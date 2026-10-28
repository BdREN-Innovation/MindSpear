// Shared slide engine (Quest v2 + Quiz v2): every shape the deck API and the
// realtime channels send. Derived from the backend code, which is the
// contract (QUEST_REDESIGN_PLAN.md / QUIZ_REDESIGN_PLAN.md "Implementation notes"):
//   - authoring responses: backend/app/Deck/Http/Resources/{Deck,Slide,Option,Media}Presenter.php (camelCase)
//   - live responses + broadcasts: SessionStatePresenter, QaQuestionPresenter,
//     SlideRunResultsService, LeaderboardController, app/Deck/Broadcasts/Payloads/* (snake_case)
//   - per-type config / answer / aggregate: app/Deck/Slides/Types/{Quest,Quiz,Content}/*SlideType.php
//   - quiz scoring / ranking: app/Deck/Scoring/*, app/Deck/Sessions/QuizRuntime.php
// Request bodies are snake_case everywhere.

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** ISO-8601 timestamp as the backend sends it (toISOString / toIso8601String). */
export type IsoDateTime = string;

export type DeckProduct = "quest" | "quiz";

export type SlideCategory = "poll" | "interactive" | "content";

export type RevealModel = "live_aggregate" | "hidden_until_reveal" | "moderated_feed" | "none";

/**
 * Run state machine: polls waiting → [get_ready →] voting → closed; Q&A waiting → open → closed;
 * quiz questions waiting → [get_ready →] voting (= answering) → reveal; spinner waiting → voting (spinning) → reveal;
 * content and leaderboard stay waiting. `reveal` is terminal (never reopened).
 */
export type RunState = "waiting" | "get_ready" | "voting" | "open" | "closed" | "reveal";

export type SessionStatus = "pending" | "live" | "ended";

/** Who may see a run's results: 'public' (participants too) or 'host' only. */
export type ResultsVisibility = "public" | "host";

export type QuestionSlideTypeKey =
	| "poll_single"
	| "poll_multi"
	| "word_cloud"
	| "open_ended"
	| "scales"
	| "ranking"
	| "qa_audience"
	| "points_allocation"
	| "rating"
	| "matrix_2x2"
	| "pin_on_image";

export type ContentSlideTypeKey =
	| "heading"
	| "paragraph"
	| "bullets"
	| "numbered"
	| "quote"
	| "image"
	| "video"
	| "big_text"
	| "qr_code";

/** Quiz v2 types (products ['quiz']). The scored ones take answers; spinner_wheel and leaderboard do not. */
export type QuizSlideTypeKey =
	| "pick_answer_single"
	/** Retired: Pick answer takes several correct answers now. Kept so past runs still render. */
	| "pick_answer_multi"
	| "true_false"
	| "short_answer"
	| "fill_blanks"
	| "drag_drop"
	| "match_pairs"
	| "correct_order"
	| "categorise"
	| "spinner_wheel"
	| "leaderboard";

/** Scored quiz types (AbstractQuizType: hidden_until_reveal, answers scored on submit). */
export type ScoredQuizSlideTypeKey = Exclude<QuizSlideTypeKey, "spinner_wheel" | "leaderboard">;

/** Quiz types whose participant options, answers and aggregates use OPAQUE string ids (QuizOptions::key), not option ids. */
export type OpaqueOptionSlideTypeKey = "match_pairs" | "correct_order" | "categorise";

export type SlideTypeKey = QuestionSlideTypeKey | QuizSlideTypeKey | ContentSlideTypeKey;

/** Types that take answers through POST .../answers (qa_audience, spinner_wheel, leaderboard and content types do not). */
export type AnswerSlideTypeKey = Exclude<QuestionSlideTypeKey, "qa_audience"> | ScoredQuizSlideTypeKey;

export const QUESTION_SLIDE_TYPE_KEYS: readonly QuestionSlideTypeKey[] = [
	"poll_single",
	"poll_multi",
	"word_cloud",
	"open_ended",
	"scales",
	"ranking",
	"qa_audience",
	"points_allocation",
	"rating",
	"matrix_2x2",
	"pin_on_image",
];

export const QUIZ_SLIDE_TYPE_KEYS: readonly QuizSlideTypeKey[] = [
	"pick_answer_single",
	"pick_answer_multi",
	"true_false",
	"short_answer",
	"fill_blanks",
	"drag_drop",
	"match_pairs",
	"correct_order",
	"categorise",
	"spinner_wheel",
	"leaderboard",
];

export const SCORED_QUIZ_SLIDE_TYPE_KEYS: readonly ScoredQuizSlideTypeKey[] = [
	"pick_answer_single",
	"pick_answer_multi",
	"true_false",
	"short_answer",
	"fill_blanks",
	"drag_drop",
	"match_pairs",
	"correct_order",
	"categorise",
];

export const OPAQUE_OPTION_SLIDE_TYPE_KEYS: readonly OpaqueOptionSlideTypeKey[] = ["match_pairs", "correct_order", "categorise"];

export const CONTENT_SLIDE_TYPE_KEYS: readonly ContentSlideTypeKey[] = [
	"heading",
	"paragraph",
	"bullets",
	"numbered",
	"quote",
	"image",
	"video",
	"big_text",
	"qr_code",
];

export const SLIDE_TYPE_KEYS: readonly SlideTypeKey[] = [
	...QUESTION_SLIDE_TYPE_KEYS,
	...QUIZ_SLIDE_TYPE_KEYS,
	...CONTENT_SLIDE_TYPE_KEYS,
];

export function isSlideTypeKey(value: unknown): value is SlideTypeKey {
	return typeof value === "string" && (SLIDE_TYPE_KEYS as readonly string[]).includes(value);
}

export function isQuizSlideTypeKey(value: unknown): value is QuizSlideTypeKey {
	return typeof value === "string" && (QUIZ_SLIDE_TYPE_KEYS as readonly string[]).includes(value);
}

/** Scored quiz type: answers earn points, results stay hidden until `reveal`. */
export function isScoredQuizSlideTypeKey(value: unknown): value is ScoredQuizSlideTypeKey {
	return typeof value === "string" && (SCORED_QUIZ_SLIDE_TYPE_KEYS as readonly string[]).includes(value);
}

/** match_pairs / correct_order / categorise: run option ids are opaque strings. */
export function usesOpaqueOptionIds(value: unknown): value is OpaqueOptionSlideTypeKey {
	return typeof value === "string" && (OPAQUE_OPTION_SLIDE_TYPE_KEYS as readonly string[]).includes(value);
}

/** Backend limits worth mirroring in the UI (config/deck.php, *SlideType constants, SlideInput). */
export const DECK_LIMITS = {
	/** config deck.max_slides_per_deck (default 100); the 422 slide_limit_reached carries the live value in data.max_slides. */
	maxSlidesPerDeck: 100,
	maxBulkSlides: 50,
	maxDeckTitle: 255,
	maxDeckDescription: 2000,
	maxSlideTitle: 280,
	maxOptionLabel: 200,
	maxOptionPayloadBytes: 512,
	minTimeLimitSeconds: 5,
	maxTimeLimitSeconds: 3600,
	maxGetReadySeconds: 30,
	maxDisplayName: 40,
	joinCodeLength: 6,
	maxAnswerBodyKb: 32,
	/** Option caps (config/deck.php option_limits): default max 30; ranking 12; scales 20; quiz rows (match_pairs counts cells, 2 per pair). */
	optionMax: {
		default: 30,
		ranking: 12,
		scales: 20,
		pick_answer_single: 10,
		pick_answer_multi: 10,
		true_false: 2,
		short_answer: 5,
		match_pairs: 16,
		correct_order: 8,
		categorise: 20,
		spinner_wheel: 12,
		fill_blanks: 0,
		drag_drop: 0,
	} as Record<string, number>,
	optionMin: {
		poll_single: 2,
		poll_multi: 2,
		ranking: 2,
		scales: 1,
		pick_answer_single: 2,
		pick_answer_multi: 2,
		true_false: 2,
		short_answer: 1,
		match_pairs: 4,
		correct_order: 3,
		categorise: 4,
		spinner_wheel: 2,
	} as Record<string, number>,
	qaFeedDefaultLimit: 100,
	qaFeedMaxLimit: 500,
	openEndedPageSize: 20,
} as const;

/** Quiz v2 limits and defaults (config/deck.php `quiz`, SlideInput, Quiz/*SlideType constants). */
export const QUIZ_LIMITS = {
	/** slides.points_min / points_max: 0..maxPoints, min ≤ max. */
	maxPoints: 1000,
	defaultPointsMin: 50,
	defaultPointsMax: 100,
	defaultSpeedBonus: true,
	/** Quiz decks seed get_ready_seconds 5 (settings.get_ready_seconds; 0 = off). */
	defaultGetReadySeconds: 5,
	/** time_limit_seconds a new slide is seeded with (unless the deck sets default_time_limit). */
	defaultTimeLimitSeconds: {
		pick_answer_single: 20,
		pick_answer_multi: 30,
		true_false: 20,
		short_answer: 30,
		fill_blanks: 45,
		drag_drop: 45,
		correct_order: 30,
		match_pairs: 45,
		categorise: 45,
	} as Record<ScoredQuizSlideTypeKey, number>,
	/** fill_blanks / drag_drop sentence (BlankText): ≤ 600 characters, ≤ 10 [bracketed] blanks, each answer ≤ 60. */
	maxSentenceLength: 600,
	maxBlanks: 10,
	maxBlankAnswer: 60,
	/** fill_blanks: other accepted answers of a typed blank, wrong choices of a dropdown blank, typed answer length. */
	maxBlankAlternatives: 4,
	maxBlankDistractors: 5,
	maxTypedBlank: 100,
	/** drag_drop: extra wrong words in the word bank. */
	maxDragDistractors: 8,
	/** short_answer config.max_length 1..200 (default 100). */
	shortAnswerMaxLength: 200,
	shortAnswerDefaultMaxLength: 100,
	/** short_answer aggregate lists at most this many answers. */
	shortAnswerTopAnswers: 10,
	/** categorise config.categories 2..5, label ≤ 100. */
	minCategories: 2,
	maxCategories: 5,
	maxCategoryLabel: 100,
	/** match_pairs 2..8 pairs. */
	minPairs: 2,
	maxPairs: 8,
	/** pair_key / category key: a letter, then letters, digits, '_' or '-' (≤ 32). */
	authorKeyPattern: /^[A-Za-z][A-Za-z0-9_-]{0,31}$/,
	/** spinner option payload.weight 0.1..100 (default 1). */
	minSpinnerWeight: 0.1,
	maxSpinnerWeight: 100,
	/** Default spin length (config deck.quiz.spin_seconds). */
	spinSeconds: 3,
	/** leaderboard config.top_n 1..50 (default 10); show_all_participants shows 50. */
	leaderboardMaxTopN: 50,
	leaderboardDefaultTopN: 10,
	/** GET .../leaderboard?limit=1..100 (default 10). */
	leaderboardMaxLimit: 100,
	/** slide.revealed leaderboard_delta rows. */
	revealLeaderboardLimit: 10,
} as const;

