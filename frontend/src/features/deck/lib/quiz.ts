import type {
	LeaderboardConfig,
	LeaderboardDeltaEntry,
	ParticipantRunView,
	QuizScoringConfig,
	QuizStanding,
	SlideOf,
	SpinnerSegment,
} from "../types";
import { isScoredQuizSlideTypeKey, QUIZ_LIMITS } from "../types";

// Pure Quiz v2 helpers mirroring the backend (QuizScoring, QuizRuntime,
// SpinnerWheelSlideType, LeaderboardSlideType), so phones, the presenter and
// the editor preview compute the same numbers the server does.

/** config deck.quiz.scoring defaults (untimed). */
export const DEFAULT_QUIZ_SCORING: QuizScoringConfig = {
	points_min: QUIZ_LIMITS.defaultPointsMin,
	points_max: QUIZ_LIMITS.defaultPointsMax,
	speed_bonus_enabled: QUIZ_LIMITS.defaultSpeedBonus,
	time_limit_seconds: null,
};

/**
 * The `config.scoring` a session would snapshot for an authoring slide
 * (QuizRuntime::scoringSnapshot): slide columns or the defaults, min clamped to max.
 */
export function slideScoring(slide: Pick<SlideOf, "pointsMin" | "pointsMax" | "speedBonusEnabled" | "timeLimitSeconds">): QuizScoringConfig {
	const max = slide.pointsMax ?? QUIZ_LIMITS.defaultPointsMax;
	const min = slide.pointsMin ?? QUIZ_LIMITS.defaultPointsMin;
	return {
		points_min: Math.min(min, max),
		points_max: max,
		speed_bonus_enabled: slide.speedBonusEnabled ?? QUIZ_LIMITS.defaultSpeedBonus,
		time_limit_seconds: slide.timeLimitSeconds && slide.timeLimitSeconds > 0 ? slide.timeLimitSeconds : null,
	};
}

/** A run's scoring block (scored quiz runs of quiz sessions), else null. */
export function runScoring(run: Pick<ParticipantRunView, "type" | "config"> | null | undefined): QuizScoringConfig | null {
	if (!run || !isScoredQuizSlideTypeKey(run.type)) return null;
	const scoring = (run.config as { scoring?: QuizScoringConfig } | null)?.scoring;
	return scoring && typeof scoring.points_max === "number" ? scoring : null;
}

/**
 * Points a fully correct answer earns after `elapsedMs` of answering (QuizScoring::earnable,
 * unrounded): points_max at 0 ms, falling linearly to points_min at the time limit; points_max
 * when the speed bonus is off or the run is untimed.
 */
export function earnablePointsExact(scoring: QuizScoringConfig, elapsedMs: number): number {
	const { points_min: min, points_max: max, speed_bonus_enabled: speed, time_limit_seconds: limit } = scoring;
	if (!speed || !limit) return max;
	const limitMs = limit * 1000;
	const ratio = Math.max(0, Math.min(1, (limitMs - Math.max(0, elapsedMs)) / limitMs));
	return min + ratio * (max - min);
}

/** earnablePointsExact × credit, rounded once like the server (half up). credit 0..1 (0 = wrong → 0). */
export function earnablePoints(scoring: QuizScoringConfig, elapsedMs: number, credit = 1): number {
	const share = Math.max(0, Math.min(1, credit));
	return share <= 0 ? 0 : Math.round(earnablePointsExact(scoring, elapsedMs) * share);
}

function spinnerWeight(payload: unknown): number {
	const raw = (payload as { weight?: unknown } | null)?.weight;
	const weight = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
	return Number.isFinite(weight) && weight > 0 ? Math.min(weight, QUIZ_LIMITS.maxSpinnerWeight) : 1;
}

/**
 * Wheel geometry of spinner options (SpinnerWheelSlideType::segments): option order
 * (position, then id), each segment proportional to its weight (missing / bad = 1),
 * degrees clockwise from 12 o'clock, 4 dp, the last one ending at 360.
 */
export function spinnerSegments(options: readonly { id: number; position: number; payload: unknown }[]): SpinnerSegment[] {
	const sorted = [...options].sort((a, b) => a.position - b.position || a.id - b.id);
	const total = sorted.reduce((sum, option) => sum + spinnerWeight(option.payload), 0);
	if (sorted.length === 0 || total <= 0) return [];

	const round = (value: number) => Math.round(value * 10_000) / 10_000;
	let start = 0;
	const segments = sorted.map((option) => {
		const end = start + (spinnerWeight(option.payload) / total) * 360;
		const segment = { option_id: option.id, start_angle: round(start), end_angle: round(end) };
		start = end;
		return segment;
	});
	segments[segments.length - 1].end_angle = 360;
	return segments;
}

/**
 * Wheel rotation (degrees, clockwise) that puts `targetAngle` under the 12 o'clock pointer
 * after `turns` full turns: rotate by -targetAngle, plus whole turns for the show.
 */
export function spinRotation(targetAngle: number, turns = 5): number {
	return turns * 360 + ((360 - (targetAngle % 360)) % 360);
}

/** Rows a leaderboard slide shows (LeaderboardSlideType::limit): top_n 1..50, or 50 with show_all_participants. */
export function leaderboardLimit(config: Partial<LeaderboardConfig> | null | undefined): number {
	if (config?.show_all_participants) return QUIZ_LIMITS.leaderboardMaxTopN;
	const n = typeof config?.top_n === "number" ? Math.floor(config.top_n) : QUIZ_LIMITS.leaderboardDefaultTopN;
	return Math.max(1, Math.min(n, QUIZ_LIMITS.leaderboardMaxTopN));
}

/** My standing from a slide.revealed leaderboard_delta, or null when I am not in the (≤ 10) rows. */
export function standingFromDelta(
	delta: readonly LeaderboardDeltaEntry[] | null | undefined,
	participantId: number | null | undefined
): QuizStanding | null {
	if (!delta || participantId === null || participantId === undefined) return null;
	const row = delta.find((entry) => entry.participant_id === participantId);
	return row
		? { participant_id: participantId, total_points: row.new_total, rank: row.new_rank, points_delta: row.points_delta }
		: null;
}

/**
 * Editor-preview stand-in for an opaque option id (match_pairs / correct_order / categorise):
 * live runs use an HMAC key the client cannot compute, so previews (slideToRunView and the
 * types' sampleAggregate) use this instead. Same option → same key.
 */
export function previewOptionKey(optionId: number): string {
	return `preview-${optionId}`;
}
