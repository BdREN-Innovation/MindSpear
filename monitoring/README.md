# Monitoring

Prometheus and Grafana for the MindSpear stack, as a separate Docker Compose project. It shows,
over time, what `docker stats` shows for every container, plus the host, PostgreSQL, Redis and the
Laravel queue depths, and it receives the results of k6 load tests (`load-tests/`).

| Component | Image | What it collects |
|---|---|---|
| `prometheus` | `prom/prometheus` | Stores every metric; scrapes every 15 s; receives k6 results (remote write) |
| `grafana` | `grafana/grafana` | Dashboards, provisioned from files in this folder |
| `cadvisor` | `gcr.io/cadvisor/cadvisor` | Per-container CPU, memory, network, restarts, out-of-memory kills |
| `node-exporter` | `prom/node-exporter` | Host CPU, memory, load, disk |
| `postgres-exporter` | `prometheuscommunity/postgres-exporter` | Connections, transactions, cache hit ratio, locks |
| `redis-exporter` | `oliver006/redis_exporter` | Redis memory, clients, commands, and the Laravel queue lengths |

Not included yet, each with a place ready for it: alerting (`prometheus/rules/`, the commented
`alertmanager` service, `grafana/provisioning/alerting/`), application metrics such as php-fpm,
nginx, or a `/metrics` endpoint in Laravel or FastAPI (`prometheus/targets/apps/`), and logs (Loki).

## Quick start (dev)

The app stack must be running first: this stack joins its Docker network.

```sh
docker compose up -d                                   # the app (docker-compose.yml)
docker compose -f monitoring/docker-compose.yml up -d  # this stack; no .env needed in dev
```

- Grafana: http://localhost:3200 (admin / admin; Grafana asks you to change it). The home page is
  **MindSpear overview**.
- Prometheus: http://localhost:9090 (targets: http://localhost:9090/targets).

To stop it: `docker compose -f monitoring/docker-compose.yml down`. Data stays in the
`mindspear-monitoring_prometheus-data` and `mindspear-monitoring_grafana-data` volumes; `down -v`
deletes it.

**Order matters for the app network.** This stack must be started after the app (otherwise:
"network mindspear_mindspear declared as external, but could not be found") and stopped before
the app's `docker compose down` (otherwise the app's network cannot be removed: "has active
endpoints"). Restarting the app with `up -d` or `restart` is fine.

## Production (dev.mindspear.app)

Grafana is served at **https://dev.mindspear.app/grafana/** by the server's nginx. Prometheus and
the exporters are never public.

1. The app stack is up: `docker compose -f docker-compose.prod.yml up -d` (it creates the
   `mindspear-prod_mindspear` network).
2. Settings:
   ```sh
   cp monitoring/.env.example monitoring/.env
   chmod 600 monitoring/.env
   ```
   and set:
   ```ini
   MONITORING_ENV=prod
   APP_NETWORK=mindspear-prod_mindspear
   GRAFANA_ADMIN_PASSWORD=<openssl rand -hex 32>
   GRAFANA_DOMAIN=dev.mindspear.app
   GRAFANA_ROOT_URL=https://%(domain)s/grafana/
   GRAFANA_SERVE_FROM_SUB_PATH=true
   GRAFANA_COOKIE_SECURE=true
   POSTGRES_EXPORTER_USER=<DB_USERNAME from backend/.env.prod, or "monitoring" (below)>
   POSTGRES_EXPORTER_PASSWORD=<its password>
   POSTGRES_EXPORTER_DB=<DB_DATABASE from backend/.env.prod>
   REDIS_PASSWORD=<REDIS_PASSWORD from backend/.env.prod>
   ```
3. Start it: `docker compose -f monitoring/docker-compose.yml up -d`, then check that every
   container is healthy: `docker compose -f monitoring/docker-compose.yml ps`.
4. nginx: `deploy/nginx/dev.mindspear.app.conf` has an `upstream mindspear_grafana` line and three
   `/grafana` locations. certbot has rewritten the copy installed on the server (it added the HTTPS
   server), so **add those lines to the live file** `/etc/nginx/sites-available/dev.mindspear.app`
   rather than copying the repository file over it. Then:
   ```sh
   sudo nginx -t && sudo systemctl reload nginx
   curl -s https://dev.mindspear.app/grafana/api/health    # {"database":"ok",...}
   ```
