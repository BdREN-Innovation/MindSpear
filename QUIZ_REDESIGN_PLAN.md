# MindSpear Quiz Redesign — Slide-Based Quiz (AhaSlides Parity)

> **Goal.** Rebuild the Quiz module so authoring, hosting, and participation feel indistinguishable from AhaSlides. Slide-based editor, Quiz-specific scored question types, time-weighted scoring with per-slide min/max, QR join, 5-second "Get ready" countdown, animated results, emoji-avatar participants, global leaderboard slide.
>
> **Strategic role.** Quiz v2 is **additive to Quest v2**. Quest v2 (see [QUEST_REDESIGN_PLAN.md](QUEST_REDESIGN_PLAN.md)) ships first and introduces the shared slide engine — tables, slide-type registry, state machine, editor shell, presenter shell, and PWA participant shell. Quiz v2 reuses all of that and adds only what is Quiz-specific: scored slide types, a time-weighted scoring service, the `hidden_until_reveal` state-machine variant, the Leaderboard slide, and product-scoped editor/presenter/participant behaviour. This is a deliberate flip from the original ordering and shortens Quiz v2 dramatically.
>
> **Out of scope (for now).** Anything the shared engine already provides (see Quest v2 plan). Also skipped within Quiz: unscored types (Poll, Word Cloud, Q&A, Rating, 100 Points, Matrix, Pin on Image — those ship with Quest v2 and stay product-scoped to Quest), emoji reactions, audience chat, templates marketplace, full Spinner Wheel prediction/scoring mode.
>
> **Amendments (2026-10-17, user-confirmed).** This plan predates the built Quest v2 engine, My Files and the AI wizard. Where this section disagrees with the text below, this section wins.
> - **Legacy quiz stays.** Quiz v2 is live-hosting only. Legacy Quiz v1 keeps self-paced / exam attempts (`quiz_mode`, `/attempt/...`), the question bank, quiz reports, Discover / public templates and the Fun Games "import a quiz from My Library". §4.4 no longer deletes legacy tables; it only lists what must exist in v2 before any removal is considered.
> - **Fun Games stays separate.** Quiz v2 is the slide-based AhaSlides-style quiz on the deck engine; Fun Games remains its own game mode with its own scoring/timer services. No shared code now.
> - **AI generation is in scope.** New `quiz_v2` target in `features/ai-generate` writing scored v2 slides (pick_answer_single/multi, short_answer, correct_order, match_pairs, categorise) through `POST /quizzes/{id}/slides/bulk`. The wizard UI is the existing `DocumentToQuestionsWizard` (same as the current quiz). Legacy quiz AI stays unchanged.
> - **Create modals.** Dashboard "Create a new quiz" (existing modal) and a new "Create a new quest" modal both offer a Blank card and a big "AI Generate (From a File)" card. When the user's v2 flag is on they create v2 decks; otherwise the legacy flows run. This replaces Quest's small "Or generate from a file" pill.
> - **Engine alignment.** States reuse the built engine: Quiz's "answering" = `voting`; Quiz adds `reveal` (waiting → get_ready → voting → reveal → next). Positions are 1-based (a new deck's `qr_code` slide is position 1). Images use My Files (`slide_options.image_file_id`, `slides.media_file_id`). Routes use `DeckRoutes` with prefixes `quizzes` / `quiz-sessions` and product `quiz`. Feature flag `users.quiz_v2_enabled` (+ `QUIZ_V2_DEFAULT_ENABLED`), gated exactly like `quest_v2_enabled`. PostgreSQL only; migrations dated after the latest Deck migration.
>
> **Scope confirmed with user.**
> - Quiz v2 only; Quest v2 ships first and delivers the shared primitives.
> - Greenfield Quiz v2 data — no migration from legacy Quiz v1.
> - Build Quiz v2 alongside legacy Quiz v1. Do **not** drop legacy `quizes` / `questions` / `quiz_sessions` / etc. until Quiz v2 is default and stable.
> - Quiz v2 slide types: Pick Answer (single + multi), Short Answer (scored), Match Pairs, Correct Order, Categorise, plus a simplified Spinner Wheel engagement slide, Leaderboard slide, and the shared Content/Heading/QR Code slides (already available from Quest v2).
> - Per-slide min/max points with time-based interpolation (AhaSlides model), plus a global Leaderboard slide.
> - Core quiz experience only — no emoji reactions, chat, hand-raise, live feedback screen.
>
> **Relationship to other plans.**
> - [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) — Phases 0–3 done (Reverb live, Socket.IO gone, public/private channels, participant tokens). This plan uses the existing `LiveSessionService`, `LiveAggregateService`, `ParticipantTokenService`, and generic `LiveBroadcastEvent`.
> - [QUEST_REDESIGN_PLAN.md](QUEST_REDESIGN_PLAN.md) — Delivers the shared slide engine before this plan starts. Every time this document references `decks`, `slides`, `slide_options`, `deck_sessions`, `deck_session_slide_runs`, `deck_participants`, `deck_participant_answers`, `SlideTypeRegistry`, the deck-editor components, the presenter shell, or the PWA participant shell, those were built in the Quest plan and this plan consumes them.
>
> **Database decision.** PostgreSQL everywhere (local dev and tests included) — the deck engine and file library use PostgreSQL-only features.
>
> **Cutover decision.** Quiz v2 is built alongside Legacy Quiz v1 and becomes the default for **live hosting** only. Legacy tables are NOT dropped (see Amendments and §4.4).

---

## Architectural shape

### What Quest v2 already delivers (consumed here)

All of the following is *provided* by Quest v2 and reused verbatim by Quiz v2:

- **Shared tables:** `decks` (with `product` discriminator), `slides`, `slide_options`, `deck_sessions`, `deck_session_slide_runs`, `deck_participants`, `deck_participant_answers` (all columns incl. the Quiz-relevant nullables `points_min`/`points_max`/`speed_bonus_enabled`/`get_ready_seconds` on `slides` and `is_correct` on `slide_options`, `total_points` on `deck_participants`, `is_correct`/`points_awarded` on `deck_participant_answers`).
- **Slide type registry** (`app/Deck/Slides/SlideTypeRegistry.php`) with `SlideTypeContract` and the five hooks. Quiz v2 registers new types with `products: ['quiz']`.
- **Session slide snapshots** — authoring slides are copied into `deck_session_slide_runs` at session start; all runtime reads go through the snapshot.
- **State versioning** on slide runs (`state_version` increments per transition; stale delayed jobs no-op).
- **Event routing** — typed payload DTOs + `LiveBroadcastEvent`. Channels: `session.quiz.{publicChannelKey}` (public), `host.quiz.v2.{sessionId}` (private during coexistence).
- **Participant token flow** — raw token returned once, SHA-256 hash stored, `X-Participant-Token` header on answer submissions.
- **Editor shell** (`features/deck-editor/`) with three-panel layout, slide rail, center canvas, tabbed inspector, `SlidePicker` modal, autosave, DnD reorder, keyboard shortcuts.
- **Presenter shell** with QR sidebar, top join banner, bottom host control bar, keyboard nav, Echo subscriptions.
- **PWA participant shell** with manifest, service worker, install prompt, safe-area layout, sheet modals, haptics, emoji avatar picker, keyboard-aware inputs.
- **Reconnect/resync** (`useSessionChannel`, `useHostChannel`, `useSessionSync`, `GET /{deck}-sessions/{id}/state`).
- **Curated ~40-emoji avatar list** + `GET /api/v1/meta/emoji-avatars`.
- **Join-code generator** (6-char A-Z 2-9).

