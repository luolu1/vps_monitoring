import cron from 'node-cron';
import {
  addEvent,
  consumeUnknownCountryHint,
  listCountryDictionary,
  listEnabledSites,
  markSiteSynced,
  replaceItemsBySite,
  getSettings,
  upsertUnknownCountryHint
} from './db.js';
import { buildAffLink, fetchInventoryWithMeta } from './scraper.js';
import { sendTelegram } from './notify.js';

// siteId -> lock start timestamp(ms)
const siteRunLocks = new Map();

function lockTtlMs(site) {
  const intervalMin = Math.max(1, Number(site.check_interval_minutes || 5));
  return Math.max(intervalMin * 3 * 60 * 1000, 15 * 60 * 1000);
}

function acquireSiteLock(site) {
  const siteId = Number(site.id);
  const now = Date.now();
  const startedAt = Number(siteRunLocks.get(siteId) || 0);
  if (!startedAt) {
    siteRunLocks.set(siteId, now);
    return { ok: true, staleRecovered: false };
  }

  const ttl = lockTtlMs(site);
  if (now - startedAt > ttl) {
    siteRunLocks.set(siteId, now);
    return { ok: true, staleRecovered: true };
  }
  return { ok: false, staleRecovered: false };
}

function releaseSiteLock(site) {
  siteRunLocks.delete(Number(site.id));
}

function parseTime(value) {
  if (!value) return null;
  const iso = String(value).replace(' ', 'T') + 'Z';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function shouldRunAuto(site) {
  const intervalMin = Math.max(1, Number(site.check_interval_minutes || 5));
  const last = parseTime(site.last_sync_at);
  if (!last) return true;
  return Date.now() - last >= intervalMin * 60 * 1000;
}

function buildSnapshot(site, items) {
  return items.map((item) => {
    const affLink = buildAffLink(site.aff_base_url, item.href || '', item, site);
    const rawJson = JSON.stringify({ ...item, affLink });
    return { ...item, rawJson };
  });
}

function normalize(text) {
  return String(text || '').toLowerCase();
}

function applyCountryDictionary(item, dictionary) {
  if (item.country && item.country !== '未知') {
    return item;
  }
  const merged = `${item.title || ''} ${item.config || ''}`.toLowerCase();
  for (const rule of dictionary) {
    const keyword = normalize(rule.keyword).trim();
    if (!keyword) continue;
    if (merged.includes(keyword)) {
      return { ...item, country: rule.country };
    }
  }
  return item;
}

function learnUnknownCountry(item) {
  if (item.country && item.country !== '未知') {
    return;
  }
  const text = `${item.title || ''} ${item.config || ''}`;
  const tokens = text.match(/[\p{L}\p{N}\-]{2,}/gu) || [];
  const stopwords = new Set([
    'cpu', 'vcpu', 'ram', 'ssd', 'nvme', 'ipv4', 'ipv6', 'tb', 'gb', 'mbps', 'kvm', 'virtualization',
    'port', 'speed', 'limited', 'traffic', 'exceeded', 'network', 'ddos', 'anti', 'unlock', 'netflix',
    'cogent', 'he', 'eie', 'isp', 'test', 'ip', 'sale', 'pro', 'vps', 'cloud', 'server', 'bandwidth',
    'monthly', 'yearly', 'month', 'year', 'price', 'start', 'from', 'or', 'and', 'in', 'out'
  ]);
  const unique = [...new Set(tokens.map((t) => t.toLowerCase()))]
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => token.length >= 2 && token.length <= 24)
    .filter((token) => !stopwords.has(token))
    .filter((token) => /[a-z\p{L}]/u.test(token))
    .slice(0, 10);
  for (const token of unique) {
    upsertUnknownCountryHint(token, item.title || '', item.config || '');
  }
}

export async function runMonitorOnce(siteId = null) {
  const sites = listEnabledSites().filter((s) => (siteId ? s.id === Number(siteId) : true));
  for (const site of sites) {
    const lock = acquireSiteLock(site);
    if (!lock.ok) {
      addEvent(site.id, 'site_skip', site.name, null, 0, 'skip_running');
      continue;
    }
    try {
      if (lock.staleRecovered) {
        addEvent(site.id, 'site_lock', site.name, null, 0, 'stale_lock_recovered');
      }
      const result = await fetchInventoryWithMeta(site);
      const dict = listCountryDictionary();
      const items = (result.items || []).map((item) => applyCountryDictionary(item, dict));
      const meta = result.meta || {};
      if (!items || items.length === 0) {
        addEvent(site.id, 'site_empty', site.name, null, 0, 'empty_result');
        continue;
      }
      items.forEach((item) => {
        if (item.country === '未知') {
          learnUnknownCountry(item);
        }
      });
      const snapshot = buildSnapshot(site, items);
      replaceItemsBySite(site.id, snapshot);
      markSiteSynced(site.id);
      addEvent(site.id, 'site_sync', site.name, null, items.length, 'sync_success');
      const settings = getSettings();
      await sendTelegram(settings, `✅ 同步成功\n商家: ${site.name}\n产品数: ${items.length}`);
      addEvent(
        site.id,
        'site_diag',
        site.name,
        null,
        items.length,
        `diag:mode=${meta.mode || 'unknown'};cat_found=${meta.categoryFound || 0};cat_ok=${meta.categorySuccess || 0};products=${meta.productCount || items.length}`
      );
    } catch (error) {
      addEvent(site.id, 'site_error', site.name, null, 0, `error:${String(error.message || error)}`);
      const settings = getSettings();
      await sendTelegram(settings, `❌ 同步失败\n商家: ${site.name}\n错误: ${String(error.message || error)}`);
    } finally {
      releaseSiteLock(site);
    }
  }
}

export function startMonitor() {
  cron.schedule('* * * * *', async () => {
    const sites = listEnabledSites().filter((s) => shouldRunAuto(s));
    for (const site of sites) {
      await runMonitorOnce(site.id);
    }
  });
}