5. Sign in at https://dev.mindspear.app/grafana/ with `GRAFANA_ADMIN_USER` and the password from
   step 2. The admin password from `.env` only applies to a new, empty `grafana-data` volume; to
   change it later, use the UI or
   `docker compose -f monitoring/docker-compose.yml exec grafana grafana cli admin reset-admin-password <new>`.

Upgrading: change the image tags in `docker-compose.yml`, then
`docker compose -f monitoring/docker-compose.yml up -d`. Nothing in the app needs to restart.

### A read-only database role (recommended in production)

The exporter needs only statistics, not the app's data or write access. Create a role for it once:

```sh
docker compose -f docker-compose.prod.yml exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```
```sql
CREATE ROLE monitoring LOGIN PASSWORD '<openssl rand -hex 32>';
GRANT pg_monitor TO monitoring;
GRANT CONNECT ON DATABASE <DB_DATABASE> TO monitoring;
```

Then set `POSTGRES_EXPORTER_USER=monitoring` and its password in `monitoring/.env` and run
`docker compose -f monitoring/docker-compose.yml up -d postgres-exporter`.

## Settings (`monitoring/.env`)

Every setting has the default shown in `.env.example`, which fits the dev stack.

| Variable | Default | Purpose |
|---|---|---|
| `MONITORING_ENV` | `dev` | The `env` label Prometheus adds to data it sends elsewhere (alerts, federation) |
| `APP_NETWORK` | `mindspear_mindspear` | The app's Docker network (prod: `mindspear-prod_mindspear`) |
| `GRAFANA_BIND`, `GRAFANA_PORT` | `127.0.0.1`, `3200` | Where Grafana is published |
| `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD` | `admin`, `admin` | First admin account (first start only) |
| `GRAFANA_DOMAIN`, `GRAFANA_ROOT_URL`, `GRAFANA_SERVE_FROM_SUB_PATH`, `GRAFANA_COOKIE_SECURE` | `localhost`, `http://localhost:3200/`, `false`, `false` | Grafana's public address (prod: `/grafana/` on the main domain) |
| `PROM_BIND`, `PROM_PORT` | `127.0.0.1`, `9090` | Where Prometheus is published. It has no login: keep it on 127.0.0.1 |
| `PROM_RETENTION`, `PROM_RETENTION_SIZE` | `15d`, `5GB` | History kept, whichever limit is reached first |
| `POSTGRES_HOST`, `POSTGRES_EXPORTER_USER`, `POSTGRES_EXPORTER_PASSWORD`, `POSTGRES_EXPORTER_DB` | `postgres`, `myuser`, `mypassword`, `mindspear` | How the exporter connects |
| `REDIS_HOST`, `REDIS_PASSWORD` | `redis`, empty | How the exporter connects (prod Redis has a password) |
| `REDIS_QUEUE_KEYS`, `REDIS_QUEUE_KEY_PATTERNS` | the three Laravel queues | Redis keys whose length is reported (below) |

## How it fits together

```
monitoring/
├── docker-compose.yml
├── .env.example
├── scripts/fetch-dashboards.sh      # updates the community dashboards (below)
├── prometheus/
│   ├── prometheus.yml               # global settings and one scrape job per target file
│   ├── targets/infra.yml            # cadvisor, node-exporter
│   ├── targets/datastores.yml       # postgres-exporter, redis-exporter
│   ├── targets/apps/                # application exporters, one file each (none yet)
│   └── rules/mindspear.yml          # recording rules the overview dashboard uses
└── grafana/
    ├── provisioning/                # the datasource and the dashboard folder, as code
    └── dashboards/<folder>/*.json   # each subfolder is a Grafana folder
```

- **Networks**: everything talks on the private `monitoring` network. Only the two database
  exporters also join the app's network, to reach `postgres` and `redis` by name.
- **Targets** are listed in `prometheus/targets/*.yml` (file-based service discovery). Prometheus
  watches those files, so adding or changing a target needs no restart and no reload.
- **Dashboards are code**: the JSON files are provisioned read-only. Changing one in the UI and
  pressing Save does not work; edit the file instead (below).
- **One Prometheus serves both stacks on a server**: cAdvisor reports every container on the host,
  labelled with its compose project, so the overview's **Compose project** drop-down picks
  `mindspear` (dev), `mindspear-prod`, or this stack itself.
- **k6** pushes results to `http://127.0.0.1:9090/api/v1/write`; see `load-tests/README.md`.

### Laravel queue depth

