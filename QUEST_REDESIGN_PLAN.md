# MindSpear Quest Redesign — Slide-Based Quest (Mentimeter Parity)

> **Goal.** Rebuild the Quest module so authoring, hosting, and participating feel indistinguishable from Mentimeter. Slide-based editor, Mentimeter-style interactive question types (Multiple Choice, Word Cloud, Open Ended, Scales, Ranking, Q&A, 100 Points, Rating, 2×2 Matrix, Pin on Image), rich content slides, live-updating result visualisations, and a PWA-styled participant shell that feels like a native Android/iOS app.
>
> **Strategic role.** Quest v2 ships **first** and introduces the **shared slide engine** that Quiz v2 will later inherit. Tables, registry, state machine, presenter layout, editor shell, and PWA participant shell are all built here as product-agnostic primitives. Quiz v2 will add scoring types + reveal semantics + leaderboard on top of this foundation. This flips the earlier sequencing in [QUIZ_REDESIGN_PLAN.md](QUIZ_REDESIGN_PLAN.md); that plan is being updated to consume what Quest v2 ships.
>
> **Out of scope (for now).** Scoring, leaderboards, "reveal correct answer" states (those are Quiz concerns). Also skipped: emoji reactions, audience chat, hand-raise, "Who will win" prediction type, templates marketplace, Capacitor-wrapped native app shells. Quest v1 keeps running untouched until cutover.
>
> **In scope because of later work (added 2026-10-15).** The per-user file library ("My Files", `app/Modules/FileLibrary`) and AI "Generate from a document" shipped after this plan was written. Quest v2 builds on both: every image and uploaded video goes through My Files (see §1.9, §2.3, §5.5), and the document-to-AI wizard is ported to the v2 editor (see §5.7).
>
> **Scope confirmed with user.**
> - Shared slide engine owned by Quest v2; Quiz v2 builds on it next.
> - Quest type set for v1: Multiple Choice (single + multi), Word Cloud, Open Ended, Scales, Ranking, Q&A (Mentimeter-style with upvoting + moderation), 100 Points, Rating, 2×2 Matrix, Pin on Image. Plus the full Content slide set: Heading, Paragraph, Bullets, Numbered, Quote, Image, Video, Big Text, QR Code. Fill-in-the-blanks and Quick Form are not Quest types — they move to Quiz or are dropped.
> - Participant shell = PWA-styled web (installable, full-screen, safe-area aware, native-feel UI, haptics, sheet modals). No native wrappers.
> - PWA shell is shared infrastructure; Quiz v2 inherits it.
> - Greenfield Quest v2 tables alongside legacy Quest v1. Drop Quest v1 tables only after cutover.
> - Q&A = Mentimeter semantics: audience submits questions, upvotes each other's, host moderates (hide / star / mark answered).
>
> **Relationship to [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).** Phases 0–3 of that plan are complete: Reverb is live, Socket.IO is gone, public/private channel split works, participant-token flow is in place. This plan builds on top of that realtime foundation — existing `LiveSessionService`, `LiveAggregateService`, `ParticipantTokenService`, generic `LiveBroadcastEvent`, channel split, and participant-token auth pattern are reused by generalising them from legacy Quiz/Quest models to shared `DeckSession` / `DeckParticipant` models. Add typed payload DTOs/tests around that layer instead of a parallel tree of broadcast classes unless the generic layer becomes a real limitation.
>
> **Database decision.** PostgreSQL everywhere, including local dev and tests (the Docker setup already uses it). SQLite is no longer an option: the file library relies on PostgreSQL-only features (`pg_advisory_xact_lock`, `ILIKE`, `jsonb`). Every new migration, JSON filter, aggregate, or raw SQL in this plan must be checked against PostgreSQL before merge. Use `jsonb` (not `json`) for all JSON columns so we can index / query them later.
>
> **Cutover decision.** Quest v2 is a build-alongside replacement, not a table-drop. The new API should use product-scoped v2 routes (`/api/v1/quests/v2/...`) during coexistence, then optionally alias to clean `/api/v1/quests/...` routes after cutover. Legacy Quest v1 keeps its current routes and tables during development. Legacy removal only happens in the final cutover phase, after Quest v2 has been the default for two+ weeks of stability.

---

## Architectural shape

### The shared slide engine

Quest and Quiz are two products that render "decks of slides." The engine is neutral; the products are discriminators.

```
Deck                                 (owner, product, title, settings)
└── Slide (ordered, typed)           (type, position, config, options)
    └── SlideOption[]                (image, label, payload)
```

A **deck** is a unit of authoring. A **slide** is an atomic unit of live engagement. A **slide type** defines how a slide is edited, presented, answered, and aggregated. The **product** (`quest` vs `quiz`) gates:
- Which slide types are available in the type picker
- Whether scoring + leaderboards are enabled
- Which reveal model the state machine uses (live aggregate vs hidden-until-reveal)

Because every piece of data is keyed by deck → slide → option, the *same* editor, presenter, participant shell, API contract, event payloads, and reconnect flow serve both products.

### Slide type catalog (Quest v1)

