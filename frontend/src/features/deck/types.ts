// Shared slide engine (Quest v2, later Quiz v2): every shape the deck API and
// the realtime channels send. Derived from the backend code, which is the
// contract (QUEST_REDESIGN_PLAN.md "Implementation notes"):
//   - authoring responses: backend/app/Deck/Http/Resources/{Deck,Slide,Option,Media}Presenter.php (camelCase)
//   - live responses + broadcasts: SessionStatePresenter, QaQuestionPresenter,
//     SlideRunResultsService, app/Deck/Broadcasts/Payloads/* (snake_case)
//   - per-type config / answer / aggregate: app/Deck/Slides/Types/{Quest,Content}/*SlideType.php
// Request bodies are snake_case everywhere.

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** ISO-8601 timestamp as the backend sends it (toISOString / toIso8601String). */
export type IsoDateTime = string;

export type DeckProduct = "quest" | "quiz";

export type SlideCategory = "poll" | "interactive" | "content";

export type RevealModel = "live_aggregate" | "hidden_until_reveal" | "moderated_feed" | "none";

/** Run state machine: polls waiting → [get_ready →] voting → closed; Q&A waiting → open → closed; content stays waiting. */
export type RunState = "waiting" | "get_ready" | "voting" | "open" | "closed";

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

export type SlideTypeKey = QuestionSlideTypeKey | ContentSlideTypeKey;

/** Types that take answers through POST .../answers (qa_audience and content types do not). */
export type AnswerSlideTypeKey = Exclude<QuestionSlideTypeKey, "qa_audience">;

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

export const SLIDE_TYPE_KEYS: readonly SlideTypeKey[] = [...QUESTION_SLIDE_TYPE_KEYS, ...CONTENT_SLIDE_TYPE_KEYS];

export function isSlideTypeKey(value: unknown): value is SlideTypeKey {
	return typeof value === "string" && (SLIDE_TYPE_KEYS as readonly string[]).includes(value);
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
	/** Option caps (config/deck.php option_limits): default max 30; ranking 12; scales 20. */
	optionMax: { default: 30, ranking: 12, scales: 20 } as Record<string, number>,
	optionMin: { poll_single: 2, poll_multi: 2, ranking: 2, scales: 1 } as Record<string, number>,
	qaFeedDefaultLimit: 100,
	qaFeedMaxLimit: 500,
	openEndedPageSize: 20,
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
}

export type SlideConfig<K extends SlideTypeKey = SlideTypeKey> = SlideConfigMap[K];

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

/** What a participant POSTs as `answer_payload`. Option ids are run option `id`s. */
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
}

export type StoredAnswer<K extends SlideTypeKey = AnswerSlideTypeKey> = StoredAnswerMap[K];

/** GET .../my-answer, state.my_submission_for_current_slide, review run.my_answer. */
export interface MySubmission<P = StoredAnswer> {
	slide_run_id: number;
	/** As stored; `{}` when empty. */
	answer_payload: P;
	time_to_answer_ms: number | null;
	submitted_at: IsoDateTime | null;
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
}

export type SlideAggregate<K extends SlideTypeKey = SlideTypeKey> = SlideAggregateMap[K];

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
	/** 0..30; seeds get_ready_seconds of NEW answer slides (0 = no countdown). */
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

/** Settings with defaults filled in (old rows may hold a partial object). */
export function resolveDeckSettings(settings: Partial<DeckSettings> | null | undefined): DeckSettings {
	return { ...DEFAULT_DECK_SETTINGS, ...(settings ?? {}) };
}

/** PATCH body: settings merge onto the stored ones; null resets a key; unknown keys are 422. */
export type DeckSettingsPatch = { [P in keyof DeckSettings]?: DeckSettings[P] | null };

