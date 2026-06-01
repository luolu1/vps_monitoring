import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = path.resolve('data.json');
const APP_CONFIG_PATH = path.resolve('app.config.json');

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function createDefault() {
  return {
    counters: { users: 1, sites: 1, items: 1, events: 1 },
    users: [{ id: 1, username: 'admin', password: 'admin123', created_at: now() }],
    country_dictionary: [],
    country_unknown_hints: [],
    click_events: [],
    view_events: [],
    blocked_products: [],
    settings: {
      public_title: 'VPS库存监控前台',
      public_background_image: '',
      telegram_bot_token: '',
      telegram_chat_id: '',
      admin_path: 'admin',
      monitor_concurrency: 5,
      monitor_idle_delay_ms: 3000,
      monitor_site_timeout_ms: 0
    },
    monitor_sites: [],
    inventory_items: [],
    inventory_events: []
  };
}

function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    const init = createDefault();
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2), 'utf8');
    return init;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const cleaned = String(raw || '').replace(/^\uFEFF/, '').trim();
    if (!cleaned) {
      const init = createDefault();
      fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2), 'utf8');
      return init;
    }
    return JSON.parse(cleaned);
  } catch (_e) {
    const backupPath = `${DB_PATH}.broken.${Date.now()}.bak`;
    try {
      fs.copyFileSync(DB_PATH, backupPath);
    } catch (_ignore) {
    }
    const init = createDefault();
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2), 'utf8');
    return init;
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function readAppConfig() {
  if (!fs.existsSync(APP_CONFIG_PATH)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(APP_CONFIG_PATH, 'utf8');
    const cleaned = String(raw || '').replace(/^\uFEFF/, '').trim();
    if (!cleaned) return null;
    return JSON.parse(cleaned);
  } catch (_e) {
    return null;
  }
}

export function getAppConfig() {
  const cfg = readAppConfig() || {};
  const serverCfg = cfg.server || {};
  const adminCfg = cfg.admin || {};
  const publicCfg = cfg.public || {};
  const telegramCfg = cfg.telegram || {};
  const monitorCfg = cfg.monitor || {};
  const flaresolverrCfg = cfg.flaresolverr || {};

  return {
    server: {
      host: String(serverCfg.host || '0.0.0.0').trim() || '0.0.0.0',
      port: Number.isFinite(Number(serverCfg.port)) ? Math.max(1, Math.min(65535, Math.floor(Number(serverCfg.port)))) : 3000
    },
    admin: {
      username: String(adminCfg.username || '').trim() || 'admin',
      password: String(adminCfg.password || '').trim() || 'admin123',
      path: String(adminCfg.path || 'admin').trim().replace(/^\/+|\/+$/g, '') || 'admin'
    },
    public: {
      title: String(publicCfg.title || '').trim() || 'VPS库存监控前台',
      backgroundImage: String(publicCfg.backgroundImage || '').trim()
    },
    telegram: {
      botToken: String(telegramCfg.botToken || '').trim(),
      chatId: String(telegramCfg.chatId || '').trim()
    },
    flaresolverr: {
      url: String(flaresolverrCfg.url || '').trim() || 'http://127.0.0.1:8191/v1'
    },
    monitor: {
      concurrency: Number.isFinite(Number(monitorCfg.concurrency)) ? Math.max(1, Math.min(30, Math.floor(Number(monitorCfg.concurrency)))) : 5,
      idleDelayMs: Number.isFinite(Number(monitorCfg.idleDelayMs)) ? Math.max(1000, Math.min(60000, Math.floor(Number(monitorCfg.idleDelayMs)))) : 3000,
      siteTimeoutMs: Number.isFinite(Number(monitorCfg.siteTimeoutMs)) ? Math.max(0, Math.min(3600000, Math.floor(Number(monitorCfg.siteTimeoutMs)))) : 0
    }
  };
}