Quest types are **unscored** and use the **`live_aggregate`** reveal model (results update live on presenter as votes arrive — Mentimeter's signature).

| Type key | Category | Reveal | Participant UI | Notes |
|---|---|---|---|---|
| `poll_single` | Poll | live | Tap one option | Same data shape as Quiz `pick_answer_single`, just unscored |
| `poll_multi` | Poll | live | Tap multiple options, Submit | Min/max selections configurable |
| `word_cloud` | Poll | live | 1–N text submissions | `max_entries_per_participant` config, profanity filter list |
| `open_ended` | Poll | live | Long text input | Host sees card wall / moderated feed |
| `scales` | Poll | live | 1 Likert value per statement | Multi-statement, 2–10 scale points with labels |
| `ranking` | Poll | live | Drag to order | Aggregated weighted-average position |
| `qa_audience` | Interactive | moderated_feed | Submit question + upvote others | Mentimeter Q&A — see 1.4 |
| `points_allocation` | Poll | live | Distribute 100 points across options | Client validates sum=100 before submit |
| `rating` | Poll | live | 1–5 stars per item | Multi-item list with per-item average |
| `matrix_2x2` | Poll | live | Drag dot onto 2D plane | X/Y axis labels configurable, scatter-plot result |
| `pin_on_image` | Poll | live | Tap on image to drop a pin | Host sees heatmap overlay |
| `heading` | Content | none | Read-only | Title + subtitle |
| `paragraph` | Content | none | Read-only | Rich text |
| `bullets` | Content | none | Read-only | Bullet list |
| `numbered` | Content | none | Read-only | Numbered list |
| `quote` | Content | none | Read-only | Large quote + optional attribution |
| `image` | Content | none | Read-only | Image with optional caption |
| `video` | Content | none | Read-only | YouTube/Vimeo embed, or an mp4 from My Files |
| `big_text` | Content | none | Read-only | Single big phrase (for "section breaks") |
| `qr_code` | Content | none | Read-only | Auto-renders join code + QR |

**Design principle.** Every slide type ships the *same* five hooks (detailed in 1.3): Creator, Presenter, Participant, validation/scoring/aggregate, serializers. Adding a new type — including future Quiz types — means implementing those five hooks against the shared engine, nothing else.

### Channels and events (unchanged from Phase 2/3)

Same public/private split:

- **Public** `session.{product}.{publicChannelKey}` — participants + host receive slide-state + aggregate events (product ∈ {`quest`, `quiz`})
- **Private** `host.{product}.v2.{sessionId}` — host-only events during coexistence; namespace the `.v2` so numeric IDs from legacy sessions can't collide. Collapse to `host.{product}.{sessionId}` after cutover.

New event payloads (routed through `LiveBroadcastEvent` with typed DTOs, not new event classes):

| Event `name` | Channel | Purpose |
|---|---|---|
| `slide.changed` | Public | Host navigated to a new slide |
| `slide.state.changed` | Public | State machine transitioned (state + state_version + seconds_remaining) |
| `slide.aggregate.updated` | Public only for `live_aggregate` slides with "Show votes to participants" on (`config.show_results_to_participants`, default off, §5.6); otherwise Private (host) | Debounced (500ms) aggregate snapshot — live-updating charts |
| `slide.closed` | Public | Voting closed; final aggregate attached only when participants may see results (else `aggregate: null` and the host gets the final aggregate as a host-only `slide.aggregate.updated`) |
| `qa.question.submitted` | Public (Private (host) when the slide hides the feed from participants) | New Q&A question appended (payload: question_id, body, participant emoji, upvote_count=0) |
| `qa.question.upvoted` | Public (Private (host) for hidden questions or a hidden feed) | Absolute count (question_id, upvote_count) |
| `qa.question.moderated` | Private (host) + Public (redacted) | Host hid / starred / marked answered |
| `participant.count.updated` | Public | Already exists |
| `answer.submitted` | Private (host) | Already exists — extend payload to include `time_to_answer_ms` |

### Live session state machine (Quest)

Quest is simpler than Quiz — no "reveal" phase because results update live.

```
waiting          ← host navigated to slide, hasn't opened voting yet
  ↓ host clicks "Start voting" (or auto on get_ready flag off)
get_ready        ← optional 5s countdown (default OFF for Quest; ON for Quiz)
  ↓ auto
voting           ← accepting submissions; aggregate broadcasts live on public channel
  ↓ host clicks "Close voting" OR host advances past the slide OR time_limit expires (if set)
closed           ← submissions rejected; final aggregate frozen but still visible on presenter
  ↓ host advances
(next slide)
```

Q&A slides override: the state goes `waiting → open → closed`, with `open` behaving like `voting` but without a timer and with a moderation queue.

### Session slide snapshots

Authoring slides are mutable. Live sessions must NEVER read config/options directly from authoring slides after the session starts — a host editing mid-session would corrupt live state.

When a host starts a session, create one `deck_session_slide_runs` row per slide, copying:
- `slide_id` → pointer back to authoring
- `type_snapshot`, `position_snapshot`, `config_snapshot` (JSONB), `options_snapshot` (JSONB)
- `time_limit_seconds`, `get_ready_seconds` snapshots
- Runtime fields: `state`, `state_version`, `state_started_at`, `voting_started_at`, `closed_at`

All runtime behaviour reads from the snapshot. Aggregates and answers point at the slide_run row, not the authoring slide. This also gives us per-session auditability.

### Auth model (unchanged from Phase 2)

- Host = Sanctum-authenticated user, owns the deck
- Participant = anonymous, receives `participant_token` on join, stored as SHA-256 hash
- All answer submissions send `X-Participant-Token`
- Emoji avatar + display name stored on `deck_participants` (extended with `emoji_avatar` column — not in `anonymous_details` JSON; first-class column so leaderboard joins can use it)

---

## Phase 1 — Shared slide engine: data model & core backend

**Goal.** Schema, models, slide type registry, event routing. Zero UI. Build the primitives that both Quest v2 (this plan) and Quiz v2 (next plan) consume.
**Duration.** 3–4 days.

### 1.1 New tables (shared; neutral names)

All tables are prefixed `deck_*` — neutrally named because Quiz v2 will use the same tables filtered by `decks.product = 'quiz'`.

| Table | Purpose |
|---|---|
| `decks` | `id`, `owner_id`, `product` (enum: `quest` / `quiz`), `title`, `description`, `cover_file_id` (nullable FK → `files`, `nullOnDelete`), `settings` (JSONB — defaults for time, get_ready, theme), `published_at`, timestamps, soft-delete |
| `slides` | `id`, `deck_id`, `type`, `position`, `title`, `body` (JSONB — for rich-text content slides), `config` (JSONB — per-type schema), `media_file_id` (nullable FK → `files`, `nullOnDelete` — image for `image`/`pin_on_image`, mp4 for `video`), `time_limit_seconds` (nullable), `get_ready_seconds` (nullable), `points_min`/`points_max`/`speed_bonus_enabled` (nullable — Quiz only), timestamps, soft-delete. Unique `(deck_id, position)` |
| `slide_options` | `id`, `slide_id`, `position`, `label`, `image_file_id` (nullable FK → `files`, `nullOnDelete`), `is_correct` (nullable — Quiz only), `payload` (JSONB — pair_key, category_key, correct_order_index, matrix label, etc.), timestamps |
| `deck_sessions` | `id`, `deck_id`, `host_user_id`, `public_channel_key` (unique), `join_code` (globally unique), `status` (pending/live/ended), `current_slide_run_id`, `timer_state` (JSONB), `started_at`, `ended_at` |
| `deck_session_slide_runs` | `id`, `deck_session_id`, `slide_id`, `position_snapshot`, `type_snapshot`, `config_snapshot` (JSONB), `options_snapshot` (JSONB), `time_limit_seconds`, `get_ready_seconds`, `state` (enum), `state_version` (int, increments every transition), `state_started_at`, `voting_started_at`, `closed_at`, timestamps |
| `deck_participants` | `id`, `deck_session_id`, `display_name`, `emoji_avatar`, `participant_token_hash` (unique), `participant_token_expires_at`, `participant_token_revoked_at`, `total_points` (nullable — Quiz only), `joined_at`, `left_at` |
| `deck_participant_answers` | `id`, `deck_participant_id`, `slide_run_id`, `answer_payload` (JSONB), `time_to_answer_ms` (nullable), `is_correct` (nullable — Quiz only), `points_awarded` (nullable — Quiz only), `submitted_at`. Unique `(deck_participant_id, slide_run_id)` |
| `deck_qa_questions` | `id`, `deck_session_id`, `slide_run_id`, `participant_id`, `body`, `upvote_count`, `is_answered`, `is_hidden`, `is_starred`, `submitted_at`. Index on `(slide_run_id, upvote_count DESC)` for top-N reads |
| `deck_qa_upvotes` | `id`, `qa_question_id`, `participant_id`, `created_at`. Unique `(qa_question_id, participant_id)` |

**Indexes (up-front):**
- `deck_sessions(join_code)` unique
- `deck_sessions(public_channel_key)` unique
- `deck_participants(participant_token_hash)` unique
- `deck_participant_answers(slide_run_id)`
- `deck_participant_answers(deck_participant_id, slide_run_id)` unique
- `slides(deck_id, position)` unique
- `deck_qa_questions(slide_run_id, upvote_count)`

**PostgreSQL checks:**
- All JSONB fields. Test `config_snapshot @> '{"key": "value"}'` queries.
- `upvote_count` increments use `UPDATE ... SET upvote_count = upvote_count + 1 WHERE ...` — don't do read-modify-write.
- `position` reorder uses a single transaction-wrapped `UPDATE` with a staging `-position` trick to avoid unique-constraint violations during the swap.

**File references.** Slides, options and deck covers point at a My Files row by id (`*_file_id`), never at a storage path. URLs are resolved when serialising (`File::url`), so renaming or moving storage never breaks a deck. Session snapshots (`options_snapshot`, `config_snapshot`) copy the resolved URL, so a live session keeps working even if the owner deletes the file mid-session. Migrations must be dated after `2026_10_16_000004` (the last FileLibrary migration) so `files` has its final shape.

**Join-code decision:** codes are globally unique, not "unique among active sessions only." Reuse sounds convenient, but global uniqueness avoids partial-index differences between SQLite/PostgreSQL, makes support/debugging easier, and removes ambiguity from old participant links.

### 1.2 Models + relationships

`app/Models/Deck/{Deck,Slide,SlideOption,DeckSession,DeckSessionSlideRun,DeckParticipant,DeckParticipantAnswer,DeckQaQuestion,DeckQaUpvote}.php`. Namespace `App\Models\Deck` signals "shared Quest+Quiz v2 models."

Add model scopes:
- `Deck::quest()` / `Deck::quiz()` — product filters
- `Deck::ownedBy($user)` — authorisation helper
- `DeckSession::live()` — status filter
- `DeckSessionSlideRun::current()` — joins against `deck_sessions.current_slide_run_id`

### 1.3 Slide type registry (PHP)

Create `app/Deck/Slides/SlideTypeRegistry.php` with one concrete class per type implementing:

```php
interface SlideTypeContract {
    public function key(): string;                             // 'poll_single', 'qa_audience', …
    public function products(): array;                         // ['quest'] / ['quiz'] / ['quest','quiz']
    public function revealModel(): string;                     // 'live_aggregate' | 'hidden_until_reveal' | 'moderated_feed' | 'none'
    public function defaultConfig(): array;                    // Seed for new slides
    public function validateConfig(array $config): array;      // Rules for author-facing config edits
    public function validateAnswer(array $payload, array $config): array;  // Rules for participant submissions
    public function score(array $payload, array $config, int $timeToAnswerMs): ScoreResult;  // Quest returns zero
    public function aggregate(array $snapshots, Collection $answers): array;  // Snapshot for broadcasts
    public function serializeForPresenter(DeckSessionSlideRun $run, array $aggregate): array;
    public function serializeForParticipant(DeckSessionSlideRun $run): array; // Must strip any answer-key info
}
```

Register all types in `DeckServiceProvider`. Controllers dispatch to the registry; no `switch ($slide->type)` blocks anywhere.

**Critical:** `serializeForParticipant` must never leak aggregate data during `voting` state on `hidden_until_reveal` types. Have a Pest test per type that asserts this.

### 1.4 Q&A model & aggregator

Q&A is the one type that doesn't fit the "answers → aggregate" pattern cleanly, so it gets a dedicated aggregator on top of the registry:

```php
// LiveQaService
public function submitQuestion(DeckSessionSlideRun $run, DeckParticipant $p, string $body): DeckQaQuestion;
public function upvote(DeckQaQuestion $q, DeckParticipant $p): int;   // returns new upvote_count
public function removeUpvote(DeckQaQuestion $q, DeckParticipant $p): int;
public function moderate(DeckQaQuestion $q, array $flags): void;       // hide / star / mark_answered
public function topN(DeckSessionSlideRun $run, int $n, string $sort = 'top'): Collection;  // 'top' | 'new'
```

All broadcasts go through `LiveBroadcastEvent` with `name: 'qa.question.*'`. Redis-backed debounce for upvote events (200ms — Q&A upvotes burst).

**Profanity filter.** Optional config per slide (`config.profanity_filter_enabled`). Simple list-based filter in v1; pluggable service for future. Applied on both Q&A submissions and Word Cloud entries.

### 1.5 Event routing

Reuse `app/Events/Live/LiveBroadcastEvent.php`. Create typed payload DTOs under `app/Deck/Broadcasts/Payloads/`:

- `SlideChangedPayload`, `SlideStateChangedPayload`, `SlideAggregateUpdatedPayload`, `SlideClosedPayload`
- `QaQuestionSubmittedPayload`, `QaQuestionUpvotedPayload`, `QaQuestionModeratedPayload`
- `AnswerSubmittedPayload` (private)

Each DTO is a `readonly class` with `toArray(): array`. `LiveBroadcastEvent::fromPayload($payload, $channel)` routes it. Pest tests per DTO assert required keys and privacy (e.g., `AnswerSubmittedPayload` must never appear in a public-channel broadcast).

All broadcasts must happen after database commit. Prefer the existing `LiveSessionService::afterCommit()` wrapper around the generic `LiveBroadcastEvent`; if a dedicated event class is introduced later, it must be after-commit safe too.

### 1.6 Live service generalisation

Before Quest v2 endpoints are wired, update the existing live services so they accept shared deck models:

- `LiveSessionService` should derive public/private channel names from `DeckSession->deck->product`, with private channels namespaced as `host.{product}.v2.{sessionId}` during coexistence.
- `ParticipantTokenService` should issue, resolve, revoke, and sanitise tokens for `DeckParticipant` in addition to legacy `QuestParticipant` / `QuizParticipant`.
- `LiveAggregateService` should schedule aggregates by `deck_session_slide_runs.id`, not legacy task/question IDs.
- Existing legacy Quest/Quiz live flows must continue to work until their cutover phases.

### 1.7 Aggregate debouncing

Reuse `LiveAggregateService` (already exists). Call pattern:

```php
$aggregateService->schedule(
    $run,
    fn () => $typeRegistry->aggregate($run, $run->answers),
    debounceMs: 500,
);
```

Service maintains per-slide-run timestamps in Redis (`agg:debounce:{slide_run_id}`). If a broadcast was sent in the last 500ms, the next call schedules a job instead of firing immediately.

The trailing job runs on the default queue (the `queue` service). Its worker runs with `--sleep=0.2`; with the default 3 s poll the last update of a burst could land up to 3 s late.

**Lessons from the legacy debounce (removed in `8bcb3ab`).** Legacy live sessions had a 1s `Cache::add` debounce that dispatched a *delayed* job and dropped every other call. In Docker no worker consumed the `default` queue (fixed: `queue` service in `docker-compose.yml`), so the delayed job never ran and charts froze; the debounce was removed and every answer now queues a snapshot. The v2 debounce must:
- broadcast the first change immediately (leading edge), and guarantee one trailing broadcast after the window (never drop the last state);
- compute the aggregate when the job runs, not when it was scheduled;
- keep at most one pending trailing job per slide run;
- be covered by a test that fakes time and asserts the final broadcast carries the final count.

**Phase 1 exit criteria:**
- Migrations green on PostgreSQL.
- Every slide type has a registry class + Pest tests for `validateConfig`, `validateAnswer`, `aggregate`, `serializeForParticipant` (privacy), `score` (zero for Quest).
- Existing legacy Quest and Quiz live smoke tests still pass after the live services are generalised.
- Tinker can create a deck, append a slide of every Quest type, and `broadcast(new LiveBroadcastEvent(...))` successfully.

---

### 1.9 File library integration (backend)

Quest v2 adds no storage of its own. All media is a row in `files` owned by the deck owner, stored by `FileStorageService`, counted by `QuotaService`.

- **Image resize on upload (all library images, not just Quest).** In `FileStorageService::store`, images wider or taller than 1024 px are downscaled to fit 1024×1024 (GD, already installed), keeping aspect ratio and format; animated GIFs are left as-is. The resized bytes are what gets stored, hashed (dedupe) and counted toward quota.
- **Image dimensions.** New nullable `width` / `height` columns on `files`, filled at upload with `getimagesize()`. `pin_on_image` reads them from the file instead of storing `intrinsic_width/height` in `config`.
- **Video category.** Add `video` to `config/file_library.php` (`allowed.video = ['mp4']`, `max_video_mb = 50`). Videos are public like images (served from `/storage/library/{user}/videos/...`), count toward quota, and are checked by MIME (`video/mp4`). Raise PHP limits in `backend/Dockerfile` to `upload_max_filesize = 60M`, `post_max_size = 64M`. The frontend picker gains `accept: "video"`. Note: one 50 MB video is half of the default 100 MB quota — show that in the upload UI and consider a higher default quota for hosts.
- **Reference tracking.** `FileReferenceService` gets the new columns (`decks.cover_file_id`, `slides.media_file_id`, `slide_options.image_file_id`) as exact id matches (no filename `LIKE`). Deleting a file from My Files that a deck still uses shows the existing "still in use" warning. Because deletes are soft deletes and files stay on disk, decks keep showing the media.
- **Duplicate / delete.** Duplicating a deck or slide copies the `*_file_id` values — no new files, no extra quota. Deleting a deck or slide never touches My Files.
- **Ownership.** Attaching a file to a slide requires `FilePolicy::manage` (the file belongs to the deck owner).

### Implementation notes (done 2026-10-17)

Phase 1 is built: migrations are green on PostgreSQL, the full backend suite passes (681 tests), and a tinker smoke created a quest deck with all 20 slide types, snapshotted a session and broadcast to the dev Reverb. Where the code differs from the text above, **the code is the contract**; Phases 2–3 build against what follows.

**Where things live (backend/).**
- Schema: `database/migrations/Deck/2026_10_17_000001…000010` (loaded by `App\Providers\DeckServiceProvider`), plus `app/Modules/FileLibrary/Database/Migrations/2026_10_17_000101_add_dimensions_to_files.php` and `…000102_index_deck_file_references.php`. `slides (deck_id, position)` is unique only `WHERE deleted_at IS NULL`. Runs also snapshot `title_snapshot` / `body_snapshot`. `deck_session_slide_runs.slide_id` is `nullOnDelete`.
- Models and factories: `app/Models/Deck/*`, `database/factories/Deck/*`. Use `DeckFactory::newOwner()` for users in tests; `UserFactory` targets a `name` column that no longer exists.
- Engine: `app/Deck/Slides/{SlideTypeContract, AbstractSlideType, SlideTypeRegistry, ScoreResult, UnknownSlideType, AppendsSubmissions, TakesMedia}.php`. Types live in `app/Deck/Slides/Types/Quest/*` (11) and `app/Deck/Slides/Types/Content/*` (9). Helpers that are not types: `PollOptions`, `PollSettings`, `PollText`, `PointCloud`.
- Broadcasting: `app/Deck/Broadcasts/{BroadcastPayload, DeckChannels, DeckBroadcaster}.php` and `Payloads/*`. Q&A: `app/Deck/Qa/{LiveQaService, Jobs/BroadcastQaUpvoteCount}.php`. Trailing aggregate job: `app/Jobs/Deck/BroadcastDeckAggregate.php`. Config: `config/deck.php`.
- Tests: `tests/Feature/Deck/*`. `Phase1IntegrationTest.php` checks the shared rules across every registered type.

**Slide type contract (differs from §1.3).** `SlideTypeRegistry` discovers every concrete type under `app/Deck/Slides/Types`; nothing is registered by hand.
```php
key(); products(); category() /* poll|interactive|content */; revealModel(); acceptsAnswers();
defaultConfig(); defaultOptions() /* list<{label, payload}> */;
validateConfig(array $config): array;                                  // normalised; unknown keys dropped; bare error keys
validateAnswer(array $payload, array $config, array $options): array;  // returns the payload to store
score(array $payload, array $config, array $options, int $timeToAnswerMs): ScoreResult;
aggregate(array $config, array $options, Collection $answers): array;  // pure; answers = DeckParticipantAnswer rows
serializeForPresenter(DeckSessionSlideRun $run, array $aggregate): array;
serializeForParticipant(DeckSessionSlideRun $run): array;              // never aggregate / is_correct
// registry: for($key), has(), all(), keys(), forProduct($product), aggregate(DeckSessionSlideRun $run, ?Collection $answers = null)
```
- `$options` is the run's `options_snapshot`: `list<{id, position, label, image_file_id, image_url, is_correct, payload}>`.
- Validation error keys are bare (`option_ids`, `items.2`, `media`). Controllers add the `config.` / `answer_payload.` prefix in one place.
- Phase 2 must enforce minimum option counts: at least 2 for poll_single, poll_multi and ranking; at least 1 statement for scales.
- Phase 2 must also cap option counts, because aggregates are broadcast whole and Reverb drops publishes over 10,000 bytes. Measured worst-case Pusher bodies:

  | Type | Size measured | Over 10 KB at |
  |---|---|---|
  | ranking | 4.5 KB at 10 items, 6.0 KB at 12, 8.8 KB at 15 | 14.7 KB at 20 items |
  | scales (10 points) | 3.9 KB at 10 statements, 7.3 KB at 20 | 10.8 KB at 30 statements |
  | rating | 6.6 KB at 30 items | — |

  Suggested caps: ranking ≤ 12 items, scales ≤ 20 statements, everything else ≤ 30 options.
- `AppendsSubmissions` (word_cloud, open_ended): the submit endpoint merges a repeat submission with `mergeSubmissions()`; every other type replaces the answer (`updateOrCreate`). The interface docblock describes the locked insert-or-merge flow Phase 3 must implement, with a concurrency test.

**Per-type config / answer / aggregate (summary; each class docblock has the full shape).** Every live poll type's config ends with `show_results_to_participants: bool = false` (`PollSettings`; this is §5.6's "Show votes to participants").