/* ------------------------------------------------------------------ */
/* Rich text (paragraph slide body: TipTap / ProseMirror JSON)         */
/* ------------------------------------------------------------------ */

export type RichTextMarkType = "bold" | "italic" | "underline" | "strike" | "code" | "link";

export interface RichTextMark {
	type: RichTextMarkType;
	/** link: {href (http(s) or mailto), target?, rel?} */
	attrs?: { href?: string; target?: string | null; rel?: string | null };
}

export type RichTextNodeType =
	| "paragraph"
	| "heading"
	| "blockquote"
	| "bulletList"
	| "orderedList"
	| "listItem"
	| "codeBlock"
	| "horizontalRule"
	| "hardBreak"
	| "text";

export interface RichTextNode {
	type: RichTextNodeType;
	/** heading: {level: 1|2|3}; paragraph/heading: {textAlign: left|center|right|justify}; orderedList: {start} */
	attrs?: Record<string, unknown>;
	content?: RichTextNode[];
	text?: string;
	marks?: RichTextMark[];
}

export interface RichTextDoc {
	type: "doc";
	content?: RichTextNode[];
}

/* ------------------------------------------------------------------ */
/* Per-type config (slides.config / run config_snapshot)               */
/* ------------------------------------------------------------------ */

/** Server-owned media snapshot (TakesMedia::withMedia): only in run config snapshots, never in authoring config. */
export interface RunMedia {
	file_id: number;
	url: string;
	width: number | null;
	height: number | null;
	mime: string | null;
}

/** Every live poll type ends its config with this (§5.6 "Show votes to participants"). */
export interface PollSettingsConfig {
	show_results_to_participants: boolean;
}

export type ResultLayout = "bars" | "donut" | "pie" | "dots";

export interface PollSingleConfig extends PollSettingsConfig {
	result_layout: ResultLayout;
	/** instant: tap submits; confirm: tap then a confirm button. */
	submit_mode: "instant" | "confirm";
}

export interface PollMultiConfig extends PollSettingsConfig {
	result_layout: ResultLayout;
	/** 1..50; capped at the option count when answers are checked. */
	min_selections: number;
	/** min_selections..50, null = no limit. */
	max_selections: number | null;
}

export interface WordCloudConfig extends PollSettingsConfig {
	/** 1..10, total per participant. */
	max_entries_per_participant: number;
	/** 1..100 characters per entry. */
	max_entry_length: number;
	profanity_filter_enabled: boolean;
	/** Come back and add more words until max_entries_per_participant. */
	allow_multiple_submissions: boolean;
}

export interface OpenEndedConfig extends PollSettingsConfig {
	/** 10..2000 characters per response. */
	max_length: number;
	/** 1..20; > 1 = "allow multiple submissions". */
	max_submissions_per_participant: number;
	profanity_filter_enabled: boolean;
}

export interface ScalesConfig extends PollSettingsConfig {
	/** 2..10 */
	scale_points: number;
	/** Exactly scale_points long; label per value 1..N (≤ 60 chars), null = unlabelled. */
	scale_labels: (string | null)[];
	require_all_statements: boolean;
}

export interface RankingConfig extends PollSettingsConfig {
	/** true: every item must be ranked; false: any non-empty top-k prefix. */
	require_full_ranking: boolean;
}

export type QaSlideSort = "top" | "newest";

/** qa_audience has no PollSettings (results are a moderated feed). */
export interface QaAudienceConfig {
	allow_anonymous: boolean;
	show_feed_to_participants: boolean;
	sort: QaSlideSort;
	profanity_filter_enabled: boolean;
	/** 10..1000, default 280. */
	max_question_length: number;
}

export interface PointsAllocationConfig extends PollSettingsConfig {
	/** 1..1000, default 100. */
	total_points: number;
}

export type RatingScale = 3 | 5 | 7 | 10;

export interface RatingConfig extends PollSettingsConfig {
	scale: RatingScale;
	require_all_items: boolean;
}

export interface AxisLabels {
	/** ≤ 80 chars, '' when unset. */
	low: string;
	high: string;
}

export interface Matrix2x2Config extends PollSettingsConfig {
	/** x 0 = low (left), 100 = high (right). */
	x_axis: AxisLabels;
	/** y 0 = low (bottom), 100 = high (top). */
	y_axis: AxisLabels;
}

export interface PinOnImageConfig extends PollSettingsConfig {
	/** 1..10 */
	max_pins_per_participant: number;
	/** Snapshot only (required at session start); the authoring slide carries `media` at the top level. */
	media?: RunMedia | null;
}

/** The heading text is the slide `title`. */
export interface HeadingConfig {
	subtitle: string | null;
}

/** The text itself is the slide `body` (RichTextDoc). */
export interface ParagraphConfig {
	align: "left" | "center" | "right";
	text_size: "small" | "medium" | "large";
}

export interface ListConfig {
	/** 1..20 entries, single-line ≤ 200, may be ''. */
	items: string[];
}

export type BulletsConfig = ListConfig;
export type NumberedConfig = ListConfig;

export interface QuoteConfig {
	/** Multi-line ≤ 500, may be ''. */
	text: string;
	attribution: string | null;
}

export interface ImageConfig {
	caption: string | null;
	alt: string | null;
	/** Snapshot only; null when no image is attached. */
	media?: RunMedia | null;
}

export type VideoProvider = "youtube" | "vimeo";

/** EITHER a YouTube/Vimeo link (video_url + derived keys) OR an mp4 (`media`), never both. */
export interface VideoConfig {
	video_url: string | null;
	/** Derived by the server from video_url; never send. */
	video_provider: VideoProvider | null;
	video_id: string | null;
	embed_url: string | null;
	/** Snapshot only: the mp4 from My Files. */
	media?: RunMedia | null;
}

export interface BigTextConfig {
	/** Single line ≤ 80, may be ''. */
	text: string;
}

/** The code / URL come from the session (join info), not the slide. */
export interface QrCodeConfig {
	show_join_code: boolean;
}

/* --- Quiz v2 --------------------------------------------------------- */

/**
 * A type without settings. PHP sends an empty config as `[]` (authoring config
 * goes through MediaPresenter::object and arrives as `{}`); read keys, never iterate.
 */
export type EmptyConfig = Record<never, never>;

/**
 * Run snapshot `config.scoring` of a scored quiz run (QuizRuntime::scoringSnapshot):
 * the slide's points (defaults 50 / 100 / on) and the run's time limit, which the
 * speed bonus counts down from. Public: drives the participant "50p ── 100p" bar.
 * Never in authoring config (there the slide columns pointsMin / pointsMax / speedBonusEnabled hold it).
 */
export interface QuizScoringConfig {
	points_min: number;
	points_max: number;
	speed_bonus_enabled: boolean;
	/** null = untimed (then a correct answer always earns points_max). */
	time_limit_seconds: number | null;
}

/**
 * pick_answer_single (Pick answer): no settings; the correct option(s) are option `isCorrect`.
 * One marked: players pick one. Several marked: players select options and must match the
 * correct set exactly (all or nothing). Runs say which in config.multiple_answers.
 */
export type PickAnswerSingleConfig = EmptyConfig;

/** pick_answer_multi (retired; old runs only): no settings. ALL OR NOTHING: the selected set must equal the correct set. */
export type PickAnswerMultiConfig = EmptyConfig;

/** true_false: two options (seeded True / False, relabelable); one marked correct. */
export type TrueFalseConfig = EmptyConfig;

/** How a fill_blanks blank is answered: typed, or chosen from a dropdown. */
export type FillBlankMode = "type" | "dropdown";

/** Author settings of one fill_blanks blank (config.blanks[i] = the i-th [bracketed] answer). */
export interface FillBlankSettings {
	mode: FillBlankMode;
	/** type: other accepted answers (≤ 4). */
	alternatives: string[];
	/** dropdown: the wrong choices (≤ 5); the bracketed answer is always a choice. */
	distractors: string[];
}

/** fill_blanks: the sentence with each answer in [square brackets]; never public (runs get parts + blanks). */
export interface FillBlanksConfig {
	text: string;
	/** In reading order; missing entries are {mode: "type"}, extra ones unused. */
	blanks: FillBlankSettings[];
	/** Typed answers; default false. */
	case_sensitive: boolean;
}

/** drag_drop: the sentence with each answer in [square brackets], plus extra wrong words for the bank (≤ 8). */
export interface DragDropConfig {
	text: string;
	distractors: string[];
}

/** A piece of a fill_blanks / drag_drop sentence: a text run, or a blank (0-based index into `blanks`). */
export type SentencePart = { text: string } | { blank: number };

/** A blank as participants see it. */
export type PublicBlank = { mode: "type" } | { mode: "dropdown"; choices: string[] } | { mode: "drop" };

/** The run config of fill_blanks / drag_drop (the answer key stays on the server). */
export interface SentenceRunConfig {
	parts: SentencePart[];
	blanks: PublicBlank[];
}

/** short_answer: accepted answers are the option labels (1..5), never shown to participants. */
export interface ShortAnswerConfig {
	/** Default false: answers are case-folded before comparing. */
	case_sensitive: boolean;
	/** 1..200 characters per answer, default 100. */
	max_length: number;
	/** Masks wrong submitted answers in the aggregate; default true. */
	profanity_filter_enabled: boolean;
}

