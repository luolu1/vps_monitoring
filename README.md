# VPS Inventory Monitoring

WHMCS VPS inventory monitoring platform with:

- Admin backend (dashboard, site management, country dictionary, blocked products)
- Public storefront (merchant grouping, filters, direct affiliate purchase)
- Click tracking, telemetry, and Telegram sync notifications

## Quick Overview

- Runtime: Node.js 20+
- Database: local `data.json`
- Default port: `3000`
- Default admin: `admin` / `admin123`

## Environment Variables

Optional variables:

- `PORT` (default `3000`)
- `SESSION_SECRET` (default `change-me-secret`)

Example (Linux/macOS):

```bash
export PORT=3000
export SESSION_SECRET="replace-with-strong-secret"
```

Example (Windows PowerShell):

```powershell
$env:PORT = "3000"
$env:SESSION_SECRET = "replace-with-strong-secret"
```

---

## Deploy on Linux

### 1) Install Node.js

Ubuntu/Debian (Node 20):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2) Run App

```bash
git clone https://github.com/luolu1/vps_monitoring.git
cd vps_monitoring
npm install
npm run dev
```

Open: `http://<server-ip>:3000`

### 3) Production (recommended)

Use PM2:

```bash
sudo npm i -g pm2
pm2 start src/server.js --name vps-monitor
pm2 save
pm2 startup
```

---

## Deploy on Windows

### 1) Install Node.js LTS

- Download and install from: https://nodejs.org/

### 2) Run App (PowerShell)

```powershell
git clone https://github.com/luolu1/vps_monitoring.git
cd vps_monitoring
npm install
npm run dev
```

Open: `http://localhost:3000`

If `npm` is blocked by execution policy, run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

---

## Deploy with Docker

### Option A: Docker CLI

```bash
git clone https://github.com/luolu1/vps_monitoring.git
cd vps_monitoring
docker build -t vps-monitoring:latest .
docker run -d --name vps-monitor -p 3000:3000 -e PORT=3000 -e SESSION_SECRET="replace-with-strong-secret" vps-monitoring:latest
```

### Option B: Docker Compose

```bash
git clone https://github.com/luolu1/vps_monitoring.git
cd vps_monitoring
docker compose up -d --build
```

Open: `http://localhost:3000`

Project includes:

- `Dockerfile`
- `docker-compose.yml`

---

## Notes

- First run auto-creates `data.json` and default admin user.
- `data.json` is runtime data. Back it up regularly.
- For security, change default admin credentials immediately in **System Settings**.
- Monitor now includes a site-level lock with stale-lock recovery to prevent overlapping sync runs for the same site (`skip_running` / `stale_lock_recovered` events).