| Type | Config (defaults) | Answer in → stored | Aggregate |
|---|---|---|---|
| `poll_single` | `result_layout: bars`, `submit_mode: instant\|confirm` | `{option_id}` | `{total_responses, total_votes, options[{option_id, count, percentage}]}` |
| `poll_multi` | `min_selections: 1`, `max_selections: null` | `{option_ids[]}` → in option order | as above; % of respondents, plus `average_selections_per_participant` |
| `word_cloud` | `max_entries_per_participant: 3` (total), `max_entry_length: 25`, `profanity_filter_enabled: true`, `allow_multiple_submissions: false` | `{entries[]}` → `{entries[], entry_times[]}` | `{total_responses, total_entries, distinct_words, truncated, words[{word, count, first_seen_at}]}`, ≤ 75 words within a 7,000-byte budget |
| `open_ended` | `max_length: 500`, `max_submissions_per_participant: 1`, `profanity_filter_enabled: true` | `{text}` → `{entries[{body, submitted_at}]}` | broadcast preview: 10 newest cards, bodies cut to 200 chars (`body_truncated`, `truncated`). Full pages come from `OpenEndedSlideType::page()` for `GET /aggregate?page=N` |
| `scales` | `scale_points: 5`, `scale_labels[5]`, `require_all_statements: false` | `{ratings[{option_id, value}]}` | `{total_responses, scale_points, statements[{option_id, count, mean, distribution[]}]}` |
| `ranking` | `require_full_ranking: true` | `{order[]}` (best first) | `{total_responses, item_count, items[{option_id, rank, average_position, count, position_counts[]}]}` |
| `qa_audience` | `allow_anonymous`, `show_feed_to_participants`, `sort: top\|newest`, `profanity_filter_enabled: true`, `max_question_length: 280` (10..1000) | no answers (`acceptsAnswers()` false) → `LiveQaService` | describes the feed only |
| `points_allocation` | `total_points: 100` | `{allocations[{option_id, points}]}`, sum must equal total → every option listed | `{total_responses, total_points, total_points_distributed, options[{option_id, points, percentage, average_points}]}` |
| `rating` | `scale: 3\|5\|7\|10 = 5`, `require_all_items: false` | `{ratings[{option_id, value}]}` | `{total_responses, scale, items[{option_id, count, mean, distribution[]}]}` |
| `matrix_2x2` | `x_axis{low, high}`, `y_axis{low, high}` | `{x, y}`, 0–100 (y 100 = top) | `{total_responses, total_points, points (latest 150), density{size: 20, counts}, centroid}` |
| `pin_on_image` | `max_pins_per_participant: 1` (snapshot adds `media`) | `{pins[{x, y}]}` or `{x, y}`, 0–100 from top-left | `{total_responses, total_pins, pins (latest 150), density}` |
| content (9) | heading `{subtitle}` (the heading text is the slide `title`); paragraph `{align, text_size}` with its rich text in `slides.body`, checked by `ParagraphSlideType::validateBody()`; bullets/numbered `{items[]}`; quote `{text, attribution}`; image `{caption, alt}`; video `{video_url}` plus derived `video_provider`/`video_id`/`embed_url` (`VideoSlideType::parseVideoUrl()`); big_text `{text}`; qr_code `{show_join_code}`, with the code and URL taken from the session | none | `[]` |

**Media (server-owned, `TakesMedia`).** `validateConfig()` drops any `media` an author sends. Only `withMedia(array $config, ?File $file)` adds `media = {file_id, url (File::url), width, height, mime}`. All content types and `pin_on_image` implement it.
- Session start: `$config = $type instanceof TakesMedia ? $type->withMedia($slide->config, $slide->mediaFile /* withTrashed */) : $slide->config`.
- Then, for pin_on_image (`requiresMedia()`), call `assertMediaPresent($config)`. It returns 422 keyed `media`, plus `media.*` reasons, when there is no image or its width/height are unknown. Older library images have null dimensions: Phase 2 should fill them lazily with `getimagesize` when a file is attached.
- `PUT /slides/{id}/media`: a `{file_id}` sets `media_file_id` and, on video slides, clears `config.video_url`. A `{video_url}` clears `media_file_id`.

**Broadcast payloads (`App\Deck\Broadcasts\Payloads`, all with `slide_run_id` + `server_time`).**
- `SlideChangedPayload::fromRun($run, $participantSlide, $totalSlides)` (public; any aggregate is removed).
- `SlideStateChangedPayload::fromRun($run)` (public): `{state, state_version, seconds_remaining, ends_at, duration_seconds, state_started_at, voting_started_at, closed_at}`.
- `SlideAggregateUpdatedPayload::fromRun($run, $aggregate, $visibility)`.
- `SlideClosedPayload::fromRun($run, ?$aggregate)` (always public).
- `AnswerSubmittedPayload::fromAnswer($answer, $totalResponses, $isUpdate)` (always host).
- `ParticipantCountUpdatedPayload::fromSession($session)` (public).
- `QaQuestionSubmittedPayload`, `QaQuestionUpvotedPayload` (the absolute count) and `QaQuestionModeratedPayload::forHost()/forPublic()`. A hidden question is redacted on the public channel to `{question_id, slide_run_id, is_hidden: true}`.
- All of these go out through `DeckBroadcaster::broadcast($session, $payload)`. It sends after the DB commit, synchronously, and routes host visibility only to `private-host.{product}.v2.{id}`. `LiveBroadcastEvent::fromPayload($payload, $channel, $meta = [], $now = false)` wraps a payload.

**Live services (§1.6–1.7 as built).**
- `LiveAggregateService::schedule(DeckSessionSlideRun $run, ?Closure $compute = null, ?int $debounceMs = null)`: call it after every accepted answer. It broadcasts on the leading edge, then queues one owner-locked trailing `BroadcastDeckAggregate` per run, which recomputes when it runs.
- `resultsVisibility($run)` returns public only for a `live_aggregate` type with `show_results_to_participants` on. `broadcastDeckAggregateNow()` and `broadcastClosed()` both follow it.
- Phase 3's close action must call `broadcastClosed($run)`: a public `slide.closed`, plus a host-only final aggregate when results are hidden. `GET /slide-runs/{id}/aggregate` must apply the same visibility rule to participants.
- `LiveSessionService` gains `publicChannelFor()`, `hostChannelFor()`, `deckHostChannel()` and `moduleFor()`. `broadcastParticipantCount()` accepts a `DeckSession` and counts after commit. `state()` and the joined/completed broadcasts stay legacy-only; Phase 3 builds its own state payload.
- `ParticipantTokenService` gains `issue()`/`validateRequest()`/`revokeParticipant()` for `DeckParticipant`, plus `participantForDeckSession(Request, $session)`, `resolveDeckParticipant($token, $session)` and `revokeForDeckSession($session)` (call it on session end).
- `LiveQaService`:
  - Methods: `submitQuestion($run, $participant, $body)`, `upvote()`, `removeUpvote()`, `moderate($question, $flags)` and `topN($run, $n, $sort = 'top', $includeHidden = false)`.
  - Moderation flags: `is_hidden|hide`, `is_starred|star`, `is_answered|mark_answered`. Values must be real booleans.
  - Errors are `ValidationException` (422) keyed `body`, `slide_run`, `participant`, `question` or `flags`.
  - Upvote broadcasts are debounced to 200 ms.

**Files (§1.9 as built).**
- `files.width`/`height` are recorded at upload.
- Images are resized to fit 1024 px with GD (jpeg, png, gif, webp) after EXIF orientation is applied. Animated GIFs and images over `max_image_pixels` are stored unchanged.
- The new `video` category accepts mp4 up to 50 MB.
- A daily upload cap applies (`max_daily_upload_mb`, error code `daily_upload_limit`).
- `FileReferenceService` counts deck covers, slides and options by id.
- The backend image and the `queue` service must be recreated (`docker compose up -d backend queue`) to pick up the new GD build, the PHP upload limits and the worker's `--sleep=0.2`.

## Phase 2 — Quest authoring API

**Goal.** REST endpoints the slide editor needs, scoped to `product=quest`.
**Duration.** 3 days.

### 2.1 Endpoints

