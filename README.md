# VPS Inventory Monitoring

WHMCS VPS inventory monitoring platform with:

- Admin backend: dashboard, site management, country dictionary, blocked products
- Public storefront: merchant grouping, filters, direct affiliate purchase
- Click tracking, telemetry, Telegram notifications
- Restock Telegram alerts when previously out-of-stock products come back
- Continuous worker-pool auto sync with configurable concurrency

## Deployment

This project is intended to be deployed with Docker Compose.

Requirements:

- Docker
- Docker Compose

## Important Files

- `docker-compose.yml`: deployment entrypoint
- `app.config.example.json`: config template for GitHub / new deployments
- `app.config.json`: real local config file, not committed to Git
- `data/inventory.sqlite`: runtime database file in Docker deployments

## Configuration

1. Create your real config file from the example:

```bash
cp app.config.example.json app.config.json
mkdir -p data
```

2. Edit `app.config.json`.

Example:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000
  },
  "admin": {
    "username": "your-admin",
    "password": "your-strong-password",
    "path": "your-admin-path"
  },
  "public": {
    "title": "VPS库存监控前台",
    "backgroundImage": "",
    "baseUrl": ""
  },
  "telegram": {
    "botToken": "",
    "restockChatId": ""
  },
  "flaresolverr": {
    "url": "http://flaresolverr:8191/v1"
  },
  "monitor": {
    "concurrency": 5,
    "idleDelayMs": 3000,
    "siteTimeoutMs": 0
  }
}
```

Main keys:

- `server.host` / `server.port`
- `admin.username` / `admin.password` / `admin.path`
- `public.title` / `public.backgroundImage` / `public.baseUrl`
- `telegram.botToken` / `telegram.restockChatId`
- `flaresolverr.url`
- `monitor.concurrency` / `monitor.idleDelayMs` / `monitor.siteTimeoutMs`

## Docker Compose

Start services:

```bash
docker compose up -d --build
```

Stop services:

```bash
docker compose down
```

Restart only the app after editing config:

```bash
docker compose restart vps-monitor
```

View logs:

```bash
docker compose logs -f vps-monitor
docker compose logs -f flaresolverr
```

Open:

- Frontend: `http://<server-ip>:3000`
- Admin login: `http://<server-ip>:3000/<admin.path>/login`

Notes:

- `docker-compose.yml` mounts `app.config.json` and `./data` into the app container
- Compose also starts `flaresolverr`
- Inside Docker Compose, `flaresolverr.url` should use `http://flaresolverr:8191/v1`
- `public.baseUrl` is the externally accessible frontend address used in Telegram tag links
- examples: `http://IP:3000`, `https://domain:3000`, `https://domain`
- when using CDN or Cloudflare Tunnel, set `public.baseUrl` to the user-facing HTTPS domain

## Data Persistence

- `data/inventory.sqlite` stores all runtime application data
- this includes users, settings, sites, country dictionary, unknown hints, inventory, events, clicks, views, and blocked products
- Back up the whole `data/` directory regularly
- If you migrate servers, keep both `app.config.json` and `data/`

## SQLite Storage

The app now uses SQLite as the single runtime data store:

- users
- system settings
- monitored sites
- country dictionary
- unknown country hints
- inventory snapshots
- inventory events
- click events
- page view events
- blocked products

Default location in Docker Compose:

- `data/inventory.sqlite`

If you are upgrading from an old JSON-based deployment, the app can still import legacy `data/data.json` automatically on first start when the SQLite tables are empty.

After migration, the app no longer reads or writes runtime state from `data/data.json`.

## Restock Notifications

If Telegram is configured, the monitor sends restock notifications to:

- `telegram.restockChatId`: restock product notifications

Restock messages can include clickable tag links pointing to the frontend tag filter page.
These links are generated from `public.baseUrl`.

Restock notification rule:

- a product existed in the previous snapshot
- it was out of stock before
- it becomes in stock in the latest sync
- the product has not already been marked as restock-notified for this `0 -> 1` transition

This prevents the same restocked item from being sent repeatedly on every later sync.

## GitHub Hosting Notes

If you plan to host this project on GitHub:

- Commit `app.config.example.json`
- Do not commit `app.config.json`
- Do not commit `data/`
- Do not commit real admin credentials, Telegram tokens, or private URLs
- `app.config.json` is already ignored by `.gitignore`
- Before pushing, review `git status` and make sure no secrets are staged

Recommended repository contents:

- source code
- `Dockerfile`
- `docker-compose.yml`
- `app.config.example.json`
- `README.md`

Do not rely on GitHub to store production secrets.

## First Run

After the container starts:

1. Open the admin login page
2. Sign in with the credentials from `app.config.json`
3. Add sites
4. Choose `HTTP` or `Browser` fetch mode per site
5. Enable auto sync for the sites you want in the polling pool

## Sync Model

Current auto sync behavior:

- enabled auto-sync sites enter the worker pool
- the pool keeps a fixed concurrency
- when one site finishes, the next site starts automatically
- after all sites complete, the next cycle begins immediately
- single-site timeout protection prevents stuck workers from blocking the pool forever

## Troubleshooting

`FlareSolverr 请求失败: getaddrinfo ENOTFOUND flaresolverr`

- If you use Docker Compose, make sure the `flaresolverr` service is running
- Inside Compose, `flaresolverr.url` should be `http://flaresolverr:8191/v1`

Port already in use:

- another process is already listening on the configured port
- stop the old process or change `server.port` in `app.config.json`

Config changed but not applied:

- restart the app container: `docker compose restart vps-monitor`

`Error: EISDIR: illegal operation on a directory, open '/app/data.json'`

- this is only relevant when migrating from an old JSON-based deployment
- it means the old deployment mounted `./data.json` as a directory
- switch to the current compose file that mounts `./data:/app/data`
- then run:

```bash
docker compose down
rm -rf data.json
mkdir -p data
docker compose up -d --build
```
