# VPS Inventory Monitoring

WHMCS VPS inventory monitoring platform with:

- Admin backend: dashboard, site management, country dictionary, blocked products
- Public storefront: merchant grouping, filters, direct affiliate purchase
- Click tracking, telemetry, Telegram notifications
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
- `data.example.json`: runtime data template for GitHub / new deployments
- `data.json`: real runtime data file, not committed to Git

## Configuration

1. Create your real config file from the example:

```bash
cp app.config.example.json app.config.json
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
    "backgroundImage": ""
  },
  "telegram": {
    "botToken": "",
    "chatId": ""
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
- `public.title` / `public.backgroundImage`
- `telegram.botToken` / `telegram.chatId`
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

- `docker-compose.yml` mounts `app.config.json` into the app container
- Compose also starts `flaresolverr`
- Inside Docker Compose, `flaresolverr.url` should use `http://flaresolverr:8191/v1`

## Data Persistence

- `data.json` stores runtime data
- Back up `data.json` regularly
- If you migrate servers, keep both `app.config.json` and `data.json`

## GitHub Hosting Notes

If you plan to host this project on GitHub:

- Commit `app.config.example.json`
- Commit `data.example.json`
- Do not commit `app.config.json`
- Do not commit `data.json`
- Do not commit real admin credentials, Telegram tokens, or private URLs
- `app.config.json` and `data.json` are already ignored by `.gitignore`
- Before pushing, review `git status` and make sure no secrets are staged

Recommended repository contents:

- source code
- `Dockerfile`
- `docker-compose.yml`
- `app.config.example.json`
- `data.example.json`
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