Quiz v2 does **not** re-implement any of that.

### What Quiz v2 adds

1. **Quiz-specific slide types** — `pick_answer_single`, `pick_answer_multi`, `short_answer` (scored), `match_pairs`, `correct_order`, `categorise`, `spinner_wheel`, `leaderboard`. Each implements `SlideTypeContract` with `products: ['quiz']` and `revealModel: 'hidden_until_reveal'` (except `leaderboard` which is `none`, and `spinner_wheel` which is special — see §3.7).
2. **`hidden_until_reveal` state machine variant** — the shared engine already exposes a `revealModel` field. Quiz v2 supplies the engine logic that honours it: during `answering`, aggregate broadcasts go **only** to the private host channel; the public channel sees only a submitted-count. A new state `reveal` is reached when the host clicks Reveal or the timer ends, at which point the correct answer + public aggregate + reveal payload broadcasts on the public channel.
3. **Scoring service** — `app/Services/Deck/ScoringService.php`. Delegates to each slide type's `score()`. Time-weighted linear interpolation between `points_min` and `points_max`. Partial credit for match / order / categorise; multi-select is all or nothing. Zero for wrong.
4. **Leaderboard slide type + `LeaderboardService`** — `Top N` snapshot with `points_delta` per player (for the "+94" animation). Broadcasts on `leaderboard.updated` event. Cached in Redis per slide transition.
5. **Reveal UI** — per-type `Presenter` components render a `reveal` state: correct-answer markers, bar chart with option images, animated score totals.
6. **Quiz product scoping** — `/api/v1/quizzes/*` routes that filter the shared services to `product=quiz` and reject non-Quiz slide types at creation.
7. **Cutover of legacy Quiz v1** — feature flag, route deprecation, table drops.

### Slide type catalog (Quiz v2)

All registered with `products: ['quiz']` (except shared content types, which are `['quest','quiz']` and already registered by Quest v2). Reveal model = `hidden_until_reveal` unless noted.

| Type key | Scored? | Options? | Participant UI | Notes |
|---|---|---|---|---|
| `pick_answer_single` | Yes | 2–10 | Tap one option | Image + text per option |
| `pick_answer_multi` | Yes | 2–10 | Tap multiple + Submit | All or nothing: exact correct set only |
| `short_answer` | Yes | 1–5 accepted strings | Text input + Submit | Case-insensitive match (configurable), trim, collapse whitespace, exact-compare. No fuzzy match in v1. |
| `match_pairs` | Yes | 2–8 pairs | Drag/tap to connect | Right column shuffled per participant (seed = participant_id + slide_id) |
| `correct_order` | Yes | 3–8 items | Drag to reorder | Shuffled on mount, same seeded-shuffle pattern |
| `categorise` | Yes | 2–5 categories, 4–20 items | Drag items into buckets | |
| `spinner_wheel` | No in v1 | 2–12 options | View-only during spin | See §3.7 |
| `leaderboard` | — | — | Read-only | Top N ranked by `total_points`; can be inserted anywhere in the deck (reveal model `none`) |

Content slides (`heading`, `paragraph`, `bullets`, `numbered`, `quote`, `image`, `video`, `big_text`, `qr_code`) come from Quest v2 registered as `['quest','quiz']` — directly usable.

### Live session state machine (Quiz — `hidden_until_reveal`)

```
waiting          ← host navigated to slide, hasn't started it
  ↓ host clicks Start
get_ready        ← 5s countdown overlay (default ON for Quiz; configurable per deck)
  ↓ auto
answering        ← timer from slide.time_limit_seconds; aggregate broadcasts private only
  ↓ timer end OR host clicks Reveal OR all eligible participants submitted
reveal           ← correct answer + full aggregate broadcast public; host sees Next
  ↓ host advances
(next slide)
```

This is the same shape as Quest's state machine, but with an extra `reveal` state and different broadcast visibility during `answering`. The shared state-machine service already handles both by dispatching on `revealModel`.

### Scoring model (time-weighted, per-slide)

Author sets `points_min`, `points_max`, `speed_bonus_enabled` per slide.

```
if speed_bonus_enabled:
  ratio = max(0, (time_limit - time_to_answer_seconds) / time_limit)
  points = points_min + ratio * (points_max - points_min)
else:
  points = points_max
```

- Wrong answer → `0`
- Multi-select is all or nothing (user decision 2026-10-17): full points (with the usual speed-bonus interpolation) only when the selected set equals the correct set exactly; any subset or superset (including selecting every option) scores `0`, `isCorrect` false, `partialCreditRatio` 0. No `partial_credit` setting (an old one is accepted and dropped).
- Match pairs: `points * (correct_pairs / total_pairs)`
- Correct order: exact match = full; else `points * (items_in_correct_position / total)`
- Categorise: `points * (items_in_correct_category / total)`
- Short answer: full points on match, zero otherwise (no partial)
- Spinner wheel: zero in v1 (engagement-only)

The participant screen's "50p ──── 100p" progress bar animates the current earnable `points` in real time as the timer counts down.

### Auth model

Unchanged — `deck_participants` already carries `display_name`, `emoji_avatar`, `participant_token_hash`, `total_points`. Quiz v2 just uses the Quiz-populated columns.

---

## Phase 1 — Backend: Quiz-specific types + scoring

**Goal.** Register Quiz slide types against the shared engine; implement scoring + reveal logic.
**Duration.** 2–3 days.

### 1.1 Slide type implementations

Under `app/Deck/Slides/Quiz/`, one class per type implementing `SlideTypeContract`:

- `PickAnswerSingleType`
- `PickAnswerMultiType`
- `ShortAnswerScoredType`
- `MatchPairsType`
- `CorrectOrderType`
- `CategoriseType`
- `SpinnerWheelType`
- `LeaderboardType`

