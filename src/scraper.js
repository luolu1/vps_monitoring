import axios from 'axios';
import * as cheerio from 'cheerio';
import { getAppConfig } from './db.js';

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function toAbsoluteUrl(baseUrl, href) {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).toString();
  } catch (_e) {
    return href;
  }
}

function extractWhmcsConfig($, root) {
  const lines = [];
  const pText = root.find('.product-desc p').first().html();
  if (pText) {
    const normalized = pText.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').split('\n').map((s) => normalizeText(s)).filter(Boolean);
    lines.push(...normalized);
  }
  root.find('.product-desc li').each((_, li) => {
    const item = $(li);
    const value = normalizeText(item.find('.feature-value').first().text());
    const full = normalizeText(item.text());
    const label = normalizeText(full.replace(value, ''));
    if (label && value) {
      lines.push(`${label}: ${value}`);
    } else if (full) {
      lines.push(full);
    }
  });
  const compact = lines.join('\n');
  if (compact) return compact;
  return normalizeText(root.find('.product-info, .description, .desc, p').text());
}

function extractBillingPeriod(root) {
  const pricingText = normalizeText(root.find('.product-pricing, .field-container, #productConfigurableOptions, .form-group').text()).toLowerCase();
  if (!pricingText) return '';
  if (pricingText.includes('每月') || pricingText.includes('月繳') || pricingText.includes('月缴') || pricingText.includes('monthly') || pricingText.includes('/month')) return '/月';
  if (pricingText.includes('每年') || pricingText.includes('年繳') || pricingText.includes('年缴') || pricingText.includes('annually') || pricingText.includes('yearly') || pricingText.includes('/year')) return '/年';
  if (pricingText.includes('每季度') || pricingText.includes('每季') || pricingText.includes('季繳') || pricingText.includes('季缴') || pricingText.includes('quarterly')) return '/季度';
  if (pricingText.includes('每半年') || pricingText.includes('半年繳') || pricingText.includes('半年缴') || pricingText.includes('semi-annually')) return '/半年';
  if (pricingText.includes('每两年') || pricingText.includes('每兩年') || pricingText.includes('biennially')) return '/两年';
  if (pricingText.includes('每三年') || pricingText.includes('triennially')) return '/三年';
  if (pricingText.includes('一次性') || pricingText.includes('one time') || pricingText.includes('設定費') || pricingText.includes('设置费')) return '/一次性';
  return '';
}

function findCountries(text) {
  const source = String(text || '');
  if (!source) return [];
  const lower = source.toLowerCase();
  const rules = [
    { country: '中国香港', patterns: [/hong\s*kong/i, /香港/, /(^|[^a-z0-9])hk([\W_]|$)/i, /\bhkbn\b/i] },
    { country: '中国台湾', patterns: [/taiwan/i, /台(湾|灣)/, /(^|[^a-z0-9])tw([\W_]|$)/i] },
    { country: '日本', patterns: [/japan/i, /日本|東京|东京|大阪/, /(^|[^a-z0-9])jp([\W_]|$)/i] },
    { country: '新加坡', patterns: [/singapore/i, /新加坡/, /(^|[^a-z0-9])sg([\W_]|$)/i] },
    { country: '美国', patterns: [/united\s*states|america/i, /美国/, /los\s*angeles|seattle|new\s*york|fremont/i, /(^|[^a-z0-9])us([\W_]|$)/i] },
    { country: '英国', patterns: [/united\s*kingdom|britain|england|london/i, /英国/, /(^|[^a-z0-9])uk([\W_]|$)/i] },
    { country: '德国', patterns: [/germany|frankfurt|berlin/i, /德国|德國/, /(^|[^a-z0-9])de([\W_]|$)/i] },
    { country: '加拿大', patterns: [/canada|toronto|vancouver|montreal/i, /加拿大/, /(^|[^a-z0-9])ca([\W_]|$)/i] },
    { country: '韩国', patterns: [/korea|seoul/i, /韩国|南韩|南韓|首尔|首爾/, /(^|[^a-z0-9])kr([\W_]|$)/i] },
    { country: '法国', patterns: [/france|paris/i, /法国|法國/, /(^|[^a-z0-9])fr([\W_]|$)/i] },
    { country: '荷兰', patterns: [/netherlands|amsterdam/i, /荷兰|荷蘭/, /(^|[^a-z0-9])nl([\W_]|$)/i] },
    { country: '澳大利亚', patterns: [/australia|sydney|melbourne/i, /澳大利亚|澳洲/, /(^|[^a-z0-9])au([\W_]|$)/i] }
  ];
  const found = [];
  for (const rule of rules) {
    if (rule.patterns.some((p) => p.test(lower) || p.test(source))) {
      found.push(rule.country);
    }
  }
  return [...new Set(found)];
}