/** match_pairs: pairs live in the options (payload {side, pair_key}). */
export type MatchPairsConfig = EmptyConfig;

/** correct_order: the author order (option position) is the correct order. */
export type CorrectOrderConfig = EmptyConfig;

export interface QuizCategory {
	/** QUIZ_LIMITS.authorKeyPattern, distinct; items name it in payload.correct_category_key. */
	key: string;
	/** ≤ 100, null = unlabelled. */
	label: string | null;
}

export interface CategoriseConfig {
	/** 2..5 categories (seeded c1, c2). Public in the run view. */
	categories: QuizCategory[];
}

/** spinner_wheel: entries are the options (payload {weight?}); spin length is a session setting. */
export type SpinnerWheelConfig = EmptyConfig;

export interface LeaderboardConfig {
	/** 1..50, default 10. */
	top_n: number;
	/** true = everyone, up to 50 rows. */
	show_all_participants: boolean;
}

export interface SlideConfigMap {
	poll_single: PollSingleConfig;
	poll_multi: PollMultiConfig;
	word_cloud: WordCloudConfig;
	open_ended: OpenEndedConfig;
	scales: ScalesConfig;
	ranking: RankingConfig;
	qa_audience: QaAudienceConfig;
	points_allocation: PointsAllocationConfig;
	rating: RatingConfig;
	matrix_2x2: Matrix2x2Config;
	pin_on_image: PinOnImageConfig;
	heading: HeadingConfig;
	paragraph: ParagraphConfig;
	bullets: BulletsConfig;
	numbered: NumberedConfig;
	quote: QuoteConfig;
	image: ImageConfig;
	video: VideoConfig;
	big_text: BigTextConfig;
	qr_code: QrCodeConfig;
	pick_answer_single: PickAnswerSingleConfig;
	pick_answer_multi: PickAnswerMultiConfig;
	true_false: TrueFalseConfig;
	short_answer: ShortAnswerConfig;
	fill_blanks: FillBlanksConfig;
	drag_drop: DragDropConfig;
	match_pairs: MatchPairsConfig;
	correct_order: CorrectOrderConfig;
	categorise: CategoriseConfig;
	spinner_wheel: SpinnerWheelConfig;
	leaderboard: LeaderboardConfig;
}

export type SlideConfig<K extends SlideTypeKey = SlideTypeKey> = SlideConfigMap[K];

/** Run configs that differ from the authoring config (the type rebuilds them for participants). */
export interface PublicRunConfigMap {
	pick_answer_single: { multiple_answers?: boolean };
	true_false: { multiple_answers?: boolean };
	fill_blanks: SentenceRunConfig & { case_sensitive: boolean };
	drag_drop: SentenceRunConfig;
}

type RunConfigBase<K extends SlideTypeKey> = K extends keyof PublicRunConfigMap ? PublicRunConfigMap[K] : SlideConfigMap[K];

/** Run snapshot config: the authoring config (or its public form), plus `scoring` on scored quiz runs (quiz sessions only). */
export type RunConfigOf<K extends SlideTypeKey> = K extends ScoredQuizSlideTypeKey
	? RunConfigBase<K> & { scoring: QuizScoringConfig }
	: RunConfigBase<K>;

/** Keys the server owns; PATCH drops them (media goes through PUT .../media). */
export type ServerManagedConfigKey = "media" | "video_url" | "video_provider" | "video_id" | "embed_url";

/**
 * A config PATCH: merged recursively onto the stored config (nested objects
 * like x_axis merge; lists replace). For scales, scale_points may be sent alone.
 */
export type ConfigPatch<T> = T extends unknown
	? {
			[P in Exclude<keyof T, ServerManagedConfigKey>]?: T[P] extends readonly unknown[]
				? T[P]
				: T[P] extends object
					? Partial<T[P]>
					: T[P];
		}
	: never;

/* ------------------------------------------------------------------ */
/* Per-type answer payloads                                            */
/* ------------------------------------------------------------------ */

export interface Point {
	/** 0..100 percent. */
	x: number;
	/** 0..100 percent (matrix: 100 = top; pin_on_image: 0 = top edge). */
	y: number;
}

export interface OptionValue {
	option_id: number;
	/** 1..scale_points (scales) / 1..scale (rating). */
	value: number;
}

export interface PointsAllocationEntry {
	option_id: number;
	/** ≥ 0; all entries must add up to config.total_points. */
	points: number;
}

/** An opaque participant-facing option id (QuizOptions::key, e.g. "k3f9a0c12b7de"): match_pairs, correct_order, categorise. */
export type OpaqueOptionId = string;

export interface MatchPairConnection {
	/** Opaque id of a left cell. */
	left_id: OpaqueOptionId;
	/** Opaque id of a right cell. */
	right_id: OpaqueOptionId;
}

export interface CategorisePlacement {
	/** Opaque item id. */
	item_id: OpaqueOptionId;
	/** One of config.categories[].key. */
	category_key: string;
}

/** What a participant POSTs as `answer_payload`. Option ids are run option `id`s (opaque strings for match_pairs / correct_order / categorise). */
export interface AnswerPayloadMap {
	poll_single: { option_id: number };
	poll_multi: { option_ids: number[] };
	word_cloud: { entries: string[] };
	open_ended: { text: string };
	scales: { ratings: OptionValue[] };
	ranking: { order: number[] };
	qa_audience: never;
	points_allocation: { allocations: PointsAllocationEntry[] };
	rating: { ratings: OptionValue[] };
	matrix_2x2: Point;
	/** {pins:[...]} or the {x, y} shorthand for a single pin. */
	pin_on_image: { pins: Point[] } | Point;
	heading: never;
	paragraph: never;
	bullets: never;
	numbered: never;
	quote: never;
	image: never;
	video: never;
	big_text: never;
	qr_code: never;
	/** One correct marked: an option of the run. Several: 1..n distinct option ids (config.multiple_answers). */
	pick_answer_single: { option_id: number } | { option_ids: number[] };
	/** 1..n distinct option ids. */
	pick_answer_multi: { option_ids: number[] };
	true_false: { option_id: number };
	/** One per blank in reading order; null = left empty (at least one filled). Dropdown: one of its choices. */
	fill_blanks: { answers: (string | null)[] };
	/** One per blank; each a word of the bank (run options' labels), no word more often than the bank has it. */
	drag_drop: { answers: (string | null)[] };
	/** 1..config.max_length characters after cleaning (trim, whitespace collapsed). */
	short_answer: { text: string };
	/** 1..pair count connections, each left / right id used at most once; unmatched cells allowed. */
	match_pairs: { pairs: MatchPairConnection[] };
	/** Every item id exactly once, first = top. */
	correct_order: { order: OpaqueOptionId[] };
	/** 1..item count placements, each item at most once; unplaced items count as wrong. */
	categorise: { placements: CategorisePlacement[] };
	/** Takes no answers (409 invalid_state reason no_answers). */
	spinner_wheel: never;
	leaderboard: never;
}

export type AnswerPayload<K extends SlideTypeKey = AnswerSlideTypeKey> = AnswerPayloadMap[K];

/** The normalised payload the server stores and returns (my-answer, state, review). */
export interface StoredAnswerMap {
	/** {option_id} */
	poll_single: { option_id: number };
	/** In option order. */
	poll_multi: { option_ids: number[] };
	/** Deduplicated (case-insensitive) entries; entry_times[i] = when entries[i] was first sent. */
	word_cloud: { entries: string[]; entry_times: (IsoDateTime | null)[] };
	/** Appended while under max_submissions_per_participant; replaced when it is 1. */
	open_ended: { entries: { body: string; submitted_at: IsoDateTime }[] };
	/** Answered statements only, in option order. */
	scales: { ratings: OptionValue[] };
	ranking: { order: number[] };
	qa_audience: never;
	/** Every option, in option order. */
	points_allocation: { allocations: PointsAllocationEntry[] };
	/** Rated items only, in option order. */
	rating: { ratings: OptionValue[] };
	/** Rounded to 2 dp. */
	matrix_2x2: Point;
	/** Rounded to 2 dp, exact duplicates dropped. */
	pin_on_image: { pins: Point[] };
	heading: never;
	paragraph: never;
	bullets: never;
	numbered: never;
	quote: never;
	image: never;
	video: never;
	big_text: never;
	qr_code: never;
	/** {option_id}, or {option_ids} in option order when several are correct. */
	pick_answer_single: { option_id: number } | { option_ids: number[] };
	/** In option order. */
	pick_answer_multi: { option_ids: number[] };
	true_false: { option_id: number };
	/** Cleaned like short answers; null = left empty. */
	fill_blanks: { answers: (string | null)[] };
	drag_drop: { answers: (string | null)[] };
	/** Cleaned: control / invisible characters removed, whitespace collapsed, trimmed. */
	short_answer: { text: string };
	/** In the participant's order. */
	match_pairs: { pairs: MatchPairConnection[] };
	correct_order: { order: OpaqueOptionId[] };
	/** In the participant's order. */
	categorise: { placements: CategorisePlacement[] };
	spinner_wheel: never;
	leaderboard: never;
}

export type StoredAnswer<K extends SlideTypeKey = AnswerSlideTypeKey> = StoredAnswerMap[K];

/**
 * What a revealed scored quiz run adds to my-answer (QuizRuntime::answerExtras),
 * never before the reveal. total_points / rank are the participant's standing
 * after this run (ties share a rank; null when not ranked).
 */
export interface QuizAnswerResult<C = QuizCorrectAnswer> {
	/** Fully correct (partial credit is still false). */
	is_correct: boolean | null;
	points_awarded: number;
	/** The aggregate's `correct` block (opaque ids for match_pairs / correct_order / categorise). */
	correct_answer: C | null;
	total_points: number;
	rank: number | null;
}

/** GET .../my-answer, state.my_submission_for_current_slide, review run.my_answer. */
export interface MySubmission<P = StoredAnswer> {
	slide_run_id: number;
	/** As stored; `{}` when empty. */
	answer_payload: P;
	time_to_answer_ms: number | null;
	submitted_at: IsoDateTime | null;
	/** Quiz, revealed scored runs only (QuizAnswerResult). */
	is_correct?: boolean | null;
	points_awarded?: number;
	correct_answer?: QuizCorrectAnswer | null;
	total_points?: number;
	rank?: number | null;
}