export interface DeckSummary {
	id: number;
	product: DeckProduct;
	title: string;
	description: string | null;
	coverFileId: number | null;
	cover: MediaFile | null;
	settings: DeckSettings;
	slideCount: number;
	publishedAt: IsoDateTime | null;
	createdAt: IsoDateTime | null;
	updatedAt: IsoDateTime | null;
}

/** Option payload (≤ 512 B JSON). `[]` (empty PHP array) or an object. */
export type OptionPayload = Record<string, unknown>;

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
}

export interface UpdateDeckInput {
	title?: string;
	description?: string | null;
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
}

/** POST .../options/reorder entry: every option of the slide once, positions 1..n. */
export interface OptionOrderEntry {
	id: number;
	position: number;
}

export interface OptionInput {
	/** ≤ 200 */
	label?: string | null;
	/** object ≤ 512 B */
	payload?: OptionPayload | null;
}

export interface BulkSlideInput {
	type: SlideTypeKey;
	title?: string | null;
	body?: RichTextDoc | null;
	config?: Record<string, unknown> | null;
	options?: OptionInput[] | null;
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

/** A run option as participants see it (no is_correct / answer keys). Answers reference `id`. */
export interface RunOption {
	id: number;
	position: number;
	label: string | null;
	image_url: string | null;
	payload: OptionPayload;
}

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
	/** Snapshot config: answer keys and `_`-prefixed keys stripped; image/pin_on_image/video add `media`. */
	config: SlideConfigMap[K];
	options: RunOption[];
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
export type ParticipantRunView = { [K in SlideTypeKey]: RunViewBase<K> }[SlideTypeKey];

export type RunViewOf<K extends SlideTypeKey = SlideTypeKey> = Extract<ParticipantRunView, { type: K }>;

/** serializeForPresenter(): participant view + the live aggregate. Host only. */
export type PresenterRunView = { [K in SlideTypeKey]: RunViewBase<K> & { aggregate: SlideAggregateMap[K] } }[SlideTypeKey];

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
	/** Only when results are public; else null. */
	aggregate: SlideAggregate | null;
	server_time: IsoDateTime;
}

export type DeckSessionState = HostSessionState | ParticipantSessionState;

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

export interface JoinSessionInput {
	join_code: string;
	/** 1..40 */
	display_name: string;
	/** One of GET /meta/emoji-avatars. */
	emoji_avatar: string;
}

/** 201 from POST .../participants/join. */
export interface JoinSessionResult {
	participant_id: number;
	/** 64 chars; send as X-Participant-Token. */
	participant_token: string;
	public_channel_key: string;
	session_id: number;
	/** As stored (cleaned + masked). */
	display_name: string;
	emoji_avatar: string;
}

export type AdvanceAction = "start_voting" | "close_voting" | "next_slide" | "previous_slide" | "jump_to";

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
	/** The run is closed: the aggregate is frozen. */
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
	| "qa.question.moderated";

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

/** Public only when results are public; otherwise on the host channel. */
export interface SlideAggregateUpdatedEvent<A = SlideAggregate> extends BroadcastMeta {
	event: "slide.aggregate.updated";
	slide_run_id: number;
	state_version: number;
	total_responses: number | null;
	aggregate: A;
	server_time: IsoDateTime;
}

/** Always public; aggregate null when participants may not see results (the host then gets a host-only slide.aggregate.updated). */
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

export type DeckPublicEvent =
	| SlideChangedEvent
	| SlideStateChangedEvent
	| SlideAggregateUpdatedEvent
	| SlideClosedEvent
	| ParticipantCountUpdatedEvent
	| SessionEndedEvent
	| DeckQaEventPayload;

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
	/** 403: users.quest_v2_enabled is off (authoring + host routes). Profile `quest_v2_enabled` tells the UI up front. */
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

/** `data.reason` on 409 invalid_state. */
export type InvalidStateReason =
	| "no_answers"
	| "session_not_live"
	| "not_current_slide"
	| "not_voting"
	| "time_up"
	| "not_qa_slide"
	| "not_open"
	| "session_not_ended";

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