Each declares:
- `products(): ['quiz']`
- `revealModel(): 'hidden_until_reveal'` (except `LeaderboardType` → `'none'`)
- `defaultConfig()` — Quiz-appropriate defaults (see §1.2)
- `validateConfig()` / `validateAnswer()`
- `score()` — the real work; each type's rule from the scoring formula section
- `aggregate()` — counts / correct-incorrect breakdown for reveal payloads
- `serializeForParticipant()` — **must strip `is_correct`**, plus for `correct_order` must return a seeded-shuffled option order, for `match_pairs` must shuffle the right column

Register in a new `QuizDeckServiceProvider` (thin; just pushes entries into the existing registry).

### 1.2 Per-type default configs

Registry seeds these on slide creation:

| Type | Defaults |
|---|---|
| `pick_answer_single` | 2 empty options, 20s time, 50/100 points, speed bonus on, get_ready inherits deck |
| `pick_answer_multi` | 3 empty options, 30s time, 50/100 points (all-or-nothing scoring) |
| `short_answer` | 1 empty accepted answer, 30s, 50/100, case-insensitive match |
| `match_pairs` | 3 empty pairs, 45s, 50/100 |
| `correct_order` | 4 empty items, 30s, 50/100 |
| `categorise` | 2 empty categories + 4 items, 45s, 50/100 |
| `spinner_wheel` | 4 options, no time limit, no points in v1 |
| `leaderboard` | `top_n: 10` |

### 1.3 ScoringService

`app/Services/Deck/ScoringService.php`:

```php
class ScoringService {
    public function __construct(private SlideTypeRegistry $types) {}

    public function score(DeckSessionSlideRun $run, array $answerPayload, int $timeToAnswerMs): ScoreResult
    {
        $type = $this->types->for($run->type_snapshot);
        return $type->score($answerPayload, $run->config_snapshot, $timeToAnswerMs);
    }
}
```

Called synchronously from the answer-submission controller (Phase 3 of Quest plan already built). Updates `deck_participants.total_points` in the same transaction.

`ScoreResult` is a small readonly value object: `{ pointsAwarded, isCorrect, partialCreditRatio }`.

### 1.4 LeaderboardService

`app/Services/Deck/LeaderboardService.php`:

```php
public function currentTopN(DeckSession $session, int $n): Collection;  // rank, display_name, emoji_avatar, total_points, points_delta
public function pointsDeltaAfterSlideRun(DeckSession $session, DeckSessionSlideRun $run): array;  // participant_id → delta
```

Cache each snapshot in Redis keyed `leaderboard:deck_session:{id}:after:{run_id}`, TTL 1h. Rebuild on miss — don't replay incrementally.

Emits `leaderboard.updated` via `LiveBroadcastEvent` on every `reveal → done` transition. Payload includes per-participant `points_delta` for the "+94" animation on the next Leaderboard slide.

### 1.5 Reveal payload contract

On `answering → reveal` transition, the shared state-machine service delegates to the slide type's `aggregate()` and broadcasts:

```json
{
  "slide_run_id": 42,
  "type": "pick_answer_single",
  "aggregate": {
    "option_counts": [{"option_id": 1, "count": 77}, ...],
    "total_answers": 158,
    "correct_option_ids": [4]
  },
  "leaderboard_delta": [{"participant_id": 9, "points_delta": 94, "new_total": 94, "new_rank": 1}],
  "server_time": "..."
}
```

Participant-specific correctness comes via `GET /api/v1/quiz-sessions/{id}/slide-runs/{runId}/my-answer` (endpoint lives on shared controllers; participant-token auth). Payload: `{ is_correct, points_awarded, your_answer_payload }`. Keeps the broadcast small and avoids leaking per-participant data to others.

### 1.6 Broadcast visibility during `answering`

Shared state-machine service reads `revealModel` from the type and decides:

- `live_aggregate` (Quest): broadcast `slide.aggregate.updated` on public channel, debounced 500ms
- `hidden_until_reveal` (Quiz): broadcast only on private host channel; public channel sees only `submitted_count` deltas (no per-option counts)
- `moderated_feed` (Q&A): existing Quest flow

This gate exists in Quest plan §1.6 as an open hook; Quiz v2 is the first concrete consumer that needs it, so implementation lands here.

### 1.7 Tests (Pest, PostgreSQL)

For every Quiz slide type:
- `score()` truth table — full marks, wrong, partial, empty, malformed
- `validateAnswer()` rejects: unknown option IDs, wrong shape, values out of range
- `serializeForParticipant()` asserts no `is_correct` leak
- `aggregate()` determinism — same inputs → same output
- `hidden_until_reveal` assertion — during `answering`, public channel receives only `{submitted_count}` events; private host receives full per-answer events
- Reveal transition — correct payload emitted; `my-answer` endpoint returns participant-specific correctness

**Phase 1 exit criteria:** all Quiz slide types registered, unit tests green, Tinker smoke test creates a Quiz-product deck and scores a round-trip answer.

---

## Phase 2 — Backend: Quiz product scoping + endpoints

**Goal.** `/api/v1/quizzes/*` routes that wrap the shared services, scoped to `product=quiz`.
**Duration.** 2 days.

### 2.1 Endpoints