/** True when a my-answer / submission carries the quiz reveal keys (the run was revealed). */
export function hasQuizResult<P>(submission: MySubmission<P> | null | undefined): submission is MySubmission<P> & QuizAnswerResult {
	return !!submission && typeof submission.points_awarded === "number";
}

/** The QuizAnswerResult part of a revealed submission, or null before the reveal / without an answer. */
export function quizResultOf<C = QuizCorrectAnswer>(
	submission: MySubmission<unknown> | null | undefined
): QuizAnswerResult<C> | null {
	if (!hasQuizResult(submission)) return null;
	return {
		is_correct: submission.is_correct ?? null,
		points_awarded: submission.points_awarded,
		correct_answer: (submission.correct_answer ?? null) as C | null,
		total_points: submission.total_points ?? 0,
		rank: submission.rank ?? null,
	};
}

/* ------------------------------------------------------------------ */
/* Per-type aggregates                                                 */
/* ------------------------------------------------------------------ */

export interface PollOptionCount {
	option_id: number;
	count: number;
	/** 0..100, 2 dp. poll_single: of total_votes; poll_multi: of total_responses (can add up to > 100). */
	percentage: number;
}

export interface PollSingleAggregate {
	total_responses: number;
	total_votes: number;
	/** In option order. */
	options: PollOptionCount[];
}

export interface PollMultiAggregate {
	total_responses: number;
	/** Total selections. */
	total_votes: number;
	/** 2 dp, 0 when no responses. */
	average_selections_per_participant: number;
	options: PollOptionCount[];
}

export interface WordCloudWord {
	/** Lower case, NFC, whitespace collapsed; masked with '*' when filtered. */
	word: string;
	count: number;
	first_seen_at: IsoDateTime | null;
}

export interface WordCloudAggregate {
	/** Participants with at least one entry. */
	total_responses: number;
	total_entries: number;
	distinct_words: number;
	/** Fewer words sent than distinct_words (≤ 75 words within a 7,000-byte budget). */
	truncated: boolean;
	/** count desc, first_seen_at asc, word asc. */
	words: WordCloudWord[];
}

export interface OpenEndedCard {
	/** "<answer_id>:<index>" */
	id: string;
	body: string;
	/** true when the broadcast preview cut the body to 200 chars (full text via ?page=N). */
	body_truncated: boolean;
	participant_emoji: string | null;
	submitted_at: IsoDateTime | null;
}

/** Broadcast preview = page 1 (10 newest cards, bodies cut); GET .../aggregate?page=N = 20 full cards a page. */
export interface OpenEndedAggregate {
	/** Participants. */
	total_responses: number;
	total_entries: number;
	page: number;
	per_page: number;
	last_page: number;
	/** A body was cut or cards were dropped (preview only; pages are always false). */
	truncated: boolean;
	/** Newest first. */
	items: OpenEndedCard[];
}

export interface ValueCount {
	value: number;
	count: number;
}

export interface ScaleStatementResult {
	option_id: number;
	count: number;
	/** 2 dp, null when count = 0. */
	mean: number | null;
	/** {value: 1..scale_points, count} */
	distribution: ValueCount[];
}

export interface ScalesAggregate {
	total_responses: number;
	scale_points: number;
	/** In option order. */
	statements: ScaleStatementResult[];
}

export interface RankingItemResult {
	option_id: number;
	/** 1 = best; ties share a rank (1, 2, 2, 4); null only with no responses. */
	rank: number | null;
	/** 1-based, 2 dp, lower = better; null with no responses. */
	average_position: number | null;
	/** Participants who placed it explicitly. */
	count: number;
	position_counts: { position: number; count: number }[];
}

export interface RankingAggregate {
	total_responses: number;
	item_count: number;
	/** Sorted by average_position asc, then option order. */
	items: RankingItemResult[];
}

/** Describes the feed only; questions come from the Q&A feed endpoint + qa.question.* events. */
export interface QaAudienceAggregate {
	total_responses: 0;
	feed_source: "live_qa";
	sort: QaSlideSort;
	show_feed_to_participants: boolean;
	allow_anonymous: boolean;
}

export interface PointsAllocationOptionResult {
	option_id: number;
	/** Sum of points given to the option. */
	points: number;
	/** Of total_points_distributed, 0..100, 2 dp. */
	percentage: number;
	/** Per response, 2 dp. */
	average_points: number;
}

export interface PointsAllocationAggregate {
	total_responses: number;
	/** config.total_points */
	total_points: number;
	total_points_distributed: number;
	options: PointsAllocationOptionResult[];
}

export interface RatingItemResult {
	option_id: number;
	count: number;
	mean: number | null;
	/** {value: 1..scale, count} */
	distribution: ValueCount[];
}

export interface RatingAggregate {
	total_responses: number;
	scale: number;
	items: RatingItemResult[];
}

/** Every point counted: counts[row by y][col by x], each cell 100 / size percent. */
export interface DensityGrid {
	size: number;
	counts: number[][];
}

export interface Matrix2x2Aggregate {
	total_responses: number;
	total_points: number;
	/** The latest 150 points, answer order. */
	points: Point[];
	density: DensityGrid;
	/** Over every point, 2 dp; null with no points. */
	centroid: Point | null;
}

export interface PinOnImageAggregate {
	total_responses: number;
	total_pins: number;
	/** The latest 150 pins, answer order. */
	pins: Point[];
	density: DensityGrid;
}

/** Content types: `[]` inside a presenter run, `{}` from GET .../aggregate. */
export type EmptyAggregate = Record<string, never> | never[];

/* --- Quiz v2 aggregates ---------------------------------------------- */
/* Hidden from participants until `reveal` (403 results_hidden); the host
   gets them live on the host channel. Every scored aggregate ends with
   `correct` (the answer key). */

/** The answer key of a scored quiz run: aggregate.correct, my-answer correct_answer, host run answer_key. */
export interface QuizCorrectAnswerMap {
	/** Correct option ids in option order (several may be marked). */
	pick_answer_single: { option_ids: number[] };
	pick_answer_multi: { option_ids: number[] };
	true_false: { option_ids: number[] };
	/** Per blank, its accepted answers (first = the bracketed one). */
	fill_blanks: { blanks: { answers: string[] }[] };
	drag_drop: { blanks: { answers: string[] }[] };
	/** Accepted answers (cleaned option labels) in option order. */
	short_answer: { accepted_answers: string[]; case_sensitive: boolean };
	/** One entry per valid pair, left (author) order. */
	match_pairs: { pairs: MatchPairConnection[] };
	/** Item ids in the correct order. */
	correct_order: { order: OpaqueOptionId[] };
	/** Every category (config order) with its item ids (author order). */
	categorise: { categories: { key: string; item_ids: OpaqueOptionId[] }[] };
}

export type QuizCorrectAnswer<K extends ScoredQuizSlideTypeKey = ScoredQuizSlideTypeKey> = QuizCorrectAnswerMap[K];

/** The correct-answer block of type K (never for non-scored types). */
export type CorrectAnswerOf<K extends SlideTypeKey> = K extends ScoredQuizSlideTypeKey ? QuizCorrectAnswerMap[K] : never;

/** Fields every scored quiz aggregate starts with (AbstractQuizType::aggregate). Malformed stored answers are skipped. */
export interface QuizAggregateBase {
	total_responses: number;
	/** Fully correct. */
	correct_responses: number;
	/** 0 < credit < 1 (match_pairs / correct_order / categorise only; always 0 for pick / short answer). */
	partially_correct_responses: number;
	/** Credit 0. */
	incorrect_responses: number;
	/** correct_responses / total_responses × 100, 2 dp. */
	correct_percentage: number;
}

export interface QuizOptionCount {
	option_id: number;
	count: number;
	/** Of total_responses, 2 dp (multi: share that picked it; can add up to > 100). */
	percentage: number;
	is_correct: boolean;
}

export interface PickAnswerSingleAggregate extends QuizAggregateBase {
	/** In option order. */
	options: QuizOptionCount[];
	correct: QuizCorrectAnswerMap["pick_answer_single"];
}

export interface PickAnswerMultiAggregate extends QuizAggregateBase {
	options: QuizOptionCount[];
	correct: QuizCorrectAnswerMap["pick_answer_multi"];
}

export interface TrueFalseAggregate extends QuizAggregateBase {
	options: QuizOptionCount[];
	correct: QuizCorrectAnswerMap["true_false"];
}

export interface BlankResult {
	/** Responses with this blank right. */
	correct_count: number;
	correct_percentage: number;
}

/** fill_blanks / drag_drop: per blank in reading order. */
export interface BlanksAggregate extends QuizAggregateBase {
	blanks: BlankResult[];
	correct: QuizCorrectAnswerMap["fill_blanks"];
}

export interface ShortAnswerRow {
	/** Most common spelling of answers that normalise the same; masked when wrong and filtered; ≤ 100 chars. */
	text: string;
	count: number;
	percentage: number;
	is_correct: boolean;
}

export interface ShortAnswerAggregate extends QuizAggregateBase {
	distinct_answers: number;
	/** Top 10 by count desc, then text. */
	answers: ShortAnswerRow[];
	/** A text or a row was cut to fit the reveal broadcast. */
	answers_truncated: boolean;
	correct: QuizCorrectAnswerMap["short_answer"];
}

export interface MatchPairResult {
	left_id: OpaqueOptionId;
	right_id: OpaqueOptionId;
	/** Responses that connected this pair correctly. */
	correct_count: number;
	correct_percentage: number;
}

export interface MatchPairsAggregate extends QuizAggregateBase {
	/** Left (author) order. */
	pairs: MatchPairResult[];
	/** [i][j] = responses that connected pairs[i].left_id to pairs[j].right_id (the diagonal is correct). */
	connection_counts: number[][];
	correct: QuizCorrectAnswerMap["match_pairs"];
}

export interface CorrectOrderItemResult {
	id: OpaqueOptionId;
	/** 1-based. */
	correct_position: number;
	/** Responses with this item in its correct slot. */
	correct_count: number;
	correct_percentage: number;
}