Product-scoped under `/api/v1/quests/v2/` during coexistence. Thin wrappers on shared controllers pre-filter by `product=quest` and reject creation of Quiz-only slide types. After Quest v2 cutover, these can be aliased to `/api/v1/quests/` if we want clean public URLs.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/quests/v2` | Create empty quest with one `qr_code` slide at position 0 |
| `GET` | `/api/v1/quests/v2` | List user's quests (paginated) |
| `GET` | `/api/v1/quests/v2/{id}` | Full quest + slides + options |
| `PATCH` | `/api/v1/quests/v2/{id}` | Update title/settings/cover |
| `DELETE` | `/api/v1/quests/v2/{id}` | Soft-delete |
| `POST` | `/api/v1/quests/v2/{id}/duplicate` | Clone entire quest |
| `POST` | `/api/v1/quests/v2/{id}/slides` | Append new slide of given type (body: `{type}`; returns slide with defaults from registry) |
| `GET` | `/api/v1/quests/v2/{id}/slides/{slideId}` | Single slide |
| `PATCH` | `/api/v1/quests/v2/{id}/slides/{slideId}` | Update title/body/config/time |
| `DELETE` | `/api/v1/quests/v2/{id}/slides/{slideId}` | Delete + shift positions |
| `POST` | `/api/v1/quests/v2/{id}/slides/{slideId}/duplicate` | Clone slide to next position |
| `POST` | `/api/v1/quests/v2/{id}/slides/reorder` | Body: `[{id, position}, …]` — single transaction |
| `POST` | `/api/v1/quests/v2/{id}/slides/{slideId}/options` | Add option |
| `PATCH` | `/api/v1/quests/v2/{id}/slides/{slideId}/options/{optionId}` | Edit option |
| `DELETE` | `/api/v1/quests/v2/{id}/slides/{slideId}/options/{optionId}` | Delete option |
| `PUT` | `/api/v1/quests/v2/{id}/slides/{slideId}/options/{optionId}/image` | Attach a My Files image: body `{file_id}`; `{file_id: null}` detaches |
| `PUT` | `/api/v1/quests/v2/{id}/slides/{slideId}/media` | Attach slide media (`image`, `pin_on_image`, `video`): body `{file_id}` or, for video, `{video_url}` |
| `PUT` | `/api/v1/quests/v2/{id}/cover` | Attach deck cover: body `{file_id}` |

There are **no upload endpoints** here. The editor uploads through the library (`POST /api/v1/library/files`, which applies quota, type checks, resize and dedupe) and then attaches the returned `file_id`.

### 2.2 Per-type default configs

Registry's `defaultConfig()` provides. Examples:

- `poll_single` → 2 empty options, no time limit, `live_aggregate` reveal
- `poll_multi` → 3 empty options, `min_selections: 1`, `max_selections: null`
- `word_cloud` → `max_entries_per_participant: 3`, `profanity_filter_enabled: true`
- `open_ended` → `max_length: 500`, `max_submissions_per_participant: 1`
- `scales` → 3 statements, 5-point scale `[Strongly Disagree, Disagree, Neutral, Agree, Strongly Agree]`
- `ranking` → 4 items, reveal aggregated order
- `qa_audience` → no time limit, `allow_anonymous: true`, `show_feed_to_participants: true`, `sort: top`
- `points_allocation` → 3 options, `total_points: 100`
- `rating` → 3 items, `scale: 5` (1–5 stars)
- `matrix_2x2` → `x_axis: { low, high }`, `y_axis: { low, high }`, empty labels
- `pin_on_image` → requires an attached image (`media_file_id`); `max_pins_per_participant: 1`
- Content slides → type-specific minimal defaults

### 2.3 Images and video

All media comes from My Files (see §1.9):

- **Images:** jpg, png, gif, webp; up to 10 MB per file; resized to fit 1024×1024 on upload; counted toward the owner's quota.
- **Video:** either a YouTube/Vimeo URL (stored in `config.video_url`, no file) or an mp4 from My Files (up to 50 MB, counted toward quota). Transcoding stays out of scope — uploads must be browser-playable mp4.
- **`pin_on_image`:** pin coordinates are stored as percentages; the image's `width`/`height` come from the `files` row.
- Responses include the resolved URL (`File::url`) next to each `*_file_id`, so the editor and presenter never build storage paths.

### 2.4 Join-code generator

6-character alphanumeric (A-Z 2-9 — skip 0/O/1/I for legibility). Generated on session start, globally unique in `deck_sessions`. Collision retry: 5 attempts.

### 2.5 Validation flow

All config + answer validation goes through `SlideTypeRegistry` (Phase 1.3). Controllers stay thin:

```php
public function updateSlide(Request $request, string $questId, string $slideId)
{
    $slide = $this->load($questId, $slideId);
    $type  = $this->registry->for($slide->type);

    $validated = $request->validate([
        'title' => 'sometimes|string|max:280',
        'body'  => 'sometimes|array',
        'config' => 'sometimes|array',
        // …
    ]);

    if (isset($validated['config'])) {
        $validated['config'] = $this->validator->validate(
            $validated['config'],
            $type->validateConfig($validated['config'])
        );
    }

    $slide->update($validated);
    return SlideResource::make($slide);
}
```

**Phase 2 exit criteria:** Pest collection that creates a quest, appends every Quest slide type, edits each, reorders, duplicates the quest, deletes — all green on PostgreSQL. Quiz-only types (scored pick-answer, etc.) correctly rejected from `/api/v1/quests/v2/` endpoints with `422 Unsupported slide type for this product`.

---

## Phase 3 — Quest live-session API

**Goal.** State machine, live-aggregate broadcasting, Q&A moderation, per-type answer validation. Wire into existing Reverb infrastructure.
**Duration.** 4 days.

### 3.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/quests/v2/{id}/sessions` | Host starts a session → returns `{session_id, join_code, public_channel_key}`. Creates `deck_session_slide_runs` snapshots for all slides. |
| `GET` | `/api/v1/quest-sessions/v2/by-code/{code}` | Join-code lookup for participant join page |
| `GET` | `/api/v1/quest-sessions/v2/{id}/state` | Full resync snapshot (matches main plan §2.5 contract) |
| `POST` | `/api/v1/quest-sessions/v2/{id}/advance` | Host transitions (see 3.2) |
| `POST` | `/api/v1/quest-sessions/v2/{id}/end` | Host ends session early |
| `POST` | `/api/v1/quest-sessions/v2/{id}/participants/join` | Anonymous join — `{display_name, emoji_avatar}` → `{participant_id, participant_token, public_channel_key}` |
| `POST` | `/api/v1/quest-sessions/v2/{id}/slide-runs/{runId}/answers` | Submit answer (participant-token auth) |
| `POST` | `/api/v1/quest-sessions/v2/{id}/slide-runs/{runId}/qa/questions` | Submit Q&A question |
| `POST` | `/api/v1/quest-sessions/v2/{id}/qa/questions/{qid}/upvote` | Upvote a Q&A question |
| `DELETE` | `/api/v1/quest-sessions/v2/{id}/qa/questions/{qid}/upvote` | Remove upvote |
| `PATCH` | `/api/v1/quest-sessions/v2/{id}/qa/questions/{qid}` | Host moderation (hide/star/mark_answered) |
| `GET` | `/api/v1/quest-sessions/v2/{id}/slide-runs/{runId}/my-answer` | Participant's own answer (after closure) |
| `GET` | `/api/v1/quest-sessions/v2/{id}/slide-runs/{runId}/aggregate` | Snapshot for late-joiners / reconnects |

### 3.2 Advance endpoint

Single entry point for host-driven transitions. Server enforces legal transitions.

Body: `{ action: 'start_voting' | 'close_voting' | 'next_slide' | 'previous_slide' | 'jump_to', target_run_id? }`

- `start_voting` from `waiting` → `get_ready` (if configured) → schedules transition job → `voting`
- `close_voting` from `voting` → `closed`
- `next_slide` from `voting` → auto-close current + move to next → `waiting`
- `previous_slide` → confirm modal on frontend; server allows with `force=true` flag

Transitions are implemented as Redis-backed delayed jobs (`TransitionSlideRunJob`). Every transition increments `state_version` and broadcasts `slide.state.changed`. Host short-circuits via direct action. Delayed jobs must carry `session_id`, `slide_run_id`, and `expected_state_version`; on execution they reload the run and no-op if the run/state/version no longer match, preventing stale jobs from closing the wrong slide after a host advance.

### 3.3 Per-type answer submission

Controller delegates to registry:

```php
public function submitAnswer(Request $request, string $sessionId, string $runId)
{
    $participant = $this->participantToken->resolve($request->header('X-Participant-Token'), $sessionId);
    $run = DeckSessionSlideRun::findOrFail($runId);

    abort_if($run->deck_session_id !== (int) $sessionId, 404);
    abort_if($run->state !== 'voting', 409, 'Not accepting answers');

    $type = $this->registry->for($run->type_snapshot);

    $validated = $this->validator->validate(
        $request->input('answer_payload'),
        $type->validateAnswer($request->input('answer_payload'), $run->config_snapshot)
    );

    $timeToAnswerMs = now()->diffInMilliseconds($run->voting_started_at);

    DB::transaction(function () use (...) {
        DeckParticipantAnswer::updateOrCreate(
            ['deck_participant_id' => $participant->id, 'slide_run_id' => $run->id],
            ['answer_payload' => $validated, 'time_to_answer_ms' => $timeToAnswerMs, 'submitted_at' => now()],
        );
    });

    $this->liveSessions->afterCommit(fn () => $this->aggregate->schedule($run, $type, debounceMs: 500));
    $this->liveSessions->afterCommit(fn () => $this->broadcast->private($run, new AnswerSubmittedPayload(...)));

    return response()->noContent();
}
```

**Opaque response.** Quest doesn't have "correct answer" semantics, but we still return `204 No Content` (not the aggregate) — participants see aggregates via the public broadcast or via `GET /slide-runs/{id}/aggregate` when the slide closes. This keeps the answer-submit path uniform with Quiz v2 (where opacity matters).

### 3.4 Q&A semantics

