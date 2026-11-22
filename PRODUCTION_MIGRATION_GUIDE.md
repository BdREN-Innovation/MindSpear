# Moving production from `main` (manual install) to this branch (Docker)

This guide answers three questions:
1. Can the live database move to this branch?
2. Will SSO affect current users?
3. What changes are needed to deploy with `docker compose -f docker-compose.prod.yml`?

It ends with a step-by-step cutover and a rollback plan.

---

## 0. Short answers

| Question | Answer |
|---|---|
| 1. Can I dump the production database and use it here? | **Yes.** Both use PostgreSQL 16, and I tested the upgrade (§1.2). Accounts, logins, files and every existing table are kept. **But see the warning below.** |
| 2. Will SSO make users lose their account or data? | **No.** SSO only adds a way to sign in. A user whose BDREN email is verified and matches their Mindspear email lands in their **existing** account. Nothing is deleted or merged. Worst case, someone using a *different* email gets a second, empty account; their old one is untouched (§2). |
| 3. What must change to deploy with Docker? | Domain names, one settings file per service, copying uploaded files, the nginx site, and the order of startup (§3, §4). |

> **⚠️ Decide this before you deploy: old quizzes, quests and surveys will be hidden.**
>
> This branch replaced the old Quiz/Quest/Survey builder with the new deck editor. The old pages
> (`/quiz-edit`, `/quest/edit`, `/survey/...`, `/attempt/...`, reports, results) and their API routes are
> **gone**, and nothing converts old quizzes into decks.
>
> After the move, the old rows are still in the database: the tables are **not dropped**, and I checked
> that no migration drops them. But **users won't see them** in My Library. To them it looks like data
> loss, even though nothing is deleted. The only old content still reachable is the question bank.
>
> Production runs `62e45f2`, where these pages still exist, so this deploy is the moment they
> disappear for users.
>
> Measure it first (§1.3), then choose one of the options in §1.4.

---

## 1. The database

### 1.1 Where production is now

Production runs `62e45f2` ("Quest Host Page Redesign done…"), the commit just before the AI-server PR
merge. It was installed by hand (`READMEv2.md`): PostgreSQL 16, Redis, php-fpm and systemd. The Docker
stack uses `postgres:16-alpine`. Same major version, so `pg_dump` → `pg_restore` works directly.

`62e45f2` has **81** migrations. This branch has **113**, so deploying runs **32** new ones (§1.2).
To confirm on the server (it should print 81; use the database name from
`/var/www/mindspear/backend/.env`):
```bash
sudo -u postgres psql -d <db_name> -Atc "select count(*) from migrations"
```

### 1.2 What I tested

- **Migration files.** Every migration that production (`62e45f2`) has is also in this branch, so
  nothing production has run is missing here. The same is true of `main` HEAD.
- **The real upgrade.** I built a scratch database from **`62e45f2`'s 81 migrations**, i.e. production's
  schema, added
  production-like rows, then ran **this branch's** migrations on it, just as the Docker backend does on
  start:

| Check | Result |
|---|---|
| This branch's migrations on the old schema | 32 ran, none failed, 0 pending afterwards |
| Users, password hashes | unchanged |
| Login tokens (`personal_access_tokens`) | kept: logged-in users stay logged in |
| Old quiz row | still there (but not shown in the UI, see the warning) |
| `files.size` (text → number) | `"204800"` → 204800; empty → 0 |
| `files.path` → new `disk_path` | `storage/uploads/a.png` → `public/uploads/a.png`; URLs unchanged |
| Soft-deleted files | kept, still soft-deleted |
| New `users` columns | added empty / `false`: no behaviour change |
| `pg_dump -Fc --no-owner --no-acl` → `pg_restore --no-owner --no-acl` into a database with a different owner | restored, 0 pending migrations |

The scratch databases were deleted afterwards.

**What the 32 migrations do:**
- **New tables, so existing data can't be affected:**
  - Decks: `decks`, `slides`, `slide_options`, `deck_sessions`, …
  - Fun Games: `fun_games`, `fun_game_*`
  - My Files text: `file_text_contents`
  - `sso_identities`
- **Changed tables:**
  - `files`: `size` becomes a number, `path` may be empty, plus new columns (category, disk_path,
    visibility, checksum, …), filled in from existing rows.
  - `users`: three new columns: `storage_quota_bytes` (empty = default quota), `quiz_v2_enabled` and
    `quest_v2_enabled` (both `false`).
