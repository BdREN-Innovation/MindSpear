# MindSpear - Development Guide

> **Purpose**: This document is the single source of truth for AI coding assistants and developers working on MindSpear. It describes everything that exists today — architecture, conventions, data flow, file locations, and patterns — so you can make informed changes without guessing.
>
> **State described**: the codebase after the v1 Quiz/Quest/Survey implementation was removed (Oct 2026). Paths in backticks are relative to the repository root. When this guide and the code disagree, the code wins — fix the guide in the same change.

---

## Table of Contents

1. [Project Identity](#1-project-identity)
2. [Tech Stack](#2-tech-stack)
3. [Repository Layout](#3-repository-layout)
4. [Backend Architecture (Laravel 12)](#4-backend-architecture-laravel-12)
   - 4.1 [Directory Map](#41-directory-map)
   - 4.2 [Database Schema & Models](#42-database-schema--models)
   - 4.3 [API Routing](#43-api-routing)
   - 4.4 [The Deck Engine (Quizzes & Quests)](#44-the-deck-engine-quizzes--quests)
   - 4.5 [Live Sessions & Broadcasting](#45-live-sessions--broadcasting)
   - 4.6 [Authentication & Authorization](#46-authentication--authorization)
   - 4.7 [Validation & Errors](#47-validation--errors)
   - 4.8 [Helpers, Traits, Observers & Listeners](#48-helpers-traits-observers--listeners)
   - 4.9 [Mail](#49-mail)
   - 4.10 [My Files (FileLibrary module)](#410-my-files-filelibrary-module)
   - 4.11 [Fun Games (FunGame module)](#411-fun-games-fungame-module)
   - 4.12 [Question & Task Banks](#412-question--task-banks)
   - 4.13 [Dashboard Statistics & Filament Admin](#413-dashboard-statistics--filament-admin)
   - 4.14 [Seeders, Factories & Tests](#414-seeders-factories--tests)
5. [Frontend Architecture (Next.js 15)](#5-frontend-architecture-nextjs-15)
   - 5.1 [Directory Map](#51-directory-map)
   - 5.2 [App Router, Route Groups & Layouts](#52-app-router-route-groups--layouts)
   - 5.3 [Redux Store & Auth State](#53-redux-store--auth-state)
   - 5.4 [HTTP Clients](#54-http-clients)
   - 5.5 [Realtime (Laravel Echo + Reverb)](#55-realtime-laravel-echo--reverb)
   - 5.6 [Deck Features (editor, presenter, participant, library)](#56-deck-features-editor-presenter-participant-library)
   - 5.7 [Other Features](#57-other-features)
   - 5.8 [Shared Components, Hooks & Styling](#58-shared-components-hooks--styling)
6. [AI Server (FastAPI)](#6-ai-server-fastapi)
7. [Data Flow: End-to-End Walkthroughs](#7-data-flow-end-to-end-walkthroughs)
8. [Entity Relationship Map](#8-entity-relationship-map)
9. [API Response Contract](#9-api-response-contract)
10. [Naming Conventions & Patterns](#10-naming-conventions--patterns)
11. [Known Quirks & Technical Debt](#11-known-quirks--technical-debt)
12. [Environment & Configuration](#12-environment--configuration)
13. [What Does NOT Exist Yet](#13-what-does-not-exist-yet)
- [Appendix: Quick Reference for Common Tasks](#appendix-quick-reference-for-common-tasks)

---

## 1. Project Identity

**MindSpear** (by BdREN) is an interactive teaching platform. A lecturer builds a quiz or quest as a slide deck, presents it live from a laptop on a projector, and participants answer on their phones with a 6-character join code, a QR code or a link — no account and no app install.

| Product | Inspiration | What it does | Backend |
|---------|-------------|--------------|---------|
| **Quiz** | Kahoot / AhaSlides | Live, host-paced quiz: timed questions scored on submit (faster = more points), results hidden until the host reveals them, leaderboard. | Deck product `quiz` |
| **Quest** | Mentimeter | Live polls, word clouds, open-ended answers, scales, ranking, audience Q&A; results update live; nothing is scored. | Deck product `quest` |
| **Fun Games** | Party quiz | Self-paced game: players join with name + email and answer at their own pace; questions are imported from a quiz deck, a JSON file or a document (AI). | `backend/app/Modules/FunGame` |

Quiz and Quest are two **products of one deck engine** (`backend/app/Deck`): the same tables, slide-type registry, session state machine, editor, presenter and participant app. The product decides which slide types are offered and whether answers are scored and revealed.

Shared tools: **My Files** (per-user file library with a storage quota), **Discover** (other users' public quizzes and quests, copyable into your library), **Question Bank** (a quiz question bank and a quest task bank — kept, but not yet usable from decks) and **AI generation** of slides/questions from a document (`ai-server/`).

**Removed in Oct 2026**: the whole v1 Quiz/Quest/Survey implementation (controllers, models, `quizes` routes, attempts, socket flows, Excel exports, v1 Filament resources, v1 frontend pages) and the per-user v2 feature flags. There is no Survey product any more. The v1 database tables remain, unused (§4.2). Anything that mentions quiz attempts, surveys, `/v2/` URLs or `quiz_v2_enabled` describes code that no longer exists — including large parts of `QUEST_REDESIGN_PLAN.md` and `QUIZ_REDESIGN_PLAN.md`, which are still useful as design background (code comments cite them as "plan §…").

**Production**: one domain, `https://mindspear.app`. Nginx routes `/` to Next.js; `/api/v1`, `/broadcasting/auth`, `/storage` and `/super-admin` (Filament) to Laravel; `/app` to Reverb. See `READMEv2.md`.

---

## 2. Tech Stack

### Backend (`backend/`)
| Layer | Technology | Version |
|-------|------------|---------|
| Framework | Laravel | ^12.0 |
| PHP | PHP | ^8.4 |
| API auth | Laravel Sanctum (bearer tokens) | ^4.1 |
| Roles | Spatie Laravel Permission | ^6.17 |
| Admin panel | Filament | ^3 |
| Social login | Laravel Socialite + socialiteproviders/microsoft | ^5.23 / ^4.7 |
| Realtime | Laravel Reverb (Pusher protocol) | ^1.10 |
| Redis client | Predis | ^3.6 |
| Database | PostgreSQL 16 — required: the deck and My Files migrations use `jsonb` and PostgreSQL-only SQL | — |
| Cache, sessions, queues | Redis 7 | — |
| Tests | Pest | ^3.7 |

The maatwebsite/excel package is still required in `backend/composer.json` (and `backend/config/excel.php` exists), but no code uses it since the exports were removed.

### Frontend (`frontend/`)
| Layer | Technology | Version |
|-------|------------|---------|
| Framework | Next.js, App Router (`next dev --turbopack`) | 15.3.8 |
| UI runtime | React | 19.1.2 |
| Language | TypeScript (strict) | ^5 |
| App state | Redux Toolkit + redux-persist (auth only) | ^2.8 / ^6.0 |
| HTTP | Axios | ^1.9 |
| Realtime | laravel-echo + pusher-js | ^2.3 / ^8.5 |
| Styling / UI | Tailwind CSS 3, Ant Design 5 (a few shared widgets), framer-motion, lucide-react | — |
| Charts | ApexCharts (react-apexcharts) | — |
| Editor pieces | Tiptap (paragraph slide), dnd-kit (slide rail, option lists, ordering answers) | — |
| Forms | React Hook Form + Zod (auth pages) | — |
| Documents | pdfjs-dist (PDF text and thumbnails in the browser) | — |

### AI server (`ai-server/`)
FastAPI, Pydantic, LangGraph and LangChain OpenRouter, managed with `uv`; tests with pytest (§6).

### Ports (`docker-compose.yml`)
| Service | Port |
|---------|------|
| Frontend (`frontend`, production build) | 2000 (container port 3000) |
| Frontend dev server (`frontend-dev`, hot reload) | 3001 |
| Backend API + Filament (`/super-admin`) | 8000 |
| Reverb | 8080 |
| AI server | 8001 |
| PostgreSQL / Redis | 5432 / 6379 |
| Grafana (`monitoring/docker-compose.yml`, 127.0.0.1 only) | 3200 (container port 3000) |
| Prometheus (`monitoring/docker-compose.yml`, 127.0.0.1 only) | 9090 |

Outside Docker, `npm run dev` uses Next's default port 3000 unless `PORT` is set (`frontend/package.json` no longer pins one); `LOCAL_DEV_COMMANDS.md` describes running the services by hand.

---

## 3. Repository Layout

```
mindspear/
├── backend/                            # Laravel 12: API, Reverb, queue jobs, Filament admin
├── frontend/                           # Next.js 15: host app + participant PWA (/play)
├── ai-server/                          # FastAPI: AI generation of questions and slides
├── docker-compose.yml                  # Local stack (§12)
├── docker-compose.prod.yml             # Production stack for dev.mindspear.app (behind the host's nginx)
├── deploy/nginx/                       # The host nginx site for docker-compose.prod.yml (and /grafana/)
├── monitoring/                         # Prometheus + Grafana, a separate compose project (§12)
├── load-tests/                         # k6 load tests (smoke, API, live quiz); results go to monitoring/ (§12)
├── READMEv2.md                         # Production deployment (single domain, Nginx, systemd)
├── LOCAL_DEV_COMMANDS.md               # Running the services without Docker
├── PRODUCT.md                          # Product context: users, formats, principles
├── QUEST_REDESIGN_PLAN.md              # Deck engine design plan (historical)
├── QUIZ_REDESIGN_PLAN.md               # Quiz design plan (historical)
└── STRUCTURE_AND_DEVELOPMENT_GUIDE.md  # This file
```

There is **no monorepo tooling**: the three projects have their own dependency managers (`composer`, `npm`, `uv`) and Dockerfiles.

---

## 4. Backend Architecture (Laravel 12)

### 4.1 Directory Map

```
backend/
├── app/
│   ├── Deck/                           # Quiz + Quest engine ("decks"), §4.4–4.5
│   │   ├── Authoring/                  # DeckAuthoringService, SlideAuthoringService, SlideOptionService, SlideInput, DeckSettings, DeckStatistics
│   │   ├── Broadcasts/                 # DeckBroadcaster, DeckChannels, LiveAggregateService, Payloads/ (one class per event)
│   │   ├── Exceptions/                 # DeckException
│   │   ├── Http/                       # DeckRoutes, DeckValidation, Controllers/, Requests/, Resources/ (presenters), Middleware/
│   │   ├── Media/                      # DeckMediaService (attach My Files items to decks, slides, options)
│   │   ├── Participants/               # Join, tokens, answers, presence, read access, results
│   │   ├── Policies/                   # DeckPolicy (owner / host only)
│   │   ├── Qa/                         # Live audience Q&A (quests)
│   │   ├── Scoring/                    # QuizScoring, ScoringService, LeaderboardService
│   │   ├── Sessions/                   # SessionLauncher, SessionStateMachine, QuizRuntime, JoinCodeGenerator
│   │   ├── Slides/                     # SlideTypeContract, AbstractSlideType, SlideTypeRegistry, Types/
│   │   └── Support/                    # OptionLimits, ProfanityFilter
│   ├── Modules/
│   │   ├── FileLibrary/                # My Files (§4.10)
│   │   └── FunGame/                    # Fun Games (§4.11)
│   ├── Events/Live/                    # LiveBroadcastEvent (decks), ImmediateLiveBroadcastEvent (Fun Games)
│   ├── Jobs/Deck/                      # TransitionSlideRunJob (slide timers), BroadcastDeckAggregate (debounced results)
│   ├── Filament/                       # Pages/, Resources/, Widgets/ (§4.13)
│   ├── Helpers/                        # helpers.php, EnvHelper.php (autoloaded via composer "files")
│   ├── Http/
│   │   ├── Controllers/api/v1/         # Auth, profile, institutions, files, logs, preferences, social auth; Quiz/ + Quest/ banks
│   │   ├── Controllers/Dashboard/      # DashboardController
│   │   ├── Middleware/                 # Authenticate (JSON 401), UseWebGuardForFilament
│   │   └── Requests/                   # BaseFormRequest + Authentication/, File/, Institution/, Preference/, Profile/, Quiz/, Quest/, SocialConfig/
│   ├── Listeners/                      # LogLogin, LogLogout, LogEmailSent
│   ├── Mail/                           # VerifyEmailMail, PasswordResetMail
│   ├── Models/                         # User, Institution, File, Preference, PasswordResetToken; Deck/, Quiz/ + Quest/ (banks), Log/
│   ├── Observers/                      # ActivityLoggerObserver, PersonalAccessTokenObserver
│   ├── Providers/                      # AppServiceProvider, EventServiceProvider, DeckServiceProvider, Filament/AdminPanelProvider
│   └── Traits/                         # ApiResponseTrait, FileUploadTrait
├── bootstrap/
│   ├── app.php                         # Core /api/v1 route files, broadcasting auth, middleware aliases, JSON 401s
│   └── providers.php                   # Provider list (incl. the FunGame and FileLibrary module providers)
├── config/                             # Standard Laravel config + deck.php, file_library.php, reverb.php, permission.php
├── database/
│   ├── migrations/                     # Core tables; Deck/ (deck engine); Quiz/, Survey/, Quest/ (legacy v1 + banks)
│   ├── factories/                      # UserFactory, Deck/ (one factory per deck model)
│   └── seeders/                        # DatabaseSeeder and friends; Quiz/ + Quest/ (bank demo data)
├── routes/
│   ├── api/v1/                         # Core route files, each required explicitly by bootstrap/app.php
│   ├── deck/                           # Deck route files, all auto-loaded by DeckServiceProvider
│   ├── channels.php                    # User channel (deck and Fun Games channels are registered by their providers)
│   ├── web.php                         # Welcome page + Filament login POST
│   ├── console.php
│   └── api.php                         # NOT loaded (§11)
├── resources/views/emails/             # verify_email / password_reset Blade templates
└── tests/Feature/                      # Pest: Deck/, FileLibrary/, FunGame/
```

### 4.2 Database Schema & Models

Migrations come from several directories and a plain `php artisan migrate` runs them all: `AppServiceProvider` loads `backend/database/migrations` plus the legacy `backend/database/migrations/Quiz`, `backend/database/migrations/Survey` and `backend/database/migrations/Quest` subdirectories, `DeckServiceProvider` loads `backend/database/migrations/Deck`, and each module provider loads `backend/app/Modules/<Module>/Database/Migrations`.

#### Deck engine (`backend/database/migrations/Deck/`, models in `backend/app/Models/Deck/`)

```
decks                                  owner_id → users; product 'quiz' | 'quest'
├── slides                             ordered by position; type = slide type key
│   └── slide_options                  ordered by position
└── deck_sessions                      at most one live session per deck
    ├── deck_session_slide_runs        one frozen snapshot per slide (position_snapshot 1..N)
    │   ├── deck_participant_answers   unique (participant, run)
    │   └── deck_qa_questions          quests: audience Q&A
    │       └── deck_qa_upvotes        unique (question, participant)
    └── deck_participants              anonymous, token-authenticated
```

| Table (model) | Key columns | Notes |
|---------------|-------------|-------|
| `decks` (`Deck`) | `owner_id`, `product`, `title`, `description`, `cover_file_id` → files, `settings` (jsonb), `visibility` (`private` / `public`), `source_deck_id` → decks, `published_at` | Soft deletes. `settings` holds `default_time_limit`, `get_ready_seconds`, `theme`, `show_qr_sidebar`, `default_qa_sort` (`DeckSettings`). `source_deck_id` is set when a public deck is copied. |
| `slides` (`Slide`) | `deck_id`, `type`, `position`, `title`, `body` (jsonb rich text), `config` (jsonb), `media_file_id` → files, `time_limit_seconds`, `get_ready_seconds`, `points_min`, `points_max`, `speed_bonus_enabled` | Soft deletes. The points columns are quiz only. |
| `slide_options` (`SlideOption`) | `slide_id`, `position`, `label`, `image_file_id` → files, `is_correct` (quiz), `payload` (jsonb) | `payload` holds type extras (pair key, category key, correct order index…). |
| `deck_sessions` (`DeckSession`) | `deck_id`, `host_user_id`, `public_channel_key` (unique), `join_code` (unique, never reused), `status`, `current_slide_run_id`, `timer_state`, `started_at`, `ended_at` | Status `pending` / `live` / `ended`; `SessionLauncher` creates sessions directly as `live`. |
| `deck_session_slide_runs` (`DeckSessionSlideRun`) | `deck_session_id`, `slide_id` (nullable), `position_snapshot`, `type_snapshot`, `title_snapshot`, `body_snapshot`, `config_snapshot`, `options_snapshot`, `time_limit_seconds`, `get_ready_seconds`, `state`, `state_version`, `state_started_at`, `voting_started_at`, `closed_at` | Live code reads only these snapshots, so editing a deck mid-session cannot break the session. |
| `deck_participants` (`DeckParticipant`) | `deck_session_id`, `display_name`, `emoji_avatar`, `participant_token_hash` (SHA-256), `participant_token_expires_at`, `participant_token_revoked_at`, `total_points` (quiz), `joined_at`, `left_at` | |
| `deck_participant_answers` (`DeckParticipantAnswer`) | `deck_participant_id`, `slide_run_id`, `answer_payload` (jsonb), `time_to_answer_ms`, `is_correct`, `points_awarded` (quiz) | One row per participant per run; multi-entry types (word cloud, open ended) merge into it. |
| `deck_qa_questions`, `deck_qa_upvotes` (`DeckQaQuestion`, `DeckQaUpvote`) | `body`, `upvote_count`, `is_answered`, `is_hidden`, `is_starred`; an upvote is (question, participant) | Quest Q&A. |

Two more Deck migrations matter: `2026_10_28_000001_merge_pick_answer_multi_slides` converted stored `pick_answer_multi` slides to `pick_answer_single`, and `2026_10_18_000001_add_quest_v2_enabled_to_users` / `2026_10_20_000001_add_quiz_v2_enabled_to_users` added the old flag columns, which are now unused.

#### Core tables (`backend/database/migrations/`)
- **users** — `first_name`, `last_name`, `email` (unique), `phone` (unique, nullable), `password`, `email_verified_at`, `email_verification_token`, `is_verified`, `profile_picture`, `account_type`, `institution_id`, `institution_name`, `designation`, `department`, `provider` / `provider_id` (social login), `storage_quota_bytes` (My Files; null = default quota). `quest_v2_enabled` / `quiz_v2_enabled` still exist in the table but are unused and not in the `User` model.
- **institutions** — soft-deletable organisation records with created/updated/deleted-by tracking.
- **files** — every upload (My Files, §4.10): `user_id`, `name`, `original_name`, `category` (image / document / video), `mime_type`, `extension`, `size` (bytes), `disk`, `disk_path`, `visibility`, `checksum`, `page_count`, `extraction_status`, `last_used_at`; soft deletes. **file_text_contents** holds the extracted text per page / slide / section for AI generation.
- **preferences** — key/value settings (`category`, `field`, `value`).
- **personal_access_tokens** (Sanctum), the Spatie permission tables, **password_reset_tokens**, and Laravel's cache / jobs / failed_jobs / sessions tables.
- **Logs** — `login_logs`, `activity_logs`, `email_logs` (models in `backend/app/Models/Log/`).

#### Fun Games (`backend/app/Modules/FunGame/Database/Migrations/`)
`fun_games` → `fun_game_questions`, `fun_game_imports`, `fun_game_sessions` → `fun_game_participants` → `fun_game_answers`. See §4.11.

#### Question & task banks (kept; in `backend/database/migrations/Quiz/` and `backend/database/migrations/Quest/`)
`quiz_q_bank_categories` → `quiz_bank_questions` (models `QuestionBankCategory`, `BankQuestion` in `backend/app/Models/Quiz/`) and `quest_task_bank_categories` → `quest_bank_tasks` (`QuestTaskBankCategory`, `BankTask` in `backend/app/Models/Quest/`). Categories nest (`parent_category_id`); items have an `owner_id`, a `visibility` and soft deletes. See §4.12.

#### Legacy v1 tables (kept, unused)
The rest of `backend/database/migrations/Quiz/`, `backend/database/migrations/Survey/` and `backend/database/migrations/Quest/` still creates the v1 tables — `quizes`, `questions`, `quiz_sessions`, `quiz_participants`, `user_quiz_answers`, `surveys`, `survey_pages`, `survey_questions`, `survey_responses`, `quests`, `quest_tasks`, `quest_sessions`, `quest_participants`, `quest_task_completions` and a few more. They are kept on purpose (old data; a fresh database stays in step with production). No application code reads or writes them and they have no models. Do not build on them.

### 4.3 API Routing

Everything is under `/api/v1`, registered from four places:

| Route files | Loaded by | Prefix |
|-------------|-----------|--------|
| `backend/routes/api/v1/` (+ its Dashboard, Quiz and Quest subfolders) | an explicit `require` list in the `then:` callback of `backend/bootstrap/app.php` | `/api/v1` |
| `backend/routes/deck/*.php` | `DeckServiceProvider::loadRouteFiles()` — every file in the folder, sorted by name | `/api/v1` + per-product prefixes (`DeckRoutes`) |
| `backend/app/Modules/FunGame/routes.php` | `FunGameServiceProvider` | `/api/v1/fun-games` |
| `backend/app/Modules/FileLibrary/routes.php` | `FileLibraryServiceProvider` | `/api/v1/library` |

Private channel authorisation is `POST /broadcasting/auth` (`api` + `auth:sanctum` middleware, set in `backend/bootstrap/app.php`).

#### Deck routes (quizzes and quests)

`config('deck.routes')` in `backend/config/deck.php` maps each product to its URL prefixes:

| Product | Authoring prefix `{a}` | Sessions prefix `{s}` |
|---------|------------------------|-----------------------|
| `quiz` | `/api/v1/quizzes` | `/api/v1/quiz-sessions` |
| `quest` | `/api/v1/quests` | `/api/v1/quest-sessions` |

A route file declares its routes once inside `DeckRoutes::authoring(fn (string $product) => ...)` or `DeckRoutes::sessions(...)`. `DeckRoutes` (`backend/app/Deck/Http/DeckRoutes.php`) registers them once per product, names them `deck.{product}.*` / `deck.{product}.sessions.*`, and stores the product as a route default that controllers read with `DeckRoutes::product($request)`. A second argument (`['quiz']` or `['quest']`) limits a group to one product. Both products share every controller.

| Method | Path | Caller | Purpose |
|--------|------|--------|---------|
| GET, POST | `{a}` | host | List my decks; create a deck |
| GET, PATCH, DELETE | `{a}/{deck}` | host | Read; update (title, description, settings, visibility); soft-delete |
| POST | `{a}/{deck}/duplicate` | host | Copy a deck |
| GET | `{a}/public`, `{a}/public/{deck}` | signed in | Discover: public decks, preview |
| POST | `{a}/public/{deck}/copy` | signed in | Copy a public deck into my library |
| POST | `{a}/{deck}/slides`, `{a}/{deck}/slides/reorder`, `{a}/{deck}/slides/bulk` | host | Add a slide; reorder; bulk insert (AI generation) |
| GET, PATCH, DELETE | `{a}/{deck}/slides/{slide}` | host | Slide CRUD (+ `POST .../duplicate`) |
| POST, PATCH, DELETE | `{a}/{deck}/slides/{slide}/options[/{option}]` | host | Option CRUD (+ `POST .../options/reorder`) |
| PUT | `{a}/{deck}/cover`, `{a}/{deck}/slides/{slide}/media`, `.../options/{option}/image` | host | Attach or detach a My Files item (or a video link) |
| POST | `{a}/{deck}/sessions` | host | Start a live session (409 `conflict` with `session_id` when one is already live) |
| GET | `/api/v1/play/by-code/{code}` | public | Find a live session by join code across products (returns `product`) |
| GET | `{s}/by-code/{code}` | public | Same, for one product |
| GET | `{s}/{session}/state` | host or participant | Resync snapshot; the view depends on whether `X-Participant-Token` is sent |
| POST | `{s}/{session}/advance`, `{s}/{session}/end` | host | State-machine actions (§4.5); end the session |
| GET | `{s}/{session}/participants` | host | Who is in the room now (newest first, at most 200, plus `total`) |
| POST | `{s}/{session}/participants/join`, `.../participants/leave` | public, participant | Join with `{join_code, display_name, emoji_avatar}` → token; leave |
| POST | `{s}/{session}/slide-runs/{run}/answers` | participant | Submit `{answer_payload}` → 204 |
| GET | `{s}/{session}/slide-runs/{run}/my-answer`, `.../aggregate` | participant, host | My answer (quiz: correctness after the reveal); results |
| GET | `{s}/{session}/participant-state`, `{s}/{session}/review` | participant | Participant state; post-session review (ended sessions only) |
| GET | `/api/v1/quiz-sessions/{session}/leaderboard` | host or participant | Quiz only (`?limit=1..100`) |
| GET, POST | `/api/v1/quest-sessions/{session}/slide-runs/{run}/qa/questions` | participant (GET: host too) | Quest only: Q&A feed; ask |
| POST, DELETE | `/api/v1/quest-sessions/{session}/qa/questions/{question}/upvote` | participant | Quest only |
| PATCH | `/api/v1/quest-sessions/{session}/qa/questions/{question}` | host | Quest only: moderate (answered / hidden / starred) |
| GET | `/api/v1/meta/emoji-avatars` | public | The allowed participant avatars (cacheable) |

"Host" means Sanctum + deck owner / session host (`DeckPolicy`); anyone else gets a 404. "Participant" means a valid `X-Participant-Token`. Rate limiters (defined in `DeckServiceProvider`): `deck-author` (host routes), `deck-join`, `deck-lookup` (by-code; misses are capped tightly), `deck-participant`, plus a per-IP cap on token routes (`ParticipantReadAccess::IP_THROTTLE`).

#### Core routes (`backend/routes/api/v1/`)

| File | Paths | Auth |
|------|-------|------|
| `backend/routes/api/v1/auth.php` | `/register`, `/login`, `/forgot-password`, `/forgot-password-resend`, `/reset-password`, `/verify-email`, `/resend-verification`; `/user-check`, `/logout` | public; the last two Sanctum |
| `backend/routes/api/v1/socialauth.php` | `/auth/{provider}/redirect`, `/auth/{provider}/callback` | public |
| `backend/routes/api/v1/profiles.php` | `/profile/show`, `/profile/update`, `/profile/change-password`, `/profile/update-profile-picture`, `/profile/delete-profile-picture` | Sanctum |
| `backend/routes/api/v1/institutions.php` | `/institutions` (CRUD) | Sanctum |
| `backend/routes/api/v1/files.php` | `/files` (legacy upload endpoints; uploads land in My Files) | Sanctum |
| `backend/routes/api/v1/logs.php` | `/logs` (read and download Laravel log files) | Sanctum |
| `backend/routes/api/v1/preferences.php` | `/preferences` (CRUD + bulk); `/public/preferences/...` | Sanctum; public reads |
| `backend/routes/api/v1/socialsettings.php` | `/social-auth-config/{google,facebook,microsoft}`, `/social-auth-config/save` | Sanctum |
| `backend/routes/api/v1/Dashboard/dashboard.php` | `/dashboard-statistics/dashboard` | Sanctum |
| `backend/routes/api/v1/Quiz/questionbank.php`, `backend/routes/api/v1/Quiz/questionbankcategory.php` | `/quiz/question-bank/...`, `/quiz/question-bank-categories/...` | Sanctum |
| `backend/routes/api/v1/Quest/questtaskbank.php`, `backend/routes/api/v1/Quest/questtaskbankcategories.php` | `/quest/task-bank/...`, `/quest/task-bank-categories` | Sanctum |

#### Module routes
- **Fun Games** (`/api/v1/fun-games`): host routes under `/fun-games/host` (Sanctum) — `games` CRUD plus `duplicate` and `publish`; `/fun-games/host/library-quizzes` (+ `preview`), `/fun-games/host/games/from-library`, `/fun-games/host/games/{game}/import`, `/fun-games/host/imports/{import}/undo`; question CRUD and reorder; sessions (create, `start`, `end`, `leaderboard`, `participants`). Player routes: `GET|POST /fun-games/join/{joinCode}` (name + email → token) and `/fun-games/sessions/{session}/{state|current|answers|results/me|leaderboard}` with `X-Participant-Token`.
- **My Files** (`/api/v1/library`, Sanctum): `/library/usage`, `/library/files` (list, upload), `/library/files/{file}` (show, rename, delete), `/library/files/{file}/use`, `/library/files/{file}/pages`, `/library/files/{file}/content`, `/library/files/{file}/slide-preview` (ready / processing / failed) and `/library/files/{file}/slide-preview/content` (the slides as a PDF).

### 4.4 The Deck Engine (Quizzes & Quests)

**Products.** `Deck::PRODUCTS` is `['quest', 'quiz']`. Every deck has one product and every lookup is product-scoped (a quiz id on a quest route is a 404).

**Slide types.** Each type is a class implementing `SlideTypeContract` (`backend/app/Deck/Slides/SlideTypeContract.php`), usually by extending `AbstractSlideType`. `DeckServiceProvider` fills the `SlideTypeRegistry` singleton by discovering every concrete class under `backend/app/Deck/Slides/Types/` — there is no manual registration, and a duplicate key throws. Controllers and services dispatch through the registry and never switch on `type`. A type declares:
- identity: `key()`, `products()`, `category()` (`poll` / `interactive` / `content`), `revealModel()` (`live_aggregate`, `hidden_until_reveal`, `moderated_feed`, `none`), `acceptsAnswers()`;
- authoring: `defaultConfig()`, `defaultOptions()` (seeded on creation), `validateConfig()`;
- live: `validateAnswer()`, `score()`, `aggregate()` (pure), `serializeForPresenter()`, `serializeForParticipant()` — the participant view never includes answer keys (`AbstractSlideType` strips `correct_*` / `answer_key` config and `is_correct` / `correct_order_index` option data; types add more via `privateConfigKeys()` / `privateOptionPayloadKeys()`).
- optional interfaces: `TakesMedia` (the slide's media comes from My Files) and `AppendsSubmissions` (several submissions merged into one answer row).

Types live in `backend/app/Deck/Slides/Types/`, in the Quest, Quiz and Content subfolders:

| Group | Keys | Products | Base class |
|-------|------|----------|------------|
| Quest | `poll_single`, `poll_multi`, `word_cloud`, `open_ended`, `scales`, `ranking`, `rating`, `points_allocation`, `matrix_2x2`, `pin_on_image`, `qa_audience` | quest | `AbstractSlideType` |
| Quiz, scored | `pick_answer_single`, `true_false`, `short_answer`, `fill_blanks`, `drag_drop`, `match_pairs`, `correct_order`, `categorise` (+ retired `pick_answer_multi`) | quiz | `AbstractQuizType` |
| Quiz, not scored | `spinner_wheel`, `leaderboard` | quiz | `AbstractSlideType` |
| Content | `heading`, `paragraph`, `bullets`, `numbered`, `quote`, `image`, `video`, `big_text`, `qr_code` | both | `ContentSlideType` |

`pick_answer_multi` is retired: `pick_answer_single` now takes one or several correct answers, authoring resolves the old key to it (`replacedBy()`), and a migration converted the stored slides. The class stays registered so session runs snapshotted with it still take answers, score and aggregate.

**Authoring.** `DeckAuthoringService`, `SlideAuthoringService` and `SlideOptionService` (`backend/app/Deck/Authoring/`) do the work; `SlideInput` normalises slide input and seeds new answer slides from the deck settings (time limit, get-ready countdown; quiz: 50/100 points and the speed bonus). Limits: `deck.max_slides_per_deck` (100), option counts per type in `deck.option_limits` (read by `OptionLimits`; caps keep whole-aggregate broadcasts under Reverb's publish size), answers up to `deck.max_answer_body_kb` (32 KB). Config never holds storage paths: decks, slides and options store `files.id` values (`cover_file_id`, `media_file_id`, `image_file_id`) attached through `DeckMediaService`.

**Discover and copies.** A deck with `visibility = public` is listed in Discover (`PublicDeckController`); copying it creates a private deck in the user's library with `source_deck_id` pointing at the original.

**Quiz scoring.** `ScoringService` scores a participant's first answer synchronously on submit, through the type's `score()` (credit 0..1) and `QuizScoring`: with the speed bonus on and a time limit, the earnable points fall linearly from `points_max` (instant answer) to `points_min` (at the limit); otherwise `points_max`. Answers are final (a second one is 409). `deck_participants.total_points` only changes when the run is revealed (`QuizRuntime`), so standings never move during voting. `LeaderboardService` ranks the participants still in the room by total points (ties share a rank) and caches a ranking per run.

**Q&A (quests).** `qa_audience` runs are `open` instead of `voting`; participants post questions and upvote them, the host moderates (answered / hidden / starred) — `SessionQaService`, `LiveQaService`, `QaFeed` in `backend/app/Deck/Qa/`. Upvote broadcasts are debounced (`deck.qa_upvote_debounce_ms`).

**Safety helpers.** `ProfanityFilter` masks the words in `deck.profanity` in display names and, when a slide enables it, in word cloud, open-ended and Q&A text. Join codes avoid look-alike characters (`deck.join_code_alphabet`).

### 4.5 Live Sessions & Broadcasting

**Starting.** `POST {a}/{deck}/sessions` runs `SessionLauncher`: it locks the deck, refuses a second live session (409 `conflict` with `data.session_id`, which the presenter uses to resume), allocates a join code (`JoinCodeGenerator`: 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, globally unique) and a random 32-character `public_channel_key`, and freezes every slide into a `deck_session_slide_runs` row (config with media rebuilt from My Files, options, timing; quiz runs also get `config_snapshot.scoring` and a per-run salt for opaque option keys).

**Run state machine** (`backend/app/Deck/Sessions/SessionStateMachine.php`). The server owns every transition:

| Run kind | States |
|----------|--------|
| Quest answer types (polls etc.) | `waiting → [get_ready →] voting → closed` |
| Quiz scored types | `waiting → [get_ready →] voting → reveal` |
| Spinner wheel | `waiting → voting (spinning) → reveal` |
| Q&A | `waiting → open → closed` |
| Content, leaderboard | stay `waiting` (navigation only) |

Host actions go to `POST {s}/{session}/advance` as `{action, target_run_id?, force?, start?}`: `start_voting`, `close_voting`, `next_slide`, `previous_slide`, `jump_to`; quiz only: `reveal`, `insert_leaderboard`. With `start: true`, `next_slide` / `jump_to` also start the poll or quiz question they move onto (its get-ready countdown begins in the same request); the presenter always sends it, so "next" is one click. Q&A, spinner and content slides still wait. Leaving an active run closes (or reveals) it first; moving backwards away from an active run needs `force: true`; a closed or revealed run never reopens. Quiz runs also reveal by themselves when the time limit runs out or when every participant still in the room has answered. Every transition increments `state_version`; an illegal action answers 409 `invalid_state` with `{slide_run_id, state, state_version}` so the client can resync with `GET {s}/{session}/state`.

**Timers and concurrency.** Countdowns and time limits are delayed `TransitionSlideRunJob`s on the default queue. A job carries the state and version it expects, so a stale job does nothing, and `syncDue()` applies an overdue transition on the next read if a job is lost. Every write locks the session row, then the run row (`FOR UPDATE`).

**Participants.** `POST {s}/{session}/participants/join` with the join code, a display name and an emoji from `deck.emoji_avatars` returns a 64-character token (`ParticipantTokenService`: stored as a SHA-256 hash, valid for 6 hours), sent afterwards as `X-Participant-Token`. The `deck.participant` middleware (`ResolveDeckParticipant`) resolves it on the answer, Q&A-write and participant-state routes; read-only routes use `ParticipantReadAccess`. Joining again from the same device with the old token returns the same participant (`rejoined: true`). `AnswerSubmissionService` checks that the run is the session's current run and is `voting`, validates through the type, stores one row per participant per run (quest: replace or merge; quiz: final and scored) and schedules a results broadcast.

**Ending.** `POST {s}/{session}/end` finishes every active run, marks the session `ended`, revokes every participant token and broadcasts `session.ended`. Revoked tokens still work on the read-only routes (my-answer, aggregate, leaderboard, Q&A feed, review) through `ParticipantReadAccess`, so phones can show the review screen.

**Broadcasting.** All deck broadcasts go through `DeckBroadcaster`: sent after the database transaction commits, immediately (no queue hop), and a failure is logged, never thrown. Each event is a payload class in `backend/app/Deck/Broadcasts/Payloads/`, wrapped in `LiveBroadcastEvent` (`broadcastAs()` = the event name); Fun Games broadcast separately (§4.11). Channel names come from `DeckChannels`:

| Channel | Audience | Authorisation |
|---------|----------|---------------|
| `session.{product}.{public_channel_key}` | participants + host | public channel (random 32-character key) |
| `private-host.{product}.{sessionId}` | host only | `host.{product}.{sessionId}` in `DeckServiceProvider`: the user must be the session's host and the deck's product must match |

| Event (Echo name) | Channel | Notes |
|-------------------|---------|-------|
| `slide.changed`, `slide.state.changed` | public | Navigation and run transitions |
| `slide.aggregate.updated` | public or host | Live results, debounced per run (`deck.aggregate_debounce_ms`, `LiveAggregateService` + `BroadcastDeckAggregate`); host-only when results are hidden from participants (always for quiz runs before the reveal) |
| `slide.closed` | public | Final results of a closed run |
| `participant.count.updated` | public | |
| `participant.joined`, `answer.submitted` | host | |
| `session.ended` | public | |
| `slide.submitted_count.updated`, `slide.revealed`, `spin.started`, `leaderboard.updated` | public | Quiz only |
| `qa.question.submitted`, `qa.question.upvoted`, `qa.question.moderated` | public or host | Quest Q&A |

### 4.6 Authentication & Authorization

- **Sanctum bearer tokens.** `AuthenticationController::login` requires a verified account (`is_verified` and `email_verified_at`) and returns `$user->createToken(config('app.name'))->plainTextToken`; clients send `Authorization: Bearer {token}`. `backend/bootstrap/app.php` also enables `statefulApi()` (cookie sessions for `SANCTUM_STATEFUL_DOMAINS`), but the frontend uses bearer tokens only.
- **Registration and verification.** Register mails `VerifyEmailMail` with a random token stored in `users.email_verification_token`; `POST /verify-email` verifies the account and returns a token. Password reset: `POST /forgot-password` stores one token per email in `password_reset_tokens` and mails it; `POST /reset-password` checks the email + token pair.
- **Social login (Google, Microsoft).** `GET /auth/{provider}/redirect` returns the provider URL; the provider sends the user back to the frontend callback page (`/auth/google/callback`, `/auth/microsoft/callback`), which calls `GET /auth/{provider}/callback?code=...`; the backend creates or links the user (`provider`, `provider_id`) and returns a Sanctum token. Credentials come from `backend/config/services.php` (env); `/social-auth-config` reads and writes them in `.env` through `EnvHelper`.
- **Roles (Spatie).** Only `Super Admin` (created by `SuperAdminSeeder`) is used; it gates the Filament panel (`User::canAccessPanel`). The `role`, `permission` and `role_or_permission` middleware aliases are registered in `backend/bootstrap/app.php`, but no route uses them.
- **Deck ownership.** `DeckPolicy::manage`: a deck is managed by its owner, a session by its host; failures surface as 404.
- **Anonymous participants.** Deck sessions and Fun Games both use an `X-Participant-Token` header with their own token services (`ParticipantTokenService`, `ParticipantTokens`).
- **Filament** uses the session-based `web` guard at `/super-admin` (`UseWebGuardForFilament`, the custom login page `App\Filament\Pages\Auth\Login`, and a login POST route in `backend/routes/web.php`).
- **401s.** The `Authenticate` middleware and the `AuthenticationException` renderer in `backend/bootstrap/app.php` answer API requests with JSON `{success: false, message: "Unauthenticated."}`.

### 4.7 Validation & Errors

- `BaseFormRequest` (`backend/app/Http/Requests/BaseFormRequest.php`) turns validation failures into a 422 `{status: false, message: "Validation Error", data: {validation_errors: {...}}}`.
- Deck routes: slide types throw `ValidationException` with bare keys, controllers prefix them (`DeckValidation::prefixed('config', ...)` gives `config.max_selections`, `answer_payload.*`), and `DeckServiceProvider` renders any `ValidationException` escaping a `backend/routes/deck` route in the same 422 shape.
- Rule violations throw `DeckException` with `data.code` one of `not_found`, `conflict`, `invalid_state`, `unsupported_type`, `forbidden`, `unauthorized`, `slide_limit_reached`. Its `report()` is empty, so these expected outcomes stay out of the log. `FunGameException` and `FileLibraryException` use the same shape.
- Deck form requests live in `backend/app/Deck/Http/Requests/` (authoring, sessions, Q&A, join, answers); the others in `backend/app/Http/Requests/` (Authentication, File, Institution, Preference, Profile, SocialConfig, and the Quiz/Quest bank requests).

### 4.8 Helpers, Traits, Observers & Listeners

- `backend/app/Helpers/helpers.php`: `getStorageDriver()` (the default filesystem disk) and `frontend_url($path)` (an absolute frontend URL from `app.frontend_url`). The v1 join-link/join-code generators are gone; deck join codes come from `JoinCodeGenerator`.
- `backend/app/Helpers/EnvHelper.php`: read and write `.env` values at runtime (used by `/social-auth-config`).
- `ApiResponseTrait` (`backend/app/Traits/ApiResponseTrait.php`): the response envelope (§9). `FileUploadTrait`: `uploadFile()`, `removeFile()`, `checkExistsFile()` into `{Y}/{m}/{d}/{dir}/` on the default disk — used for profile pictures, institution logos and preference files. Both are mixed into `ApiBaseController`, the base of every API controller including the deck controllers (`DeckController`).
- Observers (registered in `AppServiceProvider`): `ActivityLoggerObserver` on `User` and `Institution` (→ `activity_logs`), `PersonalAccessTokenObserver` on Sanctum tokens (→ `login_logs`).
- Listeners (`EventServiceProvider`): `LogLogin` and `LogLogout` (auth events → `login_logs`), `LogEmailSent` (`MessageSent` → `email_logs`).

### 4.9 Mail

Two mailables in `backend/app/Mail/`: `VerifyEmailMail` (`backend/resources/views/emails/verify_email.blade.php`) and `PasswordResetMail` (`backend/resources/views/emails/password_reset.blade.php`). They are sent synchronously with `Mail::to(...)->send(...)` (they use the `Queueable` trait but do not implement `ShouldQueue`). With `MAIL_MAILER=log` (development) mail goes to the log; production uses SMTP.

### 4.10 My Files (FileLibrary module)

`backend/app/Modules/FileLibrary/` is registered by `FileLibraryServiceProvider` (routes at `/api/v1/library`, migrations, `FilePolicy`, the `library-upload` rate limit). Settings: `backend/config/file_library.php`.
- Every upload is a `files` row owned by the user and counts toward their quota (`QuotaService`): default `FILE_LIBRARY_DEFAULT_QUOTA_MB` (100), per-user override `users.storage_quota_bytes` (editable in the Filament `UserResource`), plus a daily upload cap so delete-and-reupload loops cannot fill the disk.
- Allowed: images (jpg, jpeg, png, gif, webp; large images are downscaled by `ImageProcessor`), documents (pdf, docx, pptx, txt) and mp4 video. SVG is refused on purpose.
- `TextExtractionService` splits DOCX, PPTX and TXT into pages / slides / sections (`file_text_contents`) for AI generation; PDFs are read in the browser with pdf.js instead.
- `SlidePreviewService` renders a PPTX to a PDF with LibreOffice so the page picker can show the real slides (pdf.js draws the thumbnails). `GenerateSlidePreview` runs on the `documents` queue, requested on upload or on first view. The PDF is a derived copy named after the file's checksum (`private/library/{user}/previews/`) and doesn't count toward the quota. LibreOffice runs with a throwaway profile that blocks active content, so a deck can't make the server fetch a URL or read a local file through a linked image. This is display only: the AI gets the extracted text, never the images.
- `FileReferenceService` reports where a file is still used: decks by file id, the banks and Fun Games by URL.
- Decks attach files by id through the authoring media routes (§4.3); the legacy `/files` endpoints also store into the library.

### 4.11 Fun Games (FunGame module)

`backend/app/Modules/FunGame/` is registered by `FunGameServiceProvider`: routes (`/api/v1/fun-games`), migrations, `FunGamePolicy`, rate limits (`fungame-join`, `fungame-participant`), the private channel `host.fungame.{sessionId}`, a `fungames` log channel and the `fun-games:tick` / `fun-games:demo` commands.
- **Games** (`fun_games`): draft or published; timer `total` or `per_question`; scoring `marks` or `speed`; every player gets the same questions or their own random draw from a pool. A game owns its questions (`fun_game_questions`).
- **Import** (`ImportService`): from one of the host's quiz decks (`source_deck_id`; choice slides with one correct answer convert, other slide types are listed as skipped) or from a JSON v1 file — which is also what the AI wizard produces (`fungame` target). Every import is previewed first and can be undone (`fun_game_imports`). Games made before the deck engine may still carry `source_quiz_id` (a legacy `quizes` row).
- **Sessions** (`SessionEngine`): `waiting → live → finishing → finished`. Players join with name + email (`POST /fun-games/join/{joinCode}`), get an `X-Participant-Token`, and each plays at their own pace (`PlayerEngine`). The server owns time: `sync()` runs on every read and write and once a second in `fun-games:tick`; `FinaliseFunGameSession` scores a finished game on the `fungames` queue (without a worker, the engine finalises inline about 10 s after the end).
- **Broadcasts** (`FunGameBroadcaster`, `ImmediateLiveBroadcastEvent`): public `session.fungame.{public_channel_key}` and private `host.fungame.{sessionId}`.

### 4.12 Question & Task Banks

Kept from v1 and **not connected to decks yet**: nothing imports bank items into a quiz or quest, and slides cannot be saved to a bank.
- **Quiz question bank** — `QuestionBankController`, `QuestionBankCategoryController` (`backend/app/Http/Controllers/api/v1/Quiz/`); models `BankQuestion` (`quiz_bank_questions`) and `QuestionBankCategory` (`quiz_q_bank_categories`). Routes: `/quiz/question-bank/{my,public,check-duplicate,store,show/{id},update/{id},delete/{id},restore/{id}}` and `/quiz/question-bank-categories/...`. UI: the `/bank/*` pages.
- **Quest task bank** — `QuestTaskBankController`, `QuestTaskBankCategoryController` (`backend/app/Http/Controllers/api/v1/Quest/`); models `BankTask` (`quest_bank_tasks`) and `QuestTaskBankCategory` (`quest_task_bank_categories`). Routes: `/quest/task-bank/...` and `GET /quest/task-bank-categories`. No frontend UI.
- Bank items keep v1-style data: `question_type` is any string (`multiple_choice`, `truefalse`, ... — not deck slide keys) with `options` / `task_data` JSON, so wiring banks to decks needs a mapping to slide types.
- The dashboard counts the user's bank questions (`question_bank_count`).

### 4.13 Dashboard Statistics & Filament Admin

- `GET /dashboard-statistics/dashboard` (`DashboardController`) returns `{quizzes, quests, question_bank_count}`; each product block comes from `DeckStatistics::forOwner()` (`backend/app/Deck/Authoring/DeckStatistics.php`): `total`, `live`, `hosted` (has an ended session) and `never_hosted`.
- Filament panel `admin` at `/super-admin` (`backend/app/Providers/Filament/AdminPanelProvider.php`): `web` guard, Super Admin only, primary colour `#F79945`, auto-discovery of `backend/app/Filament/Resources`, `backend/app/Filament/Pages` and `backend/app/Filament/Widgets`.
  - Pages: `Dashboard`, `MyProfile`, `ChangePassword`, the custom login page.
  - Resources: `UserResource` (including the storage quota), `InstitutionResource`, `ActivityLogResource`, `LoginLogResource`, `EmailLogResource`.
  - Widgets: `StatsOverview` (users, institutions, quizzes, quests, sessions hosted, session participants), `UsersByDayChart` and `ParticipantsByDayChart`, both extending the abstract `DailyCountChart` (a 30-day line chart of a query's rows by `created_at`).

### 4.14 Seeders, Factories & Tests

- `DatabaseSeeder` runs `UsersTableSeeder`, `PasswordResetTokensTableSeeder`, `PreferencesTableSeeder` and `SuperAdminSeeder` (role `Super Admin` + a user from `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`, defaults `super@admin.com` / `password`). Bank demo content is opt-in: `php artisan db:seed --class='Database\Seeders\Quiz\QuizBankQuestionSeeder'` (and `Database\Seeders\Quest\QuestBankTaskSeeder`). The Docker `backend` service migrates on start and seeds only when the users table is empty.
- Factories: `UserFactory` and one per deck model in `backend/database/factories/Deck/`.
- Tests (Pest): `backend/tests/Feature/Deck/` (authoring, sessions, participants, Q&A, media, public decks, one test file per slide type, quest and quiz end-to-end), `backend/tests/Feature/FileLibrary/`, `backend/tests/Feature/FunGame/`. They use `DatabaseTransactions` against the configured database, so they need a migrated PostgreSQL database (`backend/phpunit.xml` does not switch to SQLite). `php artisan fun-games:demo` creates a sample game for manual testing.

---

## 5. Frontend Architecture (Next.js 15)

### 5.1 Directory Map

```
frontend/src/
├── app/                                # App Router (§5.2)
│   ├── layout.tsx                      # Root: fonts, global CSS, ClientProviders, ToastProvider, SiteAnalytics
│   ├── ClientLayout.tsx                # Client mount gate + NextTopLoader + Providers
│   ├── providers.tsx                   # ThemeProvider (next-themes), Redux Provider + PersistGate, SidebarProvider
│   ├── ProtectedRoute.tsx              # Redirects to / unless auth.isAuthenticated
│   ├── (auth)/auth/                    # Sign in/up, password reset, email verification, OAuth callbacks
│   ├── (protected)/                    # Signed-in app (header + sidebar)
│   ├── (play)/play/                    # Participant PWA for live quizzes and quests
│   ├── (public)/                       # Landing, plans, upcoming, Fun Games player page
│   └── api/auth/                       # Route handlers: set-cookie, logout (httpOnly auth_token cookie)
├── features/
│   ├── deck/                           # Shared deck client: api/, live/, types.ts, productCopy.ts, theme.ts
│   ├── deck-editor/                    # Editor shell (components/), per-type views (slides/), slideRegistry.ts
│   ├── deck-presenter/                 # Host live screen (PresenterShell)
│   ├── deck-participant/               # /play screens, mobile shell, PWA registration
│   ├── deck-library/                   # My Library list, Discover list, "New quiz / quest" card
│   ├── fun-games/                      # Host and player apps, own API client, realtime, mock server
│   ├── file-library/                   # My Files view, uploader, picker, quota bar
│   ├── ai-generate/                    # Document → questions wizard, AI client, mappers
│   ├── dashboard/                      # Stats overview, question bank UI, billing / plans views
│   └── auth/                           # Sign-in / sign-up components, authSlice
├── components/                         # Layouts/ (header, sidebar, PublicLayout), ui/, FormElements/, GlobalPagination, ToastProvider
├── config/                             # api.ts, env.ts (NEXT_PUBLIC_* reader), theme.ts (Tailwind palette)
├── hooks/                              # use-mobile, useDebounce, use-click-outside
├── lib/echo.ts                         # Shared Laravel Echo (Reverb) connection
├── stores/store.ts                     # Redux store (auth only)
├── utils/                              # axiosInstance.ts, pdfUtils.ts, showConfirmDialog.ts
├── types/, interfaces/                 # Small shared types (billing, plan, icon props, module declarations)
└── styles/, fonts/, assets/
```

### 5.2 App Router, Route Groups & Layouts

| Group | Layout | Pages |
|-------|--------|-------|
| `(auth)` | root layout only | `/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`, `/auth/reset-password/[token]`, `/auth/verify/[token]`, `/auth/google/callback`, `/auth/microsoft/callback` |
| `(protected)` | `frontend/src/app/(protected)/layout.tsx`: `ProtectedRoute` + header + sidebar; the deck editor and presenter render full-screen without them | `/dashboard`; `/my-library` (`?tab=quiz` or `?tab=quest`), `/my-library/quiz-page`, `/my-library/quest-page`; `/discover/discover-quiz`, `/discover/discover-quest`; `/quizzes/[id]/edit`, `/quizzes/[id]/present`, `/quests/[id]/edit`, `/quests/[id]/present`; `/bank/my-question-bank`, `/bank/public-question-bank`, `/bank/categories`; `/my-files`; `/fun-games` (+ `/fun-games/[id]/edit`, `/fun-games/[id]/import`, `/fun-games/import`, `/fun-games/sessions`, `/fun-games/sessions/[sessionId]`); `/profile`, `/settings`, `/billing` |
| `(play)` | `frontend/src/app/(play)/layout.tsx`: PWA manifest + service worker, no app header | `/play` (enter code), `/play/[code]` (name), `/play/[code]/avatar` (emoji, then join), `/play/live/[publicChannelKey]` (live), `/play/live/[publicChannelKey]/review` (after the end) |
| `(public)` | `frontend/src/app/(public)/layout.tsx`: public header | `/` (landing), `/plans`, `/upcoming`, `/attempt/fun-games/[joinCode]` (Fun Games player) |

- `/join` permanently redirects to `/play` (`frontend/next.config.ts`), for old links and QR codes.
- `ProtectedRoute` (`frontend/src/app/ProtectedRoute.tsx`) checks `auth.isAuthenticated` in Redux (initialised from `localStorage.auth_token`) and redirects to `/`.
- The sidebar menu is defined in `frontend/src/components/Layouts/sidebar/data/index.ts` (Dashboard, My Library, Discover, Question Bank, My Files, Fun Games).

### 5.3 Redux Store & Auth State

`frontend/src/stores/store.ts` holds a single slice, `auth` (`frontend/src/features/auth/store/authSlice.ts`), persisted with redux-persist; a transform drops `loading` / `error` so an interrupted login never comes back as a spinner. Every other screen keeps its state in feature hooks (e.g. `useDeckEditor`, `usePresenterSession`, `useParticipantSession`).

```typescript
interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  user: { id: number; full_name: string; email: string; profile_picture?: string | null } | null;
}
```

Thunks: `loginUser`, `registerUser`, `loginWithGoogle`, `loginWithMicrosoft`, `logoutUser`, `updateProfilePicture`. On login the token is written to `localStorage.auth_token` (read by every HTTP client and by Echo) and mirrored into an httpOnly cookie through `POST /api/auth/set-cookie`.

### 5.4 HTTP Clients

| Client | File | Used for |
|--------|------|----------|
| `axiosInstance` / `api` | `frontend/src/utils/axiosInstance.ts` | Signed-in Laravel calls. Base URL `NEXT_PUBLIC_API_BASE_URL`, 10 s default timeout, `Authorization: Bearer` from `localStorage.auth_token`; a 401 clears the token and redirects to `/`. No console logging for deck / library URLs and coded 4xx errors, which callers turn into UI. |
| Deck API | `frontend/src/features/deck/api/` | `authoringApiFor(product)` and `sessionApiFor(product)` on `axiosInstance`; `participantApiFor(product)` and `lookupSessionByCode()` on a separate cookie-less axios instance that sends `X-Participant-Token`; emoji avatars via `useEmojiAvatars()`. URL prefixes come from `DECK_ROUTES` in `frontend/src/features/deck/api/routes.ts` (mirrors `backend/config/deck.php`); errors are normalised to `DeckApiError` (`frontend/src/features/deck/api/errors.ts`); per-call timeouts in `DECK_TIMEOUTS`. |
| Fun Games | `frontend/src/features/fun-games/api/` | Its own axios client for `/fun-games`; `NEXT_PUBLIC_FUN_GAMES_MOCK=1` swaps in an in-browser mock (`frontend/src/features/fun-games/mock/`). |
| My Files | `frontend/src/features/file-library/api/libraryApi.ts` | `/library/*` |
| AI server | `frontend/src/features/ai-generate/aiClient.ts` | `fetch` to `{NEXT_PUBLIC_AI_API_URL}/v1/generate` with the user's bearer token |

JSON casing differs by API: deck and core request bodies are snake_case; deck authoring and My Files responses are camelCase; live session responses and broadcasts are snake_case; Fun Games uses camelCase both ways. `frontend/src/features/deck/types.ts` types every deck shape.

### 5.5 Realtime (Laravel Echo + Reverb)

- `frontend/src/lib/echo.ts` keeps one Echo connection per tab (`broadcaster: "reverb"`, pusher-js) configured from `NEXT_PUBLIC_REVERB_APP_KEY` / `_HOST` / `_PORT` / `_SCHEME`. Private channels authorise against `{backend origin}/broadcasting/auth` and read the current bearer token on every authorisation.
- Deck hooks in `frontend/src/features/deck/live/`: `echoChannels.ts` ref-counts channel subscriptions; `useDeckSessionChannel` (public channel; the presenter also gets host-only events) and `useDeckHostChannel` (private host channel) merge events into state by `state_version` (`channelState.ts`). The state endpoint is the source of truth: it is re-read on mount, on every (re)subscription, on a version gap and after timer deadlines; with the socket down the hooks poll. `useServerClock` aligns countdowns with the server, `qaFeed.ts` handles Q&A, and `participantSession.ts` stores the participant token (sessionStorage per tab, plus a per-device copy in localStorage for same-device rejoin).
- Channel names are built by `publicChannelName()` / `hostChannelName()` in `frontend/src/features/deck/api/routes.ts`; Echo adds the `private-` prefix.
- Fun Games use their own wrapper (`frontend/src/features/fun-games/realtime/`) and fall back to polling when realtime is unavailable.

### 5.6 Deck Features (editor, presenter, participant, library)

**Editor** (`frontend/src/features/deck-editor/`). `EditorShell` (route `/quizzes|quests/[id]/edit`; `?slide=<id>` opens a slide) combines `SlideRail`, `SlidePicker`, the canvas (`CenterCanvas`, `SlidePreview`, `PhonePreview`, `PreviewOverlay`), `InspectorPanel` (Content / Design / Settings tabs), `DeckSettingsModal` and `GenerateSlidesModal` (AI). State lives in `useDeckEditor`, which applies patches optimistically and autosaves.

**Slide registry** (`frontend/src/features/deck-editor/slideRegistry.ts`) — the frontend twin of `SlideTypeRegistry`. Each backend key has a folder under `frontend/src/features/deck-editor/slides/` named in camelCase (`pick_answer_single` → `pickAnswerSingle`) with the same four files as `frontend/src/features/deck-editor/slides/trueFalse/`: `Editor.tsx`, `Presenter.tsx`, `Participant.tsx` and an `index.ts` exporting `entry = defineSlideType({...})` (key, products, category, label, description, icon, the three components, optional `sampleAggregate` and `retired`). Shared building blocks are in `frontend/src/features/deck-editor/slides/shared/`. Shells look a type up with `getSlideType(run.type)` and never switch on the key; `slideTypesForProduct(product)` gives the picker list (retired types hidden). Config / answer / aggregate shapes per type are in `frontend/src/features/deck/types.ts`, derived from the backend classes.

**Presenter** (`frontend/src/features/deck-presenter/`). `PresenterShell` → `usePresenterSession` starts the session or, on the 409, resumes the live one (a reload or second tab picks up where the room is). `LivePresenter` renders the current run through the registry; `ControlBar`, `useHostControls` and `usePresenterKeyboard` send advance actions; `QrSidebar` / `JoinBanner` show the join code and QR; `QaModerationSheet` moderates Q&A; `SessionSummary` is the end screen.

**Participant app** (`frontend/src/features/deck-participant/`). Screens `JoinCodeScreen` → `NameScreen` → `AvatarScreen` → `PlayScreen` → `ReviewScreen`; `lookupSessionByCode()` resolves the product with one `GET /play/by-code/{code}`. It is a PWA with its own shell (`frontend/src/features/deck-participant/shell/`), install banner and service worker registration (`frontend/src/features/deck-participant/pwa/`, `frontend/public/sw.js`, `frontend/public/manifest.webmanifest`), themed per deck by `frontend/src/features/deck/theme.ts` (CSS variables `--deck-*`).

**Library** (`frontend/src/features/deck-library/`). `DeckLibrarySection` (My Library per product: edit, present, duplicate, delete), `DeckDiscoverSection` (public decks: preview, copy) and `NewDeckCard` (dashboard tile: a blank deck or one generated by AI from a My Files document). `productCopy(product)` in `frontend/src/features/deck/productCopy.ts` holds the words and routes that differ per product (`editHref`, `presentHref`, `libraryHref`).

### 5.7 Other Features

- **Fun Games** (`frontend/src/features/fun-games/`): host app (games list, editor, import from a library quiz, a JSON file or the AI wizard, live session pages) and player app (`/attempt/fun-games/[joinCode]`: join form, lobby, sequential player, results), with server-clock sync and a polling fallback.
- **My Files** (`frontend/src/features/file-library/`): `MyFilesView` (`/my-files`), `FileDropzone`, `StorageUsageBar` and `FileLibraryPicker`, which the deck editor (slide media) and the AI wizard use.
- **AI generation** (`frontend/src/features/ai-generate/`): see §6.
- **Dashboard** (`frontend/src/features/dashboard/`): `StatsOverview` (calls `/dashboard-statistics/dashboard`), the quiz question bank UI (`frontend/src/features/dashboard/question-bank/`: my bank, public bank, categories) and static billing / plans views (`frontend/src/features/dashboard/web/`).
- **Auth** (`frontend/src/features/auth/`): sign-in / sign-up forms, Google and Microsoft buttons, `authSlice`.

### 5.8 Shared Components, Hooks & Styling

- `frontend/src/components/ui/`: `Button`, `Modal`, `ConfirmDialog`, `Dropdown`, `Table`, `Pagination`, `Skeleton`, `Loader`, `Title`; plus `GlobalPagination`, `ToastProvider` and the layouts in `frontend/src/components/Layouts/`.
- Hooks (`frontend/src/hooks/`): `useIsMobile()` (viewport < 850 px), `useDebounce(value, delay = 2000)`, `useClickOutside(callback)`.
- Styling: Tailwind with `darkMode: ["class"]` and the palette from `frontend/src/config/theme.ts` (primary `#F79945`, secondary `#BC5EB3`); Ant Design for a few shared widgets (patched for React 19 by `@ant-design/v5-patch-for-react-19`); deck screens use the `--deck-*` CSS variables; `font-mono` is IBM Plex Mono (numbers, timers, codes).
- Utilities: `frontend/src/utils/pdfUtils.ts` (pdf.js page text and thumbnails), `frontend/src/utils/showConfirmDialog.ts` (SweetAlert2).
- Path alias: `@/*` → `frontend/src/*` (`frontend/tsconfig.json`).

---

## 6. AI Server (FastAPI)

`ai-server/` is a separate Python service (FastAPI, Pydantic, LangGraph, LangChain OpenRouter — default model `anthropic/claude-sonnet-4.5`, LangChain OpenAI as the alternative provider; managed with `uv`) that turns document text into quiz slides, quest slides or Fun Games questions. It never touches the database: the frontend sends the selected text and options, receives validated items and saves them through the Laravel API.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | no | Liveness |
| GET | `/v1/targets` | no | Targets, their question types and the size limits |
| POST | `/v1/generate` | Bearer (Sanctum) | `{target, textData, topic, questionCount, questionTypes, difficulty, audienceLevel, focusArea}` → `{target, questions, meta}` |

- **Auth**: the bearer token is verified against `{LARAVEL_API_URL}/profile/show`, cached for `AUTH_CACHE_SECONDS` and rate-limited per token (`RATE_LIMIT_PER_MINUTE`); `AUTH_DISABLED=true` is for local development only.
- **Targets** (`ai-server/app/generation/registry.py`; one module each in `ai-server/app/generation/targets/`): `quiz` (types `pick_answer_single`, `pick_answer_multi`, `true_false`, `short_answer`, `fill_blanks`, `drag_drop`, `correct_order`, `match_pairs`, `categorise` — the deck slide keys; both pick kinds are saved as one `pick_answer_single` slide), `quest` (`poll_single`, `poll_multi`, `word_cloud`, `open_ended`, `scales`, `ranking`, `points_allocation`, `rating`, `matrix_2x2`) and `fungame` (`single_choice`, `true_false`). Repeats are dropped by each target's `text_fields` (quiz: title + sentence, since blank questions share titles). The old `quiz_v2` / `quest_v2` target keys no longer exist.
- **Workflow** (`ai-server/app/generation/graph/workflow.py`): build the prompt → call the model with structured output → validate item by item (bad items are dropped, never the batch) → retry when nothing is usable (`GENERATION_MAX_ATTEMPTS`) → top up when fewer items than requested came back (`GENERATION_MAX_TOPUPS`).
- **Frontend side** (`frontend/src/features/ai-generate/`):
  - `DocumentToQuestionsWizard`: pick a My Files document, choose pages or chapters (PDFs are parsed in the browser; DOCX / PPTX / TXT come from `GET /library/files/{id}/pages`), then the options.
  - `frontend/src/features/ai-generate/aiClient.ts` calls the server; `frontend/src/features/ai-generate/types.ts` holds the targets and the result shapes; `frontend/src/features/ai-generate/questionTypes.ts` the type choices shown in the UI (label, icon and order as in the editor's slide picker; "Pick answer" asks the AI for both pick kinds).
  - `frontend/src/features/ai-generate/mappers.ts` turns results into editor payloads: `toDeckSlidesBulk()` → `POST {a}/{deck}/slides/bulk`, `toFunGameImport()` → Fun Games JSON import rows.
  - Used by the editor's `GenerateSlidesModal`, the dashboard's `NewDeckCard` and the Fun Games importer.
- **Reaching it**: `NEXT_PUBLIC_AI_API_URL` is either the server's URL (allowed by its `CORS_ORIGINS`) or the path `/ai-api`, which `frontend/next.config.ts` rewrites to `AI_PROXY_URL` (Docker) and Nginx proxies in production.
- Changing question types, shapes or targets: `ai-server/README.md`.

---

## 7. Data Flow: End-to-End Walkthroughs

### 7.1 Quiz / Quest: author → present → play

```
HOST (editor / presenter)                 BACKEND (Laravel + Reverb)                 PARTICIPANT (/play)
  │                                          │                                         │
  ├─ POST /quizzes {title} ─────────────────►│ create deck (product quiz)              │
  ├─ POST /quizzes/{deck}/slides ───────────►│ slide + seeded options                  │
  ├─ PATCH .../slides/{slide} (autosave) ───►│ validateConfig() via the registry       │
  │                                          │                                         │
  ├─ POST /quizzes/{deck}/sessions ─────────►│ SessionLauncher: snapshot every slide   │
  │◄── 201 host state {session_id, join_code, public_channel_key}                       │
  ├─ subscribe private-host.quiz.{id}        │                                         │
  │                                          │◄──── GET /play/by-code/{code} ──────────┤
  │                                          │───── {session_id, product, ...} ───────►│
  │                                          │◄──── POST /quiz-sessions/{id}/participants/join
  │◄── participant.joined (host channel) ────┤───── 201 {participant_token, ...} ─────►│
  │                                          │      subscribe session.quiz.{key}       │
  ├─ POST .../advance {start_voting} ───────►│ run: waiting → get_ready → voting       │
  │                                          │───── slide.state.changed ──────────────►│
  │                                          │◄──── POST .../slide-runs/{run}/answers ─┤ X-Participant-Token
  │◄── answer.submitted, slide.aggregate.updated (host)  scored on submit, 204 ───────►│
  │                                          │───── slide.submitted_count.updated ────►│
  ├─ POST .../advance {reveal} ─────────────►│ run → reveal, points added to totals    │
  │                                          │───── slide.revealed ───────────────────►│ GET .../state (my result)
  ├─ POST .../advance {next_slide} ─────────►│───── slide.changed ────────────────────►│
  ├─ POST .../end ──────────────────────────►│ session ended, tokens revoked           │
  │                                          │───── session.ended ────────────────────►│ GET .../review
```

A **quest** follows the same path with `/quests` and `/quest-sessions`: runs end in `closed` instead of `reveal`, nothing is scored, and `slide.aggregate.updated` goes to the public channel while voting (unless the slide hides results), so the presenter's chart and the phones update live. Q&A slides open with `start_voting` (`waiting → open`) and use the `{s}/{session}/.../qa/questions` routes.

### 7.2 Quiz results and standings
1. During `voting` phones only see `slide.submitted_count.updated`; answers are already scored (`is_correct`, `points_awarded`) but hidden.
2. `reveal` (host action, the time limit, or everyone answered) adds the run's points to `deck_participants.total_points` and broadcasts `slide.revealed`.
3. Each phone makes one read, `GET {s}/{session}/state`, whose `my_submission_for_current_slide` carries correctness and the standing; `my-answer` and `leaderboard` serve the same data on demand.
4. Moving onto a leaderboard slide (or `insert_leaderboard`) broadcasts `leaderboard.updated`.

### 7.3 Fun Games
Host creates a game (blank, from a quiz deck via `/fun-games/host/games/from-library`, a JSON import or the AI wizard) → `publish` → `POST /fun-games/host/games/{game}/sessions` (`waiting`, join code + QR) → players `POST /fun-games/join/{joinCode}` with name + email → host `start` (`live`) → each player reads `current` and posts `answers` at their own pace → the session ends when everyone has finished after the join window, the host ends it, or the hard deadline passes (`finishing`) → `FinaliseFunGameSession` scores it (`finished`) → `leaderboard` and `/fun-games/sessions/{session}/results/me`.

---

## 8. Entity Relationship Map

```
users
├── decks  (owner_id; product quiz | quest; source_deck_id → decks)
│   ├── slides ──► slide_options
│   └── deck_sessions  (host_user_id → users)
│       ├── deck_session_slide_runs  (frozen slides; slide_id nullable)
│       │   ├── deck_participant_answers ◄── deck_participants
│       │   └── deck_qa_questions ──► deck_qa_upvotes ◄── deck_participants
│       └── deck_participants
├── files  (My Files) ◄── decks.cover_file_id, slides.media_file_id, slide_options.image_file_id
│   └── file_text_contents  (extracted pages)
├── fun_games  (source_deck_id → decks; legacy source_quiz_id → quizes)
│   ├── fun_game_questions
│   ├── fun_game_imports
│   └── fun_game_sessions ──► fun_game_participants ──► fun_game_answers (→ fun_game_questions)
├── quiz_q_bank_categories ──► quiz_bank_questions         (owner_id; not linked to decks)
├── quest_task_bank_categories ──► quest_bank_tasks        (owner_id; not linked to decks)
├── institutions  (users.institution_id)
└── login_logs, activity_logs, email_logs

legacy v1 tables (quizes, questions, quiz_sessions, surveys, quests, ...): present, unused
```

---

## 9. API Response Contract

Laravel endpoints respond through `ApiResponseTrait` (or exceptions rendering the same envelope):

**Success** (200 / 201):
```json
{
  "status": true,
  "message": "Session started.",
  "data": { "...": "..." }
}
```
An empty `data` is serialised as `{}`. A few endpoints answer **204 No Content** (deck answers, leave).

**Validation error** (422, `BaseFormRequest` and every deck route):
```json
{
  "status": false,
  "message": "Validation Error",
  "data": { "validation_errors": { "title": ["The title field is required."] } }
}
```

**Rule violation** (`DeckException`, `FunGameException`, `FileLibraryException`):
```json
{
  "status": false,
  "message": "This deck already has a live session. End it before starting another one.",
  "data": { "code": "conflict", "session_id": 42 }
}
```

Exceptions to the envelope:
- 401 from the auth middleware: `{ "success": false, "message": "Unauthenticated." }`.
- 429 from rate limiters: Laravel's throttle response with a `Retry-After` header (exposed through CORS).
- The AI server answers `{ "error": "message" }`.

`ApiResponseTrait` helpers: `successResponse()`, `okResponse()` (200), `createdResponse()` (201), `badRequestResponse()` (400), `unauthorizedResponse()` (401), `forbiddenResponse()` (403), `notFoundResponse()` (404), `methodNotAllowedResponse()` (405), `conflictResponse()` (409), `unprocessableResponse()` (422), `serverErrorResponse()` (500), `serviceUnavailableResponse()` (503), `errorResponse()`, and the generic `response()`.

---

## 10. Naming Conventions & Patterns

### Backend (Laravel)

| Element | Convention | Example |
|---------|-----------|---------|
| Models | PascalCase, singular | `Deck`, `DeckSessionSlideRun`, `BankQuestion` |
| Tables | snake_case, plural | `decks`, `deck_session_slide_runs`, `quiz_bank_questions` |
| Slide type keys | snake_case, ≤ 40 chars | `pick_answer_single`, `word_cloud` |
| Deck classes | role suffixes | `<Name>SlideType`, `<Event>Payload`, `*Service`, `*Presenter` (API resources) |
| Deck / module URIs | kebab-case, REST-style | `POST /quizzes/{deck}/slides`, `POST /quiz-sessions/{session}/advance` |
| Older core URIs | verb segments | `/institutions/store`, `/quiz/question-bank/update/{id}` |
| Route names | dotted | `deck.quiz.decks.show`, `deck.quest.sessions.advance`, `fungames.host.games.index`, `library.files.index` |
| Broadcast events | dotted, lowercase | `slide.state.changed` |
| JSON | deck and core request bodies snake_case (Fun Games: camelCase); response casing in §5.4 | `answer_payload`, `display_name` |
| Helpers | snake_case functions | `frontend_url()` |

### Frontend (Next.js)

| Element | Convention | Example |
|---------|-----------|---------|
| Feature modules | kebab-case folders in `frontend/src/features/` | `deck-editor`, `file-library` |
| Components | PascalCase .tsx files | `frontend/src/features/deck-editor/components/EditorShell.tsx` |
| Pages | a page.tsx per route folder | `frontend/src/app/(protected)/quizzes/[id]/edit/page.tsx` |
| Slide folders | camelCase of the backend key | `pickAnswerSingle`, `matrix2x2` |
| Hooks | `use` + PascalCase | `useDeckEditor`, `usePresenterSession` |
| Path alias | `@/*` → `frontend/src/*` | `import { api } from "@/utils/axiosInstance"` |
| Route groups | parenthesised | `(auth)`, `(play)`, `(protected)`, `(public)` |

### Shared Patterns

1. **One engine, two products.** Never scatter `'quiz'` / `'quest'` checks: the product comes from the route (`DeckRoutes::product()`), slide availability from `products()`, and the frontend uses `DECK_ROUTES`, `productCopy()` and the registry's `products`.
2. **Registries, not switches.** Backend `SlideTypeRegistry`, frontend `SLIDE_REGISTRY`, AI server `TargetRegistry` — add an entry instead of a branch.
3. **Snapshots.** Live code reads `deck_session_slide_runs` snapshots, never the authoring slide.
4. **The server owns state and time.** Transitions happen on the server (queued timer jobs + `syncDue()` on reads; Fun Games: `SessionEngine::sync()` + `fun-games:tick`); clients resync from the state endpoints.
5. **Broadcast after commit.** `DeckBroadcaster` / `FunGameBroadcaster` send inside `DB::afterCommit`; a failed broadcast is logged and never fails the request.
6. **404 over 403.** Someone else's, another product's or a deleted deck / session is a 404 (`DeckController::ownedDeck()`, `ownedSession()`).
7. **Anonymous participants.** `X-Participant-Token`, stored hashed, for decks and Fun Games alike.
8. **Media through My Files.** Decks store file ids; the banks and Fun Games store URLs.
9. **Soft deletes** on decks, slides, bank items, fun games and files.

---

## 11. Known Quirks & Technical Debt

| Item | Description | Impact |
|------|-------------|--------|
| Legacy v1 tables | `quizes` (sic), `questions`, `quiz_sessions`, `surveys`, `quests`, `quest_tasks`, ... are still created by `backend/database/migrations/Quiz/`, `backend/database/migrations/Survey/` and `backend/database/migrations/Quest/` but nothing reads them. `fun_games.source_quiz_id` still has a foreign key to `quizes`. | Medium — dropping them needs a data-retention decision and a migration that handles that foreign key. |
| Unused flag columns | `users.quest_v2_enabled` / `users.quiz_v2_enabled` remain from the removed per-user v2 flags. | Low |
| Retired slide type | `pick_answer_multi` stays registered (backend class and frontend entry with `retired: true`) so past runs render and score. | Low — do not offer it for new slides. |
| `backend/routes/api.php` not loaded | `backend/bootstrap/app.php` passes no `api:` file to `withRouting()`, so its `/user` route does not exist. | Low — dead file. |
| Unused dependencies | Backend: maatwebsite/excel (+ `backend/config/excel.php`). Frontend: e.g. `jspdf`, `pptxgenjs`, `dayjs`, `styled-components`, `swiper`, `@isoterik/react-word-cloud`, `dompurify` are no longer imported. | Low — install size. |
| Admin-style endpoints without role checks | `/social-auth-config` (reads and writes OAuth client IDs **and secrets** in `.env`), `/logs` (reads and downloads log files), `/institutions` and `/preferences` writes only require `auth:sanctum`. | High — any signed-in user can call them. |
| Password reset tokens never expire | `AuthenticationController::resetPassword` only checks that the email + token pair exists in `password_reset_tokens`; the 60-minute `expire` in `backend/config/auth.php` belongs to Laravel's password broker, which this flow does not use. | Medium |
| Unused auth cookie | Login still sets the httpOnly `auth_token` cookie (`POST /api/auth/set-cookie`), but nothing reads it since the server-side API helpers were removed; there is no Next.js middleware. | Low |
| Mixed JSON casing | Deck and core requests are snake_case; deck authoring and My Files responses camelCase; live session responses snake_case; Fun Games camelCase both ways. | Low — follow the existing endpoint. |
| Different 401 shape | `{success, message}` instead of `{status, message, data}`. | Low |
| Legacy `/files` endpoints | Still routed (uploads go into My Files) but the frontend only uses `/library`. | Low |
| Quest task bank | Has API routes but no frontend UI; neither bank is connected to decks. | Medium — see §13. |
| `INTERNAL_API_BASE_URL` | Set for the frontend in `docker-compose.yml` but not read by any code. | Low |
| No host network panel | `monitoring/`'s node-exporter is not in the host's network namespace, so it reports no network interfaces (`--no-collector.netdev`); per-container traffic comes from cAdvisor. | Low — move it to `network_mode: host` if server NIC traffic is needed. |
| cAdvisor version floor | Docker 29 stores images with containerd's snapshotter; cAdvisor before v0.55 then finds no containers and the container panels stay empty. | Low — keep `gcr.io/cadvisor/cadvisor` at v0.55.1 or newer. |
| Root metadata | `frontend/src/app/layout.tsx` still describes the app as a "Quiz, Quest and Survey Platform". | Low — cosmetic. |
| Historical plans | `QUEST_REDESIGN_PLAN.md` / `QUIZ_REDESIGN_PLAN.md` still describe `/v2` routes, flags and v1 cut-over steps. | Low — the code wins. |

---

## 12. Environment & Configuration

There are **no feature-flag variables**: quizzes, quests and Fun Games are available to every signed-in user.

### Backend `.env` (see `backend/.env.docker` for local Docker, `.env.prod.example` for production)
| Variable | Purpose |
|----------|---------|
| `APP_KEY`, `APP_URL` | Laravel key; backend URL (`http://localhost:8000`) |
| `FRONTEND_URL` | Frontend URL (`frontend_url()`, CORS default) |
| `CORS_ALLOWED_ORIGINS` | Browser origins allowed on Laravel routes, including `/broadcasting/auth` |
| `SANCTUM_STATEFUL_DOMAINS`, `SESSION_DOMAIN` | Cookie-session domains (the frontend itself uses bearer tokens) |
| `DB_CONNECTION=pgsql`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | PostgreSQL |
| `REDIS_*`, `CACHE_STORE=redis`, `SESSION_DRIVER=redis`, `QUEUE_CONNECTION=redis` | Redis |
| `BROADCAST_CONNECTION=reverb`, `REVERB_APP_ID`, `REVERB_APP_KEY`, `REVERB_APP_SECRET` | Reverb app credentials |
| `REVERB_HOST`, `REVERB_PORT`, `REVERB_SCHEME` (+ optional `REVERB_BROADCAST_*`) | Where Laravel publishes events (`REVERB_BROADCAST_*` override for an internal address) |
| `REVERB_SERVER_HOST`, `REVERB_SERVER_PORT`, `REVERB_ALLOWED_ORIGINS`, `REVERB_SCALING_ENABLED` | Reverb server bind, websocket origin allow-list, Redis scaling |
| `MAIL_*` | `MAIL_MAILER=log` in development, SMTP in production |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` | Social login (redirect URIs are frontend callback pages) |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` | Filament admin user created by the seeder |
| `FILESYSTEM_DISK`, `AWS_*` | Storage disk (local by default, optional S3) |
| `DECK_AGGREGATE_DEBOUNCE_MS`, `DECK_QA_UPVOTE_DEBOUNCE_MS`, `DECK_DEFAULT_GET_READY_SECONDS`, `DECK_MAX_SLIDES_PER_DECK`, `QUIZ_DEFAULT_GET_READY_SECONDS`, `QUIZ_SPIN_SECONDS` | Optional deck tuning (`backend/config/deck.php`) |
| `FILE_LIBRARY_DISK`, `FILE_LIBRARY_DEFAULT_QUOTA_MB`, `FILE_LIBRARY_MAX_*` | Optional My Files limits (`backend/config/file_library.php`) |
| `FUNGAMES_LOG_LEVEL`, `FUNGAMES_LOG_DAYS` | Optional `fungames` log channel settings |

### Frontend (`frontend/.env.example`)
| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | Laravel API base (`http://localhost:8000/api/v1`) |
| `NEXT_PUBLIC_REVERB_APP_KEY`, `NEXT_PUBLIC_REVERB_HOST`, `NEXT_PUBLIC_REVERB_PORT`, `NEXT_PUBLIC_REVERB_SCHEME` | Echo / Reverb client |
| `NEXT_PUBLIC_APP_URL` | Public app URL |
| `NEXT_PUBLIC_AI_API_URL` | AI server URL, or `/ai-api` with `AI_PROXY_URL` |
| `AI_PROXY_URL`, `BACKEND_PROXY_URL` | Server-side rewrites in `frontend/next.config.ts` (`/ai-api/*`; `/api/v1/*`, `/broadcasting/auth`, `/storage/*`) |
| `NEXT_PUBLIC_FUN_GAMES_MOCK` | `1` = Fun Games against an in-browser mock |

`NEXT_PUBLIC_*` values are compiled into the browser bundle at build time (the Docker `frontend` service passes them as build args); `NEXT_OUTPUT=standalone` (set in `frontend/Dockerfile`) makes a standalone server build.

### AI server (`ai-server/.env.example`)
`LARAVEL_API_URL`, `LLM_PROVIDER` (`openrouter` default, or `openai`), `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `anthropic/claude-sonnet-4.5`), optional `OPENROUTER_APP_URL`; with `LLM_PROVIDER=openai`: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`; `CORS_ORIGINS`, `AUTH_DISABLED`, `AUTH_CACHE_SECONDS`, `RATE_LIMIT_PER_MINUTE`, `LLM_*`, `GENERATION_MAX_ATTEMPTS`, `GENERATION_MAX_TOPUPS`, `MAX_QUESTIONS`, `MAX_TEXT_CHARS`, `MIN_TEXT_CHARS`.

### Docker compose services (`docker-compose.yml`)
| Service | Runs |
|---------|------|
| `postgres`, `redis` | Databases (PostgreSQL 16, Redis 7) |
| `backend` | `migrate --force`, seed when empty, `storage:link`, `artisan serve` on 8000 |
| `reverb` | `reverb:start` on 8080 |
| `queue` | `queue:work` on the default queue, then the `fungames` queue: slide timers, trailing aggregate and Q&A upvote broadcasts, Fun Games scoring. Without it, timers only advance through the read-time fallback, the trailing (final) result broadcasts are never sent, and Fun Games scoring waits for the ticker's fallback. |
| `documents-queue` | `queue:work` on the `documents` queue: renders PPTX slides for the page picker. The only image with LibreOffice (about 530 MB larger), and its own worker because a conversion would hold up live broadcasts on `queue`. Without it, PPTX slides show as text cards and everything else works. |
| `fungames-ticker` | `fun-games:tick --loop` |
| `frontend`, `frontend-dev` | Production build on 2000; `next dev` with hot reload on 3001 |
| `ai-server` | FastAPI on 8001 (needs `ai-server/.env`) |

### Monitoring (`monitoring/`)
A separate compose project (`mindspear-monitoring`), started after the app and independent of it:
`docker compose -f monitoring/docker-compose.yml up -d`. Full guide: `monitoring/README.md`.

| Service | Collects |
|---------|----------|
| `prometheus` | Stores everything (15 s scrapes, 15 days / 5 GB); receives k6 results by remote write |
| `grafana` | Dashboards on 3200 (prod: `https://dev.mindspear.app/grafana/`), provisioned from `monitoring/grafana/` |
| `cadvisor` | Per-container CPU, memory, network, restarts, out-of-memory kills, labelled with the compose project and service |
| `node-exporter` | Host CPU, memory, load, disk |
| `postgres-exporter`, `redis-exporter` | Database statistics; Redis also gives the Laravel queue lengths (`redis_key_size` of `mindspear_database_queues:<queue>`, recorded as `mindspear:queue_depth:jobs`) |

- **Networks**: scraping runs on a private `monitoring` network; only the two database exporters join the app's network (`APP_NETWORK`: `mindspear_mindspear` in dev, `mindspear-prod_mindspear` in prod).
- **Settings**: `monitoring/.env` (template `monitoring/.env.example`). Every value has a dev default, so dev needs no `.env`; prod sets the Grafana sub-path, the admin password and the database credentials.
- **Targets** are files in `monitoring/prometheus/targets/` (file-based discovery: no restart); dashboards are JSON in `monitoring/grafana/dashboards/<folder>/` (read-only in the UI). Home dashboard: **MindSpear overview**.
- **Load tests** (`load-tests/README.md`): `load-tests/run.sh <script>` runs a k6 script in a `grafana/k6` container and pushes the results to Prometheus tagged with a `testid`; they show in the Grafana folder **load-tests**. Scripts: `smoke/health.js` (is the stack up), `api/dashboard.js` (signed-in reads at a steady rate) and `live/quiz-session.js` (a host runs a quiz while `PARTICIPANTS` phones join by code, hold a Reverb websocket and react to its events the way the participant app does; it creates and deletes its own quiz). Settings and the load-test account go in `load-tests/.env`, or `load-tests/.env.server` for dev.mindspear.app (`ENV_FILE=.env.server`). One test machine is one IP: the per-IP limits allow about 700 participants, and one Reverb process about 1,000 connections (no event-loop extension installed); see `load-tests/README.md`. Every script has thresholds, so a failed run exits non-zero.

### Config files to know
| File | Purpose |
|------|---------|
| `backend/config/deck.php` | Deck engine: route prefixes per product, debounce windows, quiz scoring defaults, join codes, option limits, emoji avatars, profanity list |
| `backend/config/file_library.php` | Quota, per-file limits, allowed extensions, extraction limits |
| `backend/config/reverb.php`, `backend/config/broadcasting.php` | Reverb server and broadcaster |
| `backend/config/cors.php` | Allowed origins (`CORS_ALLOWED_ORIGINS`, falls back to `FRONTEND_URL` + localhost:2000) |
| `backend/config/auth.php`, `backend/config/sanctum.php`, `backend/config/permission.php` | Guards (`web` session, `api` Sanctum), Sanctum, Spatie tables |
| `backend/config/services.php`, `backend/config/filesystems.php` | OAuth credentials; storage disks |
| `frontend/next.config.ts` | `/join` → `/play` redirect, proxy rewrites, standalone output, image domains |
| `frontend/tailwind.config.ts` | Tailwind theme (palette from `frontend/src/config/theme.ts`) |
| `frontend/tsconfig.json` | Strict TypeScript, `@/*` path alias |
| `ai-server/app/config.py` | AI server settings (env) |
| `docker-compose.prod.yml`, `deploy/nginx/dev.mindspear.app.conf` | Production stack, and the host nginx site that routes the domain to it (including `/grafana/`) |
| `monitoring/docker-compose.yml`, `monitoring/.env.example` | Monitoring stack and its settings |
| `monitoring/prometheus/prometheus.yml`, `monitoring/prometheus/targets/`, `monitoring/prometheus/rules/` | Scrape jobs, scrape targets, recording rules |
| `monitoring/grafana/provisioning/`, `monitoring/grafana/dashboards/` | Grafana datasource and dashboards as code |

---

## 13. What Does NOT Exist Yet

| Area | Status | Notes |
|------|--------|-------|
| **Bank → deck** | Not built | Banks are standalone: no import of bank questions/tasks into a quiz or quest, and no "save slide to bank". Bank items use v1 type names, so this needs a mapping to slide types (§4.12). |
| **Quest task bank UI** | API only | Routes exist under `/quest/task-bank`; there are no frontend pages. |
| **Host reports / exports** | Not built | No per-session report page for hosts beyond the presenter's end screen, and no CSV / Excel / PDF export (the v1 reports were removed). |
| **Survey** | Removed | No survey product or replacement. |
| **Scheduled / self-paced decks** | Not built | Deck sessions are live and host-paced only; Fun Games are the self-paced format. |
| **Role-based API access** | Not built | Roles only gate Filament; API routes check ownership, never roles (§11). |
| **Payment / billing backend** | Frontend only | `/plans` and `/billing` are static views; no payment or subscription API. |
| **CI/CD** | Not configured | No pipeline configuration in the repository. |
| **Alerting** | Not configured | Monitoring has no alert rules or receivers. Slots: `monitoring/prometheus/rules/` + the commented `alertmanager` service, or `monitoring/grafana/provisioning/alerting/`. |
| **Application metrics** | Not built | No `/metrics` in Laravel or FastAPI and no nginx / php-fpm exporters; monitoring sees containers, the host and the databases. New targets go in `monitoring/prometheus/targets/apps/`. |
| **Logs in Grafana** | Not built | No Loki; logs are read with `docker compose logs`. |
| **Frontend tests** | None | Backend: Pest; AI server: pytest. |
| **Push notifications** | Not implemented | The participant service worker does not handle push. |
| **Internationalisation** | Not implemented | English only. |
| **API documentation** | Not generated | No OpenAPI; this guide and the route files are the reference. |

---

## Appendix: Quick Reference for Common Tasks

### Adding a New Slide Type

A small, complete example to copy: `backend/app/Deck/Slides/Types/Quiz/TrueFalseSlideType.php` + `frontend/src/features/deck-editor/slides/trueFalse/`.

**Backend**
1. Create a class in `backend/app/Deck/Slides/Types/Quest/`, `backend/app/Deck/Slides/Types/Quiz/` or `backend/app/Deck/Slides/Types/Content/`, extending `AbstractSlideType` (quest answer types; products default to `['quest']`), `AbstractQuizType` (scored quiz types: `['quiz']`, `hidden_until_reveal`) or `ContentSlideType` (both products, no answers).
2. Implement `key()` (unique snake_case, ≤ 40 characters), `category()`, `revealModel()` and whatever applies: `defaultConfig()`, `defaultOptions()`, `validateConfig()`, `validateAnswer()`, `score()`, `aggregate()` (pure). Keep answer keys out of the participant view (`privateConfigKeys()`, `privateOptionPayloadKeys()`; add extras through `participantExtras()`).
3. Nothing to register: `DeckServiceProvider` discovers the class. Add `TakesMedia` / `AppendsSubmissions` if the type needs media or several submissions.
4. If it has options, add its min / max to `option_limits` in `backend/config/deck.php`.
5. Add a test next to the others in `backend/tests/Feature/Deck/` (e.g. `backend/tests/Feature/Deck/Quiz/TrueFalseTypeTest.php`).

**Frontend**
6. In `frontend/src/features/deck/types.ts`: add the key to its union and key list (`QuestionSlideTypeKey` / `QuizSlideTypeKey` / `ContentSlideTypeKey` and the `*_SLIDE_TYPE_KEYS` arrays), its shapes to the per-type maps (`SlideConfigMap`, `AnswerPayloadMap`, `StoredAnswerMap`, `SlideAggregateMap`, …) and its option limits to `DECK_LIMITS`.
7. Create `frontend/src/features/deck-editor/slides/<camelCaseKey>/` with the same files as `frontend/src/features/deck-editor/slides/trueFalse/` — `Editor.tsx`, `Presenter.tsx`, `Participant.tsx` and `index.ts` (`export const entry = defineSlideType({...})`) — reusing `frontend/src/features/deck-editor/slides/shared/`.
8. Import the entry in `frontend/src/features/deck-editor/slideRegistry.ts` and add it to `ENTRIES` (picker order). In development a console error flags a registry that does not match `SLIDE_TYPE_KEYS`.
9. Optional: AI generation (a `QuestionType` in `ai-server/app/generation/targets/quiz.py` or `ai-server/app/generation/targets/quest.py`, plus labels and a mapper in `frontend/src/features/ai-generate/`), and Fun Games import if it is a single-answer choice type (`ImportService`).

### Adding a New API Endpoint

- **Quiz / quest**: add the route inside `DeckRoutes::authoring()` or `DeckRoutes::sessions()` in a file in `backend/routes/deck/` (new files there are loaded automatically). It is registered for both products unless you pass `['quiz']` or `['quest']`; constrain ids with `whereNumber()`; host routes use `auth:sanctum` + `throttle:deck-author`, participant write routes `deck.participant`. Extend `DeckController` to get `product()`, `ownedDeck()`, `ownedSession()`, `sessionRun()`. On the frontend add the call to the matching file in `frontend/src/features/deck/api/`, built on `authoringBase(product)` / `sessionsBase(product)`, and its types to `frontend/src/features/deck/types.ts`.
- **Core endpoints**: a controller in `backend/app/Http/Controllers/api/v1/` extending `ApiBaseController`, a request extending `BaseFormRequest` in `backend/app/Http/Requests/`, and a route file in `backend/routes/api/v1/` that you `require` in `backend/bootstrap/app.php` (core route files are not auto-discovered). Call it through `api` / `axiosInstance` from `frontend/src/utils/axiosInstance.ts`.
- **Module endpoints**: the module's route file, `backend/app/Modules/FunGame/routes.php` or `backend/app/Modules/FileLibrary/routes.php`.

### Adding a New Migration

1. Pick the folder: `backend/database/migrations/` (core), `backend/database/migrations/Deck/` (deck engine) or `backend/app/Modules/<Module>/Database/Migrations/` (module). Use `backend/database/migrations/Quiz/` or `backend/database/migrations/Quest/` only for the banks; never extend the legacy v1 tables.
2. `php artisan make:migration <name> --path=database/migrations/Deck` (or the module path). Every folder above is already loaded by a provider.
3. Write for PostgreSQL (`jsonb`, `timestampTz`, raw SQL where needed) and run `php artisan migrate`.

### Adding Frontend State

The Redux store holds only `auth`. Prefer state in feature hooks. If something truly app-wide is needed, add its reducer to `rootReducer` in `frontend/src/stores/store.ts`, and add its key to `persistConfig.whitelist` only if it must survive reloads.

### Adding a Monitoring Target or Dashboard

- **Target**: the exporter or `/metrics` endpoint must be reachable on the `monitoring` network. Add `monitoring/prometheus/targets/apps/<name>.yml` (`- targets: ["<host>:<port>"]` with `labels: {job: <name>}`); Prometheus picks it up within a minute, no restart. Check it at http://localhost:9090/targets.
- **Dashboard**: commit its JSON as `monitoring/grafana/dashboards/<folder>/<name>.json` with the datasource uid `prometheus`. Community dashboards from grafana.com: add the id to `monitoring/scripts/fetch-dashboards.sh` and run it. Details in `monitoring/README.md`.
- **Recording or alert rule**: a file in `monitoring/prometheus/rules/`, checked with `promtool`, then `curl -X POST http://127.0.0.1:9090/-/reload`.

### Adding a Filament Resource

Create it in `backend/app/Filament/Resources/`; `AdminPanelProvider` discovers it. The panel uses the `web` guard and is limited to the Super Admin role.
