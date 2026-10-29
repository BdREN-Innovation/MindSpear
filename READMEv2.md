# MindSpear Final Production Reset + Clean Deploy Guide

This is the final deployment path to follow for server1.

Use this guide for **server1** only. Do **not** deploy MindSpear onto server2 while it is serving other real-user Django/React/PostgreSQL apps unless you first isolate it in a separate VM/container. MindSpear needs its own Nginx vhosts, PostgreSQL database, Redis, PHP-FPM, Laravel Reverb WebSockets, and a Next.js process. Those pieces can collide with existing production apps through Nginx defaults, ports, Redis DBs, certificates, process managers, and package upgrades.

The production host configured by this guide is:

- Frontend: `https://mindspear.app`
- Laravel API: `https://mindspear.app/api/v1`
- Broadcast auth: `https://mindspear.app/broadcasting/auth`
- Reverb WebSocket: `wss://mindspear.app/app/...`
- Laravel event publishing: `http://127.0.0.1:8080/apps/...`

Nginx exposes one public domain and routes paths internally:

- `/` and most frontend routes -> Next.js on `127.0.0.1:2000`
- `/api/v1`, `/broadcasting/auth`, `/up`, `/super-admin`, `/storage`, and Laravel/Filament assets -> Laravel/PHP-FPM
- `/app` -> Laravel Reverb on `127.0.0.1:8080`

The app stack in this repo is **Laravel 12 + PHP 8.4 + PostgreSQL + Redis + Reverb + Next.js 15**. PHP 8.4 is required because `backend/composer.json` currently declares `"php": "^8.4"`.

## Root Execution Rule

Run every command in this guide from a `root` shell. SSH as `root` before starting, or if your provider only gives a sudo-capable user, enter a root shell once with `sudo -i` before running any command blocks. Do not prefix individual commands with `sudo`.

PostgreSQL setup uses `runuser -u postgres -- psql` from the root shell because local PostgreSQL administration must execute as the `postgres` system user.

## Final Decision

Follow this path:

1. Rebuild server1 from your VPS/provider panel as a fresh **Ubuntu 24.04 LTS** server.
2. Point only these DNS records to server1: `mindspear.app`, `www.mindspear.app`.
3. Remove or repoint old testing records such as `api.mindspear.app`, `ws.mindspear.app`, `new.mindspear.app`, `admin.new.mindspear.app`, and `admin.mindspear.app`.
4. Run the clean deploy below.

This is the only path that guarantees no residual config from previous hosting attempts. If your VPS/provider panel has a rebuild/reinstall button, use it.

Use the destructive in-server purge only if you cannot rebuild the OS from the provider panel.

## Why The Current Server Looks Suspicious

Your Nginx logs show requests for old hosts such as `admin.mindspear.app`, `new.mindspear.app`, and `admin.new.mindspear.app` being handled by the `api.mindspear.app` server block. That usually means one or both of these are true:

- Old DNS records still point to server1.
- Nginx is using the API vhost as the default for unmatched hosts.

That may not be the only live-hosting bug, but it can absolutely break live quiz/quest hosting because browser `Origin`, CORS, Sanctum broadcast auth, and Reverb allowed origins all depend on the exact host used by the browser.

This guide adds an explicit Nginx default reject vhost so unknown old domains do not silently hit the API app.

It also removes the separate `api.mindspear.app` and `ws.mindspear.app` production hosts. Same-domain routing is simpler for this app because the browser origin stays `https://mindspear.app` for the frontend, API, broadcast auth, and WebSocket connection.

## Before You Start

Have these ready:

- Git repo URL.
- SSH key or deploy token that can clone the repo.
- A real admin email for Let's Encrypt.
- A fresh OpenRouter API key for the AI server (`ai-server/`, the question-generation service).
- SMTP settings can wait until after live hosting is verified; the first deploy uses log-only mail to remove that external dependency.

Generate secrets on the server when needed:

```bash
openssl rand -hex 16   # IDs/password fragments
openssl rand -hex 20   # public Reverb app key
openssl rand -hex 32   # private secrets
```

## DNS Checklist

Before Certbot:

