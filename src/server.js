import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import {
  addSite,
  addCountryDictionaryRule,
  addClickEvent,
  consumeUnknownCountryHint,
  deleteCountryDictionaryRule,
  deleteSite,
  findUser,
  getDashboardStats,
  getPublicItemById,
  getSettings,
  getSiteById,
  getTrafficStats,
  listCountryDictionary,
  listBlockedProducts,
  listItemsByMerchant,
  listItemsBySite,
  listUnknownCountryHints,
  listPublicItems,
  listRecentEvents,
  listSites,
  addViewEvent,
  toggleSite,
  toggleSiteAuto,
  updateCountryDictionaryRule,
  updateSettings,
  replaceBlockedProductsForSite,
  updateSite,
  updateUserCredentials
} from './db.js';
import { runMonitorOnce, startMonitor } from './monitor.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

app.set('view engine', 'ejs');
app.set('views', 'src/views');
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '100kb' }));

app.use((req, _res, next) => {
  const settings = getSettings();
  const adminPath = `/${settings.admin_path}`;
  if (req.url === `${adminPath}/login`) {
    req.url = '/login';
  } else if (req.url === adminPath || req.url.startsWith(`${adminPath}/`)) {
    req.url = req.url.replace(adminPath, '/admin');
  }
  next();
});

app.use((req, res, next) => {
  const settings = getSettings();
  const rawPath = String(req.originalUrl || req.url || '').split('?')[0];
  if (settings.admin_path !== 'admin') {
    if (rawPath === '/admin' || rawPath.startsWith('/admin/')) {
      return res.status(404).send('Not Found');
    }
    if (rawPath === '/login' || rawPath === '/logout') {
      return res.status(404).send('Not Found');
    }
  }
  return next();
});
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-secret',
    resave: false,
    saveUninitialized: false
  })
);

function authRequired(req, res, next) {
  if (!req.session.user) {
    const settings = getSettings();
    return res.redirect(`/${settings.admin_path}/login`);
  }
  return next();
}

function adminBasePath() {
  return `/${getSettings().admin_path}`;
}

function redirectAdmin(res, suffix = '') {
  const base = adminBasePath();
  const s = suffix ? `/${String(suffix).replace(/^\/+/, '')}` : '';
  return res.redirect(`${base}${s}`);
}

app.get('/login', (req, res) => {
  const settings = getSettings();
  res.render('login', { error: '', adminBase: `/${settings.admin_path}` });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = findUser(username, password);
  if (!user) {
    const settings = getSettings();
    return res.render('login', { error: 'Invalid username or password', adminBase: `/${settings.admin_path}` });
  }
  req.session.user = { id: user.id, username: user.username };
  return redirectAdmin(res);
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    const settings = getSettings();
    res.redirect(`/${settings.admin_path}/login`);
  });
});

app.get('/', (_req, res) => {
  addViewEvent('/');
  const merchant = String(_req.query.merchant || '').trim();
  const country = String(_req.query.country || '').trim();
  const stock = String(_req.query.stock || '').trim();
  const currency = String(_req.query.currency || '').trim().toUpperCase();
  const priceRange = String(_req.query.priceRange || '').trim();

  function parsePriceNumber(text) {
    const s = String(text || '');
    const match = s.match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : 0;
  }

  const allItems = listPublicItems().map((item) => {
    let raw = {};
    try {
      raw = JSON.parse(item.raw_json || '{}');
    } catch (_e) {
      raw = {};
    }
    return {
      ...item,
      _country: raw.country || '未知',
      _priceNum: parsePriceNumber(item.price)
    };
  });

  const merchants = [...new Set(allItems.map((i) => i.site_name).filter(Boolean))].sort();
  const countries = [...new Set(allItems.map((i) => i._country).filter(Boolean))].sort();

  let minPrice = 0;
  let maxPrice = 0;
  const rangeMatch = priceRange.match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/);
  if (rangeMatch) {
    minPrice = Number(rangeMatch[1]);
    maxPrice = Number(rangeMatch[2]);
  }

  const items = allItems.filter((item) => {
    if (merchant && item.site_name !== merchant) return false;
    if (country && item._country !== country) return false;
    if (stock === 'in' && item.in_stock !== 1) return false;
    if (stock === 'out' && item.in_stock !== 0) return false;
    if (currency && !String(item.price || '').toUpperCase().includes(currency)) return false;
    if (minPrice > 0 && item._priceNum < minPrice) return false;
    if (maxPrice > 0 && item._priceNum > maxPrice) return false;
    return true;
  });

  const sites = listSites();
  const recent = listRecentEvents(500);
  const merchantCards = sites
    .filter((s) => s.enabled === 1)
    .map((s) => {
      const ev = recent.filter((e) => e.site_name === s.name && /sync_success|site_error|empty_result/.test(String(e.event_type || ''))).slice(0, 12);
      const squares = Array.from({ length: 12 }, (_, i) => {
        const one = ev[i];
        if (!one) return 'unknown';
        return String(one.event_type) === 'sync_success' ? 'ok' : 'bad';
      });
      return {
        siteName: s.name,
        productCount: items.filter((it) => it.site_name === s.name).length,
        squares
      };
    });

  const isFiltered = Boolean(merchant || country || stock || currency || priceRange);

  return res.render('public', {
    items,
    merchants,
    countries,
    merchantCards,
    isFiltered,
    filters: { merchant, country, stock, currency, priceRange },
    settings: getSettings()
  });
});

