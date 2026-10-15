# MindSpear Quiz Redesign — Slide-Based Quiz (AhaSlides Parity)

> **Goal.** Rebuild the Quiz module so authoring, hosting, and participation feel indistinguishable from AhaSlides. Slide-based editor, Quiz-specific scored question types, time-weighted scoring with per-slide min/max, QR join, 5-second "Get ready" countdown, animated results, emoji-avatar participants, global leaderboard slide.
>
> **Strategic role.** Quiz v2 is **additive to Quest v2**. Quest v2 (see [QUEST_REDESIGN_PLAN.md](QUEST_REDESIGN_PLAN.md)) ships first and introduces the shared slide engine — tables, slide-type registry, state machine, editor shell, presenter shell, and PWA participant shell. Quiz v2 reuses all of that and adds only what is Quiz-specific: scored slide types, a time-weighted scoring service, the `hidden_until_reveal` state-machine variant, the Leaderboard slide, and product-scoped editor/presenter/participant behaviour. This is a deliberate flip from the original ordering and shortens Quiz v2 dramatically.
>
> **Out of scope (for now).** Anything the shared engine already provides (see Quest v2 plan). Also skipped within Quiz: unscored types (Poll, Word Cloud, Q&A, Rating, 100 Points, Matrix, Pin on Image — those ship with Quest v2 and stay product-scoped to Quest), emoji reactions, audience chat, AI option generation, templates marketplace, full Spinner Wheel prediction/scoring mode.
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
> **Database decision.** SQLite acceptable locally, PostgreSQL is production target. Every new migration, JSON filter, aggregate, or raw SQL in this plan must be checked against PostgreSQL before merge.
>
> **Cutover decision.** Quiz v2 is a build-alongside replacement. Legacy Quiz v1 keeps running during development. After Quiz v2 has been the default for 2+ stability weeks, drop legacy `quizes`, `questions`, `quiz_sessions`, `quiz_participants`, `user_quiz_answers`, `quiz_origins`, and quiz-bank tables.

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
3. **Scoring service** — `app/Services/Deck/ScoringService.php`. Delegates to each slide type's `score()`. Time-weighted linear interpolation between `points_min` and `points_max`. Partial credit for multi-select. Zero for wrong.
4. **Leaderboard slide type + `LeaderboardService`** — `Top N` snapshot with `points_delta` per player (for the "+94" animation). Broadcasts on `leaderboard.updated` event. Cached in Redis per slide transition.
5. **Reveal UI** — per-type `Presenter` components render a `reveal` state: correct-answer markers, bar chart with option images, animated score totals.
6. **Quiz product scoping** — `/api/v1/quizzes/*` routes that filter the shared services to `product=quiz` and reject non-Quiz slide types at creation.
7. **Cutover of legacy Quiz v1** — feature flag, route deprecation, table drops.

### Slide type catalog (Quiz v2)

All registered with `products: ['quiz']` (except shared content types, which are `['quest','quiz']` and already registered by Quest v2). Reveal model = `hidden_until_reveal` unless noted.

| Type key | Scored? | Options? | Participant UI | Notes |
|---|---|---|---|---|
| `pick_answer_single` | Yes | 2–10 | Tap one option | Image + text per option |
| `pick_answer_multi` | Yes | 2–10 | Tap multiple + Submit | Partial credit config |
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
- Multi-select partial credit: `points * (correct_selected / total_correct)` with no penalty for wrong-selected in v1 (configurable later)
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
| `pick_answer_multi` | 3 empty options, 30s time, 50/100 points, partial credit on |
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

### 4.3 Feature flag rollout

1. Internal team, 1 week — dogfood
2. Beta users (flag on for opted-in accounts), 1 week
3. Default-on for everyone; legacy Quiz v1 reachable via settings toggle for 2 weeks
4. After 2+ stable weeks default-on: legacy removal (§4.4)

### 4.4 Legacy Quiz v1 removal checklist

Only after Quiz v2 is stable and default:

- Delete legacy migrations-revert for: `quizes`, `questions`, `quiz_sessions`, `quiz_participants`, `user_quiz_answers`, `quiz_origins`, `quiz_q_bank_categories`, `quiz_q_banks`, `quiz_q_bank_questions`, `quiz_bank_questions`
- Delete `backend/app/Models/Quiz/*` (old)
- Delete `backend/app/Http/Controllers/api/v1/Quiz/*` (old)
- Delete `frontend/src/features/quiz/components/{CreateQuiz,QuizEdit,QuizPublic,QuizReports}` old components
- Delete `frontend/src/app/(protected)/quiz-creator/`, `quiz-edit/`, `quiz-play/`, `quiz-reports/`
- Delete `frontend/src/app/(public)/attempt/quize/`, `(public)/live/quiz/`, `(public)/quiz-public/`, `(public)/quiz-result-view/`
- Delete old Redux slices / services under `features/quiz/` no longer used
- Grep audit: `grep -rn "from.*components/quiz.*QuizEdit" frontend/src` → zero
- Remove `quiz_v2_enabled` feature flag

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
