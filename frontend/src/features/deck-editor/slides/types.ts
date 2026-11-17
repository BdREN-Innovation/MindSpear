import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { DeckTheme } from "@/features/deck/theme";
import type { HostQaFeed, ParticipantQaFeed } from "@/features/deck/live/qaFeed";
import type { QuizLiveState } from "@/features/deck/live/channelState";
import type {
	AggregateSnapshot,
	AnswerPayloadMap,
	CorrectAnswerOf,
	Deck,
	DeckProduct,
	JoinInfo,
	LeaderboardResponse,
	OptionInput,
	QuizAnswerResult,
	QuizScoringConfig,
	QuizStanding,
	RunState,
	RunViewOf,
	SlideAggregateMap,
	SlideCategory,
	SlideOf,
	SlideOption,
	SlidePatch,
	SlideTypeKey,
	StoredAnswerMap,
} from "@/features/deck/types";

// Prop contracts every slide type folder (slides/<folder>/index.ts) implements.
// One folder per backend type key; each exports `entry` built with
// defineSlideType(). K narrows every prop to that type's config / answer /
// aggregate shapes (features/deck/types.ts); the registry stores entries
// with K erased so shells can render any run.
//
// Quiz additions (all optional, Quest shells never pass them):
// - every scored quiz run reads results from `aggregate` once state is
//   'reveal' (aggregate.correct is the answer key; before the reveal only the
//   host has an aggregate);
// - PresenterProps.quiz / ParticipantProps.quiz: live submitted count, spin,
//   leaderboard rows + reveal delta (useDeckSessionChannel().quiz);
// - ParticipantProps.scoring (the "50p ── 100p" bar), .reveal (my result after
//   the reveal) and .standing (my total + rank).

/* ------------------------------------------------------------------ */
/* Editor (Inspector "Content" tab)                                    */
/* ------------------------------------------------------------------ */

/**
 * Option operations for the slide being edited. Each call hits the API
 * (features/deck/api/authoringApi) and the editor shell replaces the slide
 * from the response, so `slide.options` re-renders with server truth.
 */
export interface OptionsApi {
	/** POST .../options — appended last. 422 `options` at the type's cap. */
	add(input?: OptionInput): Promise<SlideOption>;
	/** PATCH .../options/{id} {label?, payload?} (shell may debounce label typing). */
	update(optionId: number, input: OptionInput): Promise<SlideOption>;
	/** DELETE .../options/{id}. 422 `options` below the type's minimum. */
	remove(optionId: number): Promise<void>;
	/** PUT .../options/{id}/image {file_id|null}; null detaches (the file stays in My Files). */
	setImage(optionId: number, fileId: number | null): Promise<SlideOption>;
	/** POST .../options/reorder with the option ids in their new order (positions become 1..n). 409 conflict: the shell refetches. */
	reorder(orderedOptionIds: number[]): Promise<void>;
	/** Option count limits for this type (DECK_LIMITS.optionMin / optionMax). */
	readonly min: number;
	readonly max: number;
}

/** Slide media (image / video / pin_on_image): PUT .../media. Upload first via features/file-library. */
export interface SlideMediaApi {
	/** {file_id} attaches a My Files image or mp4; null detaches. On video slides it clears config.video_url. */
	setFile(fileId: number | null): Promise<void>;
	/** {video_url} YouTube/Vimeo link (clears media_file_id); null clears. 422 `video_url` on a bad link. */
	setVideoUrl(url: string | null): Promise<void>;
}

export interface EditorProps<K extends SlideTypeKey = SlideTypeKey> {
	slide: SlideOf<K>;
	deck: Deck;
	/** Queue a PATCH (snake_case; config merges recursively, lists replace). The shell applies it optimistically and autosaves. */
	onChange(patch: SlidePatch<K>): void;
	onOptionsChange: OptionsApi;
	media: SlideMediaApi;
	/** 422 field errors for this slide, keys as the backend sends them: `config.max_selections`, `title`, `options`, `file_id`, `video_url`. */
	errors?: Record<string, string[]>;
	disabled?: boolean;
}

/* ------------------------------------------------------------------ */
/* Presenter (host big screen + editor canvas preview)                 */
/* ------------------------------------------------------------------ */

/** Session facts a presenter may show (QR code slide, counters). Null in the editor preview. */
export interface PresenterSessionInfo {
	sessionId: number | null;
	join: JoinInfo | null;
	participantCount: number | null;
	totalSlides: number | null;
}

/** Host-only helpers, present in live mode. */
export interface HostActions {
	sessionId: number;
	product: DeckProduct;
	/** qa_audience: the moderation feed (useHostQaFeed). */
	qa?: HostQaFeed;
	/** open_ended: load a full-text page of cards (GET .../aggregate?page=N, 20 a page). */
	loadAggregatePage?(page: number): Promise<AggregateSnapshot>;
	/** Quiz: GET {session}/leaderboard?limit= (e.g. a leaderboard slide showing more rows than the event). */
	loadLeaderboard?(limit?: number): Promise<LeaderboardResponse>;
}