export function applyAppConfigOverrides() {
  const cfg = readAppConfig();
  if (!cfg || typeof cfg !== 'object') return { ok: false, applied: false };

  const db = readDb();
  db.settings = db.settings || {};
  db.users = db.users || [];

  const adminCfg = cfg.admin || {};
  const publicCfg = cfg.public || {};
  const telegramCfg = cfg.telegram || {};
  const monitorCfg = cfg.monitor || {};

  const nextUsername = String(adminCfg.username || '').trim();
  const nextPassword = String(adminCfg.password || '').trim();
  const nextAdminPath = String(adminCfg.path || '').trim().replace(/^\/+|\/+$/g, '');

  let changed = false;
  if (nextUsername) {
    const adminUser = db.users.find((u) => Number(u.id) === 1) || db.users[0];
    if (adminUser && adminUser.username !== nextUsername) {
      adminUser.username = nextUsername;
      changed = true;
    }
  }
  if (nextPassword) {
    const adminUser = db.users.find((u) => Number(u.id) === 1) || db.users[0];
    if (adminUser && adminUser.password !== nextPassword) {
      adminUser.password = nextPassword;
      changed = true;
    }
  }
  if (nextAdminPath && db.settings.admin_path !== nextAdminPath) {
    db.settings.admin_path = nextAdminPath;
    changed = true;
  }

  const publicTitle = String(publicCfg.title || '').trim();
  const publicBackgroundImage = String(publicCfg.backgroundImage || '').trim();
  if (publicTitle && db.settings.public_title !== publicTitle) {
    db.settings.public_title = publicTitle;
    changed = true;
  }
  if (publicBackgroundImage !== '' && db.settings.public_background_image !== publicBackgroundImage) {
    db.settings.public_background_image = publicBackgroundImage;
    changed = true;
  }

  const botToken = String(telegramCfg.botToken || '').trim();
  const chatId = String(telegramCfg.chatId || '').trim();
  if (botToken !== '' && db.settings.telegram_bot_token !== botToken) {
    db.settings.telegram_bot_token = botToken;
    changed = true;
  }
  if (chatId !== '' && db.settings.telegram_chat_id !== chatId) {
    db.settings.telegram_chat_id = chatId;
    changed = true;
  }

  if (typeof monitorCfg.concurrency !== 'undefined') {
    const value = Number(monitorCfg.concurrency);
    if (Number.isFinite(value)) {
      const normalized = Math.max(1, Math.min(30, Math.floor(value)));
      if (db.settings.monitor_concurrency !== normalized) {
        db.settings.monitor_concurrency = normalized;
        changed = true;
      }
    }
  }
  if (typeof monitorCfg.idleDelayMs !== 'undefined') {
    const value = Number(monitorCfg.idleDelayMs);
    if (Number.isFinite(value)) {
      const normalized = Math.max(1000, Math.min(60000, Math.floor(value)));
      if (db.settings.monitor_idle_delay_ms !== normalized) {
        db.settings.monitor_idle_delay_ms = normalized;
        changed = true;
      }
    }
  }
  if (typeof monitorCfg.siteTimeoutMs !== 'undefined') {
    const value = Number(monitorCfg.siteTimeoutMs);
    if (Number.isFinite(value)) {
      const normalized = Math.max(0, Math.min(3600000, Math.floor(value)));
      if (db.settings.monitor_site_timeout_ms !== normalized) {
        db.settings.monitor_site_timeout_ms = normalized;
        changed = true;
      }
    }
  }

  if (changed) {
    writeDb(db);
  }
  return { ok: true, applied: true, changed };
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function nextHintId(db) {
  const maxId = db.country_unknown_hints.reduce((max, item) => Math.max(max, Number(item.id || 0)), 0);
  return maxId + 1;
}

function nextCountryRuleId(db) {
  const maxId = (db.country_dictionary || []).reduce((max, item) => Math.max(max, Number(item.id || 0)), 0);
  return maxId + 1;
}

export function findUser(username, password) {
  const db = readDb();
  return db.users.find((u) => u.username === username && u.password === password) || null;
}

export function updateUserCredentials(userId, username, password) {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    return { ok: false, message: 'User not found' };
  }
  const duplicated = db.users.find((u) => u.username === username && u.id !== userId);
  if (duplicated) {
    return { ok: false, message: 'Username already exists' };
  }
  user.username = username;
  if (password) {
    user.password = password;
  }
  writeDb(db);
  return { ok: true, user };
}