export interface CorrectOrderAggregate extends QuizAggregateBase {
	/** In the correct order. */
	items: CorrectOrderItemResult[];
	/** null with no responses; ties: the smallest key sequence with `tied: true` (don't call it "most common" then). */
	most_common_order: { order: OpaqueOptionId[]; count: number; tied?: boolean } | null;
	correct: QuizCorrectAnswerMap["correct_order"];
}

export interface CategoriseItemResult {
	id: OpaqueOptionId;
	correct_category_key: string;
	correct_count: number;
	correct_percentage: number;
	/** Placements per category, aligned with category_keys. */
	category_counts: number[];
}

export interface CategoriseAggregate extends QuizAggregateBase {
	/** Config order. */
	category_keys: string[];
	/** Author order. */
	items: CategoriseItemResult[];
	correct: QuizCorrectAnswerMap["categorise"];
}

/** Where the wheel lands (server-picked, weighted). Rotate so target_angle ends under the 12 o'clock pointer. */
export interface QuizSpinResult {
	option_id: number;
	/** Degrees clockwise from 12 o'clock, inside the winning segment. */
	target_angle: number;
}

/** spinner_wheel takes no answers: `[]` before the spin, `{spin}` after it (QuizRuntime::aggregate). */
export interface SpinnerWheelAggregate {
	spin?: QuizSpinResult;
}

export interface SlideAggregateMap {
	poll_single: PollSingleAggregate;
	poll_multi: PollMultiAggregate;
	word_cloud: WordCloudAggregate;
	open_ended: OpenEndedAggregate;
	scales: ScalesAggregate;
	ranking: RankingAggregate;
	qa_audience: QaAudienceAggregate;
	points_allocation: PointsAllocationAggregate;
	rating: RatingAggregate;
	matrix_2x2: Matrix2x2Aggregate;
	pin_on_image: PinOnImageAggregate;
	heading: EmptyAggregate;
	paragraph: EmptyAggregate;
	bullets: EmptyAggregate;
	numbered: EmptyAggregate;
	quote: EmptyAggregate;
	image: EmptyAggregate;
	video: EmptyAggregate;
	big_text: EmptyAggregate;
	qr_code: EmptyAggregate;
	pick_answer_single: PickAnswerSingleAggregate;
	pick_answer_multi: PickAnswerMultiAggregate;
	true_false: TrueFalseAggregate;
	fill_blanks: BlanksAggregate;
	drag_drop: BlanksAggregate;
	short_answer: ShortAnswerAggregate;
	match_pairs: MatchPairsAggregate;
	correct_order: CorrectOrderAggregate;
	categorise: CategoriseAggregate;
	spinner_wheel: SpinnerWheelAggregate;
	/** The ranking itself comes from state `quiz.leaderboard` / leaderboard.updated / GET .../leaderboard. */
	leaderboard: EmptyAggregate;
}

export type SlideAggregate<K extends SlideTypeKey = SlideTypeKey> = SlideAggregateMap[K];

/** Any scored quiz aggregate. */
export type QuizAggregate = SlideAggregateMap[ScoredQuizSlideTypeKey];

/* ------------------------------------------------------------------ */
/* Authoring (camelCase, owner only)                                   */
/* ------------------------------------------------------------------ */

/** A My Files row next to a *_file_id (MediaPresenter::file). */
export interface MediaFile {
	fileId: number;
	url: string;
	name: string | null;
	mime: string | null;
	category: "image" | "document" | "video" | null;
	width: number | null;
	height: number | null;
	size: number;
	/** false when the owner deleted it from My Files (the deck still shows it). */
	inLibrary: boolean;
}

export type DeckQaSort = "top" | "newest";

/** decks.settings; every write stores all five keys. */
export interface DeckSettings {
	/** 5..3600 or null; seeds time_limit_seconds of NEW answer slides. */
	default_time_limit: number | null;
	/** 0..30; seeds get_ready_seconds of NEW answer slides (0 = no countdown). Quiz decks default to 5. */
	get_ready_seconds: number;
	/** Palette preset key (features/deck/theme.ts); slug [a-z0-9][a-z0-9_-]*, ≤ 40. */
	theme: string;
	show_qr_sidebar: boolean;
	default_qa_sort: DeckQaSort;
}

export const DEFAULT_DECK_SETTINGS: DeckSettings = {
	default_time_limit: null,
	get_ready_seconds: 0,
	theme: "default",
	show_qr_sidebar: true,
	default_qa_sort: "top",
};

/** Per-product defaults (backend DeckSettings::defaults): a quiz deck's get_ready_seconds defaults to 5. */
export function defaultDeckSettings(product?: DeckProduct | null): DeckSettings {
	return product === "quiz"
		? { ...DEFAULT_DECK_SETTINGS, get_ready_seconds: QUIZ_LIMITS.defaultGetReadySeconds }
		: DEFAULT_DECK_SETTINGS;
}

/** Settings with defaults filled in (old rows may hold a partial object). */
export function resolveDeckSettings(
	settings: Partial<DeckSettings> | null | undefined,
	product?: DeckProduct | null
): DeckSettings {
	return { ...defaultDeckSettings(product), ...(settings ?? {}) };
}

/** PATCH body: settings merge onto the stored ones; null resets a key; unknown keys are 422. */
export type DeckSettingsPatch = { [P in keyof DeckSettings]?: DeckSettings[P] | null };

/** private (default): only the owner. public: listed in Discover, where anyone signed in can preview and copy it. */
export type DeckVisibility = "private" | "public";

export interface DeckSummary {
	id: number;
	product: DeckProduct;
	title: string;
	description: string | null;
	coverFileId: number | null;
	cover: MediaFile | null;
	settings: DeckSettings;
	visibility: DeckVisibility;
	slideCount: number;
	publishedAt: IsoDateTime | null;
	createdAt: IsoDateTime | null;
	updatedAt: IsoDateTime | null;
}

/** Option payload (≤ 512 B JSON). `[]` (empty PHP array) or an object. */
export type OptionPayload = Record<string, unknown>;

/* Quiz option payloads (validateOptionPayload normalises them on add / edit / bulk; 422 payload.<key>). */

export type MatchPairsSide = "left" | "right";

/** match_pairs cell: a pair = the left and the right option sharing pair_key (QUIZ_LIMITS.authorKeyPattern). */
export interface MatchPairsOptionPayload {
	side: MatchPairsSide;
	pair_key: string;
}

/** categorise item: names one of config.categories[].key. */
export interface CategoriseOptionPayload {
	correct_category_key: string;
}

/** spinner_wheel entry: weight 0.1..100 (missing = 1); a segment's size is proportional to it. */
export interface SpinnerOptionPayload {
	weight?: number;
}

export interface SlideOption {
	id: number;
	slideId: number;
	/** 1-based. */
	position: number;
	label: string | null;
	imageFileId: number | null;
	image: MediaFile | null;
	/** Quiz only; null on Quest. Never show to participants. */
	isCorrect: boolean | null;
	payload: OptionPayload;
	createdAt: IsoDateTime | null;
	updatedAt: IsoDateTime | null;
}

interface SlideBase<K extends SlideTypeKey> {
	id: number;
	deckId: number;
	type: K;
	/** null for a type the backend registry no longer knows. */
	category: SlideCategory | null;
	revealModel: RevealModel | null;
	acceptsAnswers: boolean | null;
	/** 1-based, contiguous. */
	position: number;
	title: string | null;
	/** paragraph only (RichTextDoc); null otherwise. */
	body: RichTextDoc | null;
	/** Stored config (no `media`; that is the top-level `media`). */
	config: SlideConfigMap[K];
	/** image / video (mp4) / pin_on_image. */
	mediaFileId: number | null;
	media: MediaFile | null;
	timeLimitSeconds: number | null;
	getReadySeconds: number | null;
	/** Quiz only; null on Quest. */
	pointsMin: number | null;
	pointsMax: number | null;
	speedBonusEnabled: boolean | null;
	/** In position order. */
	options: SlideOption[];
	createdAt: IsoDateTime | null;
	updatedAt: IsoDateTime | null;
}

/** Authoring slide, discriminated by `type`. */
export type Slide = { [K in SlideTypeKey]: SlideBase<K> }[SlideTypeKey];

/** The authoring slide of one type (or the union when K is a union). */
export type SlideOf<K extends SlideTypeKey = SlideTypeKey> = Extract<Slide, { type: K }>;

export interface Deck extends DeckSummary {
	/** In position order, each with its options. */
	slides: Slide[];
}

export interface DeckListMeta {
	currentPage: number;
	perPage: number;
	total: number;
	lastPage: number;
}

export interface DeckPage {
	items: DeckSummary[];
	meta: DeckListMeta;
}

/** A Discover card (GET /public): a public deck, its creator and how often it was copied. */
export interface PublicDeckSummary extends DeckSummary {
	creator: { id: number; name: string; avatar: string | null } | null;
	/** Live copies made from it in Discover. */
	copyCount: number;
	/** The viewer's own deck. */
	isMine: boolean;
}

/** GET /public/{deck}: the preview, with slides and options. */
export interface PublicDeck extends PublicDeckSummary {
	slides: Slide[];
}

export interface PublicDeckPage {
	items: PublicDeckSummary[];
	meta: DeckListMeta;
}

export interface ListPublicDecksParams {
	search?: string;
	/** popular = most copied first. */
	sort?: "updated" | "created" | "title" | "popular";
	direction?: "asc" | "desc";
	/** 1..50, default 20 */
	perPage?: number;
	page?: number;
}

export interface ListDecksParams {
	search?: string;
	sort?: "updated" | "created" | "title";
	direction?: "asc" | "desc";
	/** 1..50, default 20 */
	perPage?: number;
	page?: number;
}

export interface CreateDeckInput {
	title?: string | null;
	description?: string | null;
	settings?: DeckSettingsPatch;
	visibility?: DeckVisibility;
}

export interface UpdateDeckInput {
	title?: string;
	description?: string | null;
	visibility?: DeckVisibility;
	settings?: DeckSettingsPatch;
}