```bash
dig +short mindspear.app
dig +short www.mindspear.app
```

Both should return server1's public IP.

If you use Cloudflare or another DNS proxy/CDN, keep `mindspear.app` and `www.mindspear.app` in DNS-only mode for the first deploy and live-hosting smoke test. After everything works, you may enable the proxy again, but only with WebSockets enabled, SSL mode set to Full Strict, and no cache rule touching `/api/v1`, `/broadcasting/auth`, or `/app`.

Also check old hosts:

```bash
dig +short api.mindspear.app
dig +short ws.mindspear.app
dig +short new.mindspear.app
dig +short admin.new.mindspear.app
dig +short admin.mindspear.app
```

These should not point to server1 unless you intentionally add them to Nginx, CORS, and Reverb allowed origins. The clean production setup should not use them.

## Environment File Policy

Keep backend and frontend env files separate.

This is better than a single shared `.env` because the two runtimes load env files differently and have different security boundaries:

- Laravel reads `backend/.env` at runtime. This file contains server-only secrets such as database password, `APP_KEY`, `REVERB_APP_SECRET`, SMTP credentials, and admin seeder credentials.
- Next.js reads frontend env during build/start. Any variable prefixed with `NEXT_PUBLIC_` is intentionally baked into browser JavaScript. The frontend holds no secrets: the OpenRouter key lives in the AI server's env (`ai-server/.env`), never in a frontend env file.

The naming difference is framework convention, not a MindSpear invention:

- Backend production runtime file: `/var/www/mindspear/backend/.env` (Laravel standard).
- Frontend production secret override: `/var/www/mindspear/frontend/.env.production.local` (Next.js standard for machine-local production values that should not be committed).

The committed `frontend/.env.production` is a frontend template. The backend template is embedded in this guide because `backend/.env.production` is intentionally ignored by git and will not exist after a fresh clone.

A single top-level env file is possible with a deploy script that generates both runtime files, but do not symlink one file into both apps. That makes it too easy to leak backend-only secrets into a frontend build.

## Destructive Purge For Server1

Skip this section if you rebuild the OS from your VPS/provider panel.

Run this only on server1, and only if server1 can be deleted completely. This removes MindSpear app files, service units, Nginx config, TLS certificates, PostgreSQL data, Redis data, PHP config, Node/PM2 state, Composer, package repositories added for this app, logs, and cron entries.

If there is anything on server1 you want to keep, stop here. This purge is intentionally destructive.