export function listSites() {
  const db = readDb();
  return [...db.monitor_sites]
    .map((s) => ({
      ...s,
      auto_enabled: typeof s.auto_enabled === 'number' ? s.auto_enabled : s.enabled,
      request_timeout_ms: Number(s.request_timeout_ms || 20000),
      retry_count: Number(s.retry_count || 2),
      fetch_mode: s.fetch_mode || 'http',
      cf_wait_ms: Number(s.cf_wait_ms || 7000)
    }))
    .sort((a, b) => b.id - a.id);
}

export function addSite(payload) {
  const db = readDb();
  const item = {
    id: ++db.counters.sites,
    name: payload.name,
    url: payload.url,
    aff_base_url: payload.aff_base_url,
    parser_type: String(payload.parser_type || 'whmcs').toLowerCase(),
    enabled: payload.enabled ? 1 : 0,
    auto_enabled: payload.auto_enabled ? 1 : 0,
    request_timeout_ms: Number(payload.request_timeout_ms || 20000),
    retry_count: Number(payload.retry_count || 2),
    fetch_mode: payload.fetch_mode || 'http',
    cf_wait_ms: Number(payload.cf_wait_ms || 7000),
    last_sync_at: null,
    created_at: now(),
    updated_at: now()
  };
  db.monitor_sites.push(item);
  writeDb(db);
  return item;
}

export function updateSite(id, payload) {
  const db = readDb();
  const site = db.monitor_sites.find((s) => s.id === id);
  if (!site) return null;
  site.name = payload.name;
  site.url = payload.url;
  site.aff_base_url = payload.aff_base_url;
  site.parser_type = String(payload.parser_type || site.parser_type || 'whmcs').toLowerCase();
  site.enabled = payload.enabled ? 1 : 0;
  site.auto_enabled = payload.auto_enabled ? 1 : 0;
  site.request_timeout_ms = Number(payload.request_timeout_ms || site.request_timeout_ms || 20000);
  site.retry_count = Number(payload.retry_count || site.retry_count || 2);
  site.fetch_mode = payload.fetch_mode || site.fetch_mode || 'http';
  site.cf_wait_ms = Number(payload.cf_wait_ms || site.cf_wait_ms || 7000);
  site.updated_at = now();
  writeDb(db);
  return site;
}

export function markSiteSynced(id) {
  const db = readDb();
  const site = db.monitor_sites.find((s) => s.id === id);
  if (!site) return null;
  site.last_sync_at = now();
  site.updated_at = now();
  writeDb(db);
  return site;
}

export function getSiteById(id) {
  const db = readDb();
  return db.monitor_sites.find((s) => s.id === id) || null;
}

export function toggleSite(id) {
  const db = readDb();
  const site = db.monitor_sites.find((s) => s.id === id);
  if (!site) return null;
  site.enabled = site.enabled ? 0 : 1;
  site.updated_at = now();
  writeDb(db);
  return site;
}

export function toggleSiteAuto(id) {
  const db = readDb();
  const site = db.monitor_sites.find((s) => s.id === id);
  if (!site) return null;
  const oldAuto = typeof site.auto_enabled === 'number' ? site.auto_enabled : site.enabled;
  site.auto_enabled = oldAuto ? 0 : 1;
  site.updated_at = now();
  writeDb(db);
  return site;
}

export function listItemsBySite(siteId) {
  const db = readDb();
  return db.inventory_items.filter((i) => i.site_id === siteId).sort((a, b) => b.id - a.id);
}

export function listPublicItems() {
  const db = readDb();
  const enabledSiteIds = new Set(db.monitor_sites.filter((s) => s.enabled === 1).map((s) => s.id));
  const blockedSet = new Set((db.blocked_products || []).map((b) => `${Number(b.site_id)}::${String(b.title || '').trim()}`));
  return db.inventory_items
    .filter((i) => enabledSiteIds.has(i.site_id))
    .filter((i) => !blockedSet.has(`${Number(i.site_id)}::${String(i.title || '').trim()}`))
    .map((i) => ({
      ...i,
      site_name: (db.monitor_sites.find((s) => s.id === i.site_id) || {}).name || '-'
    }))
    .sort((a, b) => {
      if (a.in_stock !== b.in_stock) return b.in_stock - a.in_stock;
      return b.id - a.id;
    });
}