/** `order` in slide responses: every live slide, authoritative after any move. */
export interface SlideOrderEntry {
	id: number;
	position: number;
}

export interface AddSlideInput {
	type: SlideTypeKey;
	/** null/absent = end, 0 = first. */
	after_position?: number | null;
}

/** PATCH /slides/{id} body (snake_case). */
export interface SlidePatch<K extends SlideTypeKey = SlideTypeKey> {
	/** ≤ 280 */
	title?: string | null;
	/** paragraph only */
	body?: RichTextDoc | null;
	config?: ConfigPatch<SlideConfigMap[K]>;
	/** 5..3600 | null; types that take no answers have no timer. */
	time_limit_seconds?: number | null;
	/** 0..30 | null */
	get_ready_seconds?: number | null;
	/**
	 * Quiz scored slides only (quiz routes; Quest answers 422 "only available on quiz slides";
	 * unscored types 422 "This slide type is not scored."): 0..1000 | null (null = default at
	 * session start). min ≤ max is checked against the stored values (422 on the field sent).
	 */
	points_min?: number | null;
	points_max?: number | null;
	speed_bonus_enabled?: boolean | null;
}

/** POST .../options/reorder entry: every option of the slide once, positions 1..n. */
export interface OptionOrderEntry {
	id: number;
	position: number;
}

export interface OptionInput {
	/** ≤ 200 */
	label?: string | null;
	/** object ≤ 512 B; quiz types validate it (match_pairs {side, pair_key}, categorise {correct_category_key}, spinner {weight?}). */
	payload?: OptionPayload | null;
	/** Quiz routes only (Quest answers 422): marks a pick_answer option correct. */
	is_correct?: boolean | null;
}

export interface BulkSlideInput {
	type: SlideTypeKey;
	title?: string | null;
	body?: RichTextDoc | null;
	config?: Record<string, unknown> | null;
	/** Options may carry is_correct on quiz routes (422 slides.N.options.M.is_correct on Quest). */
	options?: OptionInput[] | null;
	/** Quiz routes only: 422 slides.N.points_min etc. */
	points_min?: number | null;
	points_max?: number | null;
	speed_bonus_enabled?: boolean | null;
}

export interface BulkSlidesInput {
	/** 1..50, all-or-nothing; 422 keyed slides.N.* */
	slides: BulkSlideInput[];
	after_position?: number | null;
}

export interface SlideWithOrder {
	slide: Slide;
	order: SlideOrderEntry[];
}

export interface SlidesWithOrder {
	slides: Slide[];
	order: SlideOrderEntry[];
}

export interface OptionWithSlide {
	option: SlideOption;
	slide: Slide;
}

/* ------------------------------------------------------------------ */
/* Live run views (snake_case)                                         */
/* ------------------------------------------------------------------ */

/**
 * A run option as participants see it (no is_correct / answer keys). Answers reference `id`
 * (an opaque string for match_pairs / correct_order / categorise; then `position` is the display index).
 */
export interface RunOption<Id extends number | string = number, P = OptionPayload> {
	id: Id;
	position: number;
	label: string | null;
	image_url: string | null;
	payload: P;
}

/** Participant run options of the quiz types (everything else: RunOption). */
export interface QuizRunOptionMap {
	pick_answer_single: RunOption;
	pick_answer_multi: RunOption;
	true_false: RunOption;
	/** No options: the sentence and its blanks are in config. */
	fill_blanks: never;
	/** The word bank under opaque ids, shuffled per participant; payload {}. Answers send the words (labels). */
	drag_drop: RunOption<OpaqueOptionId, EmptyConfig>;
	/** Accepted answers are never shown: options is always []. */
	short_answer: never;
	/** Left cells first (author order), then the right cells shuffled per run; payload {side} only. */
	match_pairs: RunOption<OpaqueOptionId, { side: MatchPairsSide }>;
	/** Shuffled per run (never already in the correct order); payload {}. */
	correct_order: RunOption<OpaqueOptionId, EmptyConfig>;
	/** The scorable items shuffled per run; payload {} (no correct_category_key). */
	categorise: RunOption<OpaqueOptionId, EmptyConfig>;
	/** Wheel entries in option order; geometry is the run's `segments`. */
	spinner_wheel: RunOption<number, SpinnerOptionPayload>;
	/** No options. */
	leaderboard: never;
}

export type RunOptionOf<K extends SlideTypeKey> = K extends keyof QuizRunOptionMap ? QuizRunOptionMap[K] : RunOption;

/** spinner_wheel wheel geometry: degrees clockwise from 12 o'clock, size proportional to weight; the last ends at 360. */
export interface SpinnerSegment {
	option_id: number;
	start_angle: number;
	end_angle: number;
}

/** Type-specific participant-view fields (participantExtras). */
export type RunViewExtrasOf<K extends SlideTypeKey> = K extends "spinner_wheel" ? { segments: SpinnerSegment[] } : unknown;

/** What the host's presenter view adds to each option of a scored quiz run. */
export interface QuizPresenterOptionExtraMap {
	pick_answer_single: { option_id: number; payload: OptionPayload; is_correct: boolean };
	pick_answer_multi: { option_id: number; payload: OptionPayload; is_correct: boolean };
	true_false: { option_id: number; payload: OptionPayload; is_correct: boolean };
	fill_blanks: never;
	/** option_id = the word's place in the bank (host only). */
	drag_drop: { option_id: number; payload: OptionPayload };
	short_answer: never;
	match_pairs: { option_id: number; payload: MatchPairsOptionPayload };
	correct_order: { option_id: number; payload: OptionPayload };
	categorise: { option_id: number; payload: CategoriseOptionPayload };
}

/** A presenter-view option of a scored quiz run: participant row + the real `option_id` + the full payload (+ is_correct on pick types). */
export type PresenterRunOptionOf<K extends ScoredQuizSlideTypeKey> = RunOptionOf<K> & QuizPresenterOptionExtraMap[K];

interface RunViewBase<K extends SlideTypeKey> {
	/** The slide run id (`slide_run_id` everywhere else). */
	id: number;
	/** The authoring slide; null when it was deleted since. */
	slide_id: number | null;
	type: K;
	category: SlideCategory | null;
	reveal_model: RevealModel | null;
	accepts_answers: boolean;
	position: number;
	title: string | null;
	body: RichTextDoc | null;
	/** Snapshot config: answer keys and `_`-prefixed keys stripped; image/pin_on_image/video add `media`; scored quiz runs add `scoring`. */
	config: RunConfigOf<K>;
	/** Participant views of scored quiz runs: [] while `options_hidden` (waiting / get_ready). */
	options: RunOptionOf<K>[];
	/**
	 * Scored quiz runs, participant views only: true while the run is waiting / get_ready —
	 * `options` is [] (and item data withheld) until voting starts; the title is still sent.
	 * Absent or false everywhere else (the presenter always gets the options).
	 */
	options_hidden?: boolean;
	state: RunState;
	/** Per run: starts at 0 and goes up on every transition of THIS run. */
	state_version: number;
	time_limit_seconds: number | null;
	get_ready_seconds: number | null;
	state_started_at: IsoDateTime | null;
	voting_started_at: IsoDateTime | null;
	closed_at: IsoDateTime | null;
}

/** serializeForParticipant(): what participants (and the host's `runs` list) get. Never an aggregate. */
export type ParticipantRunView = { [K in SlideTypeKey]: RunViewBase<K> & RunViewExtrasOf<K> }[SlideTypeKey];

export type RunViewOf<K extends SlideTypeKey = SlideTypeKey> = Extract<ParticipantRunView, { type: K }>;

type PresenterRunViewFor<K extends SlideTypeKey> = K extends ScoredQuizSlideTypeKey
	? Omit<RunViewBase<K>, "options"> & {
			options: PresenterRunOptionOf<K>[];
			/** The correct answer (= aggregate.correct). Host only, from the start of the run. */
			answer_key: QuizCorrectAnswerMap[K];
			aggregate: SlideAggregateMap[K];
		}
	: RunViewBase<K> & RunViewExtrasOf<K> & { aggregate: SlideAggregateMap[K] };

/** serializeForPresenter(): participant view + the live aggregate (scored quiz runs: + answer_key, per-option option_id / payload). Host only. */
export type PresenterRunView = { [K in SlideTypeKey]: PresenterRunViewFor<K> }[SlideTypeKey];

export type PresenterRunViewOf<K extends SlideTypeKey = SlideTypeKey> = Extract<PresenterRunView, { type: K }>;

/** `slide.changed` body when the full one would exceed 8,500 bytes: GET state for the rest. */
export interface SlimRunView {
	id: number;
	slide_id: number | null;
	type: SlideTypeKey;
	category: SlideCategory | null;
	reveal_model: RevealModel | null;
	accepts_answers: boolean;
	position: number;
	state: RunState;
	state_version: number;
	refetch: true;
}

export function isSlimRunView(run: ParticipantRunView | SlimRunView | null | undefined): run is SlimRunView {
	return !!run && (run as SlimRunView).refetch === true;
}

/* ------------------------------------------------------------------ */
/* Session state payloads                                              */
/* ------------------------------------------------------------------ */

/** Derived like slide.state.changed; all null for untimed states. Count down from ends_at corrected by server_time. */
export interface TimerFields {
	seconds_remaining: number | null;
	ends_at: IsoDateTime | null;
	duration_seconds: number | null;
}

export interface SessionInfo {
	id: number;
	deck_id: number;
	product: DeckProduct | null;
	deck_title: string | null;
	/** Deck colour preset (settings.theme); "default" when unset. */
	theme: string;
	status: SessionStatus;
	current_slide_run_id: number | null;
	total_slides: number;
	started_at: IsoDateTime | null;
	ended_at: IsoDateTime | null;
}

export interface JoinInfo {
	join_code: string;
	/** FRONTEND_URL + /join/{CODE} */
	join_url: string;
	public_channel_key: string;
}

export interface SessionChannels {
	/** "session.{product}.{public_channel_key}" */
	public: string;
	/** "host.{product}.v2.{session_id}" (private) */
	host: string;
}