```bash
set -e

export DEBIAN_FRONTEND=noninteractive

# Stop app-level processes.
systemctl stop mindspear-frontend mindspear-reverb mindspear-queue 2>/dev/null || true
systemctl disable mindspear-frontend mindspear-reverb mindspear-queue 2>/dev/null || true
rm -f /etc/systemd/system/mindspear-frontend.service
rm -f /etc/systemd/system/mindspear-reverb.service
rm -f /etc/systemd/system/mindspear-queue.service
systemctl daemon-reload

# Stop platform services used by the old deployment or earlier attempts.
systemctl stop nginx php8.4-fpm redis-server postgresql cron certbot.timer apache2 caddy supervisor 2>/dev/null || true
systemctl disable nginx php8.4-fpm redis-server postgresql cron certbot.timer apache2 caddy supervisor 2>/dev/null || true

# Reset firewall rules from old attempts. Clean deploy recreates only SSH/HTTP/HTTPS.
ufw --force reset 2>/dev/null || true

# Stop and remove PM2 leftovers from the old deployment style.
pm2 delete all 2>/dev/null || true
pm2 kill 2>/dev/null || true
npm uninstall -g pm2 2>/dev/null || true
rm -rf /root/.pm2 /home/*/.pm2
for u in $(systemctl list-unit-files --type=service | awk 'tolower($1) ~ /^pm2/ {print $1}'); do
  systemctl disable --now "$u" 2>/dev/null || true
  rm -f "/etc/systemd/system/$u"
done
find /etc/systemd/system -maxdepth 1 -type f \( -iname '*mindspear*' -o -iname '*reverb*' -o -iname '*queue*' \) -delete
systemctl daemon-reload

# Remove MindSpear files, logs, cron, Nginx fragments, and TLS data.
rm -rf /var/www/mindspear /var/log/mindspear
rm -rf /var/www/html /var/www/*
rm -f /etc/nginx/sites-enabled/* /etc/nginx/sites-available/* /etc/nginx/conf.d/*
crontab -u www-data -r 2>/dev/null || true
crontab -r 2>/dev/null || true
rm -f /var/spool/cron/crontabs/www-data /var/spool/cron/crontabs/root 2>/dev/null || true
rm -rf /etc/letsencrypt /var/lib/letsencrypt /var/log/letsencrypt
rm -rf /var/backups/mindspear* /tmp/mindspear* /tmp/laravel* /tmp/next-*

# Drop old database and user if PostgreSQL is still present.
if command -v psql >/dev/null 2>&1; then
  runuser -u postgres -- psql <<'SQL' || true
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'mindspear';
DROP DATABASE IF EXISTS mindspear;
DROP USER IF EXISTS mindspear;
SQL
fi

# Purge packages used by the old MindSpear deployment.
apt purge -y \
  'php8.4*' 'php*' composer nodejs npm nginx nginx-common nginx-core \
  certbot python3-certbot-nginx redis-server redis-tools \
  postgresql postgresql-* postgresql-client-* postgresql-common \
  cron apache2 apache2-* caddy supervisor ufw \
  2>/dev/null || true
apt autoremove -y --purge
apt autoclean

# Remove binaries, package repos, config directories, logs, and data dirs left after package purge.
rm -f /usr/local/bin/composer
rm -f /etc/apt/sources.list.d/nodesource*.list
rm -f /etc/apt/sources.list.d/ondrej-ubuntu-php*.list /etc/apt/sources.list.d/ondrej-php*.list
rm -rf /etc/nginx /etc/php /etc/redis /etc/postgresql /etc/postgresql-common /etc/ufw
rm -rf /etc/apache2 /etc/caddy /etc/supervisor /etc/supervisor.d
rm -rf /var/lib/redis /var/lib/postgresql /var/lib/ufw /var/log/nginx /var/log/postgresql /var/log/redis
rm -rf /var/log/apache2 /var/log/caddy /var/cache/nginx /run/php /run/redis /run/postgresql
rm -rf /usr/lib/node_modules /usr/local/lib/node_modules

apt update

# Final residue check. These commands should return nothing important.
systemctl list-unit-files | grep -Ei 'mindspear|reverb|(^|[[:space:]/.-])pm2([[:space:]/.-]|$)|nginx|apache|caddy|php8\.4|redis|postgres|cron' || true
find /etc -maxdepth 3 \( -iname '*mindspear*' -o -iname '*reverb*' -o -iname '*nginx*' -o -iname '*letsencrypt*' \) -print || true
find /var -maxdepth 3 \( -iname '*mindspear*' -o -iname '*letsencrypt*' \) -print || true

reboot
```

Harmless false positives can appear here. For example, `systemd-tpm2-*` is not PM2, and `/etc/aide/aide.conf.d/31_aide_nginx` is an AIDE integrity-check rule, not an active Nginx config.

After reboot, reconnect and continue with the clean deploy. The clean deploy will reinstall every needed package and recreate required users, directories, config files, databases, certificates, and services.

## Clean Deploy

Reminder: all command blocks below assume you are already in a `root` shell.

### 1. Base Packages

```bash
export DEBIAN_FRONTEND=noninteractive

apt update
apt -y upgrade

apt -y install \
  ca-certificates curl gnupg git unzip ufw software-properties-common lsb-release \
  build-essential pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
  nginx certbot python3-certbot-nginx redis-server cron \
  postgresql-16 postgresql-client-16
```

### 2. Firewall

Only expose SSH, HTTP, and HTTPS. Reverb listens on localhost and is proxied through Nginx.

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

### 3. PHP 8.4

```bash
add-apt-repository -y ppa:ondrej/php
apt update
apt -y install \
  php8.4 php8.4-fpm php8.4-cli php8.4-common \
  php8.4-pgsql php8.4-redis php8.4-mbstring php8.4-xml php8.4-curl \
  php8.4-zip php8.4-bcmath php8.4-intl php8.4-gd php8.4-opcache
```