export function getPublicItemById(id) {
  const db = readDb();
  const itemId = Number(id);
  const item = db.inventory_items.find((i) => i.id === itemId);
  if (!item) return null;
  const site = db.monitor_sites.find((s) => s.id === item.site_id);
  if (!site || site.enabled !== 1) return null;
  return { ...item, site_name: site.name };
}

export function listBlockedProducts() {
  const db = readDb();
  return [...(db.blocked_products || [])].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
}

export function listItemsByMerchant(siteId) {
  const db = readDb();
  const id = Number(siteId || 0);
  if (!id) return [];
  return db.inventory_items.filter((i) => i.site_id === id).sort((a, b) => b.id - a.id);
}

export function replaceBlockedProductsForSite(siteId, titles) {
  const db = readDb();
  const id = Number(siteId || 0);
  if (!id) return;
  const keep = (db.blocked_products || []).filter((b) => Number(b.site_id) !== id);
  const uniqueTitles = [...new Set((titles || []).map((t) => String(t || '').trim()).filter(Boolean))];
  let nextId = keep.reduce((m, x) => Math.max(m, Number(x.id || 0)), 0) + 1;
  const add = uniqueTitles.map((title) => ({ id: nextId++, site_id: id, title, created_at: now() }));
  db.blocked_products = [...keep, ...add];
  writeDb(db);
}

export function addClickEvent(itemId, siteId) {
  const db = readDb();
  db.click_events = db.click_events || [];
  db.click_events.push({
    id: db.click_events.length + 1,
    item_id: Number(itemId),
    site_id: Number(siteId),
    date: todayDate(),
    created_at: now()
  });
  writeDb(db);
}

export function addViewEvent(pathname) {
  const db = readDb();
  db.view_events = db.view_events || [];
  db.view_events.push({
    id: db.view_events.length + 1,
    path: String(pathname || '/'),
    date: todayDate(),
    created_at: now()
  });
  writeDb(db);
}