/** HOST STATE: body of start / advance / end and the host's GET state. */
export interface HostSessionState extends TimerFields {
	session_id: number;
	join_code: string;
	public_channel_key: string;
	session: SessionInfo;
	join: JoinInfo;
	channels: SessionChannels;
	participant_count: number;
	/** Participant view of every run, in position order. */
	runs: ParticipantRunView[];
	/** Presenter view (with the live aggregate) of the current run. */
	current_run: PresenterRunView | null;
	results_visibility: ResultsVisibility | null;
	/** Quiz sessions only. */
	quiz?: QuizStatePayload;
	server_time: IsoDateTime;
}

export interface ParticipantIdentity {
	id: number;
	/** Cleaned + profanity-masked. */
	display_name: string;
	emoji_avatar: string;
}

/** PARTICIPANT STATE: GET state with X-Participant-Token (or participant-state). Never the list of runs. */
export interface ParticipantSessionState extends TimerFields {
	session_id: number;
	session: SessionInfo & { public_channel_key: string };
	participant: ParticipantIdentity;
	current_run: ParticipantRunView | null;
	/** Same as current_run (plan §7.6 name). */
	current_slide_run: ParticipantRunView | null;
	has_answered: boolean;
	my_submission_for_current_slide: MySubmission | null;
	results_visibility: ResultsVisibility | null;
	/** Only when results are public (quiz: after the reveal, incl. `correct`); else null. */
	aggregate: SlideAggregate | null;
	/** Quiz sessions only. */
	quiz?: QuizStatePayload;
	/** Quiz sessions only: my total points and rank. */
	standing?: QuizStanding;
	server_time: IsoDateTime;
}

export type DeckSessionState = HostSessionState | ParticipantSessionState;

/* --- Quiz state ------------------------------------------------------ */

/** One leaderboard row (LeaderboardService): ranked by total_points desc, then join time; ties share a rank (1, 2, 2, 4). */
export interface LeaderboardEntry {
	rank: number;
	participant_id: number;
	display_name: string | null;
	emoji_avatar: string | null;
	total_points: number;
	/** Points earned on the latest revealed scored run at or before the current slide (the "+94"). */
	points_delta: number;
}

/** slide.revealed leaderboard_delta row: the movement this run caused, best new_rank first. */
export interface LeaderboardDeltaEntry {
	participant_id: number;
	points_delta: number;
	new_total: number;
	new_rank: number;
}

/** A participant's own place (QuizRuntime::standing). rank null when they are not ranked (e.g. left the table). */
export interface QuizStanding {
	participant_id: number;
	total_points: number;
	rank: number | null;
	/** Points from the latest revealed scored run. */
	points_delta: number;
}

/** state `quiz` (quiz sessions only, host and participant). */
export interface QuizStatePayload {
	/** Answers on the current run (the public "12 answered" count). */
	submitted_count: number;
	/** Participants in the room (joined, not left). Participant state; the host reads the top-level participant_count. */
	participant_count?: number;
	/** Spinner result once spun, else null. */
	spin: QuizSpinResult | null;
	/** Top N when the current run is a leaderboard slide, else null. */
	leaderboard: LeaderboardEntry[] | null;
}

/** GET {session}/leaderboard?limit=1..100 (quiz; host with Sanctum, or participant with X-Participant-Token, also after the end). */
export interface LeaderboardResponse {
	session_id: number;
	status: SessionStatus;
	/** The limit applied (default 10). */
	top_n: number;
	participant_count: number;
	leaderboard: LeaderboardEntry[];
	/** The participant's own place (participant calls); null for the host. */
	me: QuizStanding | null;
	server_time: IsoDateTime;
}

export function isHostSessionState(state: DeckSessionState): state is HostSessionState {
	return Array.isArray((state as HostSessionState).runs) && "channels" in state;
}

/** GET by-code/{code} (live sessions only). */
export interface SessionLookup {
	session_id: number;
	join_code: string;
	product: DeckProduct | null;
	deck_title: string | null;
	status: SessionStatus;
	public_channel_key: string;
}

/** lookupSessionByCode(): the lookup with the product whose routes found it (use that product's API from here on). */
export interface ResolvedSessionLookup extends SessionLookup {
	product: DeckProduct;
}

export interface JoinSessionInput {
	join_code: string;
	/** 1..40 */
	display_name: string;
	/** One of GET /meta/emoji-avatars. */
	emoji_avatar: string;
}

/** 201 from POST .../participants/join (200 for a same-device rejoin). */
export interface JoinSessionResult {
	participant_id: number;
	/** 64 chars; send as X-Participant-Token. */
	participant_token: string;
	public_channel_key: string;
	session_id: number;
	/** As stored (cleaned + masked). A rejoin keeps the stored name and avatar. */
	display_name: string;
	emoji_avatar: string;
	/** true: the join carried this device's token and brought back the same participant (left_at cleared, points kept). */
	rejoined?: boolean;
}

/**
 * `reveal` (quiz routes only; 422 on Quest): a quiz / spinner run in `voting` → reveal. On a quiz run
 * close_voting does the same; on a spinner start_voting spins. 409 invalid_state elsewhere.
 */
export type AdvanceAction =
	| "start_voting"
	| "close_voting"
	| "reveal"
	| "next_slide"
	| "previous_slide"
	| "jump_to"
	/**
	 * Quiz host only: create a leaderboard run right after the current run and move to it
	 * (later runs shift; broadcasts slide.changed + leaderboard.updated). Leaving an active quiz run reveals it first.
	 */
	| "insert_leaderboard";

export interface AdvanceInput {
	action: AdvanceAction;
	/** Required for jump_to. */
	target_run_id?: number | null;
	/** Send after the "go back" confirmation (moving backwards away from an active run). */
	force?: boolean;
}

/** GET .../slide-runs/{run}/aggregate[?page=N] */
export interface AggregateSnapshot<A = SlideAggregate> {
	slide_run_id: number;
	type: SlideTypeKey;
	state: RunState;
	state_version: number;
	closed_at: IsoDateTime | null;
	/** The run is closed / revealed: the aggregate is frozen. */
	final: boolean;
	visibility: ResultsVisibility;
	total_responses: number | null;
	aggregate: A;
	server_time: IsoDateTime;
}

/** REVIEW run: participant view + my answer + results (null when hidden; Q&A always null). */
export type ReviewRun = ParticipantRunView & {
	my_answer: MySubmission | null;
	results_visibility: ResultsVisibility;
	aggregate: SlideAggregate | null;
};

export interface ReviewSessionInfo {
	id: number;
	deck_id: number;
	product: DeckProduct | null;
	deck_title: string | null;
	/** Deck colour preset (settings.theme); "default" when unset. */
	theme: string;
	status: SessionStatus;
	total_slides: number;
	started_at: IsoDateTime | null;
	ended_at: IsoDateTime | null;
	public_channel_key: string;
}