- **No table or column is dropped.**

### 1.3 Measure the old content that will be hidden

Run on production:
```sql
select 'quizzes'  as what, count(*) from quizes   where deleted_at is null union all
select 'quests',          count(*) from quests    union all
select 'surveys',         count(*) from surveys   union all
select 'quiz sessions',   count(*) from quiz_sessions union all
select 'quest sessions',  count(*) from quest_sessions union all
select 'survey responses',count(*) from survey_responses union all
select 'owners with old quizzes/quests', count(distinct user_id) from
  (select user_id from quizes union select user_id from quests) t;
```
If a table has no `deleted_at` column, drop that condition.

### 1.4 Options for the old content (pick one before cutover)

| Option | Effort | User experience |
|---|---|---|
| **A. Archive.** Deploy as is; old content stays in the database, untouched. Tell users in advance that the builder changed and old quizzes aren't carried over. | none | Old quizzes disappear from the UI |
| **B. Convert.** Before cutover, add a one-time command that copies each old quiz/quest into a deck (questions → slides). Results and reports of old sessions stay archived. | a few days of development and testing | Users find their quizzes and quests in the new editor |
| **C. Read-only legacy site.** Keep the old app on a subdomain (e.g. `legacy.mindspear.app`) against a **copy** of the old database, for viewing and exporting old results. | moderate; a second deployment to maintain | Old reports reachable for a while |

My recommendation:
- If §1.3 shows real usage, choose **B**, optionally with **C** for old reports.
- If the numbers are tiny, **A** with an announcement is fine.

Whatever you choose, the data is never lost: the tables stay in the database.

---

## 2. SSO and existing users

SSO ships **off** (`SSO_ENABLED=false`). Deploying this branch with SSO off changes nothing about sign-in.
Details are in `SSO_INTEGRATION.md`; this is what matters for production users.

**What stays the same when SSO is turned on:**
- Email/password, Google and Microsoft sign-in keep working.
- Existing login tokens stay valid, so nobody is logged out.
- An account's quizzes, decks, files and results belong to the account, which never changes.

**What happens on someone's first "Sign in with BDREN SSO":**

| Situation | Result | Data |
|---|---|---|
| Same email as their Mindspear account, and BDREN has **verified** it | Linked to the **existing** account | All their data is there |
| Same email, but BDREN has **not** verified it | Refused: "sign in with your password, then connect from Profile" | Nothing changes |
| They signed in with password/Google first, then pressed **Connect** on Profile | Linked to the **existing** account, whatever the BDREN email | All their data is there |
| A **different** email than their Mindspear account, with automatic account creation on | A **new, empty** account | Old account is untouched (§2.1 to fix) |
| A **different** email, with `SSO_AUTO_CREATE_USERS=false` | Refused with the "connect from Profile" message | Nothing changes |

So an account can't be lost or overwritten. Matching uses BDREN's permanent user id after the first link,
and email matching requires BDREN to have verified the email, so nobody can take over someone else's
account by registering their email.

**Recommended settings for the first weeks:**
```
SSO_ENABLED=true
SSO_LINK_BY_VERIFIED_EMAIL=true
SSO_AUTO_CREATE_USERS=false     # no accidental second accounts during the pilot
SSO_ENFORCE_ENTITLEMENTS=false  # BDREN plan limits are logged, never enforced
```
Also make sure ZITADEL requires email verification for self-registered users. Then tell users: "Sign in as
usual, open Profile → Connect BDREN once."

### 2.1 If someone ended up with a second, empty account

Their data is in the original account. To fix it:
1. Delete the empty account's SSO link (or the empty account itself, in `/super-admin`):
   ```sql
   delete from sso_identities where user_id = <empty account id>;
   ```
2. They sign in to their **original** account (password or Google), then use Profile → Connect.

---

## 3. What to change for the Docker deployment

The Docker files are written for `dev.mindspear.app`. If production uses another domain (e.g.
`mindspear.app`), change it in every place below. Keep the **same domain** as today: logins in users'
browsers, Google/Microsoft redirect URIs and shared links all depend on it.