Edit `/etc/php/8.4/fpm/php.ini`:

```ini
memory_limit = 512M
upload_max_filesize = 50M
post_max_size = 50M
max_execution_time = 60
expose_php = Off
display_errors = Off
log_errors = On
opcache.enable = 1
opcache.memory_consumption = 256
opcache.max_accelerated_files = 20000
opcache.validate_timestamps = 0
```

```bash
systemctl enable --now php8.4-fpm
systemctl restart php8.4-fpm
```

### 4. Composer And Node.js 20

```bash
curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
composer --version

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt -y install nodejs
node -v
npm -v
```

Expected Node major version: `20`.

### 5. PostgreSQL And Redis

```bash
systemctl enable --now postgresql redis-server nginx cron
redis-cli ping
```

Expected Redis output: `PONG`.

Create the database:

```bash
DB_PASSWORD='REPLACE_WITH_STRONG_DB_PASSWORD'

runuser -u postgres -- psql <<SQL
CREATE USER mindspear WITH PASSWORD '${DB_PASSWORD}';
CREATE DATABASE mindspear OWNER mindspear;
GRANT ALL PRIVILEGES ON DATABASE mindspear TO mindspear;
ALTER DATABASE mindspear SET timezone TO 'UTC';
SQL
```

Keep this `DB_PASSWORD`; it must go into `backend/.env`.

### 6. Clone The App

```bash
mkdir -p /var/www/mindspear
chown -R root:www-data /var/www/mindspear
cd /var/www/mindspear
git clone REPLACE_REPO_URL .
```

### 7. Backend Environment

```bash
cd /var/www/mindspear/backend

cat > .env <<'ENV'
APP_NAME=MindSpear
APP_ENV=production
APP_KEY=
APP_DEBUG=false
APP_URL=https://mindspear.app
APP_TIMEZONE=UTC
APP_LOCALE=en
APP_FALLBACK_LOCALE=en
APP_FAKER_LOCALE=en

FRONTEND_URL=https://mindspear.app
CORS_ALLOWED_ORIGINS=https://mindspear.app,https://www.mindspear.app
SANCTUM_STATEFUL_DOMAINS=
SESSION_DOMAIN=.mindspear.app
SESSION_SECURE_COOKIE=true
SESSION_SAME_SITE=lax

APP_MAINTENANCE_DRIVER=file
BCRYPT_ROUNDS=12
PHP_CLI_SERVER_WORKERS=4

LOG_CHANNEL=daily
LOG_STACK=daily
LOG_DEPRECATIONS_CHANNEL=null
LOG_LEVEL=warning
LOG_DAYS=14

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=mindspear
DB_USERNAME=mindspear
DB_PASSWORD=REPLACE_WITH_STRONG_DB_PASSWORD

CACHE_STORE=redis
QUEUE_CONNECTION=redis
SESSION_DRIVER=redis
BROADCAST_CONNECTION=reverb
REDIS_CLIENT=phpredis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=null
REDIS_DB=0
REDIS_CACHE_DB=1

REVERB_APP_ID=REPLACE_WITH_RANDOM_ID
REVERB_APP_KEY=REPLACE_WITH_RANDOM_PUBLIC_KEY
REVERB_APP_SECRET=REPLACE_WITH_RANDOM_SECRET
REVERB_HOST=mindspear.app
REVERB_PORT=443
REVERB_SCHEME=https
REVERB_BROADCAST_HOST=127.0.0.1
REVERB_BROADCAST_PORT=8080
REVERB_BROADCAST_SCHEME=http
REVERB_SERVER_HOST=127.0.0.1
REVERB_SERVER_PORT=8080
REVERB_ALLOWED_ORIGINS=https://mindspear.app,https://www.mindspear.app
REVERB_SCALING_ENABLED=true

MAIL_MAILER=log
MAIL_SCHEME=null
MAIL_HOST=
MAIL_PORT=587
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS="no-reply@mindspear.app"
MAIL_FROM_NAME="${APP_NAME}"

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=us-east-1
AWS_BUCKET=
AWS_USE_PATH_STYLE_ENDPOINT=false

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://mindspear.app/auth/google/callback

MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=https://mindspear.app/auth/microsoft/callback

SUPER_ADMIN_EMAIL=admin@mindspear.app
SUPER_ADMIN_PASSWORD=REPLACE_WITH_STRONG_ADMIN_PASSWORD
ENV

chown root:www-data .env
chmod 640 .env

mkdir -p storage/framework/{cache/data,sessions,views} storage/logs bootstrap/cache
chown -R root:www-data storage bootstrap/cache
chmod -R ug+rwX storage bootstrap/cache
```

