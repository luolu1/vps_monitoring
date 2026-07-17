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
  root.find('.product-desc-item').each((_, el) => {
    const text = normalizeText($(el).text());
    if (text) lines.push(text);
  });
  root.find('.products-desc-item').each((_, el) => {
    const item = $(el);
    const title = normalizeText(item.find('.desc-item-title').first().text());
    const value = normalizeText(item.find('.desc-item-value').first().text());
    const full = normalizeText(item.text());
    if (title && value) {
      lines.push(`${title}: ${value}`);
    } else if (full) {
      lines.push(full);
    }
  });
  root.find('ul.text-center li, ul.list-unstyled li').each((_, li) => {
    const item = $(li);
    const value = normalizeText(item.find('b, strong').first().text());
    const full = normalizeText(item.text());
    const label = normalizeText(full.replace(value, ''));
    if (label && value) {
      lines.push(`${label}: ${value}`);
    } else if (full) {
      lines.push(full);
    }
  });
  const compact = lines.join('\n');
  const descHtml = root.find('.product-desc, .product-info, .description, .desc').first().html();
  if (descHtml) {
    const normalized = descHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .split('\n')
      .map((s) => normalizeText(s))
      .filter(Boolean)
      .join('\n');
    if (normalized && normalized.length > compact.length) return normalized;
  }
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
  $('.product, .product-item, .server-item, .package, .tt-single-product, .cart-products-item, .card.card-body.align-items-center').each((_, el) => {
    const root = $(el);
    const wrapperId = (root.attr('id') || root.find('[pid]').first().attr('pid') || '').trim();
    const orderBtnId = (root.find('a.btn-order-now').attr('id') || '').trim();
    const title = normalizeText(root.find('h2, h3, h4, .title, .product-title, .product-name, .cart-products-title, header span, [id$="-name"]').first().text());
    const price = normalizeText(root.find('.price, .product-price, .product-pricing, .cart-products-price, .price-cls').first().text());
    const billingPeriod = extractBillingPeriod(root);
    const config = extractWhmcsConfig($, root);
    const country = detectCountry(title, config);
    const stockText = normalizeText(root.text()).toLowerCase();
    const qtyText = normalizeText(root.find('.qty, .cart-products-qty').first().text());
    const qtyMatch = qtyText.match(/(\d+)/);
    const qty = qtyMatch ? Number(qtyMatch[1]) : null;

    if (!title) return;

    let inStock = 1;
    if (qty !== null) inStock = qty > 0 ? 1 : 0;
    if (root.find('.none-stock').length > 0 || stockText.includes('out of stock') || stockText.includes('sold out') || stockText.includes('unavailable') || stockText.includes('缺货') || stockText.includes('无货') || stockText.includes('售罄') || stockText.includes('0 可用')) {
      inStock = 0;
    }

    const hrefFromAnchor = root.find('a.btn-order-now, a[href*="/store/"], a[href*="pid="], a[href*="cart.php"]').first().attr('href') || '';
    const onclick = root.find('button[onclick]').first().attr('onclick') || '';
    const hrefFromOnclick = (onclick.match(/window\.location\.href\s*=\s*['\"]([^'\"]+)['\"]/i) || [])[1] || '';
    const href = toAbsoluteUrl(pageUrl, hrefFromAnchor || hrefFromOnclick);
    let pid = null;
    try {
      const u = new URL(href);
      const pidFromQuery = u.searchParams.get('pid');
      if (pidFromQuery && /^\d+$/.test(pidFromQuery)) pid = Number(pidFromQuery);
    } catch (_e) { }
    if (!pid) {
      const pidFromAttr = root.find('[pid]').first().attr('pid');
      if (pidFromAttr && /^\d+$/.test(pidFromAttr)) {
        pid = Number(pidFromAttr);
      }
    }
    if (!pid) {
      const pidMatch = wrapperId.match(/^product(\d+)$/i) || wrapperId.match(/^(\d+)$/) || orderBtnId.match(/^product(\d+)-order-button$/i);
      pid = pidMatch ? Number(pidMatch[1]) : null;
    }
    const finalHref = href || (pid ? toAbsoluteUrl(pageUrl, `/cart.php?a=add&pid=${pid}`) : '');
    if (!pid && !/\/store\//i.test(finalHref) && !/cart\.php\?a=add/i.test(finalHref)) {
      return;
    }
    products.push({ itemKey: String(pid || finalHref || title), title, price, billingPeriod, country, config, inStock, href: finalHref, pid, qty });
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
  $('a[href]').each((_, el) => {
    const raw = ($(el).attr('href') || '').trim();
    if (!raw) return;
    const href = toAbsoluteUrl(pageUrl, raw);
    if (/\/cart\.php\?gid=\d+/i.test(href) || /\/index\.php\?rp=\/store\//i.test(href) || /\/store\/[a-z0-9\-_%]+/i.test(href)) {
      links.push(href);
    }
  });
  $('a[href]').each((_, el) => {
    const raw = ($(el).attr('href') || '').trim();
    if (!raw) return;
    const href = toAbsoluteUrl(pageUrl, raw);
    if (/\/pages\/(cloud-instance|baremetal-instance)/i.test(href)) {
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

function getBillingPeriodLabel(period) {
  const text = String(period || '');
  return /monthly/i.test(text) ? '/月'
    : /quarterly/i.test(text) ? '/季度'
    : /semi-annually/i.test(text) ? '/半年'
    : /annually|yearly/i.test(text) ? '/年'
    : /biennially/i.test(text) ? '/两年'
    : /triennially/i.test(text) ? '/三年'
    : '';
}

function getBillingCycleWeight(period) {
  const text = String(period || '').toLowerCase();
  if (text.includes('monthly')) return 1;
  if (text.includes('quarterly')) return 3;
  if (text.includes('semi-annually')) return 6;
  if (text.includes('annually') || text.includes('yearly')) return 12;
  if (text.includes('biennially')) return 24;
  if (text.includes('triennially')) return 36;
  return 999;
}

function normalizeBwhPriceOptions(prices = []) {
  return [...prices]
    .map((one) => ({
      cents: Number(one.cents || 0),
      currency: String(one.currency || 'USD'),
      period: String(one.period || ''),
      billingPeriod: getBillingPeriodLabel(one.period),
      cycleWeight: getBillingCycleWeight(one.period)
    }))
    .sort((a, b) => a.cycleWeight - b.cycleWeight || a.cents - b.cents);
}

function formatBwhPrice(prices = []) {
  const options = normalizeBwhPriceOptions(prices);
  const preferred = options[0] || null;
  if (!preferred) return { price: '', billingPeriod: '', priceOptions: [] };
  const amount = preferred.cents / 100;
  return {
    price: `${preferred.currency} ${amount.toFixed(2)}`,
    billingPeriod: preferred.billingPeriod,
    priceOptions: options.map((option) => ({
      price: `${option.currency} ${(option.cents / 100).toFixed(2)}`,
      billingPeriod: option.billingPeriod,
      period: option.period,
      cycleWeight: option.cycleWeight
    }))
  };
}

function buildBwhConfig(item) {
  const datacenters = Object.keys(item.datacenters || {});
  const lines = [
    `CPU: ${item.cpu || 0} 核`,
    `内存: ${item.ram || 0} MB`,
    `硬盘: ${item.ssd || 0} MB`,
    `流量: ${item.transfer || 0} MB`,
    `端口: ${item.link || 0} Mbps`
  ];
  if (item.tiers && item.tiers.length > 0) {
    lines.push(`分类: ${item.tiers.join(', ')}`);
  }
  if (datacenters.length > 0) {
    lines.push(`机房: ${datacenters.join(', ')}`);
  }
  return lines.join('\n');
}

async function fetchBwhInventory(site) {
  const apiUrl = toAbsoluteUrl(site.url, '/order/get-data');
  const response = await axios.get(apiUrl, {
    timeout: Number(site.request_timeout_ms || 20000),
    validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json,text/plain,*/*'
    }
  });
  if (response.status >= 400) throw new Error(`http_${response.status}`);
  const list = Array.isArray(response.data)
    ? response.data
    : Array.isArray(response.data && response.data.products)
      ? response.data.products
      : [];
  return list.map((item) => {
    const formatted = formatBwhPrice(item.prices || []);
    const config = buildBwhConfig(item);
    return {
      itemKey: String(item.id || item.name || ''),
      title: String(item.name || '').trim(),
      price: formatted.price,
      billingPeriod: formatted.billingPeriod,
      priceOptions: formatted.priceOptions,
      country: detectCountry(String(item.name || ''), config),
      config,
      inStock: item.outOfStock ? 0 : 1,
      href: '',
      pid: Number(item.id || 0) || null,
      qty: item.outOfStock ? 0 : null
    };
  }).filter((item) => item.title);
}

function parseDmitCartProducts(html, pageUrl) {
  const $ = cheerio.load(html);
  const products = [];

  $('.cart-products-item').each((_, el) => {
    const root = $(el);
    const box = root.find('.cart-products-box').first();
    const title = normalizeText(root.find('.cart-products-title').first().text());
    if (!title) return;

    const pidText = String(box.attr('pid') || '').trim();
    const pid = /^\d+$/.test(pidText) ? Number(pidText) : null;
    const priceNum = normalizeText(root.find('.price-num').first().text());
    const priceSuffix = normalizeText(root.find('.price-suffix').first().text()) || 'USD';
    const pricePrefix = normalizeText(root.find('.price-prefix').first().text()) || '$';
    const billingText = normalizeText(root.find('.billing-cycle-text').first().text());
    const qtyText = normalizeText(root.find('.cart-products-qty').first().text());
    const config = extractWhmcsConfig($, root);
    const country = detectCountry(title, config);
    const href = pid ? toAbsoluteUrl(pageUrl, `/cart.php?a=add&pid=${pid}`) : '';
    const price = priceNum ? `${pricePrefix}${priceNum}${priceSuffix}` : normalizeText(root.find('.cart-products-price').first().text());
    const inStock = /out of stock|sold out|unavailable/i.test(qtyText) || box.hasClass('none-stock') ? 0 : 1;
    const billingPeriod = billingText.toLowerCase().includes('monthly') ? '/月'
      : billingText.toLowerCase().includes('quarterly') ? '/季度'
      : billingText.toLowerCase().includes('annually') || billingText.toLowerCase().includes('yearly') ? '/年'
      : billingText.toLowerCase().includes('triennially') ? '/三年'
      : billingText.toLowerCase().includes('biennially') ? '/两年'
      : '';

    products.push({
      itemKey: String(pid || href || title),
      title,
      price,
      billingPeriod,
      country,
      config,
      inStock,
      href,
      pid,
      qty: inStock ? null : 0
    });
  });

  return products;
}

function parseDmitPricingProducts(html, pageUrl) {
  const $ = cheerio.load(html);
  const products = [];
  const seen = new Set();
  const stockRegex = /(out of stock|sold out|unavailable|缺货|无货|售罄|sold\s*out|暂时缺货)/i;

  function toPidFromAttr(href) {
    const candidate = normalizeText(href || '');
    if (!candidate) return null;
    try {
      const u = new URL(toAbsoluteUrl(pageUrl, candidate));
      const pid = u.searchParams.get('pid');
      if (pid && /^\d+$/.test(pid)) return Number(pid);
    } catch (_e) {}
    const m = String(candidate || '').match(/pid=(\d+)/i);
    return m && m[1] ? Number(m[1]) : null;
  }

  function addItem({ title, price, period, stockText, configText, href, pid, pidAttr }) {
    if (!title) return;
    const finalPid = pid || toPidFromAttr(pidAttr) || toPidFromAttr(href);
    const finalHref = toAbsoluteUrl(pageUrl, href || '');
    const baseKey = String(finalPid || finalHref || title).trim();
    if (!baseKey || seen.has(baseKey)) return;
    seen.add(baseKey);

    const normalizedPrice = normalizeText(price || '');
    const normalizedConfig = normalizeText(configText || '');
    const normalizedStockText = normalizeText(stockText || '');
    const periodText = normalizeText(period || '');
    const billingPeriod = getBillingPeriodLabel(periodText) || getBillingPeriodLabel(normalizedPrice);
    const stockLower = normalizedStockText.toLowerCase();
    const inStock = stockLower.includes('out of stock') || stockLower.includes('sold out') || normalizedStockText.includes('Out of Stock') || normalizedStockText.includes('OUT OF STOCK') || stockRegex.test(stockLower) ? 0 : 1;

    if (!normalizedPrice && !normalizedConfig) return;

    products.push({
      itemKey: String(baseKey),
      title: normalizeText(title),
      price: normalizedPrice,
      billingPeriod,
      country: detectCountry(normalizedConfig ? normalizedConfig : title, normalizedConfig),
      config: normalizedConfig || title,
      inStock,
      href: finalHref,
      pid: finalPid ? Number(finalPid) || null : null,
      qty: inStock ? null : 0
    });
  }

  $('.plan-card').each((_, el) => {
    const card = $(el);
    const title = normalizeText(card.find('.plan-card-name').first().text());
    const priceText = normalizeText(card.find('.plan-card-price').first().text()).replace(/\s*\/\s*/g, '/');

    const configText = [
      card.find('.plan-card-specs').first().text(),
      card.closest('.plan-group').find(`.plan-cards`).first().text(),
      card.closest('.plan-group').attr('data-loc'),
      card.closest('.plan-group').attr('data-hw'),
      card.closest('.plan-group').attr('data-net')
    ].map((v) => normalizeText(v)).filter(Boolean).join(' | ');

    const actionNode = card.find('.plan-card-action').first();
    const btnText = normalizeText(actionNode.text());
    const stockText = normalizeText(actionNode.find('button').first().text()) || btnText;
    const disabled = actionNode.find('button.btn-order-disabled').length > 0 || /disabled/.test(String(actionNode.find('button').first().attr('disabled') || '').toLowerCase());
    const onclick = normalizeText(actionNode.find('button').first().attr('onclick') || '');
    const onclickPid = (onclick.match(/pid=(\d+)/i) || [])[1] || null;
    const hrefFromClick = normalizeText(actionNode.find('a').first().attr('href') || '');
    const pidFromAction = onclickPid ? Number(onclickPid) : null;

    const periodText = normalizeText(card.find('.plan-card-price span, .plan-card-price small').first().text());

    const normalizedHref = hrefFromClick || (pidFromAction ? `/cart.php?a=add&pid=${pidFromAction}` : '');

    addItem({
      title,
      price: priceText,
      period: periodText,
      stockText: disabled || stockRegex.test(stockText) ? 'Out of Stock' : stockText,
      configText,
      href: normalizedHref,
      pid: pidFromAction,
      pidAttr: onclick
    });
  });

  // Fallback for template variants where order buttons are rendered as plain links or nested inside different wrappers
  $('a[href], button[onclick], .btn-order').each((_, el) => {
    const node = $(el);
    const root = node.closest('.plan-card').length ? node.closest('.plan-card') : node;
    if (!/cart\.php\?a=add&pid=\d+/i.test(String(node.attr('onclick') || '')) && !/\/cart\.php\?a=add&pid=\d+/i.test(String(node.attr('href') || ''))) {
      if (!/plan-card/.test(root.attr('class') || '')) return;
    }
    const title = normalizeText(root.find('.plan-card-name').first().text()) || normalizeText(root.closest('.plan-card').find('.plan-card-name').first().text());
    if (!title) return;

    const href = normalizeText(node.attr('href') || '');
    const onclickText = normalizeText(node.attr('onclick') || '');
    const pid = toPidFromAttr(href) || toPidFromAttr(onclickText);
    const priceText = normalizeText(root.find('.plan-card-price').first().text()) || normalizeText(root.closest('.plan-card').find('.plan-card-price').first().text());
    const config = normalizeText(root.find('.plan-card-specs').first().text()) || normalizeText(root.closest('.plan-card').find('.plan-card-specs').first().text());
    const periodText = normalizeText(root.find('.plan-card-price span, .plan-card-price small').first().text());
    const stockLabel = normalizeText(node.text());
    const disabled = /disabled|out of stock/i.test(stockLabel || '');

    addItem({
      title,
      price: priceText,
      period: periodText,
      stockText: disabled ? 'Out of Stock' : (stockLabel || 'In Stock'),
      configText: config,
      href,
      pid,
      pidAttr: onclickText
    });
  });

  return products;
}

function mergeProductLists(...lists) {
  const merged = [];
  const seen = new Set();
  const append = (items) => {
    for (const item of items || []) {
      const key = String(item.itemKey || item.href || item.title || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  };
  for (const list of lists) append(list);
  return merged;
}

function isDmitOutOfStockPage(html) {
  const text = normalizeText(String(html || '')).toLowerCase();
  return text.includes('out of stock')
    || text.includes('orders for it have been suspended until more stock is available');
}

async function verifyDmitInventory(fetchPage, pageUrl, items) {
  const verified = new Array(items.length);
  let index = 0;
  const workerCount = Math.min(2, items.length);

  const workers = Array.from({ length: workerCount }, () => (async () => {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) break;

      const item = items[currentIndex];
      if (!item || !item.href || !/\/cart\.php\?a=add&pid=\d+/i.test(item.href)) {
        verified[currentIndex] = item;
        continue;
      }

      try {
        const html = await fetchPage(toAbsoluteUrl(pageUrl, item.href));
        verified[currentIndex] = {
          ...item,
          inStock: isDmitOutOfStockPage(html) ? 0 : 1
        };
      } catch (_e) {
        verified[currentIndex] = {
          ...item,
          inStock: 0
        };
      }
    }
  })());

  await Promise.all(workers);
  return verified;
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
  const siteUrl = String(site.url || '');
  const isDmitSite = /(^|\.)dmit\.io$/i.test((() => {
    try {
      return new URL(siteUrl).hostname;
    } catch (_e) {
      return '';
    }
  })());
  const isBwhSite = /(^|\.)bwh81\.net$/i.test((() => {
    try {
      return new URL(siteUrl).hostname;
    } catch (_e) {
      return '';
    }
  })());
  
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

  const fetchVerificationPage = async (url) => {
    const verifyOptions = {
      timeoutMs: Math.min(Number(fetchOptions.timeoutMs || 30000), 15000),
      retryCount: 0
    };
    return useBrowser ? await fetchHtmlWithFlareSolverr(url, verifyOptions) : await fetchHtml(url, verifyOptions);
  };

  const parserType = (site.parser_type || 'whmcs').toLowerCase();

  if (isBwhSite) {
    return await fetchBwhInventory(site);
  }

  const html = await fetchMain(site.url);

  if (isDmitSite) {
    const pricingHtml = await fetchMain(toAbsoluteUrl(site.url, '/pages/pricing')).catch(() => null);
    const cartHtml = await fetchMain(toAbsoluteUrl(site.url, '/cart.php')).catch(() => null);
    const direct = mergeProductLists(
      parseDmitPricingProducts(pricingHtml || html, site.url),
      parseDmitCartProducts(cartHtml || html, site.url),
      parseDmitCartProducts(html, site.url)
    );
    if (direct.length > 0) {
      return verifyDmitInventory(fetchMain, site.url, direct);
    }

    const fallback = mergeProductLists(
      parseTechnovmProducts(pricingHtml || html, site.url),
      parseTechnovmProducts(cartHtml || html, site.url),
      parseTechnovmProducts(html, site.url)
    );
    if (fallback.length > 0) {
      return fallback;
    }

    return [];
  }

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

    const storeLinks = [...new Set([...baseStoreUrls, ...discoveredStoreLinks])];
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
