# Load tests (k6)

Load tests are [k6](https://grafana.com/docs/k6/latest/) scripts. `run.sh` runs one in a throwaway
`grafana/k6` container and pushes its results to the Prometheus in `monitoring/`, so every run shows
up in Grafana (folder **load-tests**, dashboard **k6 Prometheus**) next to what the containers,
PostgreSQL, Redis and the queues were doing at the same moment.

## Before you run anything

- **Never load-test a server other people are using without agreement.** The default target is the
  local stack (`docker compose up -d`).
- **Start monitoring first**: `docker compose -f monitoring/docker-compose.yml up -d`. k6 pushes to
  Prometheus on `127.0.0.1:9090`, so run k6 on the same machine as the monitoring stack (for a server,
  run it on the server itself).
- **A load-test account** on the target. The `api/` and `live/` tests sign in (the quiz host). Make a
  user for this purpose, with a verified email (through the app's sign-up and verification, or
  `php artisan tinker` on that machine), never a real person's account. Its email and password go in
  the settings file (below).
- **Settings files** (git-ignored, `chmod 600`):
  ```sh
  cp load-tests/.env.example load-tests/.env                  # the local stack
  cp load-tests/.env.server.example load-tests/.env.server    # https://dev.mindspear.app
  ```

## Running

```sh
load-tests/run.sh smoke/health.js                               # is the stack up?
load-tests/run.sh api/dashboard.js                              # signed-in reads, 2 page loads a second for 1 minute
load-tests/run.sh live/quiz-session.js                          # a live quiz: 30 participants, 5 questions
PARTICIPANTS=100 QUESTIONS=8 load-tests/run.sh live/quiz-session.js
RATE=4 DURATION=5m load-tests/run.sh api/dashboard.js

# The deployed site: the same scripts with ENV_FILE=.env.server
ENV_FILE=.env.server load-tests/run.sh smoke/health.js
ENV_FILE=.env.server PARTICIPANTS=300 load-tests/run.sh live/quiz-session.js
```

Anything after the script name goes to k6 (`--vus`, `--duration`, `--http-debug`, ...). Each run gets a
`testid` tag, `<scenario>-<date>-<time>` (or `TESTID=...` to name it), and writes its summary to
`load-tests/results/<testid>.json` (git-ignored).

A setting on the command line wins over the settings file. `K6_MEMORY` caps k6's container (3g):
each simulated phone takes about 1 MB, so this machine can drive a few thousand.

## Testing dev.mindspear.app, step by step

k6 runs on your machine; its results go through an SSH tunnel into the server's Prometheus, so the
server's Grafana shows them next to the server's own CPU, memory, database and queue numbers.

1. **Monitoring runs on the server** (`monitoring/README.md`, "Production"). Check:
   `curl -s https://dev.mindspear.app/grafana/api/health` → `"database": "ok"`.
2. **A load-test account on the server**: a user made for this, with a verified email.
3. **Settings**: `cp load-tests/.env.server.example load-tests/.env.server`, `chmod 600` it, and fill in
   `K6_USER_EMAIL` and `K6_USER_PASSWORD`. Everything else is already right for dev.mindspear.app.
4. **The tunnel**, in a second terminal (keep it open during the test):
   ```sh
   ssh -N -L 19090:127.0.0.1:9090 user@server_ip
   ```
   Local port 19090, because your own monitoring stack already uses 9090. `run.sh` checks the tunnel
   before it starts and says so if it is not open.
5. **Smoke test** (a few requests, no data): `ENV_FILE=.env.server load-tests/run.sh smoke/health.js`
6. **The load test**:
   ```sh
   ENV_FILE=.env.server PARTICIPANTS=300 load-tests/run.sh live/quiz-session.js
   ```
   300 participants join at 4 a second (about 75 s), then 5 questions follow (about 2 minutes).
7. **Watch it** at https://dev.mindspear.app/grafana/: **load-tests / k6 Prometheus** (pick the run's
   `testid`) for what the participants saw, and **mindspear / MindSpear overview** with **Compose
   project** = `mindspear-prod` for the server: backend and Reverb CPU, PostgreSQL, Redis, queue depth.
8. **Clean up on the server** afterwards (the test quiz, its session and the 300 participants):
   `COMPOSE_FILE=docker-compose.prod.yml load-tests/cleanup.sh`

Then raise `PARTICIPANTS` step by step (500, 700, ...). Past about 700 from one machine the per-IP
limits start to answer 429, and past about 1,000 Reverb's connection ceiling applies (below).

## The scenarios

| Script | What it does | Settings (defaults) |
|---|---|---|
| `smoke/health.js` | Five quick passes over `/up`, the AI server's `/health` and a join-code lookup. No sign-in, no data. Run it after every deploy. | – |
| `api/dashboard.js` | What opening the app does when signed in: profile, dashboard numbers, quiz and quest lists, My Files, at a steady rate. | `RATE` page loads a second (2), `DURATION` (1m) |
| `live/quiz-session.js` | A real quiz with a room of phones that behave like the participant app. `setup()` creates a quiz with single-answer questions and starts a session; one **host** VU paces it from the Join QR code slide (open question, wait, reveal, next, end). Each **participant** looks the code up, joins, reads its state once, then holds a **Reverb websocket** and reacts to events: when answering opens it fetches the options within 0–0.4 s (every phone at once: the sharpest burst), answers after thinking, and reads its result within 0–2 s of the reveal. Phones never block, like a browser. `teardown()` ends the session and deletes the quiz (a soft delete: history stays until `cleanup.sh`). | `PARTICIPANTS` (30), `QUESTIONS` (5), `JOIN_RATE` joins a second (4), `ANSWER_SECONDS` (15), `REVEAL_SECONDS` (5); `REVERB_URL`, `REVERB_KEY` |