Edit `/var/www/mindspear/backend/.env` and replace every `REPLACE_...` value before continuing. Then install backend dependencies:

```bash
export COMPOSER_ALLOW_SUPERUSER=1
composer install --no-dev --optimize-autoloader --no-interaction
```

Important:

- `REDIS_PASSWORD=null` must match default Redis with no password.
- `REVERB_APP_KEY` must be copied exactly into the frontend env.
- `REVERB_HOST=mindspear.app` is browser-facing.
- `REVERB_BROADCAST_HOST=127.0.0.1` makes Laravel publish live events directly to the local Reverb daemon. This avoids production hairpin DNS/TLS problems.
- `MAIL_MAILER=log` is intentional for the first deploy. Switch to real SMTP only after live hosting works.
- Do not include old hosts like `new.mindspear.app` unless you intentionally serve production from them.

Finish backend setup:

```bash
php artisan key:generate --force
php artisan migrate --force
php artisan db:seed --class=SuperAdminSeeder --force
php artisan storage:link

php artisan optimize:clear
php artisan config:cache
php artisan event:cache
php artisan view:cache

chown -R www-data:www-data storage bootstrap/cache
find storage -type d -exec chmod 775 {} \;
find storage -type f -exec chmod 664 {} \;
```

Route caching is intentionally skipped for the first clean deployment. Laravel can cache these routes, but skipping it removes one extra production-only variable while we verify live hosting. Add `php artisan route:cache` later after the live flow is confirmed.

### 8. Frontend Environment And Build

```bash
cd /var/www/mindspear/frontend
cp .env.production .env.production.local
chown root:www-data .env.production.local
chmod 640 .env.production.local
```

Edit `/var/www/mindspear/frontend/.env.production.local`:

```env
NEXT_PUBLIC_API_BASE_URL=https://mindspear.app/api/v1
NEXT_PUBLIC_REVERB_APP_KEY=REPLACE_WITH_SAME_BACKEND_REVERB_APP_KEY
NEXT_PUBLIC_REVERB_HOST=mindspear.app
NEXT_PUBLIC_REVERB_PORT=443
NEXT_PUBLIC_REVERB_SCHEME=https
NEXT_PUBLIC_APP_URL=https://mindspear.app
# The AI server, behind the same domain: Nginx proxies /ai-api/ to 127.0.0.1:8001/
NEXT_PUBLIC_AI_API_URL=/ai-api
```

Build:

```bash
npm ci
npm run build
chown -R www-data:www-data /var/www/mindspear/frontend/.next
```

### 8.1 AI Server

The AI server (`ai-server/`, FastAPI on 127.0.0.1:8001) writes quiz / quest / fun-game items. The
browser reaches it through `/ai-api` on the site's origin (Nginx, section 10), so it needs no CORS.
It runs on Ubuntu 24.04's Python 3.12 in a uv-managed virtualenv:

```bash
curl -LsSf https://astral.sh/uv/0.12.23/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

cd /var/www/mindspear/ai-server
# The system Python, not a uv-downloaded one under /root that www-data can't read.
uv sync --frozen --no-dev --python /usr/bin/python3.12
cp .env.example .env
chown root:www-data .env
chmod 640 .env
```

Edit `/var/www/mindspear/ai-server/.env`:

```env
APP_ENV=production
CORS_ORIGINS=
LARAVEL_API_URL=https://mindspear.app/api/v1
AUTH_DISABLED=false
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=REPLACE_WITH_OPENROUTER_KEY
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
OPENROUTER_APP_URL=https://mindspear.app
```

### 9. systemd Services

This guide uses systemd for all long-running app processes. PM2 is intentionally not used.

Create `/etc/systemd/system/mindspear-frontend.service`:

```ini
[Unit]
Description=MindSpear Next.js frontend
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/mindspear/frontend
Environment=NODE_ENV=production
Environment=PORT=2000
ExecStart=/usr/bin/node /var/www/mindspear/frontend/node_modules/next/dist/bin/next start -p 2000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/mindspear-reverb.service`:

```ini
[Unit]
Description=MindSpear Laravel Reverb WebSocket
After=network.target redis-server.service
Requires=redis-server.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/mindspear/backend
ExecStart=/usr/bin/php8.4 artisan reverb:start --host=127.0.0.1 --port=8080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/mindspear-queue.service`:

```ini
[Unit]
Description=MindSpear Laravel queue worker
After=network.target redis-server.service postgresql.service
Requires=redis-server.service postgresql.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/mindspear/backend
ExecStart=/usr/bin/php8.4 artisan queue:work redis --queue=default,broadcasts --sleep=1 --tries=3 --backoff=3 --max-time=3600 --max-jobs=1000 --timeout=60
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/mindspear-ai.service`:

```ini
[Unit]
Description=MindSpear AI server (question generation)
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
# Settings are read from .env in this directory.
WorkingDirectory=/var/www/mindspear/ai-server
ExecStart=/var/www/mindspear/ai-server/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Start services:

```bash
systemctl daemon-reload
systemctl enable --now mindspear-frontend mindspear-reverb mindspear-queue mindspear-ai
systemctl status mindspear-frontend mindspear-reverb mindspear-queue mindspear-ai --no-pager
```

Check local listeners:

```bash
ss -ltnp | grep -E ':2000|:8001|:8080|:5432|:6379'
curl -I http://127.0.0.1:2000
curl http://127.0.0.1:8001/health
```

### 10. Nginx

Remove the default site:

```bash
rm -f /etc/nginx/sites-enabled/default
```

Create `/etc/nginx/sites-available/00-reject-unknown-hosts`:

```nginx
server {
    listen 80 default_server;
    server_name _;
    return 444;
}

server {
    listen 443 ssl default_server;
    server_name _;
    ssl_reject_handshake on;
}
```

Create `/etc/nginx/sites-available/mindspear.app`:

```nginx
server {
    listen 80;
    server_name www.mindspear.app;
    return 301 https://mindspear.app$request_uri;
}