function toMs(ts) {
  if (!ts) return 0;
  const iso = String(ts).replace(' ', 'T') + 'Z';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function countInHours(events, hours) {
  const end = Date.now();
  const start = end - hours * 3600 * 1000;
  return events.filter((e) => {
    const ms = toMs(e.created_at);
    return ms >= start && ms <= end;
  }).length;
}

function formatDateLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function parseDateInput(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function aggregateByHour(events, baseDate) {
  const start = startOfDay(baseDate);
  const labels = Array.from({ length: 24 }, (_, i) => `${i}点`);
  const values = Array.from({ length: 24 }, () => 0);
  events.forEach((e) => {
    const ms = toMs(e.created_at);
    if (!ms) return;
    const d = new Date(ms);
    if (
      d.getFullYear() === start.getFullYear() &&
      d.getMonth() === start.getMonth() &&
      d.getDate() === start.getDate()
    ) {
      values[d.getHours()] += 1;
    }
  });
  return { labels, values };
}

function aggregateByDayRange(events, startDate, endDate) {
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);
  const labels = [];
  const values = [];
  const dayMs = 24 * 3600 * 1000;
  for (let t = start.getTime(); t <= end.getTime(); t += dayMs) {
    const d = new Date(t);
    const label = formatDateLocal(d);
    labels.push(label);
    const next = t + dayMs;
    const n = events.filter((e) => {
      const ms = toMs(e.created_at);
      return ms >= t && ms < next;
    }).length;
    values.push(n);
  }
  return { labels, values };
}

export function getTrafficStats(options = {}) {
  const db = readDb();
  const clickEvents = db.click_events || [];
  const viewEvents = db.view_events || [];
  const windows = [1, 6, 12, 24, 24 * 7, 24 * 30];
  const labels = ['1小时', '6小时', '12小时', '24小时', '一周', '一月'];
  const clickSeries = windows.map((h) => countInHours(clickEvents, h));
  const viewSeries = windows.map((h) => countInHours(viewEvents, h));

  const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${i}点`);
  const clickHourly = Array.from({ length: 24 }, () => 0);
  const viewHourly = Array.from({ length: 24 }, () => 0);
  const today = todayDate();
  clickEvents.forEach((e) => {
    if (e.date !== today) return;
    const d = new Date(String(e.created_at).replace(' ', 'T'));
    const hour = d.getHours();
    if (hour >= 0 && hour <= 23) {
      clickHourly[hour] += 1;
    }
  });
  viewEvents.forEach((e) => {
    if (e.date !== today) return;
    const d = new Date(String(e.created_at).replace(' ', 'T'));
    const hour = d.getHours();
    if (hour >= 0 && hour <= 23) {
      viewHourly[hour] += 1;
    }
  });

  const period = String(options.period || 'today');
  const now = new Date();
  let clickChart = { labels: hourlyLabels, values: clickHourly };
  let viewChart = { labels: hourlyLabels, values: viewHourly };

  if (period === 'yesterday') {
    const y = new Date(now.getTime() - 24 * 3600 * 1000);
    clickChart = aggregateByHour(clickEvents, y);
    viewChart = aggregateByHour(viewEvents, y);
  } else if (period === 'last24h') {
    const start = new Date(now.getTime() - 24 * 3600 * 1000);
    clickChart = aggregateByDayRange(clickEvents, start, now);
    viewChart = aggregateByDayRange(viewEvents, start, now);
  } else if (period === 'last7d') {
    const start = new Date(now.getTime() - 6 * 24 * 3600 * 1000);
    clickChart = aggregateByDayRange(clickEvents, start, now);
    viewChart = aggregateByDayRange(viewEvents, start, now);
  } else if (period === 'last14d') {
    const start = new Date(now.getTime() - 13 * 24 * 3600 * 1000);
    clickChart = aggregateByDayRange(clickEvents, start, now);
    viewChart = aggregateByDayRange(viewEvents, start, now);
  } else if (period === 'last30d') {
    const start = new Date(now.getTime() - 29 * 24 * 3600 * 1000);
    clickChart = aggregateByDayRange(clickEvents, start, now);
    viewChart = aggregateByDayRange(viewEvents, start, now);
  } else if (period === 'thisMonth') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    clickChart = aggregateByDayRange(clickEvents, start, now);
    viewChart = aggregateByDayRange(viewEvents, start, now);
  } else if (period === 'lastMonth') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    clickChart = aggregateByDayRange(clickEvents, start, end);
    viewChart = aggregateByDayRange(viewEvents, start, end);
  } else if (period === 'custom') {
    const s = parseDateInput(options.startDate);
    const e = parseDateInput(options.endDate);
    if (s && e && s.getTime() <= e.getTime()) {
      clickChart = aggregateByDayRange(clickEvents, s, e);
      viewChart = aggregateByDayRange(viewEvents, s, e);
    }
  }

  return {
    labels,
    clickSeries,
    viewSeries,
    hourlyLabels,
    clickHourly,
    viewHourly,
    chart: {
      period,
      click: clickChart,
      view: viewChart
    },
    viewTotal: viewEvents.length,
    clickTotal: clickEvents.length
  };
}

export function getDashboardStats() {
  const db = readDb();
  const sites = db.monitor_sites || [];
  const items = db.inventory_items || [];
  const clicks = db.click_events || [];
  const views = db.view_events || [];
  const today = todayDate();
  return {
    siteTotal: sites.length,
    siteEnabled: sites.filter((s) => s.enabled === 1).length,
    itemTotal: items.length,
    itemInStock: items.filter((i) => i.in_stock === 1).length,
    itemOutStock: items.filter((i) => i.in_stock !== 1).length,
    clickTotal: clicks.length,
    clickToday: clicks.filter((c) => c.date === today).length,
    viewTotal: views.length,
    viewToday: views.filter((v) => v.date === today).length
  };
}

export function getSettings() {
  const db = readDb();
  const settings = db.settings || {};
  const monitorConcurrency = Number(settings.monitor_concurrency || 5);
  const monitorIdleDelayMs = Number(settings.monitor_idle_delay_ms || 3000);
  const monitorSiteTimeoutMs = Number(settings.monitor_site_timeout_ms || 0);
  return {
    public_title: settings.public_title || 'VPS库存监控前台',
    public_background_image: settings.public_background_image || '',
    telegram_bot_token: settings.telegram_bot_token || '',
    telegram_chat_id: settings.telegram_chat_id || '',
    admin_path: String(settings.admin_path || 'admin').trim().replace(/^\/+|\/+$/g, '') || 'admin',
    monitor_concurrency: Number.isFinite(monitorConcurrency) ? Math.max(1, Math.min(30, Math.floor(monitorConcurrency))) : 5,
    monitor_idle_delay_ms: Number.isFinite(monitorIdleDelayMs) ? Math.max(1000, Math.min(60000, Math.floor(monitorIdleDelayMs))) : 3000,
    monitor_site_timeout_ms: Number.isFinite(monitorSiteTimeoutMs) ? Math.max(0, Math.min(3600000, Math.floor(monitorSiteTimeoutMs))) : 0
  };
}

export function updateSettings(payload) {
  const db = readDb();
  db.settings = db.settings || {};
  const monitorConcurrency = Number(payload.monitor_concurrency || 5);
  const monitorIdleDelayMs = Number(payload.monitor_idle_delay_ms || 3000);
  const monitorSiteTimeoutMs = Number(payload.monitor_site_timeout_ms || 0);
  db.settings.public_title = String(payload.public_title || '').trim() || 'VPS库存监控前台';
  db.settings.public_background_image = String(payload.public_background_image || '').trim();
  db.settings.telegram_bot_token = String(payload.telegram_bot_token || '').trim();
  db.settings.telegram_chat_id = String(payload.telegram_chat_id || '').trim();
  db.settings.admin_path = String(payload.admin_path || 'admin').trim().replace(/^\/+|\/+$/g, '') || 'admin';
  db.settings.monitor_concurrency = Number.isFinite(monitorConcurrency) ? Math.max(1, Math.min(30, Math.floor(monitorConcurrency))) : 5;
  db.settings.monitor_idle_delay_ms = Number.isFinite(monitorIdleDelayMs) ? Math.max(1000, Math.min(60000, Math.floor(monitorIdleDelayMs))) : 3000;
  db.settings.monitor_site_timeout_ms = Number.isFinite(monitorSiteTimeoutMs) ? Math.max(0, Math.min(3600000, Math.floor(monitorSiteTimeoutMs))) : 0;
  writeDb(db);
}

export function listCountryDictionary() {
  const db = readDb();
  db.country_dictionary = (db.country_dictionary || []).map((r) => ({ ...r, id: Number(r.id || 0) || nextCountryRuleId(db) }));
  return [...db.country_dictionary]
    .sort((a, b) => a.country.localeCompare(b.country, 'zh-CN'));
}

export function addCountryDictionaryRule(country, keyword) {
  const db = readDb();
  db.country_dictionary = db.country_dictionary || [];
  const c = String(country || '').trim();
  const k = String(keyword || '').trim().toLowerCase();
  if (!c || !k) {
    return { ok: false, message: 'country or keyword empty' };
  }
  const exists = db.country_dictionary.find((r) => r.country === c && String(r.keyword || '').toLowerCase() === k);
  if (exists) {
    return { ok: false, message: 'rule exists' };
  }
  db.country_dictionary.push({ id: nextCountryRuleId(db), country: c, keyword: k, created_at: now(), updated_at: now() });
  writeDb(db);
  return { ok: true };
}

export function updateCountryDictionaryRule(id, country, keyword) {
  const db = readDb();
  db.country_dictionary = db.country_dictionary || [];
  const rule = db.country_dictionary.find((r) => Number(r.id) === Number(id));
  if (!rule) return { ok: false, message: 'rule not found' };
  const c = String(country || '').trim();
  const k = String(keyword || '').trim().toLowerCase();
  if (!c || !k) return { ok: false, message: 'country or keyword empty' };
  const duplicated = db.country_dictionary.find((r) => Number(r.id) !== Number(id) && r.country === c && String(r.keyword || '').toLowerCase() === k);
  if (duplicated) return { ok: false, message: 'rule exists' };
  rule.country = c;
  rule.keyword = k;
  rule.updated_at = now();
  writeDb(db);
  return { ok: true };
}

export function deleteCountryDictionaryRule(id) {
  const db = readDb();
  db.country_dictionary = db.country_dictionary || [];
  const before = db.country_dictionary.length;
  db.country_dictionary = db.country_dictionary.filter((r) => Number(r.id) !== Number(id));
  if (db.country_dictionary.length === before) return { ok: false, message: 'rule not found' };
  writeDb(db);
  return { ok: true };
}

export function listUnknownCountryHints() {
  const db = readDb();
  const arr = db.country_unknown_hints || [];
  return [...arr].sort((a, b) => {
    if (Number(a.count || 0) !== Number(b.count || 0)) return Number(b.count || 0) - Number(a.count || 0);
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

export function upsertUnknownCountryHint(token, sampleTitle, sampleConfig) {
  const db = readDb();
  db.country_unknown_hints = db.country_unknown_hints || [];
  const t = String(token || '').trim().toLowerCase();
  if (!t || t.length < 2) return;
  const row = db.country_unknown_hints.find((x) => String(x.token || '').toLowerCase() === t);
  if (row) {
    row.count = Number(row.count || 0) + 1;
    row.last_seen_at = now();
    if (!row.sample_title && sampleTitle) row.sample_title = sampleTitle;
    if (!row.sample_config && sampleConfig) row.sample_config = sampleConfig;
    writeDb(db);
    return;
  }
  db.country_unknown_hints.push({
    id: nextHintId(db),
    token: t,
    sample_title: sampleTitle || '',
    sample_config: sampleConfig || '',
    count: 1,
    first_seen_at: now(),
    last_seen_at: now()
  });
  writeDb(db);
}

export function consumeUnknownCountryHint(token) {
  const db = readDb();
  db.country_unknown_hints = db.country_unknown_hints || [];
  const t = String(token || '').trim().toLowerCase();
  const before = db.country_unknown_hints.length;
  db.country_unknown_hints = db.country_unknown_hints.filter((x) => String(x.token || '').toLowerCase() !== t);
  if (db.country_unknown_hints.length !== before) {
    writeDb(db);
  }
}

export function deleteSite(id) {
  const db = readDb();
  const siteId = Number(id);
  const before = db.monitor_sites.length;
  db.monitor_sites = db.monitor_sites.filter((s) => s.id !== siteId);
  if (db.monitor_sites.length === before) {
    return { ok: false, message: 'site not found' };
  }
  db.inventory_items = db.inventory_items.filter((i) => i.site_id !== siteId);
  db.inventory_events = db.inventory_events.filter((e) => e.site_id !== siteId);
  writeDb(db);
  return { ok: true };
}

export function replaceItemsBySite(siteId, items) {
  const db = readDb();
  db.inventory_items = db.inventory_items.filter((i) => i.site_id !== siteId);
  for (const item of items) {
    db.inventory_items.push({
      id: ++db.counters.items,
      site_id: siteId,
      item_key: item.itemKey,
      title: item.title,
      in_stock: item.inStock,
      price: item.price || '',
      raw_json: item.rawJson,
      last_seen_at: now()
    });
  }
  writeDb(db);
}

export function listRecentEvents(limit = 50) {
  const db = readDb();
  return db.inventory_events
    .map((e) => ({
      ...e,
      site_name: (db.monitor_sites.find((s) => s.id === e.site_id) || {}).name || '-'
    }))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

export function listEnabledSites() {
  return listSites().filter((s) => Number(s.auto_enabled) === 1);
}

export function upsertInventory(site, item, rawJson) {
  const db = readDb();
  let old = db.inventory_items.find((i) => i.site_id === site.id && i.item_key === item.itemKey);
  if (!old) {
    old = db.inventory_items.find((i) => i.site_id === site.id && i.title === item.title);
  }

  if (!old) {
    db.inventory_items.push({
      id: ++db.counters.items,
      site_id: site.id,
      item_key: item.itemKey,
      title: item.title,
      in_stock: item.inStock,
      price: item.price || '',
      raw_json: rawJson,
      last_seen_at: now()
    });
    writeDb(db);
    return { old: null };
  }

  const oldSnapshot = { ...old };
  old.item_key = item.itemKey;
  old.title = item.title;
  old.in_stock = item.inStock;
  old.price = item.price || '';
  old.raw_json = rawJson;
  old.last_seen_at = now();
  writeDb(db);
  return { old: oldSnapshot };
}

export function addEvent(siteId, itemKey, title, oldStock, newStock, eventType) {
  const db = readDb();
  db.inventory_events.push({
    id: ++db.counters.events,
    site_id: siteId,
    item_key: itemKey,
    title,
    old_stock: oldStock,
    new_stock: newStock,
    event_type: eventType,
    created_at: now()
  });
  writeDb(db);
}