/**
 * Quiz live extras of the current run, exactly useDeckSessionChannel().quiz:
 * {slide_run_id, submitted_count, participant_count, spin, leaderboard,
 * leaderboard_top_n, leaderboard_delta, leaderboard_truncated}.
 */
export type QuizSlideLiveInfo = QuizLiveState;

/** Presenter quiz extras (null in preview / Quest). */
export type PresenterQuizInfo = QuizSlideLiveInfo;

/** Participant quiz extras: the live block plus who I am (to find "You" in leaderboard rows). */
export interface ParticipantQuizInfo extends QuizSlideLiveInfo {
	/** My participant id (null when unknown). */
	participant_id: number | null;
}

/** My result on a revealed scored quiz run (my-answer / state my_submission correctness keys). */
export type QuizReveal<K extends SlideTypeKey = SlideTypeKey> = QuizAnswerResult<CorrectAnswerOf<K>>;

export interface PresenterProps<K extends SlideTypeKey = SlideTypeKey> {
	/** The run (participant view; a PresenterRunView is accepted, but read results from `aggregate`). */
	run: RunViewOf<K>;
	/** Latest aggregate (live updates); in preview, entry.sampleAggregate(slide) or null. */
	aggregate: SlideAggregateMap[K] | null;
	state: RunState;
	theme: DeckTheme;
	/** 'preview' = editor canvas / thumbnails: no host, no session, no network. */
	mode: "live" | "preview";
	host?: HostActions;
	session?: PresenterSessionInfo;
	/**
	 * Quiz sessions: submitted count ("12 / 30 answered"), participant count, spin target,
	 * leaderboard rows (leaderboard slide) and this run's leaderboard_delta after the reveal.
	 * null/undefined in preview mode and on Quest (sample data is the type's own business).
	 */
	quiz?: PresenterQuizInfo | null;
}

/* ------------------------------------------------------------------ */
/* Participant (phone answering UI; content types: read-only view)     */
/* ------------------------------------------------------------------ */

export interface ParticipantProps<K extends SlideTypeKey = SlideTypeKey> {
	run: RunViewOf<K>;
	/** The participant's stored answer for this run (normalised server shape), or null. Render the submitted state from it. */
	mySubmission: StoredAnswerMap[K] | null;
	/** POST .../answers. Rejects with DeckApiError (409 reason not_voting / time_up, 422 answer_payload.*). */
	onSubmit(payload: AnswerPayloadMap[K]): Promise<void>;
	/** Not voting (waiting / get_ready / closed), submitting, or offline. */
	disabled: boolean;
	theme: DeckTheme;
	/** Results when the slide shows them to participants (results_visibility 'public'); else null/undefined. */
	aggregate?: SlideAggregateMap[K] | null;
	/** qa_audience only: feed + submit / upvote (useParticipantQaFeed). */
	qa?: ParticipantQaFeed;
	/** 'review' = post-session read-only. */
	mode?: "live" | "preview" | "review";
	/** Quiz scored runs: run.config.scoring (points_min / points_max / speed bonus / time limit) for the points bar; null otherwise. */
	scoring?: QuizScoringConfig | null;
	/**
	 * Quiz, once the run is revealed and I answered: {is_correct, points_awarded, correct_answer,
	 * total_points, rank}. null before the reveal (never expect correctness earlier) or without an answer.
	 */
	reveal?: QuizReveal<K> | null;
	/** Quiz: my total points and rank (also for leaderboard slides). */
	standing?: QuizStanding | null;
	/** Quiz live extras (submitted count, spin, leaderboard rows) + my participant id. */
	quiz?: ParticipantQuizInfo | null;
}

/* ------------------------------------------------------------------ */
/* Registry entry                                                      */
/* ------------------------------------------------------------------ */

export type SlideTypeEntry<K extends SlideTypeKey = SlideTypeKey> = {
	/** Backend type key, e.g. 'poll_single'. */
	key: K;
	products: DeckProduct[];
	category: SlideCategory;
	label: string;
	/** One line for the SlidePicker. */
	description: string;
	icon: LucideIcon;
	/** Inspector Content tab. */
	Editor: ComponentType<EditorProps<K>>;
	/** Host big screen + editor canvas preview. */
	Presenter: ComponentType<PresenterProps<K>>;
	/** Phone answering UI (content types: read-only view). */
	Participant: ComponentType<ParticipantProps<K>>;
	/** Fake aggregate for the editor canvas preview. */
	sampleAggregate?: (slide: SlideOf<K>) => SlideAggregateMap[K];
	/** Not offered for new slides (the SlidePicker hides it); kept to render past runs. */
	retired?: boolean;
};

/**
 * Declare a slide type with its props narrowed to K, returned with K erased
 * for the registry:
 *   export const entry = defineSlideType({ key: "poll_single", ..., Editor: PollSingleEditor });
 */
export function defineSlideType<K extends SlideTypeKey>(entry: SlideTypeEntry<K>): SlideTypeEntry {
	return entry as unknown as SlideTypeEntry;
}