function detectCountry(title, config) {
  const fromTitle = findCountries(title);
  if (fromTitle.length > 0) return fromTitle.join(' / ');
  const fromConfig = findCountries(config);
  if (fromConfig.length > 0) return fromConfig.join(' / ');
  return '未知';
}

function parseTechnovmProducts(html, pageUrl) {
  const $ = cheerio.load(html);
  const products = [];
  $('.product, .product-item, .server-item, .package, .tt-single-product').each((_, el) => {
    const root = $(el);
    const wrapperId = (root.attr('id') || '').trim();
    const orderBtnId = (root.find('a.btn-order-now').attr('id') || '').trim();
    const title = normalizeText(root.find('h2, h3, .title, .product-title, header span, [id$="-name"]').first().text());
    const price = normalizeText(root.find('.price, .product-price').first().text());
    const billingPeriod = extractBillingPeriod(root);
    const config = extractWhmcsConfig($, root);
    const country = detectCountry(title, config);
    const stockText = normalizeText(root.text()).toLowerCase();
    const qtyText = normalizeText(root.find('.qty').first().text());
    const qtyMatch = qtyText.match(/(\d+)/);
    const qty = qtyMatch ? Number(qtyMatch[1]) : null;

    if (!title) return;

    let inStock = 1;
    if (qty !== null) inStock = qty > 0 ? 1 : 0;
    if (stockText.includes('out of stock') || stockText.includes('sold out') || stockText.includes('unavailable') || stockText.includes('缺货') || stockText.includes('无货') || stockText.includes('售罄') || stockText.includes('0 可用')) {
      inStock = 0;
    }

    const href = toAbsoluteUrl(pageUrl, root.find('a.btn-order-now, a[href*="/store/"], a[href*="pid="]').first().attr('href') || '');
    let pid = null;
    try {
      const u = new URL(href);
      const pidFromQuery = u.searchParams.get('pid');
      if (pidFromQuery && /^\d+$/.test(pidFromQuery)) pid = Number(pidFromQuery);
    } catch (_e) { }
    if (!pid) {
      const pidMatch = wrapperId.match(/^product(\d+)$/i) || orderBtnId.match(/^product(\d+)-order-button$/i);
      pid = pidMatch ? Number(pidMatch[1]) : null;
    }
    products.push({ itemKey: String(pid || href || title), title, price, billingPeriod, country, config, inStock, href, pid, qty });
  });
  return products;
}

function parseTechnovmStoreLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];
  $('#Primary_Navbar-Store a[href], #Secondary_Sidebar-Categories a[href], .dropdown-menu a[href]').each((_, el) => {
    const raw = ($(el).attr('href') || '').trim();
    if (!raw) return;
    const href = toAbsoluteUrl(pageUrl, raw);
    if (!href) return;
    if (/\/cart\.php\?gid=\d+/i.test(href) || /\/index\.php\?rp=\/store\//i.test(href) || /\/store\/[a-z0-9\-_%]+/i.test(href)) {
      links.push(href);
    }
  });
  return [...new Set(links)];
}

function parseGeneric(html) {
  const $ = cheerio.load(html);
  const products = [];
  $('a').each((_, el) => {
    const title = normalizeText($(el).text());
    const href = ($(el).attr('href') || '').trim();
    if (!title || !href) return;
    if (!/vps|server|kvm|vm|cloud/i.test(title)) return;
    products.push({ itemKey: href, title, price: '', inStock: 1, href });
  });
  return products;
}