Thin wrappers around the shared deck controllers; enforce `decks.product = 'quiz'` and reject creation of Quest-only slide types.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/quizzes` | Create empty Quiz-product deck with one `qr_code` slide at position 0 |
| `GET` | `/api/v1/quizzes` | List user's quizzes (paginated) |
| `GET` | `/api/v1/quizzes/{id}` | Full quiz + slides + options |
| `PATCH` | `/api/v1/quizzes/{id}` | Update title / settings / cover |
| `DELETE` | `/api/v1/quizzes/{id}` | Soft-delete |
| `POST` | `/api/v1/quizzes/{id}/duplicate` | Clone entire quiz |
| `POST` | `/api/v1/quizzes/{id}/slides` | Append slide of given type (registry-validated) |
| ... | (all shared slide/option CRUD endpoints) | Same shape as Quest plan §2.1, `product=quiz` scoped |
| `POST` | `/api/v1/quizzes/{id}/sessions` | Start a session → `{session_id, join_code, public_channel_key}` |
| `GET` | `/api/v1/quiz-sessions/{id}/state` | Full resync snapshot |
| `POST` | `/api/v1/quiz-sessions/{id}/advance` | Host transitions (adds `reveal` action compared to Quest) |
| `POST` | `/api/v1/quiz-sessions/{id}/end` | End session early |
| `POST` | `/api/v1/quiz-sessions/{id}/participants/join` | Anonymous join |
| `POST` | `/api/v1/quiz-sessions/{id}/slide-runs/{runId}/answers` | Submit answer |
| `GET` | `/api/v1/quiz-sessions/{id}/slide-runs/{runId}/my-answer` | Participant's own correctness + points |
| `GET` | `/api/v1/quiz-sessions/{id}/leaderboard` | Top N with rank + delta |

### 2.2 Advance action additions

The shared advance endpoint accepts `action`. Quest uses `start_voting | close_voting | next_slide | previous_slide | jump_to`. Quiz adds **`reveal`** — manual short-circuit of the answering timer. Server validates legal transitions; illegal transitions return 409.

### 2.3 Answer submission response

Matches Quest: `204 No Content`. No correctness info in the response. Client calls `/my-answer` after reveal.

### 2.4 Feature flag

Add `quiz_v2_enabled` boolean to `users` table (or global config). Routes are mounted regardless; only the frontend "New Quiz" button and deep links are gated by the flag. This lets beta users co-exist with v1 users cleanly.

**Phase 2 exit criteria:** Pest collection creates a Quiz deck, appends every Quiz type, edits, reorders, starts a session, submits answers, advances through reveal → leaderboard update → next slide — all green on PostgreSQL.

### Implementation notes (Quiz Phases 1–2, done 2026-10-17)

Phases 1 and 2 are built on the Quest v2 engine and pass on PostgreSQL: the full backend suite is green (1,133 tests), including `tests/Feature/Deck/Quiz/*` (the type, scoring and leaderboard tests, plus `QuizFeatureFlagTest`, `QuizAuthoringApiTest`, `QuizSessionApiTest` and `QuizV2EndToEndTest` for the engine and HTTP layer). `QuizV2EndToEndTest.php` is the exit test above, through the HTTP API only: it creates a quiz, appends all 8 quiz types, edits them (labels, `is_correct`, payloads, config, points), duplicates and reorders slides, starts a session, has 3 participants answer every scored type, reveals by all-answered, by the host and by the timer, checks both leaderboard slides, spins the wheel, ends the session and reads the review. Where the code differs from §1–§2, **the code is the contract** for Phases 3–4.

**Where things live (backend/).**
- Types (Phase 1): `app/Deck/Slides/Types/Quiz/*` (8 types + `AbstractQuizType`, `QuizOptions`, `Evaluation`; class docblocks hold every config / answer / aggregate shape). Scoring: `app/Deck/Scoring/{ScoringService, QuizScoring, LeaderboardService}.php`.
- Engine (Phase 2): `app/Deck/Sessions/QuizRuntime.php` (everything the engine needs from scoring / leaderboard in one place), `SessionStateMachine` (reveal, spinner, leaderboard broadcast, auto-reveal), `SessionLauncher` (snapshots), `Participants/AnswerSubmissionService` (scoring on submit), `Services/Live/LiveAggregateService` (broadcast gating, `broadcastRevealed`), payloads in `app/Deck/Broadcasts/Payloads/{SubmittedCountUpdated, SlideRevealed, LeaderboardUpdated, SpinStarted}Payload.php` + `PublishSize`, `Http/Controllers/LeaderboardController.php`, `Http/Requests/Authoring/QuizFields.php`.
- Routes: `routes/deck/quiz_{authoring, media, sessions, participants, review}.php` (`DeckRoutes::…(…, ['quiz'])`); the `quest_*.php` files are now registered for `['quest']` only. Config: `config/deck.php` → `routes.quiz`, `quiz_v2_default_enabled`, the `quiz` block (`get_ready_seconds` 5, `scoring` 50/100/on, `spin_seconds` 3, `leaderboard_size` 10, `leaderboard_max` 100, `reveal_leaderboard_limit` 10) and quiz rows in `option_limits`.
- Migration `database/migrations/Deck/2026_10_20_000001_add_quiz_v2_enabled_to_users.php`; Filament → Users → Features → "Quiz v2"; `GET /api/v1/profile/show` returns `data.profile.quiz_v2_enabled` (effective value).

#### Decisions taken
- **Sessions prefix is `/api/v1/quiz-sessions/v2`, not `/quiz-sessions`.** Legacy Quiz v1 still serves `GET /api/v1/quiz-sessions/{id}/state` (and `POST …/change-question`); the same path for v2 would shadow it (numeric ids of both tables overlap). Authoring stays `/api/v1/quizzes` (legacy is `/quizes`). Frontend: `DECK_ROUTES.quiz = { authoring: "/quizzes", sessions: "/quiz-sessions/v2" }`.
- **Rollout flag** exactly like Quest: `users.quiz_v2_enabled` or `QUIZ_V2_DEFAULT_ENABLED`; 403 `{message: "Quiz v2 is not enabled for your account.", data.code: 'feature_disabled'}` on every `/quizzes` route and on host advance / end / host state / host aggregate / host leaderboard. Participants are never gated.
- **States.** Answering = `voting`; new terminal state `reveal` (`DeckSessionSlideRun::STATE_REVEAL`). Quiz runs never end in `closed`.
- **Get ready.** Quiz decks default `settings.get_ready_seconds` to 5 (null resets to 5), new answer slides are seeded with it, and at session start a quiz answer slide whose `get_ready_seconds` is null gets 5. An explicit 0 means off.
- **Scoring** happens synchronously on submit (`ScoringService` with `config_snapshot.scoring`), stored in `deck_participant_answers.is_correct / points_awarded` only. **Answers are final** (review fix): a second submit on a scored quiz run is 409 `invalid_state` `data.reason: 'already_answered'` and the first answer keeps its points. `deck_participants.total_points` (0 at join for quiz) moves **only at the reveal** (`QuizRuntime::applyRevealedPoints`, one UPDATE in the reveal transaction), so standing, leaderboards, `leaderboard_delta` and my-answer totals only ever reflect revealed runs. Quest answers are never scored (columns stay null) and Quest re-submissions still replace / merge.
- **Auto-reveal**: after each accepted answer commits (and after a participant leaves), the run reveals when every participant still in the room (`left_at` null) has an answer on it.
- **Leaving an active quiz run** (next / previous with `force` / jump / end) reveals it (broadcasting `slide.revealed`) instead of closing it. `close_voting` on a quiz run is the same as `reveal`.
- **Spinner**: `start_voting` calls `SpinnerWheelSlideType::spin()` (weighted), stores the result in `config_snapshot._spin` (the `_` keeps it out of the participant config), goes to `voting` with `time_limit_seconds` = `ceil(spin_duration_ms / 1000)` (fallback `deck.quiz.spin_seconds`) and reveals itself at the deadline (`TransitionSlideRunJob` / `syncDue`), or on `reveal`. It takes no answers (409 `no_answers`).
- **Leaderboard slide** is a content-kind run (navigation only). Becoming current broadcasts `leaderboard.updated`; size = `LeaderboardSlideType::limit(config)` (`top_n`, or 50 with `show_all_participants`). Ranks share ties (1, 2, 2, 4); `points_delta` is from the latest revealed scored run at or before the current slide.
- **Authoring hooks wired**: `defaultSlideAttributes()` seeds new quiz slides (time limit per type unless the deck sets `default_time_limit`, `points_min` 50, `points_max` 100, `speed_bonus_enabled` true; spinner / leaderboard / content: null), `validateOptionPayload()` normalises option payloads on add / edit / bulk (errors keyed `payload.<key>`).

#### Endpoint table
Authoring: `/api/v1/quizzes` (Sanctum + `throttle:deck-author` + `deck.feature`, names `deck.quiz.*`). Same rows, request and response shapes as the Quest authoring table (QUEST_REDESIGN_PLAN.md "Implementation notes (Phases 2–3)"), including media / cover / option image and `POST /{deck}/sessions`, with these differences:

| Method | Path | Quiz difference |
|---|---|---|
| POST | `/` | default title "Untitled quiz"; `settings.get_ready_seconds` defaults to 5 |
| POST | `/{deck}/slides` | quiz + content types only (Quest-only types → 422 `unsupported_type`); seeds `timeLimitSeconds` (pick single 20, multi / short / order 30, match / categorise 45), `getReadySeconds` (deck, 5), `pointsMin` 50, `pointsMax` 100, `speedBonusEnabled` true |
| PATCH | `/{deck}/slides/{slide}` | also `points_min?`, `points_max?` (int 0..1000 \| null), `speed_bonus_enabled?` (bool \| null). min ≤ max is checked against the stored values (422 on the field sent). Unscored types (spinner, leaderboard, content) → 422 "This slide type is not scored." null = default at session start |
| POST / PATCH | `/{deck}/slides/{slide}/options[/{option}]` | also `is_correct?` (bool \| null). Payload goes through the type's `validateOptionPayload()`: match_pairs `{side: left\|right, pair_key}`, categorise `{correct_category_key}`, spinner `{weight?: 0.1..100}` (422 `payload.side` …) |
| POST | `/{deck}/slides/bulk` | also `slides.N.points_min / points_max / speed_bonus_enabled` and `slides.N.options.M.is_correct`; errors `slides.N.points_min`, `slides.N.options.M.payload.side`, … ; all or nothing |

On **Quest** routes the quiz-only fields answer 422 `"This field is only available on quiz slides."` (`points_min`, `points_max`, `speed_bonus_enabled`, `is_correct`, also inside bulk), and quiz types → 422 `unsupported_type`.

Option counts (`config/deck.php option_limits`): pick single / multi 2–10, short_answer 1–5 (accepted answers), match_pairs 4–16 cells (2–8 pairs), correct_order 3–8, categorise 4–20 items (categories 2–5 live in config), spinner_wheel 2–12, leaderboard none.

Live session: `/api/v1/quiz-sessions/v2` (names `deck.quiz.sessions.*`). Same rows as the Quest live table (by-code, state, participant-state, advance, end, join, answers, my-answer, aggregate, review; no Q&A routes), with these differences:

| Method | Path | Auth | Quiz difference / response `data` | Errors |
|---|---|---|---|---|
| POST | `/{session}/advance` | host | `action` also `reveal` (quiz / spinner run in `voting`) and `insert_leaderboard` (a leaderboard run right after the current one, then moves to it). `close_voting` on a quiz run = reveal. `start_voting` on a spinner spins | 409 `invalid_state` `{slide_run_id, state, state_version}` (reveal outside `voting`, on a content / leaderboard run, twice; `insert_leaderboard` while a leaderboard is current), 422 `action` (`reveal` / `insert_leaderboard` on Quest routes) |
| POST | `/{session}/slide-runs/{run}/answers` | participant | still **204**; scored on submit (answer row only); may reveal the run (all answered); brings back a participant who had left | as Quest; 409 `already_answered` on a second answer; spinner / leaderboard → 409 `no_answers` |
| GET | `/{session}/slide-runs/{run}/my-answer` | participant (review token too) | before the reveal exactly the Quest shape `{slide_run_id, answer_payload, time_to_answer_ms, submitted_at}`; after it adds `{is_correct, points_awarded, correct_answer (the aggregate's correct block), total_points, rank}` (`points_awarded` of this run; `total_points` / `rank` the CURRENT standing over every revealed run, not a per-run snapshot) | 404 `You have not answered this slide.` |
| POST | `/{session}/participants/join` | public | with a valid `X-Participant-Token` of this session (same device): **200** the SAME participant `{…, participant_token (unchanged), rejoined: true}` (stored name / avatar win, `left_at` cleared, points kept); otherwise 201 as before with `rejoined: false`. Quest too | as Quest |
| POST | `/{session}/participants/leave` | participant (`X-Participant-Token`, or body `participant_token` for `sendBeacon`, form-encoded) | **204** (also when already left): sets `left_at`, broadcasts `participant.count.updated`, quiz: reveals the current run if everyone left in the room answered. Token stays valid. Quest too | 401, 404 |
| GET | `/{session}/slide-runs/{run}/aggregate` | host or participant | participants: 403 `results_hidden` until the run is revealed, then `visibility: 'public'`, `final: true`, aggregate incl. `correct` (spinner: + `spin`) | as Quest |
| GET | `/{session}/leaderboard?limit=1..100` | host (Sanctum, flag) **or** participant (`X-Participant-Token`, also after the end) | `{session_id, status, top_n (default 10), participant_count, leaderboard: [{rank, participant_id, display_name, emoji_avatar, total_points, points_delta}], me: {participant_id, total_points, rank, points_delta} \| null (host), server_time}` | 401, 403 `feature_disabled` (host), 404 (not the host / unknown session), 422 `limit` |
| GET | `/{session}/review` | participant | runs' `my_answer` carries the correctness keys for revealed runs; unplayed runs `aggregate: null` | as Quest |

#### State machine
- Quiz answer types: `waiting → get_ready` (when `get_ready_seconds > 0`) `→ voting → reveal`. `voting → reveal` on `reveal` / `close_voting`, the time limit (`voting_started_at + time_limit_seconds`), every participant answered, leaving the slide, or `end`.
- Spinner: `waiting → voting` (spinning, `time_limit_seconds` = spin length) `→ reveal`.
- Leaderboard and content: stay `waiting`; `start_voting` / `reveal` → 409.
- `reveal` is terminal (never reopened); navigation never changes the state of the run it lands on; going back from an active run needs `force:true` (409 `requires_force`).
- Every transition bumps `state_version` and broadcasts `slide.state.changed` (public). `reveal` stamps `closed_at`.

#### State payloads (additions for quiz sessions)
- HOST STATE and PARTICIPANT STATE gain `quiz: {submitted_count (answers of participants still in the room), spin: {option_id, target_angle} | null, leaderboard: [rows] | null (when the current run is a leaderboard)}`; PARTICIPANT STATE's `quiz` also has `participant_count` (left_at null; host state has it top-level) and PARTICIPANT STATE has `standing: {participant_id, total_points, rank (null after leaving), points_delta}`.
- Quiz runs (scored types) carry `options_hidden: bool`. A participant's current run in `waiting` / `get_ready` has `options: []`, `options_hidden: true` (title, body, config still there); so does the public `slide.changed`. Phones re-read GET state when the run enters `voting` (slide.state.changed). The presenter (`current_run`, host `runs`) and the post-session review always have the options.
- Runs carry `config.scoring = {points_min, points_max, speed_bonus_enabled, time_limit_seconds}` (public: the "50p ── 100p" bar) on scored runs; never `is_correct`, `pair_key`, `correct_category_key` or answer keys (match_pairs / correct_order / categorise expose opaque string ids). Host `current_run` (presenter view) adds `answer_key`, per-option `option_id` and the live `aggregate`.
- PARTICIPANT STATE before the reveal: `results_visibility: 'host'`, `aggregate: null`, `my_submission_for_current_slide` without correctness. After it: `results_visibility: 'public'`, the reveal aggregate, `my_submission_for_current_slide` with the my-answer correctness keys.

#### Broadcasts (all with `slide_run_id` + `server_time`)
- During `voting` on a quiz run: host channel `slide.aggregate.updated` (debounced) and `answer.submitted`; public channel only `slide.submitted_count.updated` `{slide_run_id, submitted_count, participant_count}` (same debounce). Never a public aggregate, never `slide.closed`.
- `slide.revealed` (public) `{slide_run_id, type, state:'reveal', state_version, closed_at, aggregate (with correct), leaderboard_delta: [{participant_id, points_delta, new_total, new_rank}] (best first, ≤ 10), leaderboard_truncated, spin: {option_id, target_angle} | null, refetch}`. When it would not fit a Reverb publish: `aggregate: null, refetch: true` → GET `…/aggregate`. Order on a reveal: `slide.state.changed` then `slide.revealed`.
- `spin.started` (public) `{slide_run_id, state_version, option_id, target_angle (degrees, under the 12 o'clock pointer), duration_seconds, ends_at}`; wheel geometry is in the run's `segments`.
- `leaderboard.updated` (public) `{slide_run_id, top_n, leaderboard: [{rank, participant_id, display_name, emoji_avatar, total_points, points_delta}] | null, refetch}` after `slide.changed` + `slide.state.changed` when a leaderboard run becomes current; `refetch: true` → GET `…/leaderboard`.
- Channels: `session.quiz.{public_channel_key}` and `private-host.quiz.v2.{session_id}`.

#### Error codes
Unchanged set (`not_found`, `conflict`, `invalid_state`, `unsupported_type`, `slide_limit_reached`, `forbidden`, `feature_disabled`, `unauthorized`, `results_hidden`, `too_many_requests`). Quiz-specific: 409 `invalid_state` for an illegal `reveal`, 409 `no_answers` on spinner / leaderboard answers, 403 `results_hidden` on a quiz aggregate before its reveal, 422 field errors `points_min` / `points_max` / `speed_bonus_enabled` / `is_correct` / `payload.*`.

#### Review fixes (2026-10-17, after the 3 Quiz v2 reviews)
- **Score oracle closed.** Answers are final for scored quiz runs (409 `invalid_state`, `data: {reason: 'already_answered', slide_run_id}`; checked before validation and again by the unique row under the run lock). Totals move only at the reveal (`QuizRuntime::applyRevealedPoints`: `UPDATE deck_participants … + SUM(points_awarded)` of the run, inside the reveal transaction, which holds the run lock that waits for in-flight answers, so every answer counts exactly once). Standing / leaderboard / `leaderboard_delta` / my-answer totals therefore never change during voting (regression: `QuizReviewFixesTest` "never moves standing…", "keeps the first answer final…").
- **Shuffles** (`QuizOptions::shuffle`): options sorted by `HMAC-SHA256(app.key, "{run_id}:{participant_id}:{option_id}")` (participant id empty for the run-level order). Per participant: correct_order items, match_pairs right column, categorise items. No "never the given order" rotation (it leaked 2-item pairs and biased 3-item orders); the correct order can appear. The participant state uses the participant's order; public broadcasts (`slide.changed`) only ever carry options for an already-revealed run, in the run-level order; the presenter uses the run-level order. Proven in `QuizShuffleKeysTest` (2 items 50/50 over 4,000 seeds, 3 items uniform over 6,000, orders not recomputable with the old unkeyed hash or another key).
- **Opaque option keys per run**: `'k' . substr(HMAC-SHA256(app.key, "deck-quiz-option:{salt}:{option_id}"), 0, 12)` where `salt = config_snapshot._key_salt`, 32 random hex chars drawn per run at session start (never serialised: `_` keys are stripped). Keys differ on every run and session of the same deck; runs snapshotted before the fix (no salt) keep the old per-option key so stored answers still match. (The salt stands in for the run id: the types only receive the snapshots, and a random salt is at least as strong.)
- **Options hidden on phones until voting** (`options: []`, `options_hidden: true` in `waiting` / `get_ready`); phones re-read GET state when voting starts.
- **Leave / rejoin / ghosts**: `POST …/participants/leave` (both products) and same-device rejoin (join with the stored token → same participant, 200 `rejoined: true`). An answer from a participant who left brings them back. `participant_count`, `submitted_count`, auto-reveal and leaderboards (`LeaderboardService` ranks `left_at` null only) consider only participants in the room; a participant who left reads `standing.rank: null` with their own total.
- **`participant_count`** in the participant state `quiz` block (phones keep "x / y" after a reload). Quest state is unchanged.
- **`insert_leaderboard`** advance action (host, quiz only; plan §3.2): creates a leaderboard run (default config `{top_n: 10, show_all_participants: false}`, no authoring slide, title "Leaderboard") right after the current run, shifts later runs' `position_snapshot` by one, then moves to it like `next_slide` (an active run is revealed first): `slide.changed` (total_slides + 1), `slide.state.changed`, `leaderboard.updated`. 409 when the current run is already a leaderboard; 422 on Quest routes.
- **Rate shape**: per-token `deck-participant` (240 / min) is the main guard; the shared per-IP cap on token routes (answers, my-answer, aggregate, leaderboard, leave) is raised from 1,800 to **6,000 / min** (`ParticipantReadAccess::IP_PER_MINUTE`): 500 phones on one NAT answering every 20 s = 500 answers + ≤ 500 reads per question = 3,000 / min, so 2× headroom. GET state is per-token only. Quiz phones make ONE read after a reveal: GET state (it carries `my_submission_for_current_slide` with the correctness keys and `standing`), not state and my-answer.
- **Host channel** `private-host.{product}.v2.{id}` now also requires the product's v2 rollout flag (DeckFeature), like the host HTTP routes.
- **correct_order aggregate**: `most_common_order` is `{order, count, tied: bool}` — `tied` is true when two or more different orders share the top count (deterministic order still picked), so the presenter can avoid calling a tie (or a 1-1-1 split) "most common".
- Docblock fix: my-answer's `total_points` / `rank` are the current standing, not "as of this run".
- **Deferred:** §3.4 frontend E2E / visual regression / per-component unit tests are NOT built (the frontend has no test runner yet); logged here and in §3.4.

#### For the frontend (Phases 3–4)
- Use `sessionsBase('quiz') = '/quiz-sessions/v2'`. Gate the v2 quiz UI on `profile.quiz_v2_enabled`; any authoring / hosting call can still answer 403 `feature_disabled`.
- Presenter: `start_voting` → countdown from `ends_at` (get_ready), then voting; show `quiz.submitted_count` / `slide.submitted_count.updated`, the host aggregate from the host channel, a Reveal button (`action: 'reveal'`), then Next. On `slide.revealed` animate the correct answer and `leaderboard_delta`.
- Participant: after answering show "submitted" (answers are final; a 409 `already_answered` means it is already stored, keep the locked state); on `slide.revealed` (or `state: 'reveal'` on resync) make ONE read, GET state (`my_submission_for_current_slide` has `is_correct`, `points_awarded`, `total_points`, `rank`; `standing`), not state and my-answer. Never expect correctness before the reveal. While `options_hidden` is true show the question + "Get ready…"; re-read GET state when the run enters `voting`; render options exactly in the order the run view gives. "Leave session" calls `POST …/participants/leave` (best effort on pagehide with `fetch(…, {keepalive: true})` or `sendBeacon` + form-encoded `participant_token`); a reload with a stored token re-joins with `X-Participant-Token` (same participant).
- Spinner: on `spin.started` rotate to `target_angle` over `duration_seconds`; `slide.revealed.spin` confirms the winner.
- Leaderboard slide: render `leaderboard.updated.leaderboard` (or `quiz.leaderboard` from state); `points_delta` drives the "+94".

---

## Phase 3 — Frontend: Quiz slide type components

**Goal.** Per-type Editor, Presenter, and Participant components registered in the frontend `slideRegistry.ts`.
**Duration.** 4–5 days. Parallelisable — one type per dev per day.

### 3.1 Registry entries

Append Quiz types to the shared registry (`features/deck-editor/slideRegistry.ts`):

```ts
import { pickAnswerSingle } from './slides/pickAnswerSingle';
// ...
export const slideRegistry = {
  ...questRegistry,          // from Quest v2
  ...contentRegistry,        // shared
  pick_answer_single:  pickAnswerSingle,
  pick_answer_multi:   pickAnswerMulti,
  short_answer:        shortAnswerScored,
  match_pairs:         matchPairs,
  correct_order:       correctOrder,
  categorise:          categorise,
  spinner_wheel:       spinnerWheel,
  leaderboard:         leaderboardSlide,
};
```

Each type provides `{ key, products, category, label, icon, defaults, Editor, Presenter, Participant }`. Product filtering in the `SlidePicker` modal hides Quest-only types when editing a Quiz-product deck.

### 3.2 Per-type implementation notes

#### `pick_answer_single` / `pick_answer_multi`

- **Editor:** Content tab = options list with image + label inputs; checkbox marks correct answer(s). Settings tab = time, points min/max, speed bonus, get_ready override.
- **Presenter (waiting):** question + options (no counts), big Start button. Matches AhaSlides waiting screen.
- **Presenter (get_ready):** "Get ready… 5, 4, 3, 2, 1" overlay.
- **Presenter (answering):** question + options (no correct-answer hint) + live submitted-count (from public channel; per-option counts hidden) + timer.
- **Presenter (reveal):** bar chart with option images embedded in bars (theme palette from main plan §1.2), ✅/❌ markers under each option label, Next button.
- **Participant (answering):** option cards (min 48×48 tap target), points progress bar, instant-submit (single) or Submit button (multi).
- **Participant (reveal):** big green ✅ + "+94 points" if correct; red ❌ + "0 points" + highlight correct option otherwise.

#### `short_answer`

- **Editor:** accepted-answers list (1–5 strings), case-sensitivity toggle.
- **Participant:** single text input + Submit; character counter if `max_length` set.
- **Presenter (reveal):** list of top-N most-common submitted answers with correct/incorrect markers; accepted-answer(s) shown prominently.

#### `match_pairs`

- **Editor:** pairs list (left + right text/image).
- **Participant:** two columns (left static, right shuffled). Tap left cell → it highlights → tap right cell → connection line drawn. Connections editable until Submit.
- **Presenter (reveal):** all pairs shown with lines drawn from submitted connections; aggregate count per-pair correct.

#### `correct_order`

- **Editor:** ordered items list (author-defined order is the correct one).
- **Participant:** shuffled list with drag handles. `@dnd-kit` with pointer/touch sensors (mobile) and keyboard sensor (accessibility).
- **Presenter (reveal):** correct order shown alongside the most-common submitted order; per-item correctness.

#### `categorise`

- **Editor:** categories list + items list; each item has a `correct_category_key` selector.
- **Participant:** categories as drop zones (horizontal row on desktop, vertical stack on mobile). Items in a "pool" at top. Drag into categories.
- **Presenter (reveal):** category buckets with item correctness breakdown.

#### `spinner_wheel`

- **Editor:** options list, each optionally weighted.
- **Live flow:**
  1. Host clicks Start → server does weighted-random selection → broadcasts `spin.started` with `target_angle`
  2. All clients animate a 3-second CSS rotation to that angle
  3. Server broadcasts `slide.state.changed → reveal` at animation end
  4. Landed option highlighted; no points in v1
- **Presenter:** large spinning wheel (SVG + Framer Motion rotation).
- **Participant:** view-only wheel (smaller) + landed-option message.

Participant prediction scoring is parked for v1.1+.

#### `leaderboard`

- **Editor:** Settings tab = `top_n` (default 10), show-all-participants toggle (default off, only top_n).
- **Presenter:** title + player count + ranked bars with emoji avatars + points + delta (matches AhaSlides leaderboard screenshot). Framer Motion rank-change animation when arriving from previous Leaderboard slide in the deck.
- **Participant:** same layout, centered on own row with "You (#4)" marker.

Leaderboard slides can be inserted anywhere (beginning / middle / end). Each reads the current `LeaderboardService::currentTopN()` snapshot. Host can also insert one mid-session via a control-bar button (deck is mutated live, slide_run snapshot is added on-the-fly).

### 3.3 Animations

ApexCharts handles bar-chart animation. Framer Motion handles:
- Bar-chart reveal (opacity + slide-up of bars on `reveal` transition)
- ✅/❌ badges fade-in 400ms after bars animate
- Leaderboard rank-change (y-translate + color pulse on rank change)
- Get-ready countdown (scale pulse on each digit)

### 3.4 Tests

> **Deferred (2026-10-17):** none of the items below is built yet: the frontend has no test runner. The backend side is covered by `tests/Feature/Deck/Quiz/*` (incl. `QuizV2EndToEndTest`, `QuizReviewFixesTest`, `QuizShuffleKeysTest`).

- Cypress/Playwright E2E: full quiz flow across every type with 3 fake participants, all submissions recorded, reveal correct, leaderboard updated.
- Visual regression snapshots of each reveal screen.
- Per-type `Participant` component unit tests — submit-disabled invariants, confirm modals, validation messages.

**Phase 3 exit criteria:** author a quiz containing every slide type, host a session, 3 real tabs/devices participate end-to-end, reveals match AhaSlides screenshots closely, leaderboard animates correctly, review screen shows per-participant correctness.

---

## Phase 4 — Polish, load test, cutover, docs

**Goal.** Ship-ready. Absorbs applicable parts of main plan §4–§6 specifically for Quiz.
**Duration.** 2–3 days.

### 4.1 Responsive pass

- Participant PWA (shared shell from Quest v2) tested with Quiz types at 320px, 375px, 414px, 768px
- Reveal screens tested at projector resolutions (1280×720, 1920×1080)
- Leaderboard slide tested at all host resolutions (bar label truncation, scroll behaviour for top 20+)

### 4.2 Load test

Reuse main plan §5.2 harness, focused on Quiz specifics:
- 500 participants submit answers in a 20-second window → all scored, leaderboard updated within 1s of reveal
- 100 concurrent reconnects during `answering` → all clients receive correct state + remaining time
- Private-channel aggregate floods: host-only `answer.submitted` events arriving at ~25/sec should not back-pressure Reverb
- Voting-start burst (added 2026-10-17 after the review fixes): options are hidden on phones until voting, so every phone reads its own state when voting opens (0–0.4 s jitter) — 500 phones ≈ 500 state reads within half a second. Measure p95 latency and worker saturation (the dev server runs 4 PHP workers); widen the jitter or push per-participant options another way if it hurts the speed bonus.
- Reveal: one state read per phone (0–2 s jitter) — 500 reads over 2 s.

### 4.3 Feature flag rollout

1. Internal team, 1 week — dogfood
2. Beta users (flag on for opted-in accounts), 1 week
3. Default-on for everyone; legacy Quiz v1 reachable via settings toggle for 2 weeks
4. After 2+ stable weeks default-on: legacy removal (§4.4)

### 4.4 Legacy Quiz v1 — what stays, and what v2 needs before any removal

Legacy Quiz v1 stays (user decision 2026-10-17). It still owns: self-paced / exam attempts (`quiz_mode`, `/attempt/...`, `quiz-attempts-url`), the question bank (`quiz_q_bank*`, `quiz_bank_questions`), quiz reports, Discover / public templates, and the Fun Games import (`ImportService::libraryQuizzes`). Do not drop `quizes`, `questions`, `quiz_sessions`, `quiz_participants`, `user_quiz_answers`, `quiz_origins` or the bank tables.

Only after Quiz v2 has a home for every item above may removal be planned again, as a separate plan. Until then the cutover is limited to: the dashboard "Create a new quiz" modal and My Library create v2 decks for users with `quiz_v2_enabled`, and live hosting of those decks runs on v2.

### 4.5 Docs

Update [STRUCTURE_AND_DEVELOPMENT_GUIDE.md](STRUCTURE_AND_DEVELOPMENT_GUIDE.md) with Quiz v2 specifics:
- Quiz slide type catalog + scoring formula
- `hidden_until_reveal` state machine variant (already touched in Quest docs)
- Leaderboard service + cache keys
- Quiz reveal payload contract

Extend the `DECK_ADDING_A_SLIDE_TYPE.md` doc (created in Quest plan §8.4) with a Quiz-specific example: how to add a scored type end-to-end (registry, `score()`, reveal aggregate, Participant reveal UI).

---

## Timeline

| Phase | Duration | Notes |
|---|---|---|
| 1. Backend: Quiz-specific types + scoring | 2–3 days | Depends on Quest v2 engine being merged |
| 2. Backend: Quiz product scoping + endpoints | 2 days | Parallelisable with 3 after day 1 |
| 3. Frontend: per-type components | 4–5 days | Parallelisable per type |
| 4. Polish + load test + cutover + docs | 2–3 days | |
| **Total (serial)** | **10–13 days** | |
| **Total (two devs, parallelised)** | **~7–9 days** | |

Compared to the original estimate (~18–22 days) this is roughly half — the shared engine already solves everything non-Quiz-specific. The only substantial work left is the eight Quiz slide types, scoring, and reveal semantics.

**Sequencing.** Quiz v2 Phase 1 starts the day Quest v2 Phase 3 merges (registry + state-machine hooks are stable). Phases 2–3 proceed in parallel. Phase 4 begins when Phase 3 is feature-complete.

---

## Decision log (Quiz-specific additions)

| Decision | Rationale |
|---|---|
| Quiz v2 is additive on top of Quest v2's shared engine | User-confirmed sequencing. Quest ships first, so reusing its primitives is strictly cheaper than duplicating them. |
| No new tables in Quiz v2 | The shared `decks`/`slides`/`deck_*` tables already contain every column Quiz needs (scoring columns are nullable and Quest leaves them null). |
| Register Quiz types with `products: ['quiz']` | Frontend type-picker and backend product-scope validators use this to keep Quiz types out of Quest editors and vice versa. |
| Reveal model gate in the shared state machine | `hidden_until_reveal` + `live_aggregate` + `moderated_feed` live in one place; Quiz is the first consumer of the hidden variant. |
| Opaque answer-submit + separate `/my-answer` endpoint | Prevents leaking correctness before reveal via network-tab inspection. Matches Quest's opaque submit pattern. |
| ScoringService centralised + delegates to per-type `score()` | Single place to change if we ever want league-wide scoring rules (e.g. difficulty multipliers). |
| LeaderboardService caches snapshots in Redis per slide run | Avoids recomputing for every Leaderboard slide view; 1h TTL is plenty. |
| Leaderboard slide supports mid-deck insertion + on-the-fly insertion by host | AhaSlides parity; keeps host UX fluid. |
| Spinner Wheel without prediction scoring in v1 | Engagement feature, not core quiz. Ship the animation; validate user interest; add scoring later. |
| Feature-flag rollout staged over ~4 weeks before legacy removal | Risk management. Legacy tables are cheap to keep; losing data is not. |