| File | Change |
|---|---|
| `docker-compose.prod.yml` | `frontend` build args: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_REVERB_HOST` → your domain. `NEXT_PUBLIC_REVERB_APP_KEY` must equal `REVERB_APP_KEY` in `backend/.env.prod`. Update the header comment. |
| `deploy/nginx/dev.mindspear.app.conf` | Copy to `/etc/nginx/sites-available/<domain>.conf`; set `server_name` to your domain. Keep the upstream ports (3100, 8100, 8180, 8101). |
| `backend/.env.prod` (copy of `.env.prod.example`) | See below |
| `ai-server/.env.prod` (copy of `.env.prod.example`) | `OPENROUTER_API_KEY`, and the settings it marks Required |

**`backend/.env.prod`: the values that must come from the current production `.env`:**

| Setting | Why |
|---|---|
| `APP_KEY` | **Copy the old one exactly.** A new key makes encrypted data unreadable and logs everyone out. |
| `GOOGLE_*`, `MICROSOFT_*` | Same app registrations. Keep the redirect URIs identical to today's. |
| `MAIL_*` | Same mail account |
| `AWS_*` | Only if production stores files on S3 |
| `SUPER_ADMIN_EMAIL` | Use the **existing** admin's email. Its password is left alone. A different email that belongs to an existing user would give that user Super Admin. |

**Values that are new in Docker:**

| Setting | Notes |
|---|---|
| `DB_HOST=postgres`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | The Docker database, not the old one. Choose a new strong password. |
| `REDIS_HOST=redis`, `REDIS_PASSWORD` | New, strong |
| `REVERB_APP_ID`, `REVERB_APP_KEY`, `REVERB_APP_SECRET` | New random values (`openssl rand -hex 16` each). The key must match the compose file. |
| `APP_URL`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `REVERB_ALLOWED_ORIGINS`, `SSO_REDIRECT_URI`, … | Your domain |
| SSO block | Leave `SSO_ENABLED=false` for the cutover; turn it on afterwards (§2) |

**On the same server as the old installation:**
- The Docker ports (127.0.0.1: 3100, 8100, 8180, 8101) don't collide with the old services.
- Docker's PostgreSQL and Redis publish no ports, so they don't clash with the host's either.
- At cutover, stop the old app services (php-fpm pool, queue workers, Reverb, the Next.js process) so
  nothing writes to the old database any more. Keep host **nginx** (it fronts Docker) and host
  **PostgreSQL** (as the rollback copy).

---

## 4. Cutover runbook

**Rehearse first** on a staging server or a copy: do §4.1 to §4.4 there with a fresh dump, click through
the app, then do it for real.

### 4.1 Prepare (no downtime)
```bash
# On the server, a separate checkout of this branch (not /var/www/mindspear):
git clone <repo> /opt/mindspear && cd /opt/mindspear && git checkout <this branch>
cp backend/.env.prod.example backend/.env.prod && chmod 600 backend/.env.prod      # fill in (§3)
cp ai-server/.env.prod.example ai-server/.env.prod && chmod 600 ai-server/.env.prod
# Edit docker-compose.prod.yml and the nginx conf for your domain (§3)
docker compose -f docker-compose.prod.yml build          # builds now, so the cutover is short
```

### 4.2 Stop writes and take the copy (downtime starts)
```bash
cd /var/www/mindspear/backend && sudo -u www-data php artisan down
# Stop the old workers so queued jobs don't run against the old database. Unit names are
# from READMEv2.md; check yours with: systemctl list-units | grep -i mindspear
sudo systemctl stop mindspear-queue* mindspear-reverb* mindspear-frontend* 2>/dev/null

sudo -u postgres pg_dump -Fc --no-owner --no-acl <old_db_name> > /root/mindspear-$(date +%F).dump
sudo tar -C /var/www/mindspear/backend/storage -czf /root/mindspear-storage-$(date +%F).tgz app
```

### 4.3 Load into Docker (order matters)
**The database must be restored before the backend starts.** The backend runs `migrate` on start, and on
an empty database it would create a fresh schema that the restore then clashes with.
```bash
cd /opt/mindspear
P="docker compose -f docker-compose.prod.yml"
$P up -d postgres                                   # creates an EMPTY database from DB_* settings
sleep 10
source <(grep -E '^DB_(USERNAME|DATABASE)=' backend/.env.prod)
$P exec -T postgres pg_restore -U "$DB_USERNAME" -d "$DB_DATABASE" --no-owner --no-acl --exit-on-error \
  < /root/mindspear-$(date +%F).dump