/** GET {session}/review (ended sessions only). */
export interface ReviewState {
	session_id: number;
	session: ReviewSessionInfo;
	participant: ParticipantIdentity;
	/** Position order. */
	runs: ReviewRun[];
	server_time: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Q&A                                                                 */
/* ------------------------------------------------------------------ */

export interface QaItemBase {
	question_id: number;
	slide_run_id: number;
	body: string;
	participant_emoji: string | null;
	upvote_count: number;
	is_answered: boolean;
	is_starred: boolean;
	submitted_at: IsoDateTime | null;
}

/** Participant feed item (hidden questions never reach participants). */
export interface QaParticipantItem extends QaItemBase {
	is_hidden: false;
	has_upvoted: boolean;
	is_mine: boolean;
}

/** Host feed item (= host `qa.question.moderated` payload). */
export interface QaHostItem extends QaItemBase {
	participant_id: number | null;
	is_hidden: boolean;
}

export type QaItem = QaParticipantItem | QaHostItem;

/** Feed order as the feed endpoint names it ('newest' is accepted on input and returned as 'new'). */
export type QaFeedSort = "top" | "new";

export interface QaFeedParams {
	sort?: QaFeedSort | "newest";
	/** 1..500, default 100 */
	limit?: number;
}

export interface QaFeed<I extends QaItem = QaItem> {
	slide_run_id: number;
	state: RunState;
	viewer: "host" | "participant";
	sort: QaFeedSort;
	show_feed_to_participants: boolean;
	/** Participant + feed hidden: only their own questions. */
	own_only: boolean;
	/** Every question this viewer may see. */
	total: number;
	limit: number;
	/** Host: starred first, then the sort; includes hidden. Participant: no hidden. */
	questions: I[];
}

/** POST / DELETE .../upvote (idempotent). */
export interface QaVoteResult {
	question_id: number;
	slide_run_id: number;
	upvote_count: number;
	has_upvoted: boolean;
}

export interface QaModerationFlags {
	is_hidden?: boolean;
	is_starred?: boolean;
	is_answered?: boolean;
}

/* ------------------------------------------------------------------ */
/* Broadcast events                                                    */
/* ------------------------------------------------------------------ */

export type DeckPublicEventName =
	| "slide.changed"
	| "slide.state.changed"
	| "slide.aggregate.updated"
	| "slide.closed"
	| "participant.count.updated"
	| "session.ended"
	| "qa.question.submitted"
	| "qa.question.upvoted"
	| "qa.question.moderated"
	| QuizPublicEventName;

/** Public events only quiz sessions send. */
export type QuizPublicEventName = "slide.submitted_count.updated" | "slide.revealed" | "spin.started" | "leaderboard.updated";

export const QUIZ_PUBLIC_EVENT_NAMES: readonly QuizPublicEventName[] = [
	"slide.submitted_count.updated",
	"slide.revealed",
	"spin.started",
	"leaderboard.updated",
];

export type DeckHostEventName =
	| "answer.submitted"
	| "participant.joined"
	| "slide.aggregate.updated"
	| "qa.question.submitted"
	| "qa.question.upvoted"
	| "qa.question.moderated";

export type DeckEventName = DeckPublicEventName | DeckHostEventName;

/** Keys LiveBroadcastEvent::fromPayload adds to every deck event. */
export interface BroadcastMeta {
	module?: DeckProduct;
	session_id?: number;
	broadcasted_at?: IsoDateTime;
}

export interface SlideChangedEvent extends BroadcastMeta {
	event: "slide.changed";
	slide_run_id: number;
	position: number;
	total_slides: number | null;
	type: SlideTypeKey;
	state: RunState;
	state_version: number;
	/** Participant view, or a slim one with refetch: true (then GET state). */
	slide: ParticipantRunView | SlimRunView;
	server_time: IsoDateTime;
}

export interface SlideStateChangedEvent extends BroadcastMeta, TimerFields {
	event: "slide.state.changed";
	slide_run_id: number;
	state: RunState;
	state_version: number;
	state_started_at: IsoDateTime | null;
	voting_started_at: IsoDateTime | null;
	closed_at: IsoDateTime | null;
	server_time: IsoDateTime;
}

/** Public only when results are public; otherwise on the host channel (always host-only for quiz runs before the reveal). */
export interface SlideAggregateUpdatedEvent<A = SlideAggregate> extends BroadcastMeta {
	event: "slide.aggregate.updated";
	slide_run_id: number;
	state_version: number;
	total_responses: number | null;
	aggregate: A;
	server_time: IsoDateTime;
}

/** Always public; aggregate null when participants may not see results (the host then gets a host-only slide.aggregate.updated). Never sent for quiz runs (they reveal). */
export interface SlideClosedEvent<A = SlideAggregate> extends BroadcastMeta {
	event: "slide.closed";
	slide_run_id: number;
	state: "closed";
	state_version: number;
	closed_at: IsoDateTime | null;
	total_responses: number | null;
	aggregate: A | null;
	server_time: IsoDateTime;
}

export interface ParticipantCountUpdatedEvent extends BroadcastMeta {
	event: "participant.count.updated";
	slide_run_id: number | null;
	participant_count: number;
	server_time: IsoDateTime;
}

export interface SessionEndedEvent extends BroadcastMeta {
	event: "session.ended";
	slide_run_id: number | null;
	session_id: number;
	status: "ended";
	ended_at: IsoDateTime | null;
	server_time: IsoDateTime;
}

/** Host only. */
export interface ParticipantJoinedEvent extends BroadcastMeta {
	event: "participant.joined";
	slide_run_id: number | null;
	participant_id: number;
	display_name: string | null;
	emoji_avatar: string | null;
	joined_at: IsoDateTime | null;
	server_time: IsoDateTime;
}

/** Host only: this submission (never the merged row), shortened when large. */
export interface AnswerSubmittedEvent extends BroadcastMeta {
	event: "answer.submitted";
	slide_run_id: number;
	answer_id: number;
	participant_id: number;
	display_name: string | null;
	emoji_avatar: string | null;
	/** The stored payload of this submission; may carry `truncated: true`, `body_truncated`, or be `{omitted: true}`. */
	answer: Record<string, unknown>;
	time_to_answer_ms: number | null;
	submitted_at: IsoDateTime | null;
	/** Answers on the run after this one. */
	total_responses: number | null;
	/** The participant replaced/extended an earlier answer. */
	is_update: boolean;
	server_time: IsoDateTime;
}

export interface QaQuestionSubmittedEvent extends BroadcastMeta {
	event: "qa.question.submitted";
	question_id: number;
	slide_run_id: number;
	body: string;
	participant_emoji: string | null;
	upvote_count: number;
	is_answered: false;
	is_starred: false;
	submitted_at: IsoDateTime | null;
}

/** Absolute count (a missed event heals on the next one). */
export interface QaQuestionUpvotedEvent extends BroadcastMeta {
	event: "qa.question.upvoted";
	question_id: number;
	slide_run_id: number;
	upvote_count: number;
}

/** Public copy of a hidden question: drop it without ever seeing its body. */
export interface QaModeratedHiddenPayload {
	question_id: number;
	slide_run_id: number;
	is_hidden: true;
}

export type QaQuestionModeratedEvent = BroadcastMeta & { event: "qa.question.moderated" } & (
		| QaModeratedHiddenPayload
		| (QaItemBase & { is_hidden: false })
		| QaHostItem
	);

export type DeckQaEventPayload = QaQuestionSubmittedEvent | QaQuestionUpvotedEvent | QaQuestionModeratedEvent;

/* --- Quiz events (public) -------------------------------------------- */

/**
 * While a quiz run takes answers the public channel only learns HOW MANY answered
 * (debounced with the host aggregate). The aggregate and answer.submitted go to the host channel.
 */
export interface SubmittedCountUpdatedEvent extends BroadcastMeta {
	event: "slide.submitted_count.updated";
	slide_run_id: number;
	submitted_count: number;
	/** Participants in the room (joined, not left). */
	participant_count: number;
	server_time: IsoDateTime;
}

/**
 * A quiz or spinner run moved to `reveal` (sent right after slide.state.changed → reveal).
 * aggregate null + refetch true when it would not fit one publish: GET state / aggregate.
 */
export interface SlideRevealedEvent<A = SlideAggregate> extends BroadcastMeta {
	event: "slide.revealed";
	slide_run_id: number;
	type: SlideTypeKey;
	state: "reveal";
	state_version: number;
	closed_at: IsoDateTime | null;
	/** Final aggregate incl. `correct` (spinner: {spin}); null when slim. */
	aggregate: A | null;
	/** This run's leaderboard movement, best new_rank first, ≤ 10 rows ([] for spinners). */
	leaderboard_delta: LeaderboardDeltaEntry[];
	/** More participants scored than listed (each reads their own through my-answer). */
	leaderboard_truncated: boolean;
	/** Spinner runs: where it landed; quiz runs null. */
	spin: QuizSpinResult | null;
	refetch: boolean;
	server_time: IsoDateTime;
}

/** The host started a spinner (after slide.state.changed → voting): animate to target_angle over duration_seconds; it reveals at ends_at. */
export interface SpinStartedEvent extends BroadcastMeta {
	event: "spin.started";
	slide_run_id: number;
	state_version: number;
	option_id: number;
	target_angle: number;
	duration_seconds: number | null;
	ends_at: IsoDateTime | null;
	server_time: IsoDateTime;
}

/**
 * A leaderboard slide became current (after slide.changed + slide.state.changed).
 * leaderboard null + refetch true when too large: GET state (quiz.leaderboard) / leaderboard.
 */
export interface LeaderboardUpdatedEvent extends BroadcastMeta {
	event: "leaderboard.updated";
	slide_run_id: number;
	top_n: number;
	leaderboard: LeaderboardEntry[] | null;
	refetch: boolean;
	server_time: IsoDateTime;
}

export type QuizPublicEvent = SubmittedCountUpdatedEvent | SlideRevealedEvent | SpinStartedEvent | LeaderboardUpdatedEvent;

export type DeckPublicEvent =
	| SlideChangedEvent
	| SlideStateChangedEvent
	| SlideAggregateUpdatedEvent
	| SlideClosedEvent
	| ParticipantCountUpdatedEvent
	| SessionEndedEvent
	| DeckQaEventPayload
	| QuizPublicEvent;

export type DeckHostEvent = AnswerSubmittedEvent | ParticipantJoinedEvent | SlideAggregateUpdatedEvent | DeckQaEventPayload;

export type DeckEvent = DeckPublicEvent | DeckHostEvent;

/* ------------------------------------------------------------------ */
/* Meta                                                                */
/* ------------------------------------------------------------------ */

/** GET /api/v1/meta/emoji-avatars */
export interface EmojiAvatarMeta {
	/** 40 curated single-code-point emoji. */
	emojis: string[];
	/** emoji → label for screen readers. */
	labels: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* API envelope + errors                                               */
/* ------------------------------------------------------------------ */

export interface ApiEnvelope<T> {
	status: boolean;
	message: string;
	data: T;
}

/** data.code values the deck API sends, plus client-side ones. */
export type DeckErrorCode =
	| "not_found"
	| "conflict"
	| "invalid_state"
	| "unsupported_type"
	| "forbidden"
	| "unauthorized"
	| "results_hidden"
	| "too_many_requests"
	| "payload_too_large"
	/**
	 * 403: users.quest_v2_enabled / quiz_v2_enabled is off (authoring + host routes, incl. host leaderboard).
	 * Profile `quest_v2_enabled` / `quiz_v2_enabled` tells the UI up front. Participants are never gated.
	 */
	| "feature_disabled"
	/** 422: the deck would exceed max slides (data.max_slides; also validation_errors.slides). */
	| "slide_limit_reached"
	/** 422 without a code. */
	| "validation"
	/** No response (offline, CORS, server down). */
	| "network"
	| "timeout"
	| "cancelled"
	| "unknown";

/**
 * `data.reason` on 409 invalid_state. Quiz: no_answers = answering a spinner / leaderboard slide.
 * An illegal `reveal` (outside voting, on a content / leaderboard run, twice) is 409 invalid_state
 * without a reason, with data {slide_run_id, state, state_version}. A quiz aggregate read before its
 * reveal is 403 results_hidden. Quiz-only fields on Quest routes are 422 (points_min, points_max,
 * speed_bonus_enabled, is_correct; also inside bulk); quiz option payloads 422 payload.<key>.
 */
export type InvalidStateReason =
	| "no_answers"
	| "session_not_live"
	| "not_current_slide"
	| "not_voting"
	| "time_up"
	| "not_qa_slide"
	| "not_open"
	| "session_not_ended"
	/** Quiz scored runs: answers are final — a second submit is rejected (the first answer and its points stand). */
	| "already_answered";

/** Extra keys some errors carry in `data` next to `code`. */
export interface DeckErrorData {
	code?: string;
	validation_errors?: Record<string, string[]>;
	reason?: InvalidStateReason | string;
	/** 409 on session start: the live session that already exists. */
	session_id?: number;
	current_slide_run_id?: number;
	slide_run_id?: number;
	state?: RunState;
	state_version?: number;
	/** 409 on previous_slide / backwards jump_to: resend with force: true. */
	requires_force?: boolean;
	status?: SessionStatus;
	session_status?: SessionStatus;
	/** 429 too_many_requests (seconds). */
	retry_after?: number;
	/** 413 payload_too_large */
	max_kb?: number;
	/** 422 unsupported_type */
	type?: string | null;
	/** 422 slide_limit_reached */
	max_slides?: number;
	[key: string]: unknown;
}