app.get('/go/:itemId', (req, res) => {
  const itemId = Number(req.params.itemId);
  const item = getPublicItemById(itemId);
  if (!item) return res.status(404).send('Item not found');
  let raw = {};
  try { raw = JSON.parse(item.raw_json || '{}'); } catch (_e) { raw = {}; }
  const url = raw.affLink || '#';
  addClickEvent(item.id, item.site_id);
  return res.redirect(url);
});

app.post('/track-click', (req, res) => {
  try {
    const itemId = Number((req.body && req.body.itemId) || 0);
    const siteId = Number((req.body && req.body.siteId) || 0);
    if (itemId > 0 && siteId > 0) {
      addClickEvent(itemId, siteId);
    }
  } catch (_e) {
  }
  return res.status(204).end();
});

app.get('/admin', authRequired, (req, res) => {
  return redirectAdmin(res, 'dashboard');
});

app.get('/admin/dashboard', authRequired, (req, res) => {
  const period = String(req.query.period || 'today');
  const startDate = String(req.query.startDate || '');
  const endDate = String(req.query.endDate || '');
  const stats = getDashboardStats();
  const events = listRecentEvents(20);
  const traffic = getTrafficStats({ period, startDate, endDate });
  const settings = getSettings();
  return res.render('admin-dashboard', { user: req.session.user, adminBase: `/${settings.admin_path}`, stats, events, traffic, filters: { period, startDate, endDate } });
});

app.get('/admin/profile', authRequired, (req, res) => {
  return res.render('admin-profile', {
    user: req.session.user,
    adminBase: `/${getSettings().admin_path}`,
    accountError: '',
    accountSuccess: '',
    settings: getSettings(),
    settingsSuccess: ''
  });
});

app.get('/admin/sites', authRequired, (req, res) => {
  const sites = listSites();
  return res.render('admin-sites', { user: req.session.user, adminBase: `/${getSettings().admin_path}`, sites });
});

app.get('/admin/blocked-products', authRequired, (req, res) => {
  const sites = listSites();
  const selectedSiteId = Number(req.query.siteId || 0);
  const selectedSite = selectedSiteId ? sites.find((s) => s.id === selectedSiteId) : null;
  const items = selectedSite ? listItemsByMerchant(selectedSiteId) : [];
  const blocked = listBlockedProducts().filter((b) => Number(b.site_id) === selectedSiteId);
  const blockedSet = new Set(blocked.map((b) => String(b.title || '').trim()));
  return res.render('admin-blocked-products', {
    user: req.session.user,
    adminBase: `/${getSettings().admin_path}`,
    sites,
    selectedSiteId,
    items,
    blockedSet
  });
});

app.post('/admin/blocked-products', authRequired, (req, res) => {
  const siteId = Number(req.body.siteId || 0);
  const titles = req.body.blockedTitles
    ? Array.isArray(req.body.blockedTitles)
      ? req.body.blockedTitles
      : [req.body.blockedTitles]
    : [];
  replaceBlockedProductsForSite(siteId, titles);
  return res.redirect(`/${getSettings().admin_path}/blocked-products?siteId=${siteId}`);
});

app.get('/admin/countries', authRequired, (req, res) => {
  return res.render('admin-countries', {
    user: req.session.user,
    adminBase: `/${getSettings().admin_path}`,
    countryRules: listCountryDictionary(),
    unknownHints: listUnknownCountryHints().slice(0, 80)
  });
});

app.get('/admin/events', authRequired, (req, res) => {
  const events = listRecentEvents(120);
  return res.render('admin-events', { user: req.session.user, adminBase: `/${getSettings().admin_path}`, events });
});

app.post('/admin/country-rules', authRequired, (req, res) => {
  const { country, keyword } = req.body;
  const result = addCountryDictionaryRule(String(country || ''), String(keyword || ''));
  if (result.ok) {
    consumeUnknownCountryHint(String(keyword || ''));
  }
  return redirectAdmin(res, 'countries');
});

app.post('/admin/country-rules/:id/edit', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const { country, keyword } = req.body;
  updateCountryDictionaryRule(id, country, keyword);
  return redirectAdmin(res, 'countries');
});