# Uploaded files → the "storage" volume (www-data is uid 33 in the php image)
docker volume create mindspear-prod_storage
docker run --rm -v mindspear-prod_storage:/dest -v /root:/src:ro alpine sh -c \
  "tar -xzf /src/mindspear-storage-$(date +%F).tgz -C /tmp && cp -a /tmp/app/. /dest/ && chown -R 33:33 /dest"

$P up -d                                            # backend migrates on start (§1.2)
$P logs backend | tail -30                          # expect the migrations, then php-fpm running
$P ps                                               # backend "healthy", everything else Up

# Option B (§1.4): copy the old quizzes and quests into decks. The old tables are only read;
# running it again converts nothing twice. Check the dry run's report first.
$P exec backend php artisan legacy:convert-decks --dry-run --report=/tmp/legacy-dry-run.json
$P exec backend php artisan legacy:convert-decks --report=/tmp/legacy-report.json
```
`legacy:convert-decks` (code in `backend/app/Deck/Legacy/`) makes one private deck per old quiz or
quest, for the same owner, with the original title, description and dates. Add `--visibility=keep` to keep
old public ones public (they then appear in Discover). Question mapping: single/multiple choice and v1 "fill
in the blanks" → Pick answer, true/false → True/False, sort → Correct order, short answer → Short answer;
quest polls → Poll, ranking, scales, word cloud, short/long answer → Open-ended. Left out, and listed in the
report: blank placeholder questions, sort questions with fewer than 3 items, and questions with no answer
data. Past sessions and answers are not converted; they stay in the old tables, and owners see them on
the **Past results** page (`/past-results`, API `/api/v1/legacy-results`, code
`backend/app/Deck/Legacy/LegacyResults.php`). It shows each old quiz or quest session by session:
- per question, the totals: votes per option with the right one marked (quiz), most given words and answers,
  ranking averages, scale averages;
- per participant, every answer, with right or wrong for quizzes;
- a CSV download.

It reads the old tables as they are. The previous version never saved scores, and its answer times are
wrong by 12 hours, so the page shows "right answers" instead of points.

### 4.4 Switch nginx (downtime ends)
```bash
sudo ln -sf /etc/nginx/sites-available/<domain>.conf /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/<old mindspear site>     # the old site file stays in sites-available
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <domain>                          # if the TLS lines need re-adding
```

### 4.5 Check
| Check | Expected |
|---|---|
| `docker compose -f docker-compose.prod.yml exec backend php artisan migrate:status \| grep -c Pending` | `0` |
| Open the site while still logged in from before | Still logged in (same token) |
| Log in with a password, with Google | Works; same account |
| Old profile pictures / uploaded images | Show (files copied) |
| `/super-admin` | Existing admin can log in |
| Create a quiz deck, present it, join from a phone | Live updates arrive (Reverb, queue) |
| Upload a file in My Files; generate questions with AI | Works (documents-queue, ai-server) |

---

## 5. Rollback

The old installation and its database are **not touched** by any of this; only copies were made.
To go back:
```bash
cd /opt/mindspear && docker compose -f docker-compose.prod.yml stop
sudo rm /etc/nginx/sites-enabled/<domain>.conf && sudo ln -s /etc/nginx/sites-available/<old site> /etc/nginx/sites-enabled/
sudo systemctl reload nginx && sudo systemctl start <the old units stopped in 4.2>
cd /var/www/mindspear/backend && sudo -u www-data php artisan up
```
Anything users created after the cutover (in the Docker database) isn't in the old database. Roll back
early, or export it first.

Keep the old installation, the dump and the storage archive until the new stack has run well for a few weeks.

---

## 6. Order of work

1. Run §1.1 and §1.3 on production; choose an option in §1.4. If it's B, build and test the converter first.
2. Prepare §3; rehearse §4 on a copy.
3. Announce a short maintenance window (and, for option A, that old quizzes aren't carried over).
4. Cutover §4 with `SSO_ENABLED=false`.
5. After a stable week: register the production ZITADEL client and turn SSO on with the pilot settings (§2).
6. Later: `SSO_AUTO_CREATE_USERS=true`, then BDREN limits, then (optionally) SSO-only. See `SSO_INTEGRATION.md` §3.