Every script declares thresholds (for example `http_req_failed` under 1–2 %, p95 latencies per call),
so a run that misses one exits non-zero: the same scripts can gate a deploy later.

### How many participants can one test machine simulate?

k6 is one IP address, and the backend rate-limits per IP (backend `DeckServiceProvider`). These are
the product's own limits, so a run that crosses one measures the limiter, not the server;
`quiz_rate_limited` counts the 429s, and its threshold fails the run if there are any.

| Limit | Per IP | What it means for `live/quiz-session.js` |
|---|---|---|
| Joins (`deck-join`) and code lookups (`deck-lookup`) | 300 a minute each | Keep `JOIN_RATE` at 4 or below: 300 participants join in 75 s, 1,000 in about 4 minutes |
| Participant calls (`deck-participant` IP cap) | 6,000 a minute | About 3 calls per phone per question (options, answer, result): roughly 700 participants before 429s |
| Signed-in authoring | 300 a minute per user | `api/dashboard.js` above `RATE=2` |

A real school network is one IP too, so the same limits apply to a real classroom.

**Reverb's own ceiling: about 1,000 phones.** Reverb runs one PHP process whose default event loop
(`stream_select`) cannot watch more than 1,024 open connections. Up to roughly 1,000 participants in
all live sessions together that is fine; beyond it new websockets are refused. The fix is installing
an event-loop extension (`ev`, `event` or `uv`) in the backend image, which Reverb then uses
automatically, and raising the container's open-file limit; or `REVERB_SCALING_ENABLED` with several
Reverb processes behind Redis.

To go past these, run k6 from several machines at once (same `TESTID`), after the Reverb fix.

## Cleaning up

Deleting a deck keeps its session history, so every `live/` run leaves an ended session with its
`k6-<n>` participants and their answers behind the soft-deleted quiz. To remove all of it:

```sh
load-tests/cleanup.sh                                     # the local stack
COMPOSE_FILE=docker-compose.prod.yml load-tests/cleanup.sh   # on a server
```

It only touches decks whose title starts with `k6 ` (the `TEST_PREFIX`) and prints what it removed.

## Reading the results

- The terminal prints k6's summary: checks, thresholds (✓ / ✗), latency per call name.
- Grafana → **load-tests / k6 Prometheus**: pick the run's `testid` and set the time range to it.
  Then **mindspear / MindSpear overview** for the same range shows which part of the stack
  (container CPU and memory, PostgreSQL connections and transactions, queue depths) reached its
  limit first.
- `live/quiz-session.js` also records what the room experienced:

  | Metric | Means |
  |---|---|
  | `quiz_participants_connected` / `_finished` | Phones subscribed to the session / still connected when it ended |
  | `quiz_answers_submitted` | Answers the server accepted |
  | `quiz_answers_too_late` | Answers that arrived after answering closed: lost, from the person's side |
  | `quiz_questions_missed` | Questions a phone did not get an accepted answer in (late, failed or never sent) |
  | `quiz_broadcast_delay` | From the server sending an event to the phone receiving it (needs synced clocks) |
  | `http_req_duration{name:options read}` | The burst when answering opens: every phone at once |
  | `quiz_rate_limited`, `quiz_ws_errors` | 429s from the per-IP limits; websocket errors |

  The run **passes** when everyone connected and finished, at most 2 % of questions were missed,
  nothing was rate-limited, and the p95 latencies stayed under their limits (1–1.5 s; broadcasts 1 s).
- k6 runs on this machine, so its own numbers land in this machine's Prometheus. For the server side
  (container CPU and memory, PostgreSQL, Redis, queues) during a run against dev.mindspear.app, the
  monitoring stack must run on the server.

Results are ordinary Prometheus data, kept for `PROM_RETENTION` (15 days by default).

## Writing a new scenario

```
load-tests/
├── run.sh                   # the runner
├── cleanup.sh               # removes the k6 decks, sessions, participants and answers
├── .env.example             # settings template, local stack
├── .env.server.example      # settings template, dev.mindspear.app
└── k6/
    ├── lib/config.js        # BASE_URL, AI_URL, route prefixes, envInt()
    ├── lib/http.js          # call() / callAsync() with the `name` tag and expected statuses; expectStatus / mustStatus
    ├── lib/reverb.js        # the websocket a phone opens (Pusher protocol): URL, subscribe, pong
    ├── lib/auth.js          # login() → bearer token (from K6_USER_EMAIL / K6_USER_PASSWORD)
    ├── lib/deck.js          # create a quiz, add questions, start / advance / end a session, delete
    └── <area>/<scenario>.js # smoke/, api/, live/; add fun-games/, files/, ai/ as needed
```

Conventions, kept by the existing scripts:

- Read the target from `lib/config.js`; never hard-code a host.
- Name every request (`call(..., { name })`): the dashboards and thresholds group by that name,
  whatever ids the URL carries.
- List the statuses a call may legitimately return in `expected` (a 409 from a move the timer made
  first, a 404 on a cleanup); anything else counts as a failed request.
- Declare `thresholds`, check every response, and keep think time (`sleep`) realistic.
- Own your data: create it in `setup()`, remove it in `teardown()`, and prefix names with `k6`
  (`TEST_PREFIX`) so leftovers are easy to find.
- AI generation calls a paid model: keep an AI scenario small and opt-in.