Laravel keeps each Redis queue in a list named `<REDIS_PREFIX>queues:<queue>` in database 0. The
prefix comes from `APP_NAME` (`MindSpear` → `mindspear_database_`) unless `REDIS_PREFIX` is set in
the backend env. redis-exporter reports the length of the three queue lists as
`redis_key_size{key="mindspear_database_queues:default"}` (0 when empty), and the recording rule
`mindspear:queue_depth:jobs` turns that into one series per `queue`.

If the prefix ever changes, confirm it and update `REDIS_QUEUE_KEYS` / `REDIS_QUEUE_KEY_PATTERNS`:

```sh
docker compose exec backend php artisan tinker --execute="echo config('database.redis.options.prefix');"
# prod: docker compose -f docker-compose.prod.yml exec backend php artisan tinker --execute="..."
```

## Common changes

### Adding a scrape target

1. The service must expose Prometheus metrics on the `monitoring` network: put the exporter in this
   compose file (or, for an app container, also attach that container to the network).
2. Add a file `prometheus/targets/apps/<name>.yml`:
   ```yaml
   - targets: ["<host>:<port>"]
     labels:
       job: <name>
   ```
3. Within a minute it appears at http://localhost:9090/targets. No restart.

### Adding or changing a dashboard

- **Your own**: build it in Grafana (New → Dashboard; a new dashboard can be saved), then
  Share → Export → Save to file, with **Export for sharing externally** turned off so the datasource
  stays `{"type": "prometheus", "uid": "prometheus"}`. Save the JSON as
  `grafana/dashboards/<folder>/<name>.json`, set the top-level `"id"` to `null`, delete the copy you
  saved in the UI, and commit. Grafana loads the file within 30 seconds.
- **Changing a provisioned one**: edit its JSON file, or copy it in the UI with Save as, change the
  copy, export it as above over the original file, and delete the copy.
- **From grafana.com**: add a line with its id to `DASHBOARDS` in `scripts/fetch-dashboards.sh`
  and run it. The script rewrites the dashboard's datasource input to the provisioned one.
- **Updating the community dashboards**: run `monitoring/scripts/fetch-dashboards.sh` (needs `curl`
  and `jq`), review `git diff`, commit.

`grafana/dashboards/mindspear/overview.json` is maintained by hand.

### Adding a recording or alert rule

Add a file under `prometheus/rules/`, check it, then reload Prometheus:

```sh
docker run --rm -v "$PWD/monitoring/prometheus:/etc/prometheus:ro" --entrypoint promtool \
  prom/prometheus:v3.5.0 check config /etc/prometheus/prometheus.yml
curl -X POST http://127.0.0.1:9090/-/reload
```

### Alerting (not set up yet)

Two places are ready, pick one when it is needed: Prometheus alert rules in `prometheus/rules/` plus
the commented `alertmanager` service (receivers in `alertmanager/alertmanager.yml`), or
Grafana-managed alerts provisioned from `grafana/provisioning/alerting/`.

## Resource use

Measured on the dev stack: about 6,500 series at a 15-second interval (PostgreSQL's per-table
statistics are the largest share), which is roughly 1 GB of disk for 15 days, capped by
`PROM_RETENTION_SIZE`. The whole stack uses about 250 MB of memory and under 3% of one CPU core.
Memory limits: Prometheus 1 GB, Grafana 512 MB, cAdvisor 256 MB, exporters 64–128 MB.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `network ... declared as external, but could not be found` | Start the app first, or set `APP_NETWORK` for this server |
| App `docker compose down` fails: network "has active endpoints" | Stop monitoring first: `docker compose -f monitoring/docker-compose.yml down` |
| Container panels empty; cAdvisor log: `failed to identify the read-write layer ID` | cAdvisor older than v0.55 with Docker's containerd image store. Keep cAdvisor at v0.55.1 or newer |
| cAdvisor exits at start naming a metric | A name in `--disable_metrics` is not known to this version: remove it |
| A target is DOWN at /targets | Its error is shown there. For postgres / redis: credentials in `monitoring/.env`, or the exporter is not on the app network |
| `/grafana/` redirects in a loop or loads without styles | `GRAFANA_ROOT_URL` must end in `/grafana/`, `GRAFANA_SERVE_FROM_SUB_PATH=true`, and nginx must not strip the prefix (no trailing slash after the upstream) |
| Grafana rejects the admin password from `.env` | It only applies to an empty volume; reset it with `grafana cli admin reset-admin-password` |
| Grafana logs `plugin table is already registered` | Harmless message from Grafana 12.1 |