- Questions submitted while slide is `open` (Q&A's voting state)
- Participants can upvote once per question (enforced by unique index on `deck_qa_upvotes`)
- Participants can upvote their own questions (Mentimeter allows this)
- Host moderation:
  - `is_hidden: true` — removes from public feed broadcasts; host can unhide
  - `is_starred: true` — pins to top of host presenter view
  - `is_answered: true` — strikethrough in feed + moved to "answered" section
- All moderation state broadcasts on both public (redacted — no `is_hidden=true` questions) and private (full state)

Participant view of Q&A feed:
- Sorted by `top` (upvotes desc) or `newest` (default configurable per slide)
- Real-time updates via `qa.question.submitted` and `qa.question.upvoted` events
- Hidden questions disappear
- Own question always visible to submitter (even if hidden by host — optional UX, TBD)

### 3.5 Per-type aggregate formulas

| Type | Aggregate formula |
|---|---|
| `poll_single` | `[{option_id, count}, …]`, `total_votes` |
| `poll_multi` | Same + `average_selections_per_participant` |
| `word_cloud` | `[{word, count, first_seen_at}, …]` normalised (lowercase, trim); host client renders with `highcharts-wordcloud` (already in deps per main plan §1.3) |
| `open_ended` | `[{id, body, participant_emoji, submitted_at}, …]`, paginated (20/page) |
| `scales` | Per statement: `[{value, count}, …]` + mean; stacked-bar presenter |
| `ranking` | Weighted average position per item: `sum(position) / count`; lower = better; presenter renders sorted |
| `qa_audience` | Via `LiveQaService::topN()` — handled separately |
| `points_allocation` | Per option: `sum(allocated) / total_points_distributed * 100` (percentage) |
| `rating` | Per item: mean + count + distribution histogram |
| `matrix_2x2` | `total_points`, the latest 150 raw points `[{x, y}, …]` (percentages 0–100), a 20×20 `density` grid of every point, and the centroid of every point; presenter renders scatter |
| `pin_on_image` | `total_pins`, the latest 150 raw pins `[{x, y}, …]` (percentages 0–100) and a 20×20 `density` grid of every pin; presenter overlays pins + heatmap (client-side gaussian blur on canvas) |

Every aggregate function is pure and deterministic — same inputs → same output. Easy to unit test.

Aggregates go out whole (`slide.aggregate.updated`, `slide.closed`, public or host channel), and Reverb rejects publish requests over `REVERB_MAX_REQUEST_SIZE` (10,000 bytes by default), so an aggregate must not grow with the audience. That's why matrix and pin cap their raw lists (`PointCloud`). List-shaped aggregates (`word_cloud`, `open_ended`) need the same care.

### 3.6 Participant join with emoji

```php
// POST /api/v1/quest-sessions/v2/{id}/participants/join
// Body: { display_name, emoji_avatar }

$session = DeckSession::where('id', $id)->firstOrFail();
abort_unless($session->status === 'live', 403);

$rawToken = Str::random(64);
$participant = DeckParticipant::create([
    'deck_session_id' => $session->id,
    'display_name'    => $request->display_name,
    'emoji_avatar'    => $request->emoji_avatar,   // validated against curated ~40 emoji list
    'participant_token_hash'       => hash('sha256', $rawToken),
    'participant_token_expires_at' => now()->addHours(6),
]);

$this->liveSessions->afterCommit(fn () => $this->broadcast->private($session, new ParticipantJoinedPayload(...)));
$this->liveSessions->afterCommit(fn () => $this->broadcast->public($session, new ParticipantCountUpdatedPayload(...)));

return ['participant_id' => $participant->id, 'participant_token' => $rawToken, 'public_channel_key' => $session->public_channel_key];
```

Emoji list = `config/deck.php` constant of ~40 curated emoji. Reject anything not in list. Avatar shown in Q&A feed, open-ended feed, and presenter-side "recent submissions" ticker.

### 3.7 Tests (Pest, PostgreSQL)

- Full happy path per type: author → session start → 3 participants join → submit answers → aggregate correct → close voting → reconnect participant → `GET /aggregate` returns frozen result.
- Q&A: 3 participants, cross-upvote, host hides one, host stars another, `topN` returns correct order.
- 100-points: rejects submission where sum ≠ 100.
- Matrix 2×2: rejects coordinate outside [0, 100] (percentages of the plane, the same unit as pin_on_image).
- Pin-on-image: rejects pin outside image bounds; deduplicates if participant re-submits.
- Reconnect after `voting → closed`: state endpoint returns `closed` + final aggregate.
- Quiz-only slide types rejected on Quest session endpoints.
- Token revocation: revoked token → 401 on answer submission.

**Phase 3 exit criteria:** full Pest suite green on PostgreSQL; Tinker-driven smoke test with 3 participants produces correct aggregates across every Quest type.

### Implementation notes (Phases 2–3, done 2026-10-18)

Phases 2 and 3 are built and pass. The full backend suite is green on PostgreSQL: 903 tests, 819 of them in `tests/Feature/Deck`. Those include `QuestV2EndToEndTest.php`, which covers §3.7's first bullet for all 10 answer-taking types, each run with results public and with results hidden. It also covers Q&A, a timed slide, a whole-deck walkthrough, and token revocation after the end, all through the HTTP API only.

A throwaway tinker smoke drove the real kernel against dev PostgreSQL, Redis and Reverb. Three participants answered every Quest type plus Q&A, and each aggregate matched the expected numbers. The smoke then removed every row it had created. Where the code differs from §2–§3, **the code is the contract** for Phases 4–7.

Follow-ups on 2026-10-19: option reorder endpoint, a 100-slide cap with `slide_limit_reached`, gating by the `quest_v2_enabled` flag (`feature_disabled`), a per-IP `deck-lookup` throttle on by-code, and `syncDue` on aggregate reads. After them the suite has 910 tests, 826 of them in `tests/Feature/Deck`, all green.

**Where things live (backend/).**
- Routes: `routes/deck/{meta, quest_authoring, quest_media, quest_sessions, quest_participants, quest_qa, quest_review}.php`. Each file registers through `DeckRoutes::authoring()`/`sessions()`, once per product in `config('deck.routes')`. Quiz v2 needs only a config entry.
- Authoring: `app/Deck/Authoring/*`. Media: `app/Deck/Media/DeckMediaService.php`. Sessions: `app/Deck/Sessions/{SessionLauncher, SessionStateMachine, JoinCodeGenerator}.php` and `app/Jobs/Deck/TransitionSlideRunJob.php`. Participants: `app/Deck/Participants/*`. Q&A: `app/Deck/Qa/SessionQaService.php`. Controllers: `app/Deck/Http/Controllers/**`.

#### Conventions
- Envelope: `{status, message, data}`. Validation errors return 422 `data.validation_errors.{key}`. Every other error carries `data.code`: `not_found`, `conflict`, `invalid_state`, `unsupported_type`, `slide_limit_reached`, `forbidden`, `feature_disabled`, `unauthorized`, `results_hidden` or `too_many_requests`, sometimes with extra keys.
- **Rollout flag (added 2026-10-19):** authoring and hosting need `users.quest_v2_enabled` (Filament → Users → Features → "Quest v2"), or `QUEST_V2_DEFAULT_ENABLED=true` (`config('deck.quest_v2_default_enabled')`) for everyone. Without it they answer **403** `{message: "Quest v2 is not enabled for your account.", data.code: 'feature_disabled'}`, checked after Sanctum (signed out stays 401) and before any lookup or validation. Gated: every `/quests/v2` route (deck CRUD, slides, options, media, cover, start session), and on `/quest-sessions/v2` advance, end, Q&A moderation, and the **host branch** of state, aggregate and the Q&A feed. Never gated: by-code, join, every participant-token route (state, answers, my-answer, aggregate, Q&A, review) and `meta/emoji-avatars`. `GET /api/v1/profile/show` returns `data.profile.quest_v2_enabled` as the effective value (own flag OR the config default). Code: `App\Deck\Support\DeckFeature`, middleware alias `deck.feature`.
- **Casing:**
  - Request bodies are snake_case everywhere.
  - Authoring responses (`/quests/v2/...`) use the owner-only camelCase presenters (`DeckPresenter`, `SlidePresenter`, `OptionPresenter`). They include `isCorrect`. Never show them to participants.
  - Live endpoints (`/quest-sessions/v2/...`, session start) are snake_case, the same shape as the broadcast payloads.
- Another user's deck or session, another product's, or a soft-deleted one answers **404**, never 403.
- Positions are 1-based. A new deck has one `qr_code` slide at position 1. Reorder requests (slides and options) use the same 1-based positions.
- Throttles:
  - `deck-author` for authoring and host routes.
  - `deck-join` for join.
  - `deck-lookup` for `GET by-code` (added 2026-10-19), per IP only, so made-up tokens no longer bypass it: 30 misses (404) a minute per IP, and 300 lookups a minute per IP overall (a classroom shares one address). Over either → 429.
  - `deck-participant` plus a per-IP cap (`ParticipantReadAccess::IP_THROTTLE`, 1,800/min) on token routes. On answers, Q&A, my-answer, aggregate, Q&A feed and review, the per-IP cap applies whatever token is sent.
- Participant auth uses the `X-Participant-Token` header (64 characters, returned by join). Host auth is Sanctum. **A presenter client must not send `X-Participant-Token`.** On the dual routes (state, aggregate, Q&A feed), the header selects the participant view.

#### Endpoint table

Authoring (`/api/v1/quests/v2`, Sanctum + `throttle:deck-author` + `deck.feature`). Names are `deck.quest.*`. Every row can also answer 403 `feature_disabled`.

Slide cap (2026-10-19): `config('deck.max_slides_per_deck')` (`DECK_MAX_SLIDES_PER_DECK`, default **100**) live slides per deck, enforced on append, bulk, slide duplicate and deck duplicate. Over it → 422 `{message: "A deck can have at most 100 slides.", data: {code: 'slide_limit_reached', max_slides: 100, validation_errors: {slides: [same message]}}}`; nothing is written.

| Method | Path | Request | Response `data` | Errors |
|---|---|---|---|---|
| GET | `/` | `?search` (≤100), `sort=updated\|created\|title`, `direction=asc\|desc`, `per_page` 1..50 (default 20), `page` | `{items:[deck summary], meta:{currentPage, perPage, total, lastPage}}` | 422 |
| POST | `/` | `{title?` ≤255 (default "Untitled quest"), `description?` ≤2000, `settings?}` | 201 `{deck: detail}`, seeded with one qr_code slide | 422 |
| GET | `/{deck}` | – | `{deck: detail}` (slides in position order, options, media) | 404 |
| PATCH | `/{deck}` | `{title?, description?, settings?}`; settings merge onto the stored ones, and null resets a key | `{deck: summary}` | 404, 422 (unknown settings key) |
| DELETE | `/{deck}` | – | `{}`, soft delete (not blocked by sessions) | 404 |
| POST | `/{deck}/duplicate` | – | 201 `{deck: detail}`, titled "Copy of …", with file refs copied and no new files | 404, 422 `slide_limit_reached` |
| POST | `/{deck}/slides` | `{type, after_position?}` (null/absent = end, 0 = first) | 201 `{slide, order}` | 422 `unsupported_type`, 422 `slide_limit_reached` |
| POST | `/{deck}/slides/bulk` | `{slides:[{type, title?, body?, config?, options?:[{label?, payload?}]}], after_position?}`, 1..50; all-or-nothing | 201 `{slides, order}` | 422 keyed `slides.N.*`, 422 `slide_limit_reached` |
| POST | `/{deck}/slides/reorder` | `{slides:[{id, position}]}` covering every live slide | `{order}` | 422 `slides.N.id`, 409 `conflict` (a slide is missing) |
| GET | `/{deck}/slides/{slide}` | – | `{slide}` | 404 |
| PATCH | `/{deck}/slides/{slide}` | `{title?` ≤280, `body?` (paragraph only), `config?` (merged recursively onto the stored config; lists replace), `time_limit_seconds?` 5..3600\|null, `get_ready_seconds?` 0..30\|null`}` | `{slide}` | 422 `config.<key>`, `title`, `body` or the timer keys (types that take no answers have no timer), plus the broadcast-budget 422 below |
| DELETE | `/{deck}/slides/{slide}` | – | `{order}`, soft delete; later slides close up | 404 |
| POST | `/{deck}/slides/{slide}/duplicate` | – | 201 `{slide, order}` at the next position | 404, 422 `slide_limit_reached` |
| POST | `/{deck}/slides/{slide}/options` | `{label?` ≤200, `payload?` object ≤512 B`}` | 201 `{option, slide}`, appended last | 422 `options` (at the cap, or the type takes no options) |
| POST | `/{deck}/slides/{slide}/options/reorder` (2026-10-19, `deck.quest.options.reorder`) | `[{id, position}]` (bare list, or `{options:[...]}`); positions are **1-based** and must be exactly `1..n`; every option of the slide exactly once | `{slide}`, options in the new order (stored `position` 1..n); one transaction | 404 (deck/slide), 422 `options.N.id` (not on this slide, or repeated), `options.N.position` (outside 1..n or repeated), `options` (empty or too long), 409 `conflict` (an option is missing: "The option list changed. Reload and try again.") |
| PATCH | `/{deck}/slides/{slide}/options/{option}` | `{label?, payload?}` | `{option, slide}` | 404, 422 |
| DELETE | `/{deck}/slides/{slide}/options/{option}` | – | `{slide}`, hard delete; later options close up | 422 `options` (below the minimum) |
| PUT | `/{deck}/slides/{slide}/options/{option}/image` | `{file_id: int\|null}` | `{option}` | 404 `File not found.`, 422 `file_id` |
| PUT | `/{deck}/slides/{slide}/media` | exactly one of `{file_id}`, `{file_id:null}`, `{video_url}`, `{video_url:null}` | `{slide}` (`mediaFileId`, `media`; video slides get the derived `config.video_*` keys) | 422 `file_id` / `video_url` (wrong kind, wrong type, bad link, unreadable pin_on_image image) |
| PUT | `/{deck}/cover` | `{file_id: int\|null}` | `{deck: summary}` | 404, 422 `file_id` |
| POST | `/{deck}/sessions` | – | 201 HOST STATE | 404, 409 `conflict` (no slides, or a live session already exists: `data.session_id`), 422 `unsupported_type` / `slides.{pos}.media*` |

Live session (`/api/v1/quest-sessions/v2`). Names are `deck.quest.sessions.*`.

| Method | Path | Auth | Request | Response `data` | Errors |
|---|---|---|---|---|---|
| GET | `/by-code/{code}` | public, `throttle:deck-lookup` (per IP) | case-insensitive; spaces and dashes ignored | `{session_id, join_code, product, deck_title, status, public_channel_key}` (live only) | 404, 429 |
| GET | `/{session}/state` | host (Sanctum) **or** participant (token) | – | HOST STATE or PARTICIPANT STATE | 401, 404, 403 `feature_disabled` (host branch) |
| GET | `/{session}/participant-state` | participant | – | PARTICIPANT STATE (alias) | 401, 404 |
| POST | `/{session}/advance` | host | `{action: start_voting\|close_voting\|next_slide\|previous_slide\|jump_to, target_run_id?, force?}` | HOST STATE | 409 `invalid_state` `{slide_run_id, state, state_version, requires_force?}` or `{status}`, 404 (jump target), 422, 403 `feature_disabled` |
| POST | `/{session}/end` | host | – | HOST STATE | 409 (already ended), 403 `feature_disabled` |
| POST | `/{session}/participants/join` | public, `throttle:deck-join` | `{join_code, display_name` 1..40, `emoji_avatar` (one of `GET /api/v1/meta/emoji-avatars`)`}` | 201 `{participant_id, participant_token, public_channel_key, session_id, display_name` (cleaned + masked), `emoji_avatar}` | 404 (unknown session **or wrong code**), 409 `invalid_state` `{session_status:'pending'}`, 403 `forbidden` `{session_status:'ended'}`, 422 |
| POST | `/{session}/slide-runs/{run}/answers` | participant | `{answer_payload: object}` (≤ `deck.max_answer_body_kb` = 32 KB) | **204** | 401, 404, 409 `invalid_state` `data.reason` = `no_answers` \| `session_not_live` \| `not_current_slide` (+`current_slide_run_id`) \| `not_voting` (+`state, state_version`) \| `time_up`; 413 `payload_too_large`; 422 `answer_payload.*`, 422 `unsupported_type` |
| GET | `/{session}/slide-runs/{run}/my-answer` | participant (review token too) | – | `{slide_run_id, answer_payload` (as stored), `time_to_answer_ms, submitted_at}` | 404 `You have not answered this slide.` |
| GET | `/{session}/slide-runs/{run}/aggregate[?page=N]` | host or participant (review token too) | `page` (open_ended full-text pages, 20 a page) | `{slide_run_id, type, state, state_version, closed_at, final, visibility, total_responses, aggregate, server_time}`; applies an overdue timer first (`syncDue`, 2026-10-19), so it never reports `voting`/`final:false` past the deadline | 403 `results_hidden` (participant: results not public, or a run the host has not reached), 403 `feature_disabled` (host without the flag and no token; with a token it is a participant read), 401, 404 |
| POST | `/{session}/slide-runs/{run}/qa/questions` | participant | `{body}` (trimmed, ≤ `config.max_question_length`) | 201 `{question: participantItem}` | 409 `invalid_state` `reason` = `not_qa_slide` \| `session_not_live` \| `not_open`; 422 `body`; 429 `too_many_requests` (+`retry_after`; `deck.qa_questions_per_minute`, default 10) |
| GET | `/{session}/slide-runs/{run}/qa/questions` | host or participant (review token too) | `?sort=top\|new\|newest&limit=1..500` (default: the slide's sort, 100) | `{slide_run_id, state, viewer, sort, show_feed_to_participants, own_only, total, limit, questions:[item]}` | 401, 404, 409 (not a Q&A run), 403 `feature_disabled` (host branch) |
| POST / DELETE | `/{session}/qa/questions/{question}/upvote` | participant | – | `{question_id, slide_run_id, upvote_count, has_upvoted}` (idempotent) | 404 (hidden, another session's, or another participant's while the feed is hidden), 409 `not_open` |
| PATCH | `/{session}/qa/questions/{question}` | host | any of `is_hidden\|hide`, `is_starred\|star`, `is_answered\|mark_answered` (booleans) | `{question: hostItem}` | 422 `flags`, 404, 403 `feature_disabled` |
| GET | `/{session}/review` | participant (review token) | – | REVIEW (below) | 409 `invalid_state` `reason: session_not_ended`, 401, 404 |
| GET | `/api/v1/meta/emoji-avatars` | public, cacheable | – | `{emojis:[40], labels:{emoji: label}}` | – |

#### State payloads
- **HOST STATE** (start, advance, end and host GET state):
  - Identity and join info: `{session_id, join_code, public_channel_key, session:{id, deck_id, product, deck_title, status, current_slide_run_id, total_slides, started_at, ended_at}, join:{join_code, join_url (FRONTEND_URL + /join/{CODE}), public_channel_key}, channels:{public:'session.quest.{key}', host:'host.quest.v2.{id}'}, participant_count`.
  - Runs: `runs:[participant view of every run]` and `current_run: presenter view (participant view + live aggregate) | null`.
  - Results and timer: `results_visibility: 'public'|'host'|null, seconds_remaining, ends_at, duration_seconds, server_time}`.
  - The Q&A feed is not included; read it from the feed GET.
- **PARTICIPANT STATE:**
  - Session and participant: `{session_id, session:{…same as host… + public_channel_key}, participant:{id, display_name, emoji_avatar}`.
  - Current run: `current_run` and `current_slide_run` (the same participant view, never an aggregate or answer key), `has_answered`, `my_submission_for_current_slide` (my-answer shape) or null.
  - Results and timer: `results_visibility`, `aggregate` (only when results are public, else null), `seconds_remaining, ends_at, duration_seconds, server_time}`.
  - A participant never receives the list of runs while the session is live.
- **Run (participant view, `serializeForParticipant`):**
  - Identity: `{id, slide_id, type, category, reveal_model, accepts_answers, position, title, body`.
  - Content: `config` (snapshot; answer keys and `_`-prefixed keys stripped; pin_on_image and image slides carry `media{file_id, url, width, height, mime}`) and `options:[{id, position, label, image_url, payload}]`.
  - State and timer: `state, state_version, time_limit_seconds, get_ready_seconds, state_started_at, voting_started_at, closed_at}`. Answers reference option **`id`** from here.
- **REVIEW** (new, ended sessions only): `{session_id, session:{id, deck_id, product, deck_title, status, total_slides, started_at, ended_at, public_channel_key}, participant, runs:[participant view + {my_answer|null, results_visibility, aggregate|null}], server_time}`. Q&A runs return `aggregate: null`; read their questions from the feed GET with the same token.
- Broadcasts:
  - `slide.changed` carries the participant view. If the body would be over 8,500 bytes, it carries a slim `{id, slide_id, type, category, reveal_model, accepts_answers, position, state, state_version, refetch:true}` instead; clients then GET state.
  - New events: `session.ended` (public) `{slide_run_id, session_id, status:'ended', ended_at, server_time}` and `participant.joined` (host) `{participant_id, display_name, emoji_avatar, joined_at}`.
  - `answer.submitted` (host) carries only the incoming submission, shortened when large (`body_truncated` / `truncated` / `{omitted:true}`).

#### State machine
- Run kinds:
  - Answer types: `waiting → get_ready` (only when `get_ready_seconds > 0`) `→ voting → closed`.
  - Q&A: `waiting → open → closed`, with no timer.
  - Content: stays `waiting`; `start_voting` on it gives 409.
- `start_voting` works only from `waiting`. `close_voting` works only from `voting`/`open`. A closed run never reopens.
- Leaving an active run (next, previous, jump or end) closes it. Moving backwards away from an active run needs `force:true`; without it the response is 409 with `requires_force`. Forward jumps close the run without asking.
- `next_slide` on the last run, `previous_slide` on the first, and `jump_to` the current run all give 409. Navigating never changes the state of the run it lands on. `state_version` starts at 0 and goes up on every transition.
- Timers:
  - Snapshots come only from the slide's own `time_limit_seconds`/`get_ready_seconds`; null or 0 means off. Authoring seeds them from the deck settings `default_time_limit`/`get_ready_seconds` when the slide is created; later deck changes never reach existing slides.
  - `TransitionSlideRunJob` fires at the deadline. Every state read, aggregate read (host and participant) and host action first applies an overdue timer (`syncDue`), so a late queue never leaves a run open.
  - Answers after `voting_started_at + time_limit + 1 s` get 409 `time_up`.
- `end` closes the active run, sends `slide.closed` and then `session.ended`, and revokes every participant token. Revoked tokens still work for the **read** routes (my-answer, aggregate, Q&A feed, review) of that ended session until the token's own expiry (6 h after the join). Writes and state give 401.

#### Answers: payload and merge rules
- Inbound payloads follow the Phase 1 table above, and `validateAnswer()` normalises them.
- One row is kept per participant per run, with a locked insert-or-merge:
  - `word_cloud`: the new entries replace the old ones, or are appended when `allow_multiple_submissions` is on (up to `max_entries_per_participant`).
  - `open_ended`: entries are appended up to `max_submissions_per_participant`; at 1 they replace.
  - Every other type replaces the stored answer.
- `time_to_answer_ms` and `submitted_at` are refreshed on every submission.
- Rejected cases:
  - `points_allocation` whose sum ≠ total.
  - `matrix_2x2` or `pin_on_image` coordinates outside 0..100.
  - `ranking` that leaves items out while `require_full_ranking` is on.
  - `pin_on_image` with more pins than the cap. Exact duplicate pins are dropped.

#### Decisions taken
- **Participant state route:** `GET {session}/state` serves both callers, chosen by the token header. `participant-state` is an alias.
- **Review (§7.5):** tokens are revoked at the end, but a token revoked *by the end* still reads my-answer, aggregate, the Q&A feed and the new `GET {session}/review`. A participant the host removed before the end stays locked out.
- **Results visibility:** participants see aggregates only when `config.show_results_to_participants` is true (default false) **and** the host has reached that run. Otherwise they get 403 `results_hidden`, or `aggregate:null` in state and review. The host always sees them.
- **Hidden Q&A questions** are hidden from every participant, the author included. Upvoting a hidden question gives 404.
- **`show_feed_to_participants:false`:** participants see only their own questions (`own_only:true`).
- **Q&A feed order:** the host feed lists starred questions first and then the chosen sort, and includes hidden ones. The participant feed excludes hidden questions. Own upvotes are allowed.
- **Display names:** they never appear in Q&A items or aggregates. Only the emoji is shown. `allow_anonymous` is not enforced.
- **Joining:**
  - Join needs the join code, so a guessed session id alone is not enough.
  - Every join creates a new participant; there is no rejoin.
  - A pending session gives 409; an ended one gives 403.
- **Slide size limit:** authoring refuses slide edits whose `slide.changed` body would exceed 8,500 bytes. These 422s land on `config`, `body`, `title`, `options`, `payload`/`label` or `slides.N`.
- **Option payloads** are capped at 512 B.

#### For the frontend (Phases 4–7)
- **Join flow (7.1):**
  1. `GET by-code/{code}` gives `session_id`.
  2. `POST {session_id}/participants/join {join_code, display_name, emoji_avatar}`.
  3. Store `participant_token` and `public_channel_key`. Subscribe to `session.quest.{key}`.
  - Load the emoji picker from `GET /api/v1/meta/emoji-avatars`.
- **Reconnect (7.6):** `GET {session}/state` with the token. Use `current_slide_run` and `my_submission_for_current_slide`. When `slide.changed` carries `refetch:true`, GET state again. Count down from `ends_at`, corrected by `server_time`; when it reaches 0, GET state to apply the server's transition.
- **Review (7.5):** after `session.ended`, call `GET {session}/review` with the same token. For open_ended pages use `GET .../aggregate?page=N`; for Q&A, the feed GET.
- **Presenter (Phase 6):** use host state and the host channel `private-host.quest.v2.{id}`, where hidden-results aggregates arrive. Load the Q&A panel from the feed GET with no token header. Send `force:true` after the "go back" confirmation.
- **Editor (Phase 5):**
  - Upload through `POST /api/v1/library/files`, then attach with `PUT .../media|cover|image`.
  - The response's `order` array is authoritative after any move.
  - `config` PATCH merges. For scales, `scale_points` may be sent alone.
  - Show 422 keys inline (`config.x`, `options`, `file_id`, `video_url`, `slides.N.*`).
  - Option drag-reorder: `POST .../slides/{slide}/options/reorder` with every option as `[{id, position}]`, positions 1..n (list index + 1, same as returned `position`). Replace the slide from the response's `slide`. On 409 `conflict`, refetch the slide.
  - Slide cap: on `data.code === 'slide_limit_reached'` show `message` (also on `validation_errors.slides`); `data.max_slides` is the cap.
  - Route to the v2 editor/presenter only when `profile.quest_v2_enabled` is true. Any authoring or hosting call can still answer 403 `feature_disabled` (the flag can be turned off at any time); show its `message`.
- Answers return 204 with no body. Show the submitted state, then rely on `has_answered`/`my_submission_for_current_slide` after a reload.

---

## Phase 4 — Native-feel PWA participant shell (shared)

**Goal.** A participant-side UI shell that feels like a native Android/iOS app. Built here, inherited by Quiz v2 later.
**Duration.** 4–5 days.

This phase is a dependency for Phase 7 (Quest participant views) and for Quiz v2's participant path.

### 4.1 PWA infrastructure

- **Manifest** (`frontend/public/manifest.webmanifest`): `name`, `short_name`, `theme_color`, `background_color`, `display: standalone`, `start_url`, iconography (192×192, 512×512, maskable).
- **Service worker** (lightweight). Cache the shell (HTML + JS + CSS + fonts + emoji set). **Do not** cache session-data API responses — session must always be fresh. Use `next-pwa` or a hand-rolled minimal SW; prefer the latter for transparency.
- **Meta tags** in `app/(public)/layout.tsx`:
  - `apple-mobile-web-app-capable`
  - `apple-mobile-web-app-status-bar-style: black-translucent`
  - `theme-color` (dynamic — matches deck's background theme)
  - `viewport: width=device-width, initial-scale=1, viewport-fit=cover` (critical for safe-area)
- **Apple touch icons** (sizes 180×180, splash screen images for major iOS device resolutions).
- **Install prompt**. Capture `beforeinstallprompt` event. Show a one-time banner after successful join: "Add MindSpear to your home screen for the full experience." Dismissible; suppressed if already installed (`display-mode: standalone` detect).

### 4.2 Layout primitives

`features/live/components/shell/`:

- `AppShell.tsx` — full-viewport frame with safe-area padding (`env(safe-area-inset-*)`). Provides context for theme-color, status-bar style, and keyboard-inset height.
- `TopBar.tsx` — compact title bar, back button (hardware-back aware on Android via History API), optional right-action button. Styled to look like iOS large-title or Android Material-3 top app bar.
- `BottomNav.tsx` — tabbed bottom bar for the participant hub (join / slides / profile). Only shown on hub screens, hidden during active slide answering.
- `SheetModal.tsx` — iOS-style bottom sheet with drag-to-dismiss, momentum, and backdrop. Used for: emoji picker, confirmation dialogs, info overlays.
- `TapFeedback.tsx` — wrapper that adds press-in scale animation + optional haptic pulse via `navigator.vibrate(10)`.
- `KeyboardAwareView.tsx` — uses `visualViewport` API to shift content up when software keyboard opens, matching native behaviour. Degrades gracefully where unsupported.
- `LoadingDots.tsx` — three-dot native-style loader.
- `PullIndicator.tsx` — for any screen where refresh applies (not during live session; only on reconnection-retry screens).

All primitives themable via a `ParticipantThemeContext` that inherits the deck's color settings.

### 4.3 Navigation patterns

- **Routes**: `/join`, `/join/[code]`, `/join/[code]/avatar`, `/play/[publicChannelKey]`, `/play/[publicChannelKey]/review`. No more multi-layer layouts — one `(public)` layout wraps them all with `AppShell`.
- **Transitions**: slide-in right for forward, slide-in left for back (View Transitions API where supported; CSS fallback otherwise).
- **Hardware back**: honours browser back. If user backs out of a live session, show sheet modal: "Leave session? You'll lose your place." (but on true browser navigation, can't always intercept — best-effort).

### 4.4 Interaction polish

- **Haptics**: short pulse (10ms) on option tap, medium pulse (20ms) on submit, success pulse (double) on reveal-correct (Quiz v2 later). Behind a user setting (default on; Android vibration is disabled on iOS Safari — detect and no-op).
- **Momentum scroll**: `-webkit-overflow-scrolling: touch` on all scroll containers.
- **No-tap-delay**: `touch-action: manipulation` on all interactive elements.
- **No double-tap zoom** on interactive surfaces.
- **Long-press disabled** where not meaningful (prevents context menus on images).

### 4.5 Emoji avatar picker

`SheetModal` with a 5-column grid of the curated ~40 emoji. Selection previews in a big circle up top. "Done" button commits to `sessionStorage` and proceeds.

Emoji list lives on the backend (`config/deck.php`) and is fetched once via `GET /api/v1/meta/emoji-avatars`. Frontend caches it indefinitely.

### 4.6 Accessibility

- All interactive elements 44×44 min tap target (48×48 for primary actions).
- High-contrast focus rings on all focusables (for external keyboard users).
- `aria-live="polite"` for state-machine transitions (screen readers announce "Voting is now open").
- Reduced motion respect — if `prefers-reduced-motion`, disable slide transitions and haptics.

**Phase 4 exit criteria:**
- Install prompt appears on Chrome Android and Safari iOS on real devices.
- Installed app opens with no browser chrome, correct splash screen, correct status-bar color.
- `SheetModal` drag-dismiss feels like iOS native (spring physics via Framer Motion).
- Lighthouse PWA audit passes (installable, fast on 3G, no PWA warnings).
- Safe-area insets correct on iPhone with notch and Android 3-button / gesture nav.

---

## Phase 5 — Quest editor UI (shared shell, Quest scope)

**Goal.** Three-panel slide editor matching Mentimeter. Built as a generic editor; product-filtered at the type picker and feature set. Quiz v2 will use the same editor with Quiz types.
**Duration.** 5 days.

### 5.1 Route & layout

Route: `app/(protected)/quests/[id]/edit/`. Three-panel desktop layout (mobile editor out of scope for v1):

```
┌─────────────┬───────────────────────────────┬──────────────┐
│ Slide rail  │   Center canvas (live preview)│  Inspector   │
│ (thumbnails,│   — WYSIWYG render of the     │  Content /   │
│  DnD        │     Presenter component       │  Design /    │
│  reorder)   │                               │  Settings    │
│ + New slide │                               │              │
└─────────────┴───────────────────────────────┴──────────────┘
```

### 5.2 Module structure

```
features/deck-editor/              # Shared between Quest v2 and Quiz v2
├── components/
│   ├── EditorShell.tsx            # Three-panel layout
│   ├── SlideRail.tsx              # Left thumbnail list + DnD
│   ├── SlideThumbnail.tsx
│   ├── SlidePicker.tsx            # Type picker modal; product-filtered
│   ├── CenterCanvas.tsx           # Renders active slide's Presenter view, scaled
│   ├── InspectorPanel.tsx         # Right tabbed panel
│   ├── inspector/
│   │   ├── ContentTab.tsx
│   │   ├── DesignTab.tsx
│   │   ├── SettingsTab.tsx
│   │   └── OptionRow.tsx
│   └── slides/                    # One folder per type: Editor + Presenter + Participant
│       ├── pollSingle/
│       ├── pollMulti/
│       ├── wordCloud/
│       ├── openEnded/
│       ├── scales/
│       ├── ranking/
│       ├── qaAudience/
│       ├── pointsAllocation/
│       ├── rating/
│       ├── matrix2x2/
│       ├── pinOnImage/
│       ├── heading/
│       ├── paragraph/
│       ├── bullets/
│       ├── numbered/
│       ├── quote/
│       ├── image/
│       ├── video/
│       ├── bigText/
│       └── qrCode/
└── slideRegistry.ts               # Frontend twin of backend registry
```

`slideRegistry.ts` is the single frontend source of truth. Each entry:

```ts
type SlideTypeEntry = {
  key: string;
  products: ('quest' | 'quiz')[];
  category: 'poll' | 'interactive' | 'content';
  label: string;
  icon: React.ComponentType;
  defaults: Partial<Slide>;
  Editor: React.ComponentType<{ slide: Slide; onChange(patch: Patch): void }>;
  Presenter: React.ComponentType<{ run: SlideRun; aggregate: Aggregate; state: SlideState }>;
  Participant: React.ComponentType<{ run: SlideRun; onSubmit(payload: AnswerPayload): Promise<void> }>;
};
```

### 5.3 Editor-level behaviours

- **Autosave** on field blur + 500ms debounce on input. Optimistic update; rollback on server 409.
- **Unsaved indicator** in header.
- **Reorder** via `@dnd-kit/core`. Single batched `POST /slides/reorder` call on drop.
- **Keyboard**: `Cmd/Ctrl+D` duplicate, `Delete` delete (with confirm), `Cmd/Ctrl+↑/↓` reorder, `N` new slide (opens picker), `1–9` jump to slide N.
- **Add slide** → `SlidePicker` modal. Categories: Interactive (polls + Q&A + matrix + points + pin), Content (heading + paragraph + bullets + numbered + quote + image + video + big). Quest product scope filters out Quiz-only scored types.
- **Preview button** in header → full-screen read-only deck walkthrough (arrow keys navigate).

### 5.4 Per-type editor guidelines

Each type's `Editor` renders in the Inspector's Content tab. Contract: operates on `{ slide, onChange }`, no business logic beyond config schema. Keep them small.

Specific notes:
- `qa_audience`: settings for sort mode (top/newest default), show-feed-to-participants toggle.
- `pin_on_image`: image upload mandatory; preview shows the image at 1:1 aspect.
- `matrix_2x2`: 4 text inputs for X-low/X-high/Y-low/Y-high; live preview in center canvas.
- `points_allocation`: options list with preset total (default 100); can change to 50/200.
- `rating`: items list; scale selector (3 / 5 / 7 / 10 stars).
- `video`: URL paste first (YouTube/Vimeo auto-detect) or upload; max 50MB.
- `scales`: statements list + scale configurator (number of points 2–10 + endpoint labels).

### 5.5 Image/media UX

Reuse the file-library components instead of building a new uploader (`features/file-library/`):

- Every image/video slot opens `FileLibraryPicker` (tabs: **My Files** / **Upload new**, storage bar on top). Dropping a file straight onto a slot uploads it to My Files with progress (same pattern as `lib/StylableInputFile.tsx`), then attaches it.
- Quota errors, type errors and "file is too large" come from the library API and show inline with a "Manage My Files" link.
- Hover-× on a slot only **detaches** the media from the slide; the file stays in My Files. Deleting files happens only on the My Files page.
- Video slot: a URL field (YouTube/Vimeo auto-detect) plus a "Choose from My Files" button (`accept: "video"`).
- Crop: v1 auto-crops option images to square on display (CSS `object-fit`); stored files are only resized, never cropped. Free-form crop is v2.

### 5.6 Settings tab

Per slide:
- Time limit (dropdown: none, 10, 20, 30, 45, 60, 90, 120, 180s). Most Quest types default to **none** — Mentimeter behaviour.
- Get-ready toggle (default OFF for Quest)
- Show votes to participants (default OFF — Mentimeter model: only presenter shows live chart)
- Allow multiple submissions (for word_cloud / open_ended / qa_audience)

Per deck (header → Settings modal):
- Default time, get-ready (0 disables), theme (color palette preset)
- Show/hide QR sidebar on presenter
- Default Q&A sort mode

### 5.7 Generate from a document (AI)

Port the existing wizard (`features/ai-generate/components/DocumentToQuestionsWizard.tsx`, target `quest`) into the v2 editor:

- **Entry points:** a "Generate from a document" card in `SlidePicker`, and a "Generate from a file" option on the create-quest dashboard tile (`features/quest/components/CreateQuest`), which should create a v2 deck and open `/quests/{id}/edit`.
- **Flow (unchanged):** pick a document from My Files or upload one → choose pages or chapters (PDF bookmarks / DOCX headings, max 30 pages) → options → generate.
- **Output:** replace `toQuestTasks` (v1 `quest_tasks`) with `toQuestSlides` in `features/ai-generate/mappers.ts`, appended after the current slide:
  - poll → `poll_single` / `poll_multi`
  - Yes/No → `poll_single` with options Yes, No
  - short/long answer → `open_ended`
  - `wordcloud` → `word_cloud`
  - `scales`, `ranking` → same keys
- **Prompt:** update `QUESTION_TYPES.quest` and `questPrompt` in `features/ai-generate/` to the v2 type keys; optionally add `rating` and `points_allocation`.
- **Saving:** new `POST /api/v1/quests/v2/{id}/slides/bulk` (body: list of `{type, title, config, options[]}`) in one transaction, so a generated set is added atomically.

**Phase 5 exit criteria:** author every Quest type end-to-end in browser, reorder, duplicate, delete, attach images/videos from My Files (and upload new ones there), generate slides from a document, and round-trip through the API cleanly. Canvas preview matches what the host will later see in Present mode.

---

## Phase 6 — Quest Presenter (Host) mode

**Goal.** Fullscreen presenter view with live-updating result visualisations matching Mentimeter.
**Duration.** 4–5 days.

### 6.1 Route & shell

`app/(protected)/quests/[id]/present/`. Sanctum-guarded. Mount sequence:
1. `POST /quests/{id}/sessions` → returns `{session_id, public_channel_key, join_code}`
2. Subscribe to public `session.quest.{publicChannelKey}` via `useSessionChannel` (from main plan §3.3)
3. Subscribe to private `host.quest.v2.{sessionId}` via `useHostChannel`
4. Render current slide-run's Presenter component
5. Render host control bar

### 6.2 Layout

```
┌──────────────┬───────────────────────────────────────────────┐
│              │ ┌───────────────────────────────────────────┐ │
│  QR sidebar  │ │ To join: yourdomain.com/QUEST41   [X]    │ │ top join banner
│  (toggle)    │ └───────────────────────────────────────────┘ │
│              │                                               │
│              │         [ active slide Presenter view ]       │
│              │                                               │
│              │  ┌────────────────────────────────┐           │
│              │  │ ≡ ‹ 3/12 ›  Start ▶  participants: 42 │    │ control bar
│              │  └────────────────────────────────┘           │
└──────────────┴───────────────────────────────────────────────┘
```

Bottom control bar:
- Slide rail toggle (≡) — popover with all slides
- Prev / current / Next
- Primary action button (state-dependent): `Start voting` → `Close voting` → `Next slide`
- Participant count + connection indicator
- "End session" (red, right side)

No emoji-reaction counters, no confetti button. Core only.

### 6.3 Per-type Presenter components

Each renders a different visualisation bound to the live `aggregate` prop:

| Type | Visualisation |
|---|---|
| `poll_single` / `poll_multi` | ApexCharts vertical or horizontal bar; option images embedded in bars (theme §1.2); live animation as counts tick up |
| `word_cloud` | `highcharts-wordcloud` (already in deps); words scale + fade as they arrive |
| `open_ended` | 3-column card wall; new cards fade in at top; auto-pagination if over capacity |
| `scales` | Per statement: stacked horizontal bar (low→high colors); or average dot on number line |
| `ranking` | Ordered list with weighted-average position; live reorder animation |
| `qa_audience` | Big-text display of top question + moderation panel overlay (pin, strike-answered, hide). Auto-cycles or host-selected. |
| `points_allocation` | Horizontal bar showing percentage split; animates as distributions change |
| `rating` | List of items with star-row + numeric average |
| `matrix_2x2` | Cartesian scatter plot with X/Y axis labels; live dots arrive with fade-in |
| `pin_on_image` | Image background + pin overlay; optional heatmap toggle (client-side gaussian kernel on canvas) |
| Content types | Simple read-only render (big text, image, etc.) — presenter layout = participant layout for content |

All animations via Framer Motion on `aggregate` prop changes. ApexCharts handles its own chart-level animation.

### 6.4 Q&A moderation panel

Opens as a right-side sheet during Q&A slides. Lists every submitted question with:
- Body, submitter emoji, upvote count, timestamp
- Inline actions: Hide / Unhide, Star / Unstar, Mark Answered / Unmark
- Filter tabs: All / Starred / Answered / Hidden
- Sort toggle: Top / Newest

Updates via `qa.question.*` events in real time.

### 6.5 Timer

Authoritative on server (`slide.state.changed` carries `state_started_at` + `duration_seconds`). Frontend ticks locally for smooth UI. On reconnect, `useSessionSync` resyncs. Quest timers often null (untimed) — presenter shows "Voting open" chip instead of countdown.

### 6.6 Keyboard controls

- `→ / Space` — primary action (start voting → close voting → next slide)
- `←` — previous slide (confirm if currently voting)
- `Esc` — exit present mode (confirm if session live)
- `Q` — toggle QR sidebar
- `M` — toggle Q&A moderation panel (when on a Q&A slide)

**Phase 6 exit criteria:** host runs a full Quest end-to-end with every type; live visualisations update within 500ms of participant submits; Q&A moderation works; keyboard shortcuts work; disconnect/reconnect restores correct state.

---

## Phase 7 — Participant views per Quest type

**Goal.** Per-type answering components, mounted inside the shared PWA shell from Phase 4.
**Duration.** 5–6 days. Parallelisable — one type per dev per day.

### 7.1 Route shell

- `app/(public)/join/page.tsx` — Code input (6-char, auto-uppercase, auto-advance on 6 chars)
- `app/(public)/join/[code]/page.tsx` — Name input
- `app/(public)/join/[code]/avatar/page.tsx` — Emoji picker
- `app/(public)/play/[publicChannelKey]/page.tsx` — Live play screen
- `app/(public)/play/[publicChannelKey]/review/page.tsx` — Post-session review

All wrapped in `AppShell` with PWA shell primitives.

### 7.2 Play screen render logic

```tsx
const { currentRun, slideState, secondsRemaining } = useSessionChannel('quest', publicChannelKey);
const { submitAnswer } = useParticipantApi(participantToken);
const { Participant } = slideRegistry[currentRun.type_snapshot];

switch (slideState) {
  case 'waiting':    return <WaitingForHost slide={currentRun} />;
  case 'get_ready':  return <GetReadyOverlay seconds={secondsRemaining} />;
  case 'voting':     return <Participant run={currentRun} onSubmit={submitAnswer} />;
  case 'closed':     return <VotingClosedView run={currentRun} />;
}
```

### 7.3 Per-type Participant components

Notable specifics:

| Type | Participant UX |
|---|---|
| `poll_single` | Full-width option cards (image + label); single-tap to submit (or tap → confirm on long press?). Configurable per slide: instant submit vs confirm-with-button. Default = instant. |
| `poll_multi` | Option cards with checkmark; sticky bottom Submit button |
| `word_cloud` | Text input with N-entry chips (fill in up to max_entries_per_participant); Submit when all filled or tap "Done" |
| `open_ended` | Multi-line textarea + character counter; Submit button |
| `scales` | Per statement: horizontal pill row (tap to select); pager dots for multi-statement navigation |
| `ranking` | Drag handles via touch (`@dnd-kit` with pointer sensors); confirm order with Submit |
| `qa_audience` | Textarea at top ("Ask a question…"); feed below (top/newest toggle); tap-to-upvote hearts on each question; real-time updates |
| `points_allocation` | Sliders per option with live total indicator ("42 / 100 points used"); Submit disabled until sum = total |
| `rating` | Per item: 5-star row (tap to set); pager for multi-item |
| `matrix_2x2` | Interactive 2D canvas; drag a dot anywhere; labels on axes; Submit when dot placed |
| `pin_on_image` | Full-width image; tap to drop pin (shown as pulsing dot); up to `max_pins_per_participant`; Submit button |
| Content types | Read-only with consistent header + progress indicator ("Slide 3 of 12") |

### 7.4 Submitted state

After submit, show a thank-you state that varies by type:
- Instant-feedback types (poll_single on tap-to-submit): brief "✓ Submitted" toast + participant sees static "Thanks for voting!" screen until next slide
- Multi-step types (ranking, matrix, pin): bigger confirmation screen
- Q&A: submission appended to feed; input cleared; can submit more questions

No "is my answer correct?" state — Quest is unscored. Just "submitted, waiting for host."

### 7.5 Review screen (post-session)

After host ends session. Two tabs:
- **My Answers** — list of slides, participant's submission, and (if the slide allows) the aggregate result
- **All Slides** — read-only deck walkthrough

Skipped: "Sign in to save" upsell. No leaderboard (Quest is unscored).

### 7.6 Reconnect/refresh

Handled by existing `useSessionSync`. On mount, call `/quest-sessions/{id}/state` via participant token. Server returns:

```json
{
  "session_id": ...,
  "public_channel_key": ...,
  "current_slide_run": {
    "id": ..., "type": ..., "state": ..., "state_version": ...,
    "voting_started_at": ..., "seconds_remaining": ...,
    "config_snapshot": {...}, "options_snapshot": [...]
  },
  "my_submission_for_current_slide": {...} // nullable
}
```

Client hydrates state from this. If user previously submitted, their Participant component renders the submitted state directly.

**Phase 7 exit criteria:** real-device test (iPhone + Android + desktop browser) across every Quest type. Install-to-home-screen works. Answers submit. Connection drops + recovers cleanly. Review screen shows correct data.

---

## Phase 8 — Polish, load test, cutover, docs

**Goal.** Ship-ready. Absorbs applicable parts of main plan §4–§6.
**Duration.** 3–4 days.

### 8.1 Responsive pass

- Participant PWA tested at 320px, 375px, 414px, 768px. Also at landscape on phones (often broken on first pass).
- Presenter view tested at 1280×720 (projectors), 1920×1080, ultrawide.
- Editor desktop-only acceptable for v1; mobile editor parked for v2.

### 8.2 Load test

Reuse main plan §5.2 harness. Targets:

- 500 participants subscribe to public channel, submit poll answers within 20s window, aggregate correct
- Q&A burst: 100 questions submitted + 500 upvotes in 30s, feed propagation <1s end-to-end
- Word Cloud: 500 text entries, aggregate debounce doesn't blow up
- 100-participant reconnect mid-session → all recover state correctly

### 8.3 Cutover

Feature flag `quest_v2_enabled` on user model. Rollout:
1. Internal team only, 1 week
2. Beta users, 1 week
3. Default on for everyone, legacy Quest v1 still available via setting
4. After 2+ stability weeks: delete Quest v1 tables, routes, components, Redux slices

Run grep audit before each stage: `rg "features/quest/components/Quest|app/\\(protected\\)/quests-session|app/\\(public\\)/live/quests" frontend/src` should go to zero post-cutover.

### 8.4 Docs

Update [STRUCTURE_AND_DEVELOPMENT_GUIDE.md](STRUCTURE_AND_DEVELOPMENT_GUIDE.md) with:
- Shared slide engine overview (tables, registry, state machine, product discriminator)
- Per-product behaviour rules (which types, which reveal models)
- Channel/event inventory (extending main plan's)
- PWA shell primitives

Create `DECK_ADDING_A_SLIDE_TYPE.md` — step-by-step for future devs. Five hooks, backend + frontend, product scoping, validation, tests.

### 8.5 Quest v1 removal checklist

Only after Quest v2 has been default for 2+ weeks:

- Delete `backend/app/Models/Quest/*`
- Delete `backend/app/Http/Controllers/api/v1/Quest/*`
- Add a dedicated cleanup migration that drops legacy Quest v1 tables: `quest_task_completions`, `quest_tasks_dependencies`, `quest_participants`, `quest_sessions`, `quest_tasks`, `quest_origins`, `quest_task_bank_tasks`, `quest_task_banks`, `quest_task_bank_categories`, `quest_bank_tasks`, `quests` (confirm actual table names before writing the migration).
- Delete `frontend/src/features/quest/components/Quest/*` old creator
- Delete `frontend/src/features/quest/services/*` if tied to old API
- Delete `frontend/src/app/(protected)/quests-session/`, `(protected)/quest/`, `(public)/live/quests/` (old routes)
- Update `STRUCTURE_AND_DEVELOPMENT_GUIDE.md` to remove Quest v1 references
- Remove `quest_tasks` / `quest_bank_tasks` from `FileReferenceService::PLACES` (it skips missing tables, but keep the list honest)
- Remove `toQuestTasks` from `features/ai-generate/mappers.ts` once `toQuestSlides` is live; make sure `CreateQuest` and the slide picker no longer link to `/quest/edit/{id}`
- If any upload folder is ever added under `backend/storage/app/`, add it to `backend/.dockerignore` (root-owned folders there break `docker compose build`)

---

## Timeline

| Phase | Duration | Notes |
|---|---|---|
| 1. Shared slide engine foundation | 4–5 days | Blocks everything else. +1 day for §1.9 (resize, dimensions, video category, reference tracking) |
| 2. Quest authoring API | 3 days | Can parallelise with Phase 4 mock |
| 3. Quest live-session API | 4 days | |
| 4. Native-feel PWA participant shell | 4–5 days | Can parallelise with Phase 2/3 |
| 5. Quest editor UI | 6–7 days | +1–2 days for §5.7 (AI wizard port, `toQuestSlides`, bulk endpoint) |
| 6. Quest Presenter | 4–5 days | |
| 7. Participant views per type | 5–6 days | Parallelisable per type |
| 8. Polish + cutover + docs | 3–4 days | |
| **Total (serial)** | **33–43 days** | |
| **Total (two devs, parallelised)** | **~24–28 days** | |

With two devs: dev A owns 1 → 3 → 6 → 7-backend-heavy types; dev B owns 4 → 5 → 7-frontend-heavy types. Sync points: end of Phase 1 (engine contract), end of Phase 3 (API freeze), end of Phase 4 (shell contract).

**Positioning vs Quiz v2.** Quest v2 goes first and owns the shared slide engine. Quiz v2 can start after the Quest v2 engine/API contract is stable (typically after Quest Phase 3), even if Quest's full UI rollout/cutover is still continuing. Quiz v2's effort shrinks substantially: ~8 days instead of ~18–22 days, because it only has to add:
- Quiz-specific slide types (pick_answer_single/multi, short_answer scored, match_pairs, correct_order, categorise, spinner_wheel) — Phase-7-equivalent of Quest
- Scoring service + time-interpolation formula
- Hidden-until-reveal state machine variant
- Leaderboard slide type + rank-delta animation
- Wire `product=quiz` into editor + presenter + participant shell

See the updated [QUIZ_REDESIGN_PLAN.md](QUIZ_REDESIGN_PLAN.md) for the reduced-scope Quiz v2.

---

## Decision log (additions to main plan's)

| Decision | Rationale |
|---|---|
| Quest v2 owns the shared slide engine; Quiz v2 inherits | User-confirmed sequencing. Quest ships first, so the engine is built once, in Quest's codebase, with the broader type set (Quest has more interactive types than Quiz) exercising the registry contract more fully. |
| Tables named `decks`, `slides`, `slide_options` (not `quest_*`) | They're shared. Product discriminator via `decks.product` enum. Less churn at Quiz v2 cutover. |
| Per-product route prefix (`/api/v1/quests/v2/*` during coexistence, later clean `/api/v1/quests/*`; `/api/v1/quizzes/*` for Quiz v2) | UX stays clean and product-scoped in URLs; backend controllers are thin wrappers on shared services. |
| Quest uses `live_aggregate` reveal model by default; Quiz uses `hidden_until_reveal` | Mentimeter shows live chart to presenter as votes arrive; AhaSlides hides until reveal. Different semantics, same state machine shape with a flag. |
| Session slide snapshots (Phase 1 from user's Quiz plan edit) reused here from day one | Mid-session authoring edits must not corrupt live state. Cheap to copy config at session start. |
| Route all events through existing `LiveBroadcastEvent` + typed DTOs | User explicitly stated preference in Quiz plan edit: don't grow a parallel broadcast-class tree unless the generic layer breaks down. |
| Q&A is Mentimeter-parity: submit + upvote + moderation (hide/star/mark answered) | User-confirmed. Any lighter model would feel like a regression from Mentimeter. |
| PWA-styled web (no Capacitor wrappers in v1) | Ephemeral session joins don't justify App Store release overhead. Revisit if we ever want discoverability. |
| PWA shell built in Quest v2, reused by Quiz v2 | Shell is product-agnostic; building it once is the whole point of the shared engine. |
| No emoji reactions, chat, hand-raise, "sign in to save" upsell | User-confirmed. Core experience only. Can be added later without rework. |
| Drop Fill-in-the-blanks + Quick Form from Quest | Fill-in-the-blanks is scored (belongs in Quiz). Quick Form has no direct Mentimeter analogue and muddies the model; revisit as a separate "Form" product if users miss it. |
| Curated ~40 emoji avatar list, server-validated | Stops garbage input; consistent leaderboard/feed aesthetics. |
| Editor is desktop-only v1 | Mentimeter's own mobile editor is weak; not worth the build cost pre-validation. |
| Feature flag rollout (internal → beta → default → delete v1) | Risk management. Two weeks of stability on default before table drops is non-negotiable. |
| All Quest v2 media goes through My Files (file ids, not paths) | One storage system with quota, dedupe and reuse. No second uploader to secure. Decks survive file renames; soft-deleted files keep showing. |
| Images resized to fit 1024×1024 on upload, library-wide | Smaller files, less quota used, faster slides. Done once at upload, not per request. |
| Video: YouTube/Vimeo links and mp4 from My Files (max 50 MB) | User-confirmed. Uploads count toward quota; no transcoding. |
| AI "Generate from a document" ported to Quest v2 | User-confirmed. The feature already exists for Quest v1 and must not disappear at cutover. |
| PostgreSQL in local dev and tests | The file library depends on PostgreSQL-only features. |
| Live results go to participants only when the slide opts in (`show_results_to_participants`, default off) | §5.6's Mentimeter model: the presenter shows the live chart. Enforced server-side by channel routing, so participants never receive results they are not meant to see, and the default does not fan every aggregate out to the whole audience. |
| Slide media is server-owned (`TakesMedia::withMedia`), never author config | One trusted path from `slides.media_file_id` + `File::url` into `config_snapshot.media` for image, video and pin_on_image; a config edit cannot point a slide at an arbitrary URL. |
| Matrix 2×2 and pin coordinates are percentages 0–100 | One unit for both planes; matches how the participant UI measures taps. |
| Images too large to decode safely (> `max_image_pixels`) are stored unresized, not refused | Keeps the legacy `/files/store` uploads working; dimensions are still recorded. |
| Daily cap on new upload bytes (`max_daily_upload_mb`, at least the user's quota) | Upload-then-delete churn could otherwise fill the disk, since soft-deleted files stay on disk. |