async function fetchHtml(url, options = {}) {
  const timeout = Number(options.timeoutMs || 20000);
  const response = await axios.get(url, {
    timeout,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
  });
  if (response.status >= 400) throw new Error(`http_${response.status}`);
  return String(response.data || '');
}

async function fetchHtmlWithFlareSolverr(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 30000);
  const appConfig = getAppConfig();
  const fsUrl = process.env.FLARESOLVERR_URL || appConfig.flaresolverr.url || 'http://127.0.0.1:8191/v1';

  try {
    const response = await axios.post(fsUrl, {
      cmd: 'request.get',
      url: url,
      maxTimeout: timeoutMs
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: timeoutMs + 10000
    });

    if (response.data && response.data.status === 'ok') {
      return response.data.solution.response; 
    }
    throw new Error('FlareSolverr 无法解盾');
  } catch (error) {
    throw new Error(`FlareSolverr 请求失败: ${error.message}`);
  }
}

export async function fetchInventory(site) {
  const fetchOptions = {
    timeoutMs: Number(site.request_timeout_ms || 30000),
    retryCount: Number(site.retry_count || 2)
  };
  
  const useBrowser = String(site.fetch_mode || 'http') === 'browser';
  
  const fetchMain = async (url) => {
    let lastError = null;
    for (let i = 0; i <= fetchOptions.retryCount; i++) {
      try {
        return useBrowser ? await fetchHtmlWithFlareSolverr(url, fetchOptions) : await fetchHtml(url, fetchOptions);
      } catch (error) {
        lastError = error;
        if (i < fetchOptions.retryCount) await new Promise(r => setTimeout(r, 2000));
      }
    }
    throw lastError;
  };

  const html = await fetchMain(site.url);
  const parserType = (site.parser_type || 'whmcs').toLowerCase();

  if (parserType === 'technovm' || parserType === 'whmcs') {
    const directProducts = parseTechnovmProducts(html, site.url);
    if (directProducts.length > 0) return directProducts;

    const baseStoreUrls = [
      toAbsoluteUrl(site.url, '/index.php?rp=/store'),
      toAbsoluteUrl(site.url, '/cart.php')
    ];
    const discoveredStoreLinks = [...parseTechnovmStoreLinks(html, site.url)];
    
    for (const baseStoreUrl of baseStoreUrls) {
      try {
        const storeIndexHtml = await fetchMain(baseStoreUrl);
        discoveredStoreLinks.push(...parseTechnovmStoreLinks(storeIndexHtml, baseStoreUrl));
      } catch (_e) {}
    }

    const storeLinks = [...new Set(discoveredStoreLinks)];
    const merged = [];
    const seen = new Set();

    for (const link of storeLinks) {
      try {
        const subHtml = await fetchMain(link);
        const items = parseTechnovmProducts(subHtml, link);
        for (const item of items) {
          if (seen.has(item.itemKey)) continue;
          seen.add(item.itemKey);
          merged.push(item);
        }
      } catch (_e) {}
    }
    return merged;
  }
  return parseGeneric(html);
}

export async function fetchInventoryWithMeta(site) {
  const items = await fetchInventory(site);
  return {
    items,
    meta: {
      mode: String(site.fetch_mode || 'http') === 'browser' ? 'flaresolverr' : 'http',
      categoryFound: 0,
      categorySuccess: 0,
      productCount: items.length
    }
  };
}

export function buildAffLink(baseUrl, originHref, item = null, site = null) {
  if (!originHref) {
    if (item && item.pid && /aff\.php\?/i.test(baseUrl)) return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}pid=${encodeURIComponent(String(item.pid))}`;
    return baseUrl;
  }
  const parserType = String((site && site.parser_type) || '').toLowerCase();
  if ((parserType === 'whmcs' || parserType === 'technovm') && item && item.pid && /aff\.php\?/i.test(baseUrl)) {
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}pid=${encodeURIComponent(String(item.pid))}`;
  }
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}target=${encodeURIComponent(originHref)}`;
}