app.post('/admin/country-rules/:id/delete', authRequired, (req, res) => {
  const id = Number(req.params.id);
  deleteCountryDictionaryRule(id);
  return redirectAdmin(res, 'countries');
});

app.post('/admin/account', authRequired, (req, res) => {
  const { username, password } = req.body;
  if (!username || String(username).trim().length < 3) {
    return res.render('admin-profile', { user: req.session.user, adminBase: `/${getSettings().admin_path}`, accountError: '用户名至少3位', accountSuccess: '', settings: getSettings(), settingsSuccess: '' });
  }

  const result = updateUserCredentials(req.session.user.id, String(username).trim(), String(password || '').trim());
  if (!result.ok) {
    return res.render('admin-profile', { user: req.session.user, adminBase: `/${getSettings().admin_path}`, accountError: result.message, accountSuccess: '', settings: getSettings(), settingsSuccess: '' });
  }

  req.session.user.username = result.user.username;
  return res.render('admin-profile', { user: req.session.user, adminBase: `/${getSettings().admin_path}`, accountError: '', accountSuccess: '账号信息更新成功', settings: getSettings(), settingsSuccess: '' });
});

app.post('/admin/settings', authRequired, (req, res) => {
  const { publicTitle, publicBackgroundImage, telegramBotToken, telegramChatId, adminPath } = req.body;
  updateSettings({
    public_title: publicTitle,
    public_background_image: publicBackgroundImage,
    telegram_bot_token: telegramBotToken,
    telegram_chat_id: telegramChatId,
    admin_path: adminPath
  });
  const latest = getSettings();
  return res.render('admin-profile', {
    user: req.session.user,
    adminBase: `/${latest.admin_path}`,
    accountError: '',
    accountSuccess: '',
    settings: latest,
    settingsSuccess: `系统设置更新成功，新的后台地址：/${latest.admin_path}`
  });
});

app.post('/admin/sites', authRequired, (req, res) => {
  const { name, url, parserType, enabled, autoEnabled, checkIntervalMinutes, requestTimeoutMs, retryCount, fetchMode, cfWaitMs } = req.body;
  addSite({
    name,
    url,
    aff_base_url: url,
    parser_type: parserType || 'whmcs',
    enabled: Boolean(enabled),
    auto_enabled: Boolean(autoEnabled),
    check_interval_minutes: Number(checkIntervalMinutes || 5),
    request_timeout_ms: Number(requestTimeoutMs || 20000),
    retry_count: Number(retryCount || 2),
    fetch_mode: fetchMode || 'http',
    cf_wait_ms: Number(cfWaitMs || 7000)
  });
  return redirectAdmin(res, 'sites');
});

app.post('/admin/sites/:id/edit', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const { name, url, parserType, enabled, autoEnabled, checkIntervalMinutes, requestTimeoutMs, retryCount, fetchMode, cfWaitMs } = req.body;
  updateSite(id, {
    name,
    url,
    aff_base_url: url,
    parser_type: parserType || 'whmcs',
    enabled: Boolean(enabled),
    auto_enabled: Boolean(autoEnabled),
    check_interval_minutes: Number(checkIntervalMinutes || 5),
    request_timeout_ms: Number(requestTimeoutMs || 20000),
    retry_count: Number(retryCount || 2),
    fetch_mode: fetchMode || 'http',
    cf_wait_ms: Number(cfWaitMs || 7000)
  });
  return redirectAdmin(res, 'sites');
});

app.get('/admin/sites/:id/edit', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const site = getSiteById(id);
  if (!site) {
    return res.status(404).send('Site not found');
  }
  return res.render('edit-site', { site, adminBase: `/${getSettings().admin_path}` });
});

app.post('/admin/sites/:id/toggle', authRequired, (req, res) => {
  const id = Number(req.params.id);
  toggleSite(id);
  return redirectAdmin(res, 'sites');
});

app.post('/admin/sites/:id/toggle-auto', authRequired, (req, res) => {
  const id = Number(req.params.id);
  toggleSiteAuto(id);
  return redirectAdmin(res, 'sites');
});

app.post('/admin/sites/:id/run-once', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  await runMonitorOnce(id);
  return redirectAdmin(res, 'sites');
});

app.post('/admin/sites/:id/delete', authRequired, (req, res) => {
  const id = Number(req.params.id);
  deleteSite(id);
  return redirectAdmin(res, 'sites');
});

app.get('/admin/inventory/:siteId', authRequired, (req, res) => {
  const siteId = Number(req.params.siteId);
  const site = getSiteById(siteId);
  if (!site) {
    return res.status(404).send('Site not found');
  }
  const items = listItemsBySite(siteId);
  return res.render('inventory', { site, items, adminBase: `/${getSettings().admin_path}` });
});

startMonitor();

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
