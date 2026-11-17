# MindSpear Local Dev Commands

Run each long-running command in its own terminal tab.

## Start

### 1. Redis

Ubuntu/WSL installs Redis as a **systemd service** that auto-starts on boot and binds 127.0.0.1:6379. Check first whether it's already running:

```bash
ss -ltnp | grep 6379
```
sudo systemctl stop redis-server

- **Already listening on 6379** → skip this step. The system service is already serving Redis. Move on to step 2.
- **Nothing on 6379** → start it your way:

  ```bash
  cd /home/bdren/Projects/MindSpear/backend
  redis-server --bind 127.0.0.1 --port 6379
  ```

If you want to run your own foreground Redis but the port is taken, stop the system service first (see "Stop Redis Only" below).

### 2. Backend API

```bash
cd /home/bdren/Projects/MindSpear/backend
php artisan optimize:clear
php artisan serve --host=127.0.0.1 --port=8000
```

### 3. Queue Worker

```bash
cd /home/bdren/Projects/MindSpear/backend
php artisan queue:work redis --tries=3
```

### 4. Reverb WebSocket Server

```bash
cd /home/bdren/Projects/MindSpear/backend
php artisan optimize:clear
php artisan reverb:start --host=0.0.0.0 --port=8080
```

### 5. Frontend

```bash
cd /home/bdren/Projects/MindSpear/frontend
npm run dev
```

## Verify

```bash
redis-cli -h 127.0.0.1 -p 6379 ping
ss -ltnp | grep -E ':6379|:8000|:8080|:2000'
```

Expected ports:

```text
6379  Redis
8000  Laravel API
8080  Reverb WebSocket
2000  Next.js frontend
```

## Stop

### Stop Reverb Only

```bash
pkill -f "php artisan reverb:start"
```

### Stop Queue Worker Only

```bash
pkill -f "php artisan queue:work"
```

### Restart Queue Worker After Backend Code Changes

```bash
pkill -f "php artisan queue:work"
cd /home/bdren/Projects/MindSpear/backend
php artisan queue:work redis --tries=3
```

### Stop Backend API Only

```bash
pkill -f "php artisan serve"
```

### Stop Frontend Only

```bash
pkill -f "next dev"
```

### Stop Redis Only

If you started Redis yourself in a foreground terminal, `Ctrl+C` in that terminal is the cleanest stop.

If Redis was started by the system service (the default on Ubuntu/WSL), `redis-cli shutdown` will be overruled by systemd and the service restarts immediately. Stop it via systemd instead:

```bash
sudo systemctl stop redis-server
sudo systemctl disable redis-server   # also prevent auto-start at boot
```

Confirm nothing is listening on 6379:

```bash
ss -ltnp | grep 6379
```

If the port is still busy after all of the above, find what's holding it:

```bash
sudo lsof -i :6379
```

## Stop Everything Local

```bash
pkill -f "php artisan reverb:start"
pkill -f "php artisan queue:work"
pkill -f "php artisan serve"
pkill -f "next dev"
# If you started Redis yourself in a foreground terminal, Ctrl+C there.
# If Redis is the systemd service, stop it via systemctl:
sudo systemctl stop redis-server
```

## If Reverb Says Redis Connection Refused

Start Redis first, then restart Reverb. Either start the system service:

```bash
sudo systemctl start redis-server
```

Or run your own (only if nothing is already on 6379):

```bash
cd /home/bdren/Projects/MindSpear/backend
redis-server --bind 127.0.0.1 --port 6379
```

Then in a separate terminal:

```bash
cd /home/bdren/Projects/MindSpear/backend
php artisan optimize:clear
php artisan reverb:start --host=0.0.0.0 --port=8080
```
