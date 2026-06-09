import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH_INPUT = process.env.DB_PATH || 'data/inventory.sqlite';
const APP_CONFIG_PATH = path.resolve('app.config.json');
const LEGACY_JSON_FILENAME = 'data.json';
const SQLITE_FALLBACK_FILENAME = 'inventory.sqlite';
const SHANGHAI_OFFSET_HOURS = 8;
const SHANGHAI_OFFSET_MS = SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000;

let sqliteDb = null;

function toShanghaiParts(date) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds()
  };
}

function shanghaiMs(year, month, day, hour = 0, minute = 0, second = 0) {
  return Date.UTC(year, month - 1, day, hour - SHANGHAI_OFFSET_HOURS, minute, second);
}

function now() {
  const parts = toShanghaiParts(new Date());
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
}

function todayDate() {
  const parts = toShanghaiParts(new Date());
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function createLegacyDefault() {
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
      public_base_url: '',
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

function ensureParentDir(filePath) {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function resolveSqlitePath() {
  const targetPath = path.resolve(DB_PATH_INPUT);
  try {
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      return path.join(targetPath, SQLITE_FALLBACK_FILENAME);
    }
  } catch (_e) {
  }
  if (path.extname(targetPath).toLowerCase() === '.sqlite') {
    return targetPath;
  }
  return path.join(path.dirname(targetPath), SQLITE_FALLBACK_FILENAME);
}

function resolveLegacyJsonPath() {
  const sqlitePath = resolveSqlitePath();
  return path.join(path.dirname(sqlitePath), LEGACY_JSON_FILENAME);
}

function readLegacyJsonDb() {
  const dbPath = resolveLegacyJsonPath();
  if (!fs.existsSync(dbPath)) {
    return createLegacyDefault();
  }
  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    const cleaned = String(raw || '').replace(/^\uFEFF/, '').trim();
    if (!cleaned) return createLegacyDefault();
    return JSON.parse(cleaned);
  } catch (_e) {
    return createLegacyDefault();
  }
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

function writeAppConfig(payload) {
  ensureParentDir(APP_CONFIG_PATH);
  fs.writeFileSync(APP_CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      public_title TEXT NOT NULL DEFAULT 'VPS库存监控前台',
      public_background_image TEXT NOT NULL DEFAULT '',
      public_base_url TEXT NOT NULL DEFAULT '',
      telegram_bot_token TEXT NOT NULL DEFAULT '',
      telegram_chat_id TEXT NOT NULL DEFAULT '',
      telegram_restock_chat_id TEXT NOT NULL DEFAULT '',
      admin_path TEXT NOT NULL DEFAULT 'admin',
      monitor_concurrency INTEGER NOT NULL DEFAULT 5,
      monitor_idle_delay_ms INTEGER NOT NULL DEFAULT 3000,
      monitor_site_timeout_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS monitor_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      aff_base_url TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      parser_type TEXT NOT NULL DEFAULT 'whmcs',
      enabled INTEGER NOT NULL DEFAULT 1,
      auto_enabled INTEGER NOT NULL DEFAULT 1,
      request_timeout_ms INTEGER NOT NULL DEFAULT 20000,
      retry_count INTEGER NOT NULL DEFAULT 2,
      fetch_mode TEXT NOT NULL DEFAULT 'http',
      cf_wait_ms INTEGER NOT NULL DEFAULT 7000,
      last_sync_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS country_dictionary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country TEXT NOT NULL,
      keyword TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS country_unknown_hints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      sample_title TEXT NOT NULL DEFAULT '',
      sample_config TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      item_key TEXT,
      title TEXT NOT NULL,
      in_stock INTEGER NOT NULL DEFAULT 0,
      price TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '',
      restock_notified INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      item_key TEXT,
      title TEXT,
      old_stock INTEGER,
      new_stock INTEGER,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS click_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      site_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS view_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocked_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_tag_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id INTEGER NOT NULL,
      site_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_monitor_sites_enabled ON monitor_sites(enabled, auto_enabled);
    CREATE INDEX IF NOT EXISTS idx_country_dictionary_keyword ON country_dictionary(keyword);
    CREATE INDEX IF NOT EXISTS idx_unknown_hints_token ON country_unknown_hints(token);
    CREATE INDEX IF NOT EXISTS idx_inventory_items_site_id ON inventory_items(site_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_items_site_key ON inventory_items(site_id, item_key);
    CREATE INDEX IF NOT EXISTS idx_inventory_items_site_title ON inventory_items(site_id, title);
    CREATE INDEX IF NOT EXISTS idx_inventory_items_stock ON inventory_items(in_stock);
    CREATE INDEX IF NOT EXISTS idx_inventory_events_site_id ON inventory_events(site_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_events_created_at ON inventory_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_click_events_date ON click_events(date);
    CREATE INDEX IF NOT EXISTS idx_view_events_date ON view_events(date);
    CREATE INDEX IF NOT EXISTS idx_blocked_products_site_id ON blocked_products(site_id);
    CREATE INDEX IF NOT EXISTS idx_product_tag_items_tag_id ON product_tag_items(tag_id);
    CREATE INDEX IF NOT EXISTS idx_product_tag_items_site_title ON product_tag_items(site_id, title);
  `);
  migrateProductTagsSchema(db);
  try {
    db.prepare("ALTER TABLE settings ADD COLUMN telegram_restock_chat_id TEXT NOT NULL DEFAULT ''").run();
  } catch (_e) {
  }
  try {
    db.prepare("ALTER TABLE settings ADD COLUMN public_base_url TEXT NOT NULL DEFAULT ''").run();
  } catch (_e) {
  }
  try {
    db.prepare('ALTER TABLE inventory_items ADD COLUMN restock_notified INTEGER NOT NULL DEFAULT 0').run();
  } catch (_e) {
  }
}

function migrateProductTagsSchema(db) {
  try {
    const columns = db.prepare("PRAGMA table_info(product_tags)").all();
    const hasNameColumn = columns.some((col) => String(col.name) === 'name');
    if (hasNameColumn) return;
    db.exec(`
      ALTER TABLE product_tags RENAME TO product_tags_legacy;
      CREATE TABLE IF NOT EXISTS product_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS product_tag_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id INTEGER NOT NULL,
        site_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    const legacyRows = db.prepare('SELECT site_id, title, tags, created_at FROM product_tags_legacy').all();
    const insertTag = db.prepare('INSERT OR IGNORE INTO product_tags (name, created_at) VALUES (?, ?)');
    const findTag = db.prepare('SELECT id FROM product_tags WHERE name = ? LIMIT 1');
    const insertItem = db.prepare('INSERT INTO product_tag_items (tag_id, site_id, title, created_at) VALUES (?, ?, ?, ?)');
    const tx = db.transaction(() => {
      for (const row of legacyRows) {
        const names = String(row.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
        for (const name of names) {
          insertTag.run(name, String(row.created_at || now()));
          const tag = findTag.get(name);
          if (!tag) continue;
          insertItem.run(Number(tag.id), Number(row.site_id || 0), String(row.title || ''), String(row.created_at || now()));
        }
      }
    });
    tx();
    db.exec('DROP TABLE product_tags_legacy;');
  } catch (_e) {
  }
}

function getSqliteDb() {
  if (sqliteDb) return sqliteDb;
  const sqlitePath = resolveSqlitePath();
  ensureParentDir(sqlitePath);
  sqliteDb = new Database(sqlitePath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('synchronous = NORMAL');
  createTables(sqliteDb);
  migrateLegacyData(sqliteDb);
  return sqliteDb;
}

function mapInventoryItem(row) {
  return {
    id: Number(row.id),
    site_id: Number(row.site_id),
    item_key: String(row.item_key || ''),
    title: String(row.title || ''),
    in_stock: Number(row.in_stock || 0),
    price: String(row.price || ''),
    raw_json: String(row.raw_json || ''),
    restock_notified: Number(row.restock_notified || 0),
    last_seen_at: String(row.last_seen_at || '')
  };
}

function mapInventoryEvent(row) {
  return {
    id: Number(row.id),
    site_id: Number(row.site_id),
    item_key: String(row.item_key || ''),
    title: String(row.title || ''),
    old_stock: row.old_stock === null || typeof row.old_stock === 'undefined' ? null : Number(row.old_stock),
    new_stock: row.new_stock === null || typeof row.new_stock === 'undefined' ? null : Number(row.new_stock),
    event_type: String(row.event_type || ''),
    created_at: String(row.created_at || '')
  };
}

function mapSimpleEvent(row) {
  return {
    id: Number(row.id),
    item_id: typeof row.item_id === 'undefined' ? undefined : Number(row.item_id || 0),
    site_id: typeof row.site_id === 'undefined' ? undefined : Number(row.site_id || 0),
    path: typeof row.path === 'undefined' ? undefined : String(row.path || '/'),
    date: String(row.date || ''),
    created_at: String(row.created_at || '')
  };
}

function mapBlockedProduct(row) {
  return {
    id: Number(row.id),
    site_id: Number(row.site_id),
    title: String(row.title || ''),
    created_at: String(row.created_at || '')
  };
}

function mapProductTag(row) {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    created_at: String(row.created_at || '')
  };
}

function mapProductTagItem(row) {
  return {
    id: Number(row.id),
    tag_id: Number(row.tag_id),
    site_id: Number(row.site_id),
    title: String(row.title || ''),
    created_at: String(row.created_at || '')
  };
}

function normalizeSiteRow(row) {
  return {
    ...row,
    id: Number(row.id),
    enabled: Number(row.enabled || 0),
    auto_enabled: Number(typeof row.auto_enabled === 'undefined' ? row.enabled : row.auto_enabled || 0),
    request_timeout_ms: Number(row.request_timeout_ms || 20000),
    retry_count: Number(row.retry_count || 2),
    fetch_mode: row.fetch_mode || 'http',
    cf_wait_ms: Number(row.cf_wait_ms || 7000)
  };
}

function normalizeSettingsRow(row = {}) {
  const appCfg = readAppConfig() || {};
  const publicCfg = appCfg.public || {};
  const adminCfg = appCfg.admin || {};
  const telegramCfg = appCfg.telegram || {};
  const hasRestockChatId = Object.prototype.hasOwnProperty.call(row, 'telegram_restock_chat_id');
  const hasBotToken = Object.prototype.hasOwnProperty.call(row, 'telegram_bot_token');
  const hasBackgroundImage = Object.prototype.hasOwnProperty.call(row, 'public_background_image');
  const hasPublicBaseUrl = Object.prototype.hasOwnProperty.call(row, 'public_base_url');
  return {
    public_title: String(row.public_title || publicCfg.title || 'VPS库存监控前台').trim() || 'VPS库存监控前台',
    public_background_image: hasBackgroundImage ? String(row.public_background_image || '').trim() : String(publicCfg.backgroundImage || '').trim(),
    public_base_url: hasPublicBaseUrl ? String(row.public_base_url || '').trim() : String(publicCfg.baseUrl || '').trim(),
    telegram_bot_token: hasBotToken ? String(row.telegram_bot_token || '').trim() : String(telegramCfg.botToken || '').trim(),
    telegram_chat_id: '',
    telegram_restock_chat_id: hasRestockChatId ? String(row.telegram_restock_chat_id || '').trim() : String(telegramCfg.restockChatId || '').trim(),
    admin_path: String(row.admin_path || adminCfg.path || 'admin').trim().replace(/^\/+|\/+$/g, '') || 'admin',
    monitor_concurrency: Number.isFinite(Number(row.monitor_concurrency)) ? Math.max(1, Math.min(30, Math.floor(Number(row.monitor_concurrency)))) : 5,
    monitor_idle_delay_ms: Number.isFinite(Number(row.monitor_idle_delay_ms)) ? Math.max(1000, Math.min(60000, Math.floor(Number(row.monitor_idle_delay_ms)))) : 3000,
    monitor_site_timeout_ms: Number.isFinite(Number(row.monitor_site_timeout_ms)) ? Math.max(0, Math.min(3600000, Math.floor(Number(row.monitor_site_timeout_ms)))) : 0
  };
}

function migrateLegacyArrayIfEmpty(db, countSql, rows, insertFn) {
  const existing = Number(db.prepare(countSql).get().count || 0);
  if (existing > 0 || !Array.isArray(rows) || rows.length === 0) return;
  const tx = db.transaction((items) => {
    for (const row of items) insertFn(row);
  });
  tx(rows);
}

function ensureDefaultRows(db) {
  const settingsCount = Number(db.prepare('SELECT COUNT(*) AS count FROM settings').get().count || 0);
  if (settingsCount === 0) {
    db.prepare(`
      INSERT INTO settings (
        id, public_title, public_background_image, telegram_bot_token, telegram_chat_id,
        telegram_restock_chat_id, public_base_url, admin_path, monitor_concurrency, monitor_idle_delay_ms, monitor_site_timeout_ms
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('VPS库存监控前台', '', '', '', '', '', 'admin', 5, 3000, 0);
  }

  const userCount = Number(db.prepare('SELECT COUNT(*) AS count FROM users').get().count || 0);
  if (userCount === 0) {
    db.prepare('INSERT INTO users (id, username, password, created_at) VALUES (1, ?, ?, ?)').run('admin', 'admin123', now());
  }
}

function migrateLegacyData(db) {
  const legacy = readLegacyJsonDb();

  migrateLegacyArrayIfEmpty(db, 'SELECT COUNT(*) AS count FROM users', legacy.users, (row) => {
    db.prepare('INSERT INTO users (id, username, password, created_at) VALUES (?, ?, ?, ?)').run(
      Number(row.id || 0) || null,
      String(row.username || 'admin').trim() || 'admin',
      String(row.password || 'admin123').trim() || 'admin123',
      String(row.created_at || now())
    );
  });

  if (Number(db.prepare('SELECT COUNT(*) AS count FROM settings').get().count || 0) === 0) {
    const settings = legacy.settings || {};
    db.prepare(`
      INSERT INTO settings (
        id, public_title, public_background_image, telegram_bot_token, telegram_chat_id,
        telegram_restock_chat_id, public_base_url, admin_path, monitor_concurrency, monitor_idle_delay_ms, monitor_site_timeout_ms
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(settings.public_title || 'VPS库存监控前台').trim() || 'VPS库存监控前台',
      String(settings.public_background_image || '').trim(),
      String(settings.telegram_bot_token || '').trim(),
      String(settings.telegram_chat_id || '').trim(),
      String(settings.telegram_restock_chat_id || '').trim(),
      String(settings.public_base_url || '').trim(),
      String(settings.admin_path || 'admin').trim().replace(/^\/+|\/+$/g, '') || 'admin',
      Number.isFinite(Number(settings.monitor_concurrency)) ? Math.max(1, Math.min(30, Math.floor(Number(settings.monitor_concurrency)))) : 5,
      Number.isFinite(Number(settings.monitor_idle_delay_ms)) ? Math.max(1000, Math.min(60000, Math.floor(Number(settings.monitor_idle_delay_ms)))) : 3000,
      Number.isFinite(Number(settings.monitor_site_timeout_ms)) ? Math.max(0, Math.min(3600000, Math.floor(Number(settings.monitor_site_timeout_ms)))) : 0
    );
  }

  migrateLegacyArrayIfEmpty(db, 'SELECT COUNT(*) AS count FROM monitor_sites', legacy.monitor_sites, (row) => {
    db.prepare(`
      INSERT INTO monitor_sites (
        id, name, url, aff_base_url, parser_type, enabled, auto_enabled,
        request_timeout_ms, retry_count, fetch_mode, cf_wait_ms,
        last_sync_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(row.id || 0) || null,
      String(row.name || '').trim(),
      String(row.url || '').trim(),
      String(row.aff_base_url || row.url || '').trim(),
      String(row.parser_type || 'whmcs').toLowerCase(),
      Number(row.enabled ? 1 : 0),
      Number(typeof row.auto_enabled === 'number' ? row.auto_enabled : row.enabled ? 1 : 0),
      Number(row.request_timeout_ms || 20000),
      Number(row.retry_count || 2),
      String(row.fetch_mode || 'http'),
      Number(row.cf_wait_ms || 7000),
      row.last_sync_at ? String(row.last_sync_at) : null,
      String(row.created_at || now()),
      String(row.updated_at || now())
    );
  });

  migrateLegacyArrayIfEmpty(db, 'SELECT COUNT(*) AS count FROM country_dictionary', legacy.country_dictionary, (row) => {
    db.prepare('INSERT INTO country_dictionary (id, country, keyword, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      Number(row.id || 0) || null,
      String(row.country || '').trim(),
      String(row.keyword || '').trim().toLowerCase(),
      String(row.created_at || now()),
      String(row.updated_at || now())
    );
  });

  migrateLegacyArrayIfEmpty(db, 'SELECT COUNT(*) AS count FROM country_unknown_hints', legacy.country_unknown_hints, (row) => {
    db.prepare(`
      INSERT INTO country_unknown_hints (
        id, token, sample_title, sample_config, count, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(row.id || 0) || null,
      String(row.token || '').trim().toLowerCase(),
      String(row.sample_title || ''),
      String(row.sample_config || ''),
      Math.max(1, Number(row.count || 1)),
      String(row.first_seen_at || now()),
      String(row.last_seen_at || now())
    );
  });

  migrateLegacyArrayIfEmpty(db, 'SELECT COUNT(*) AS count FROM inventory_items', legacy.inventory_items, (row) => {
    db.prepare(`
      INSERT INTO inventory_items (id, site_id, item_key, title, in_stock, price, raw_json, restock_notified, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(row.id || 0) || null,
      Number(row.site_id || 0),
      String(row.item_key || ''),
      String(row.title || ''),
      Number(row.in_stock || 0),
      String(row.price || ''),
      String(row.raw_json || ''),
      Number(row.restock_notified || 0),
      String(row.last_seen_at || now())
    );
  });

  migrateLegacyArrayIfEmpty(db, 'SELECT COUNT(*) AS count FROM inventory_events', legacy.inventory_events, (row) => {
    db.prepare(`
      INSERT INTO inventory_events (id, site_id, item_key, title, old_stock, new_stock, event_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(row.id || 0) || null,
      Number(row.site_id || 0),
      String(row.item_key || ''),
      String(row.title || ''),
      row.old_stock === null || typeof row.old_stock === 'undefined' ? null : Number(row.old_stock),
      row.new_stock === null || typeof row.new_stock === 'undefined' ? null : Number(row.new_stock),
      String(row.event_type || ''),
      String(row.created_at || now())
    );
  });

  migrateLegacyArrayIfEmpty(db, 'SELECT COUNT(*) AS count FROM click_events', legacy.click_events, (row) => {
    db.prepare('INSERT INTO click_events (id, item_id, site_id, date, created_at) VALUES (?, ?, ?, ?, ?)').run(
      Number(row.id || 0) || null,
      Number(row.item_id || 0),
      Number(row.site_id || 0),
      String(row.date || todayDate()),
      String(row.created_at || now())
    );
  });

  migrateLegacyArrayIfEmpty(db, 'SELECT COUNT(*) AS count FROM view_events', legacy.view_events, (row) => {
    db.prepare('INSERT INTO view_events (id, path, date, created_at) VALUES (?, ?, ?, ?)').run(
      Number(row.id || 0) || null,
      String(row.path || '/'),
      String(row.date || todayDate()),
      String(row.created_at || now())
    );
  });

  migrateLegacyArrayIfEmpty(db, 'SELECT COUNT(*) AS count FROM blocked_products', legacy.blocked_products, (row) => {
    db.prepare('INSERT INTO blocked_products (id, site_id, title, created_at) VALUES (?, ?, ?, ?)').run(
      Number(row.id || 0) || null,
      Number(row.site_id || 0),
      String(row.title || ''),
      String(row.created_at || now())
    );
  });

  ensureDefaultRows(db);
}

function getUserById(id) {
  const db = getSqliteDb();
  return db.prepare('SELECT id, username, password, created_at FROM users WHERE id = ?').get(Number(id)) || null;
}

function getPrimaryUser() {
  const db = getSqliteDb();
  return db.prepare('SELECT id, username, password, created_at FROM users ORDER BY id ASC LIMIT 1').get() || null;
}

function getSettingsRow() {
  const db = getSqliteDb();
  const row = db.prepare(`
    SELECT public_title, public_background_image, telegram_bot_token, telegram_chat_id, telegram_restock_chat_id,
           public_base_url, admin_path, monitor_concurrency, monitor_idle_delay_ms, monitor_site_timeout_ms
    FROM settings WHERE id = 1
  `).get() || {};
  return normalizeSettingsRow(row);
}

function listClickEvents() {
  const db = getSqliteDb();
  return db.prepare('SELECT id, item_id, site_id, date, created_at FROM click_events ORDER BY id ASC').all().map(mapSimpleEvent);
}

function listViewEvents() {
  const db = getSqliteDb();
  return db.prepare('SELECT id, path, date, created_at FROM view_events ORDER BY id ASC').all().map(mapSimpleEvent);
}

function listInventoryItemsForSite(siteId) {
  const db = getSqliteDb();
  return db.prepare(`
    SELECT id, site_id, item_key, title, in_stock, price, raw_json, restock_notified, last_seen_at
    FROM inventory_items
    WHERE site_id = ?
    ORDER BY id DESC
  `).all(Number(siteId)).map(mapInventoryItem);
}

function buildAppConfigFromState() {
  const adminUser = getPrimaryUser() || {};
  const settings = getSettingsRow();
  const current = readAppConfig() || {};
  return {
    server: {
      host: String(((current.server || {}).host) || process.env.HOST || '0.0.0.0').trim() || '0.0.0.0',
      port: Number.isFinite(Number(((current.server || {}).port) || process.env.PORT))
        ? Math.max(1, Math.min(65535, Math.floor(Number(((current.server || {}).port) || process.env.PORT))))
        : 3000
    },
    admin: {
      username: String(adminUser.username || 'admin').trim() || 'admin',
      password: String(adminUser.password || 'admin123').trim() || 'admin123',
      path: String(settings.admin_path || 'admin').trim().replace(/^\/+|\/+$/g, '') || 'admin'
    },
    public: {
      title: String(settings.public_title || 'VPS库存监控前台').trim() || 'VPS库存监控前台',
      backgroundImage: String(settings.public_background_image || '').trim(),
      baseUrl: String(settings.public_base_url || '').trim()
    },
    telegram: {
      botToken: String(settings.telegram_bot_token || '').trim(),
      restockChatId: String(settings.telegram_restock_chat_id || '').trim()
    },
    flaresolverr: {
      url: String(((current.flaresolverr || {}).url) || process.env.FLARESOLVERR_URL || 'http://127.0.0.1:8191/v1').trim() || 'http://127.0.0.1:8191/v1'
    },
    monitor: {
      concurrency: settings.monitor_concurrency,
      idleDelayMs: settings.monitor_idle_delay_ms,
      siteTimeoutMs: settings.monitor_site_timeout_ms
    }
  };
}

function syncAppConfigFromDb() {
  writeAppConfig(buildAppConfigFromState());
}

function toMs(ts) {
  if (!ts) return 0;
  const m = String(ts).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return 0;
  return shanghaiMs(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
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
  const parts = toShanghaiParts(d);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function startOfDay(d) {
  const parts = toShanghaiParts(d);
  return new Date(shanghaiMs(parts.year, parts.month, parts.day, 0, 0, 0));
}

function parseDateInput(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})$/);
  if (!m) return null;
  return new Date(shanghaiMs(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0));
}

function aggregateByHour(events, baseDate) {
  const start = startOfDay(baseDate);
  const labels = Array.from({ length: 24 }, (_, i) => `${i}点`);
  const values = Array.from({ length: 24 }, () => 0);
  events.forEach((e) => {
    const ms = toMs(e.created_at);
    if (!ms) return;
    const d = toShanghaiParts(new Date(ms));
    const startParts = toShanghaiParts(start);
    if (d.year === startParts.year && d.month === startParts.month && d.day === startParts.day) {
      values[d.hour] += 1;
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
    labels.push(formatDateLocal(d));
    const next = t + dayMs;
    values.push(events.filter((e) => {
      const ms = toMs(e.created_at);
      return ms >= t && ms < next;
    }).length);
  }
  return { labels, values };
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
      backgroundImage: String(publicCfg.backgroundImage || '').trim(),
      baseUrl: String(publicCfg.baseUrl || '').trim()
    },
    telegram: {
      botToken: String(telegramCfg.botToken || '').trim(),
      restockChatId: String(telegramCfg.restockChatId || '').trim()
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
  const db = getSqliteDb();
  const settings = getSettingsRow();
  const adminCfg = cfg.admin || {};
  const publicCfg = cfg.public || {};
  const telegramCfg = cfg.telegram || {};
  const monitorCfg = cfg.monitor || {};

  let changed = false;
  const nextUsername = String(adminCfg.username || '').trim();
  const nextPassword = String(adminCfg.password || '').trim();
  const nextAdminPath = String(adminCfg.path || '').trim().replace(/^\/+|\/+$/g, '');
  const primaryUser = getPrimaryUser();

  if (primaryUser) {
    if (nextUsername && primaryUser.username !== nextUsername) {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(nextUsername, Number(primaryUser.id));
      changed = true;
    }
    if (nextPassword && primaryUser.password !== nextPassword) {
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(nextPassword, Number(primaryUser.id));
      changed = true;
    }
  }

  const nextSettings = {
    public_title: String(publicCfg.title || '').trim() || settings.public_title,
    public_background_image: typeof publicCfg.backgroundImage !== 'undefined' ? String(publicCfg.backgroundImage || '').trim() : settings.public_background_image,
    public_base_url: typeof publicCfg.baseUrl !== 'undefined' ? String(publicCfg.baseUrl || '').trim() : settings.public_base_url,
    telegram_bot_token: typeof telegramCfg.botToken !== 'undefined' ? String(telegramCfg.botToken || '').trim() : settings.telegram_bot_token,
    telegram_chat_id: '',
    telegram_restock_chat_id: typeof telegramCfg.restockChatId !== 'undefined' ? String(telegramCfg.restockChatId || '').trim() : settings.telegram_restock_chat_id,
    admin_path: nextAdminPath || settings.admin_path,
    monitor_concurrency: typeof monitorCfg.concurrency !== 'undefined'
      ? (Number.isFinite(Number(monitorCfg.concurrency)) ? Math.max(1, Math.min(30, Math.floor(Number(monitorCfg.concurrency)))) : settings.monitor_concurrency)
      : settings.monitor_concurrency,
    monitor_idle_delay_ms: typeof monitorCfg.idleDelayMs !== 'undefined'
      ? (Number.isFinite(Number(monitorCfg.idleDelayMs)) ? Math.max(1000, Math.min(60000, Math.floor(Number(monitorCfg.idleDelayMs)))) : settings.monitor_idle_delay_ms)
      : settings.monitor_idle_delay_ms,
    monitor_site_timeout_ms: typeof monitorCfg.siteTimeoutMs !== 'undefined'
      ? (Number.isFinite(Number(monitorCfg.siteTimeoutMs)) ? Math.max(0, Math.min(3600000, Math.floor(Number(monitorCfg.siteTimeoutMs)))) : settings.monitor_site_timeout_ms)
      : settings.monitor_site_timeout_ms
  };

  const isSettingsChanged = Object.keys(nextSettings).some((key) => String(nextSettings[key]) !== String(settings[key]));
  if (isSettingsChanged) {
    db.prepare(`
      UPDATE settings
      SET public_title = ?, public_background_image = ?, public_base_url = ?, telegram_bot_token = ?, telegram_chat_id = ?, telegram_restock_chat_id = ?,
          admin_path = ?, monitor_concurrency = ?, monitor_idle_delay_ms = ?, monitor_site_timeout_ms = ?
      WHERE id = 1
    `).run(
      nextSettings.public_title,
      nextSettings.public_background_image,
      nextSettings.public_base_url,
      nextSettings.telegram_bot_token,
      nextSettings.telegram_chat_id,
      nextSettings.telegram_restock_chat_id,
      nextSettings.admin_path,
      nextSettings.monitor_concurrency,
      nextSettings.monitor_idle_delay_ms,
      nextSettings.monitor_site_timeout_ms
    );
    changed = true;
  }

  return { ok: true, applied: true, changed };
}

export function findUser(username, password) {
  const db = getSqliteDb();
  return db.prepare('SELECT id, username, password, created_at FROM users WHERE username = ? AND password = ? LIMIT 1').get(username, password) || null;
}

export function updateUserCredentials(userId, username, password) {
  const db = getSqliteDb();
  const user = getUserById(userId);
  if (!user) return { ok: false, message: 'User not found' };
  const duplicated = db.prepare('SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1').get(username, userId);
  if (duplicated) return { ok: false, message: 'Username already exists' };
  db.prepare('UPDATE users SET username = ?, password = ? WHERE id = ?').run(username, password || user.password, userId);
  syncAppConfigFromDb();
  return { ok: true, user: getUserById(userId) };
}

export function listSites() {
  const db = getSqliteDb();
  return db.prepare(`
    SELECT id, name, url, aff_base_url, parser_type, enabled, auto_enabled,
           request_timeout_ms, retry_count, fetch_mode, cf_wait_ms,
           last_sync_at, created_at, updated_at
    FROM monitor_sites
    ORDER BY id DESC
  `).all().map(normalizeSiteRow);
}

export function addSite(payload) {
  const db = getSqliteDb();
  const createdAt = now();
  const result = db.prepare(`
    INSERT INTO monitor_sites (
      name, url, aff_base_url, parser_type, enabled, auto_enabled,
      request_timeout_ms, retry_count, fetch_mode, cf_wait_ms,
      last_sync_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.name,
    payload.url,
    payload.aff_base_url,
    String(payload.parser_type || 'whmcs').toLowerCase(),
    payload.enabled ? 1 : 0,
    payload.auto_enabled ? 1 : 0,
    Number(payload.request_timeout_ms || 20000),
    Number(payload.retry_count || 2),
    payload.fetch_mode || 'http',
    Number(payload.cf_wait_ms || 7000),
    null,
    createdAt,
    createdAt
  );
  return getSiteById(Number(result.lastInsertRowid));
}

export function updateSite(id, payload) {
  const db = getSqliteDb();
  const site = getSiteById(id);
  if (!site) return null;
  db.prepare(`
    UPDATE monitor_sites
    SET name = ?, url = ?, aff_base_url = ?, parser_type = ?, enabled = ?, auto_enabled = ?,
        request_timeout_ms = ?, retry_count = ?, fetch_mode = ?, cf_wait_ms = ?, updated_at = ?
    WHERE id = ?
  `).run(
    payload.name,
    payload.url,
    payload.aff_base_url,
    String(payload.parser_type || site.parser_type || 'whmcs').toLowerCase(),
    payload.enabled ? 1 : 0,
    payload.auto_enabled ? 1 : 0,
    Number(payload.request_timeout_ms || site.request_timeout_ms || 20000),
    Number(payload.retry_count || site.retry_count || 2),
    payload.fetch_mode || site.fetch_mode || 'http',
    Number(payload.cf_wait_ms || site.cf_wait_ms || 7000),
    now(),
    Number(id)
  );
  return getSiteById(id);
}

export function markSiteSynced(id) {
  const db = getSqliteDb();
  db.prepare('UPDATE monitor_sites SET last_sync_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), Number(id));
  return getSiteById(id);
}

export function getSiteById(id) {
  const db = getSqliteDb();
  const row = db.prepare(`
    SELECT id, name, url, aff_base_url, parser_type, enabled, auto_enabled,
           request_timeout_ms, retry_count, fetch_mode, cf_wait_ms,
           last_sync_at, created_at, updated_at
    FROM monitor_sites WHERE id = ?
  `).get(Number(id));
  return row ? normalizeSiteRow(row) : null;
}

export function toggleSite(id) {
  const site = getSiteById(id);
  if (!site) return null;
  const db = getSqliteDb();
  db.prepare('UPDATE monitor_sites SET enabled = ?, updated_at = ? WHERE id = ?').run(site.enabled ? 0 : 1, now(), Number(id));
  return getSiteById(id);
}

export function toggleSiteAuto(id) {
  const site = getSiteById(id);
  if (!site) return null;
  const nextValue = site.auto_enabled ? 0 : 1;
  const db = getSqliteDb();
  db.prepare('UPDATE monitor_sites SET auto_enabled = ?, updated_at = ? WHERE id = ?').run(nextValue, now(), Number(id));
  return getSiteById(id);
}

export function listItemsBySite(siteId) {
  return listInventoryItemsForSite(siteId);
}

export function listPublicItems() {
  const enabledSites = listSites().filter((s) => s.enabled === 1);
  if (enabledSites.length === 0) return [];
  const enabledSiteIds = enabledSites.map((s) => Number(s.id));
  const placeholders = enabledSiteIds.map(() => '?').join(', ');
  const sqlite = getSqliteDb();
  const blockedRows = sqlite.prepare('SELECT site_id, title FROM blocked_products').all();
  const productTagRows = sqlite.prepare(`
    SELECT i.site_id, i.title, t.name
    FROM product_tag_items i
    INNER JOIN product_tags t ON t.id = i.tag_id
  `).all();
  const blockedSet = new Set(blockedRows.map((b) => `${Number(b.site_id)}::${String(b.title || '').trim()}`));
  const siteNameMap = new Map(enabledSites.map((s) => [Number(s.id), s.name]));
  const productTagMap = new Map();
  for (const row of productTagRows) {
    const key = `${Number(row.site_id)}::${String(row.title || '').trim()}`;
    const list = productTagMap.get(key) || [];
    const name = String(row.name || '').trim();
    if (name && !list.includes(name)) list.push(name);
    productTagMap.set(key, list);
  }
  return sqlite.prepare(`
    SELECT id, site_id, item_key, title, in_stock, price, raw_json, last_seen_at
    FROM inventory_items
    WHERE site_id IN (${placeholders})
  `).all(...enabledSiteIds)
    .map(mapInventoryItem)
    .filter((i) => !blockedSet.has(`${Number(i.site_id)}::${String(i.title || '').trim()}`))
    .map((i) => ({
      ...i,
      site_name: siteNameMap.get(Number(i.site_id)) || '-',
      product_tags: productTagMap.get(`${Number(i.site_id)}::${String(i.title || '').trim()}`) || []
    }))
    .sort((a, b) => (a.in_stock !== b.in_stock ? b.in_stock - a.in_stock : b.id - a.id));
}

export function getPublicItemById(id) {
  const sqlite = getSqliteDb();
  const row = sqlite.prepare(`
    SELECT id, site_id, item_key, title, in_stock, price, raw_json, last_seen_at
    FROM inventory_items WHERE id = ?
  `).get(Number(id));
  if (!row) return null;
  const item = mapInventoryItem(row);
  const site = getSiteById(item.site_id);
  if (!site || site.enabled !== 1) return null;
  const tagRows = sqlite.prepare(`
    SELECT t.name
    FROM product_tag_items i
    INNER JOIN product_tags t ON t.id = i.tag_id
    WHERE i.site_id = ? AND i.title = ?
    ORDER BY t.name COLLATE NOCASE ASC
  `).all(Number(item.site_id), String(item.title || '').trim());
  return {
    ...item,
    site_name: site.name,
    product_tags: tagRows.map((row) => String(row.name || '').trim()).filter(Boolean)
  };
}

export function getProductTagsForItem(siteId, title) {
  const sqlite = getSqliteDb();
  return sqlite.prepare(`
    SELECT t.name
    FROM product_tag_items i
    INNER JOIN product_tags t ON t.id = i.tag_id
    WHERE i.site_id = ? AND i.title = ?
    ORDER BY t.name COLLATE NOCASE ASC
  `).all(Number(siteId), String(title || '').trim()).map((row) => String(row.name || '').trim()).filter(Boolean);
}

export function listBlockedProducts() {
  const sqlite = getSqliteDb();
  return sqlite.prepare('SELECT id, site_id, title, created_at FROM blocked_products ORDER BY id DESC').all().map(mapBlockedProduct);
}

export function listProductTags() {
  const sqlite = getSqliteDb();
  const tags = sqlite.prepare('SELECT id, name, created_at FROM product_tags ORDER BY name COLLATE NOCASE ASC, id DESC').all().map(mapProductTag);
  const items = sqlite.prepare(`
    SELECT p.id, p.tag_id, p.site_id, p.title, p.created_at, s.name AS site_name, i.in_stock, i.price, i.last_seen_at
    FROM product_tag_items p
    LEFT JOIN monitor_sites s ON s.id = p.site_id
    LEFT JOIN inventory_items i ON i.site_id = p.site_id AND i.title = p.title
    ORDER BY s.name COLLATE NOCASE ASC, p.title COLLATE NOCASE ASC
  `).all();
  const grouped = new Map();
  for (const row of items) {
    const key = Number(row.tag_id);
    const list = grouped.get(key) || [];
    list.push({ ...mapProductTagItem(row), site_name: String(row.site_name || '-'), in_stock: Number(row.in_stock || 0), price: String(row.price || ''), last_seen_at: String(row.last_seen_at || '') });
    grouped.set(key, list);
  }
  return tags.map((tag) => ({ ...tag, items: grouped.get(Number(tag.id)) || [] }));
}

export function getProductTagById(id) {
  const sqlite = getSqliteDb();
  const tag = sqlite.prepare('SELECT id, name, created_at FROM product_tags WHERE id = ?').get(Number(id));
  if (!tag) return null;
  const items = sqlite.prepare(`
    SELECT p.id, p.tag_id, p.site_id, p.title, p.created_at, s.name AS site_name, i.in_stock, i.price, i.last_seen_at
    FROM product_tag_items p
    LEFT JOIN monitor_sites s ON s.id = p.site_id
    LEFT JOIN inventory_items i ON i.site_id = p.site_id AND i.title = p.title
    WHERE p.tag_id = ?
    ORDER BY s.name COLLATE NOCASE ASC, p.title COLLATE NOCASE ASC
  `).all(Number(id)).map((row) => ({ ...mapProductTagItem(row), site_name: String(row.site_name || '-'), in_stock: Number(row.in_stock || 0), price: String(row.price || ''), last_seen_at: String(row.last_seen_at || '') }));
  return { ...mapProductTag(tag), items };
}

export function addProductTag(name) {
  const sqlite = getSqliteDb();
  const normalized = String(name || '').trim();
  if (!normalized) return { ok: false, message: 'tag name empty' };
  const exists = sqlite.prepare('SELECT id FROM product_tags WHERE LOWER(name) = LOWER(?) LIMIT 1').get(normalized);
  if (exists) return { ok: false, message: 'tag exists' };
  sqlite.prepare('INSERT INTO product_tags (name, created_at) VALUES (?, ?)').run(normalized, now());
  return { ok: true };
}

export function updateProductTag(id, name) {
  const sqlite = getSqliteDb();
  const normalized = String(name || '').trim();
  if (!normalized) return { ok: false, message: 'tag name empty' };
  const row = sqlite.prepare('SELECT id FROM product_tags WHERE id = ?').get(Number(id));
  if (!row) return { ok: false, message: 'tag not found' };
  const exists = sqlite.prepare('SELECT id FROM product_tags WHERE id != ? AND LOWER(name) = LOWER(?) LIMIT 1').get(Number(id), normalized);
  if (exists) return { ok: false, message: 'tag exists' };
  sqlite.prepare('UPDATE product_tags SET name = ? WHERE id = ?').run(normalized, Number(id));
  return { ok: true };
}

export function deleteProductTag(id) {
  const sqlite = getSqliteDb();
  const tagId = Number(id);
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM product_tag_items WHERE tag_id = ?').run(tagId);
    sqlite.prepare('DELETE FROM product_tags WHERE id = ?').run(tagId);
  });
  const exists = sqlite.prepare('SELECT id FROM product_tags WHERE id = ?').get(tagId);
  if (!exists) return { ok: false, message: 'tag not found' };
  tx();
  return { ok: true };
}

export function listItemsByMerchant(siteId) {
  const id = Number(siteId || 0);
  if (!id) return [];
  return listInventoryItemsForSite(id);
}

export function replaceBlockedProductsForSite(siteId, titles) {
  const id = Number(siteId || 0);
  if (!id) return;
  const sqlite = getSqliteDb();
  const uniqueTitles = [...new Set((titles || []).map((t) => String(t || '').trim()).filter(Boolean))];
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM blocked_products WHERE site_id = ?').run(id);
    for (const title of uniqueTitles) {
      sqlite.prepare('INSERT INTO blocked_products (site_id, title, created_at) VALUES (?, ?, ?)').run(id, title, now());
    }
  });
  tx();
}

export function replaceProductTagsForSite(siteId, rows) {
  const id = Number(siteId || 0);
  if (!id) return;
  const sqlite = getSqliteDb();
  const normalizedRows = (rows || [])
    .map((row) => ({
      title: String((row && row.title) || '').trim(),
      tagId: Number((row && row.tagId) || 0)
    }))
    .filter((row) => row.title && row.tagId > 0);
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM product_tag_items WHERE site_id = ?').run(id);
    for (const row of normalizedRows) {
      sqlite.prepare('INSERT INTO product_tag_items (tag_id, site_id, title, created_at) VALUES (?, ?, ?, ?)').run(row.tagId, id, row.title, now());
    }
  });
  tx();
}

export function replaceProductTagItemsForSite(tagId, siteId, titles) {
  const normalizedTagId = Number(tagId || 0);
  const normalizedSiteId = Number(siteId || 0);
  if (!normalizedTagId || !normalizedSiteId) return;
  const sqlite = getSqliteDb();
  const uniqueTitles = [...new Set((titles || []).map((title) => String(title || '').trim()).filter(Boolean))];
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM product_tag_items WHERE tag_id = ? AND site_id = ?').run(normalizedTagId, normalizedSiteId);
    for (const title of uniqueTitles) {
      sqlite.prepare('INSERT INTO product_tag_items (tag_id, site_id, title, created_at) VALUES (?, ?, ?, ?)').run(normalizedTagId, normalizedSiteId, title, now());
    }
  });
  tx();
}

export function addClickEvent(itemId, siteId) {
  getSqliteDb().prepare('INSERT INTO click_events (item_id, site_id, date, created_at) VALUES (?, ?, ?, ?)').run(Number(itemId), Number(siteId), todayDate(), now());
}

export function addViewEvent(pathname) {
  getSqliteDb().prepare('INSERT INTO view_events (path, date, created_at) VALUES (?, ?, ?)').run(String(pathname || '/'), todayDate(), now());
}

export function getTrafficStats(options = {}) {
  const clickEvents = listClickEvents();
  const viewEvents = listViewEvents();
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
    const hour = toShanghaiParts(new Date(toMs(e.created_at))).hour;
    if (hour >= 0 && hour <= 23) clickHourly[hour] += 1;
  });
  viewEvents.forEach((e) => {
    if (e.date !== today) return;
    const hour = toShanghaiParts(new Date(toMs(e.created_at))).hour;
    if (hour >= 0 && hour <= 23) viewHourly[hour] += 1;
  });

  const period = String(options.period || 'today');
  const nowDate = new Date();
  let clickChart = { labels: hourlyLabels, values: clickHourly };
  let viewChart = { labels: hourlyLabels, values: viewHourly };

  if (period === 'yesterday') {
    const y = new Date(nowDate.getTime() - 24 * 3600 * 1000);
    clickChart = aggregateByHour(clickEvents, y);
    viewChart = aggregateByHour(viewEvents, y);
  } else if (period === 'last24h') {
    const start = new Date(nowDate.getTime() - 24 * 3600 * 1000);
    clickChart = aggregateByDayRange(clickEvents, start, nowDate);
    viewChart = aggregateByDayRange(viewEvents, start, nowDate);
  } else if (period === 'last7d') {
    const start = new Date(nowDate.getTime() - 6 * 24 * 3600 * 1000);
    clickChart = aggregateByDayRange(clickEvents, start, nowDate);
    viewChart = aggregateByDayRange(viewEvents, start, nowDate);
  } else if (period === 'last14d') {
    const start = new Date(nowDate.getTime() - 13 * 24 * 3600 * 1000);
    clickChart = aggregateByDayRange(clickEvents, start, nowDate);
    viewChart = aggregateByDayRange(viewEvents, start, nowDate);
  } else if (period === 'last30d') {
    const start = new Date(nowDate.getTime() - 29 * 24 * 3600 * 1000);
    clickChart = aggregateByDayRange(clickEvents, start, nowDate);
    viewChart = aggregateByDayRange(viewEvents, start, nowDate);
  } else if (period === 'thisMonth') {
    const start = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
    clickChart = aggregateByDayRange(clickEvents, start, nowDate);
    viewChart = aggregateByDayRange(viewEvents, start, nowDate);
  } else if (period === 'lastMonth') {
    const start = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1);
    const end = new Date(nowDate.getFullYear(), nowDate.getMonth(), 0);
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
    chart: { period, click: clickChart, view: viewChart },
    viewTotal: viewEvents.length,
    clickTotal: clickEvents.length
  };
}

export function getDashboardStats() {
  const sqlite = getSqliteDb();
  const siteStats = sqlite.prepare(`
    SELECT COUNT(*) AS site_total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS site_enabled FROM monitor_sites
  `).get();
  const inventoryStats = sqlite.prepare(`
    SELECT COUNT(*) AS item_total,
           SUM(CASE WHEN in_stock = 1 THEN 1 ELSE 0 END) AS item_in_stock,
           SUM(CASE WHEN in_stock != 1 THEN 1 ELSE 0 END) AS item_out_stock
    FROM inventory_items
  `).get();
  const clickTotal = Number(sqlite.prepare('SELECT COUNT(*) AS count FROM click_events').get().count || 0);
  const viewTotal = Number(sqlite.prepare('SELECT COUNT(*) AS count FROM view_events').get().count || 0);
  const today = todayDate();
  const clickToday = Number(sqlite.prepare('SELECT COUNT(*) AS count FROM click_events WHERE date = ?').get(today).count || 0);
  const viewToday = Number(sqlite.prepare('SELECT COUNT(*) AS count FROM view_events WHERE date = ?').get(today).count || 0);
  return {
    siteTotal: Number(siteStats.site_total || 0),
    siteEnabled: Number(siteStats.site_enabled || 0),
    itemTotal: Number(inventoryStats.item_total || 0),
    itemInStock: Number(inventoryStats.item_in_stock || 0),
    itemOutStock: Number(inventoryStats.item_out_stock || 0),
    clickTotal,
    clickToday,
    viewTotal,
    viewToday
  };
}

export function getSettings() {
  return getSettingsRow();
}

export function updateSettings(payload) {
  const current = getSettingsRow();
  const monitorConcurrency = Number(payload.monitor_concurrency || current.monitor_concurrency || 5);
  const monitorIdleDelayMs = Number(payload.monitor_idle_delay_ms || current.monitor_idle_delay_ms || 3000);
  const monitorSiteTimeoutMs = Number(payload.monitor_site_timeout_ms || current.monitor_site_timeout_ms || 0);
  getSqliteDb().prepare(`
    UPDATE settings
    SET public_title = ?, public_background_image = ?, public_base_url = ?, telegram_bot_token = ?, telegram_chat_id = ?, telegram_restock_chat_id = ?,
        admin_path = ?, monitor_concurrency = ?, monitor_idle_delay_ms = ?, monitor_site_timeout_ms = ?
    WHERE id = 1
  `).run(
    String(payload.public_title || '').trim() || 'VPS库存监控前台',
    typeof payload.public_background_image === 'undefined' ? current.public_background_image : String(payload.public_background_image || '').trim(),
    typeof payload.public_base_url === 'undefined' ? current.public_base_url : String(payload.public_base_url || '').trim(),
    typeof payload.telegram_bot_token === 'undefined' ? current.telegram_bot_token : String(payload.telegram_bot_token || '').trim(),
    String(payload.telegram_chat_id || '').trim(),
    typeof payload.telegram_restock_chat_id === 'undefined' ? current.telegram_restock_chat_id : String(payload.telegram_restock_chat_id || '').trim(),
    String(payload.admin_path || 'admin').trim().replace(/^\/+|\/+$/g, '') || 'admin',
    Number.isFinite(monitorConcurrency) ? Math.max(1, Math.min(30, Math.floor(monitorConcurrency))) : 5,
    Number.isFinite(monitorIdleDelayMs) ? Math.max(1000, Math.min(60000, Math.floor(monitorIdleDelayMs))) : 3000,
    Number.isFinite(monitorSiteTimeoutMs) ? Math.max(0, Math.min(3600000, Math.floor(monitorSiteTimeoutMs))) : 0
  );
  syncAppConfigFromDb();
}

export function listCountryDictionary() {
  return getSqliteDb().prepare(`
    SELECT id, country, keyword, created_at, updated_at
    FROM country_dictionary
    ORDER BY country COLLATE NOCASE ASC, id DESC
  `).all();
}

export function addCountryDictionaryRule(country, keyword) {
  const db = getSqliteDb();
  const c = String(country || '').trim();
  const k = String(keyword || '').trim().toLowerCase();
  if (!c || !k) return { ok: false, message: 'country or keyword empty' };
  const exists = db.prepare('SELECT id FROM country_dictionary WHERE country = ? AND keyword = ? LIMIT 1').get(c, k);
  if (exists) return { ok: false, message: 'rule exists' };
  db.prepare('INSERT INTO country_dictionary (country, keyword, created_at, updated_at) VALUES (?, ?, ?, ?)').run(c, k, now(), now());
  return { ok: true };
}

export function updateCountryDictionaryRule(id, country, keyword) {
  const db = getSqliteDb();
  const c = String(country || '').trim();
  const k = String(keyword || '').trim().toLowerCase();
  if (!c || !k) return { ok: false, message: 'country or keyword empty' };
  const rule = db.prepare('SELECT id FROM country_dictionary WHERE id = ?').get(Number(id));
  if (!rule) return { ok: false, message: 'rule not found' };
  const duplicated = db.prepare('SELECT id FROM country_dictionary WHERE id != ? AND country = ? AND keyword = ? LIMIT 1').get(Number(id), c, k);
  if (duplicated) return { ok: false, message: 'rule exists' };
  db.prepare('UPDATE country_dictionary SET country = ?, keyword = ?, updated_at = ? WHERE id = ?').run(c, k, now(), Number(id));
  return { ok: true };
}

export function deleteCountryDictionaryRule(id) {
  const result = getSqliteDb().prepare('DELETE FROM country_dictionary WHERE id = ?').run(Number(id));
  if (Number(result.changes || 0) === 0) return { ok: false, message: 'rule not found' };
  return { ok: true };
}

export function listUnknownCountryHints() {
  return getSqliteDb().prepare(`
    SELECT id, token, sample_title, sample_config, count, first_seen_at, last_seen_at
    FROM country_unknown_hints
    ORDER BY count DESC, id DESC
  `).all();
}

export function upsertUnknownCountryHint(token, sampleTitle, sampleConfig) {
  const db = getSqliteDb();
  const t = String(token || '').trim().toLowerCase();
  if (!t || t.length < 2) return;
  const row = db.prepare(`
    SELECT id, sample_title, sample_config, count
    FROM country_unknown_hints
    WHERE token = ?
  `).get(t);
  if (row) {
    db.prepare(`
      UPDATE country_unknown_hints
      SET count = ?, last_seen_at = ?, sample_title = ?, sample_config = ?
      WHERE id = ?
    `).run(
      Number(row.count || 0) + 1,
      now(),
      row.sample_title || sampleTitle || '',
      row.sample_config || sampleConfig || '',
      Number(row.id)
    );
    return;
  }
  db.prepare(`
    INSERT INTO country_unknown_hints (token, sample_title, sample_config, count, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(t, sampleTitle || '', sampleConfig || '', 1, now(), now());
}

export function consumeUnknownCountryHint(token) {
  getSqliteDb().prepare('DELETE FROM country_unknown_hints WHERE token = ?').run(String(token || '').trim().toLowerCase());
}

export function deleteSite(id) {
  const siteId = Number(id);
  const sqlite = getSqliteDb();
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM monitor_sites WHERE id = ?').run(siteId);
    sqlite.prepare('DELETE FROM inventory_items WHERE site_id = ?').run(siteId);
    sqlite.prepare('DELETE FROM inventory_events WHERE site_id = ?').run(siteId);
    sqlite.prepare('DELETE FROM click_events WHERE site_id = ?').run(siteId);
    sqlite.prepare('DELETE FROM blocked_products WHERE site_id = ?').run(siteId);
  });
  const before = getSiteById(siteId);
  if (!before) return { ok: false, message: 'site not found' };
  tx();
  return { ok: true };
}

export function replaceItemsBySite(siteId, items) {
  const sqlite = getSqliteDb();
  const normalizedSiteId = Number(siteId);
  const tx = sqlite.transaction((rows) => {
    const previousRows = sqlite.prepare(`
      SELECT item_key, title, in_stock, restock_notified
      FROM inventory_items
      WHERE site_id = ?
    `).all(normalizedSiteId);
    const previousByKey = new Map();
    const previousByTitle = new Map();
    for (const row of previousRows) {
      const key = String(row.item_key || '').trim();
      const title = String(row.title || '').trim();
      if (key) previousByKey.set(key, row);
      if (title) previousByTitle.set(title, row);
    }
    sqlite.prepare('DELETE FROM inventory_items WHERE site_id = ?').run(normalizedSiteId);
    for (const item of rows || []) {
      const itemKey = String(item.itemKey || '').trim();
      const itemTitle = String(item.title || '').trim();
      const oldRow = (itemKey && previousByKey.get(itemKey)) || (itemTitle && previousByTitle.get(itemTitle)) || null;
      let restockNotified = 0;
      if (oldRow) {
        if (Number(oldRow.in_stock || 0) === 0 && Number(item.inStock || 0) === 1) {
          restockNotified = Number(oldRow.restock_notified || 0);
        } else if (Number(item.inStock || 0) === 1) {
          restockNotified = 0;
        } else {
          restockNotified = 0;
        }
      }
      sqlite.prepare(`
        INSERT INTO inventory_items (site_id, item_key, title, in_stock, price, raw_json, restock_notified, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        normalizedSiteId,
        itemKey,
        itemTitle,
        Number(item.inStock || 0),
        String(item.price || ''),
        String(item.rawJson || ''),
        restockNotified,
        now()
      );
    }
  });
  tx(items || []);
}

export function listRecentEvents(limit = 50) {
  const siteNameMap = new Map(listSites().map((s) => [Number(s.id), s.name]));
  return getSqliteDb().prepare(`
    SELECT id, site_id, item_key, title, old_stock, new_stock, event_type, created_at
    FROM inventory_events
    ORDER BY id DESC
    LIMIT ?
  `).all(Number(limit || 50)).map(mapInventoryEvent).map((e) => ({
    ...e,
    site_name: siteNameMap.get(Number(e.site_id)) || '-'
  }));
}

export function listEnabledSites() {
  return listSites().filter((s) => Number(s.auto_enabled) === 1);
}

export function upsertInventory(site, item, rawJson) {
  const sqlite = getSqliteDb();
  const normalizedSiteId = Number(site.id);
  let old = sqlite.prepare(`
    SELECT id, site_id, item_key, title, in_stock, price, raw_json, restock_notified, last_seen_at
    FROM inventory_items
    WHERE site_id = ? AND item_key = ?
    LIMIT 1
  `).get(normalizedSiteId, String(item.itemKey || ''));
  if (!old) {
    old = sqlite.prepare(`
      SELECT id, site_id, item_key, title, in_stock, price, raw_json, restock_notified, last_seen_at
      FROM inventory_items
      WHERE site_id = ? AND title = ?
      LIMIT 1
    `).get(normalizedSiteId, String(item.title || ''));
  }
  if (!old) {
    sqlite.prepare(`
      INSERT INTO inventory_items (site_id, item_key, title, in_stock, price, raw_json, restock_notified, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(normalizedSiteId, String(item.itemKey || ''), String(item.title || ''), Number(item.inStock || 0), String(item.price || ''), String(rawJson || ''), 0, now());
    return { old: null };
  }
  const oldSnapshot = mapInventoryItem(old);
  const nextRestockNotified = Number(item.inStock || 0) === 1 ? 0 : Number(oldSnapshot.restock_notified || 0);
  sqlite.prepare(`
    UPDATE inventory_items
    SET item_key = ?, title = ?, in_stock = ?, price = ?, raw_json = ?, restock_notified = ?, last_seen_at = ?
    WHERE id = ?
  `).run(String(item.itemKey || ''), String(item.title || ''), Number(item.inStock || 0), String(item.price || ''), String(rawJson || ''), nextRestockNotified, now(), Number(old.id));
  return { old: oldSnapshot };
}

export function markRestockNotified(siteId, itemKey, title) {
  const sqlite = getSqliteDb();
  const normalizedSiteId = Number(siteId);
  const key = String(itemKey || '').trim();
  const textTitle = String(title || '').trim();
  if (key) {
    sqlite.prepare('UPDATE inventory_items SET restock_notified = 1 WHERE site_id = ? AND item_key = ?').run(normalizedSiteId, key);
    return;
  }
  if (textTitle) {
    sqlite.prepare('UPDATE inventory_items SET restock_notified = 1 WHERE site_id = ? AND title = ?').run(normalizedSiteId, textTitle);
  }
}

export function addEvent(siteId, itemKey, title, oldStock, newStock, eventType) {
  getSqliteDb().prepare(`
    INSERT INTO inventory_events (site_id, item_key, title, old_stock, new_stock, event_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(siteId),
    itemKey === null || typeof itemKey === 'undefined' ? null : String(itemKey),
    title === null || typeof title === 'undefined' ? null : String(title),
    oldStock === null || typeof oldStock === 'undefined' ? null : Number(oldStock),
    newStock === null || typeof newStock === 'undefined' ? null : Number(newStock),
    String(eventType || ''),
    now()
  );
}