server {
    listen 80;
    server_name mindspear.app;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 50M;

    # Reverb browser WebSocket endpoint: wss://mindspear.app/app/<key>
    location ^~ /app/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    # Laravel API. Keep this at /api/v1 so existing Next.js /api routes keep working.
    location = /api/v1 {
        root /var/www/mindspear/backend/public;
        try_files $uri /index.php?$query_string;
    }

    location ^~ /api/v1/ {
        root /var/www/mindspear/backend/public;
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /broadcasting/auth {
        root /var/www/mindspear/backend/public;
        try_files $uri /index.php?$query_string;
    }

    location = /up {
        root /var/www/mindspear/backend/public;
        try_files $uri /index.php?$query_string;
    }

    # Filament admin panel and Livewire endpoints.
    location ^~ /super-admin {
        root /var/www/mindspear/backend/public;
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ^~ /livewire {
        root /var/www/mindspear/backend/public;
        try_files $uri $uri/ /index.php?$query_string;
    }

    # Laravel public files and Filament assets.
    location ^~ /storage/ {
        root /var/www/mindspear/backend/public;
        try_files $uri =404;
        access_log off;
        expires 30d;
    }

    location ^~ /build/ {
        root /var/www/mindspear/backend/public;
        try_files $uri =404;
        access_log off;
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location ^~ /css/filament/ {
        root /var/www/mindspear/backend/public;
        try_files $uri =404;
        access_log off;
        expires 1y;
    }

    location ^~ /js/filament/ {
        root /var/www/mindspear/backend/public;
        try_files $uri =404;
        access_log off;
        expires 1y;
    }

    location = /images/mindspear_logo.svg {
        root /var/www/mindspear/backend/public;
        try_files $uri =404;
        access_log off;
    }

    location = /images/favicon.svg {
        root /var/www/mindspear/backend/public;
        try_files $uri =404;
        access_log off;
    }

    location ~ \.php$ {
        root /var/www/mindspear/backend/public;
        fastcgi_pass unix:/run/php/php8.4-fpm.sock;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout 60s;
    }

    location ~ /\.(?!well-known).* { deny all; }
    location ~* \.(?:env|log|sqlite)$ { deny all; }

    # The AI server (section 8.1). A generation with a top-up can take minutes.
    location ^~ /ai-api/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }

    location /_next/static/ {
        proxy_pass http://127.0.0.1:2000;
        proxy_cache_valid 200 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:2000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    access_log /var/log/nginx/mindspear.app.access.log;
    error_log  /var/log/nginx/mindspear.app.error.log;
}
```

Enable sites:

```bash
ln -sf /etc/nginx/sites-available/00-reject-unknown-hosts /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/mindspear.app /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 11. TLS

Run Certbot only after DNS is correct.

```bash
certbot --nginx \
  -d mindspear.app -d www.mindspear.app \
  --redirect --agree-tos -m REPLACE_ADMIN_EMAIL --no-eff-email

nginx -t
systemctl reload nginx
systemctl status certbot.timer --no-pager
```

### 12. Scheduler

```bash
echo '* * * * * cd /var/www/mindspear/backend && /usr/bin/php8.4 artisan schedule:run >> /dev/null 2>&1' | crontab -u www-data -
```

## Post-Deploy Verification

### Services

```bash
systemctl status nginx php8.4-fpm postgresql redis-server --no-pager
systemctl status mindspear-frontend mindspear-reverb mindspear-queue mindspear-ai --no-pager
```

### HTTP

```bash
curl -I https://mindspear.app
curl -I https://mindspear.app/up
curl -I https://mindspear.app/api/v1/user-check
curl https://mindspear.app/ai-api/health
curl -i -X POST https://mindspear.app/ai-api/v1/generate
```

Expected:

- `https://mindspear.app` returns `200` or a valid app redirect.
- `https://mindspear.app/up` returns `200`.
- `https://mindspear.app/api/v1/user-check` returns `401` when unauthenticated; that proves the request reached Laravel.
- `https://mindspear.app/ai-api/health` returns `{"status":"ok"}`, and the unauthenticated `POST .../v1/generate` returns `401`; that proves Nginx reaches the AI server.

Test Reverb with a real WebSocket upgrade request, not `curl -I`:

```bash
curl -i --http1.1 --max-time 5 \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Origin: https://mindspear.app' \
  'https://mindspear.app/app/REPLACE_WITH_REVERB_APP_KEY?protocol=7&client=js&version=8.4.0&flash=false'
```

Expected: `HTTP/1.1 101 Switching Protocols`. A plain `curl -I https://mindspear.app/app/...` can return an error because it is a `HEAD` request, not a WebSocket connection.

### CORS Preflight For Broadcast Auth

```bash
curl -i -X OPTIONS https://mindspear.app/broadcasting/auth \
  -H 'Origin: https://mindspear.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

Expected headers include:

```text
access-control-allow-origin: https://mindspear.app
access-control-allow-methods:
access-control-allow-headers:
```

### Reverb Browser Test

Open `https://mindspear.app`, then run this in the browser console:

```js
const ws = new WebSocket("wss://mindspear.app/app/REPLACE_WITH_REVERB_APP_KEY?protocol=7&client=js&version=8.4.0&flash=false");
ws.onopen = () => console.log("reverb open");
ws.onerror = (event) => console.error("reverb error", event);
ws.onmessage = (event) => console.log(event.data);
```

Expected: `reverb open`.

### Live Quest/Quiz Smoke Test

1. Log in at `https://mindspear.app`.
2. Create or open a quiz/quest.
3. Start a live session.
4. Join from a second browser/device using the public link or code.
5. Confirm the host screen participant count changes without refresh.
6. Start a question/task.
7. Submit from the participant device.
8. Confirm the host screen receives the live update without refresh.

## Debugging Live Hosting

Use these in separate terminals while reproducing the problem:

```bash
journalctl -u mindspear-reverb -f
journalctl -u mindspear-queue -f
journalctl -u mindspear-frontend -f
tail -f /var/log/nginx/mindspear.app.error.log
tail -f /var/www/mindspear/backend/storage/logs/laravel-*.log
```

Useful checks:

```bash
cd /var/www/mindspear/backend
php artisan about
php artisan route:list | grep broadcasting
php artisan tinker --execute="print_r(config('broadcasting.connections.reverb.options'));"
php artisan tinker --execute="cache()->put('ping','ok',10); echo cache('ping');"
php artisan queue:failed
```

If WebSocket opens but no live events arrive:

- Confirm `BROADCAST_CONNECTION=reverb`.
- Confirm `REVERB_APP_KEY` equals `NEXT_PUBLIC_REVERB_APP_KEY`.
- Confirm `REVERB_BROADCAST_HOST=127.0.0.1`, `REVERB_BROADCAST_PORT=8080`, and `REVERB_BROADCAST_SCHEME=http`.
- Run `php artisan optimize:clear && php artisan config:cache`.
- Restart Reverb: `systemctl restart mindspear-reverb`.
- Restart the frontend after rebuilding: `systemctl restart mindspear-frontend`.

If `/broadcasting/auth` returns `401`:

- The browser is not sending a valid bearer token.
- The frontend may be using the wrong API base URL.
- Check browser devtools for the exact request URL and `Authorization` header.

If `/broadcasting/auth` fails CORS:

- Check `CORS_ALLOWED_ORIGINS`.
- Run `php artisan config:cache`.
- Reload PHP-FPM: `systemctl reload php8.4-fpm`.

If Reverb rejects origin:

- Check `REVERB_ALLOWED_ORIGINS`.
- Do not browse from old hosts like `admin.new.mindspear.app`.
- Run `php artisan config:cache`.
- Restart Reverb.

If WebSocket connects but events do not arrive:

- Check that Nginx routes `/app/` to `127.0.0.1:8080`.
- Check that Laravel publishes directly to local Reverb with `REVERB_BROADCAST_HOST=127.0.0.1` and `REVERB_BROADCAST_PORT=8080`.

If old hosts still reach the app:

```bash
nginx -T | grep -nE 'api\.mindspear|ws\.mindspear|new\.mindspear|admin\.mindspear|server_name|default_server'
dig +short api.mindspear.app
dig +short ws.mindspear.app
dig +short new.mindspear.app
dig +short admin.new.mindspear.app
dig +short admin.mindspear.app
```

Remove the DNS records or add explicit reject vhosts. Do not let them silently route to `mindspear.app`.

## Update Workflow After The First Deploy

```bash
cd /var/www/mindspear
git pull

cd /var/www/mindspear/backend
export COMPOSER_ALLOW_SUPERUSER=1
composer install --no-dev --optimize-autoloader --no-interaction
php artisan migrate --force
php artisan optimize:clear
php artisan config:cache
php artisan event:cache
php artisan view:cache
php artisan queue:restart
systemctl restart mindspear-reverb mindspear-queue
systemctl reload php8.4-fpm

cd /var/www/mindspear/frontend
npm ci
npm run build
chown -R www-data:www-data /var/www/mindspear/frontend/.next
systemctl restart mindspear-frontend

cd /var/www/mindspear/ai-server
uv sync --frozen --no-dev --python /usr/bin/python3.12
systemctl restart mindspear-ai

nginx -t
systemctl reload nginx
```

## Quick Answer: Server1 Or Server2?

Use server1.

Server2 already has production users. MindSpear adds a different runtime family and WebSocket stack. That is not worth risking when server1 can be rebuilt or purged. A fresh server1 also gives us a clear failure boundary: if live hosting still fails after this guide, the problem is likely app configuration or code, not old hosting residue.
