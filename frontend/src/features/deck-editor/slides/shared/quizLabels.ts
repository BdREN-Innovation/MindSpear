import type { QuizSlideTypeKey, QuizStanding, SlideOption } from "@/features/deck/types";

// Copy the quiz types share between the big screen and phones, so both
// read the same fallback question and the same standing line.

const QUIZ_FALLBACK_TITLES: Record<QuizSlideTypeKey, string> = {
	pick_answer_single: "Pick the correct answer",
	pick_answer_multi: "Pick all the correct answers",
	true_false: "True or false?",
	short_answer: "Type the correct answer",
	fill_blanks: "Fill in the blanks",
	drag_drop: "Drag the words into the blanks",
	match_pairs: "Match the pairs",
	correct_order: "Put these in the correct order",
	categorise: "Sort the items into the right categories",
	spinner_wheel: "Spin the wheel",
	leaderboard: "Leaderboard",
};

export function quizFallbackTitle(type: QuizSlideTypeKey): string {
	return QUIZ_FALLBACK_TITLES[type];
}

/** The slide question, or the quiz type's fallback when it is empty. */
export function quizDisplayTitle(title: string | null | undefined, type: QuizSlideTypeKey): string {
	return title?.trim() || quizFallbackTitle(type);
}

/** A, B, C… for option badges (numbers after Z). */
export function optionLetter(index: number): string {
	return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "1,250" — points with grouping. */
export function formatPoints(points: number): string {
	return Math.round(points).toLocaleString("en-US");
}

/** "#4 of 30" / "#4" / null when unranked. */
export function rankLabel(rank: number | null | undefined, total?: number | null): string | null {
	if (!rank) return null;
	return total && total >= rank ? `#${rank} of ${total}` : `#${rank}`;
}

/** Standing after a reveal: my-answer's total / rank win over the live standing (they are this run's). */
export function resolveStanding(
	reveal: { total_points: number; rank: number | null } | null | undefined,
	standing: QuizStanding | null | undefined
): { total: number; rank: number | null } | null {
	if (reveal) return { total: reveal.total_points, rank: reveal.rank ?? standing?.rank ?? null };
	if (standing) return { total: standing.total_points, rank: standing.rank };
	return null;
}

/**
 * Characters as the server counts them (PHP mb_strlen = Unicode code points),
 * so an emoji is 1, not the 2 UTF-16 units of `text.length`.
 */
export function codePointLength(text: string): number {
	return Array.from(text).length;
}

/**
 * Whether an authoring option is marked correct, like QuizOptions::isCorrect:
 * the option's is_correct column, or — when that is null — a boolean
 * `is_correct` in its payload (how the payload-only bulk endpoint marks one).
 */
export function optionIsCorrect(option: Pick<SlideOption, "isCorrect" | "payload">): boolean {
	if (option.isCorrect !== null && option.isCorrect !== undefined) return option.isCorrect === true;
	return (option.payload as { is_correct?: unknown } | null | undefined)?.is_correct === true;
}

/** How a revealed item / pair did: "most" only above half (exactly 50% is not most). */
export interface MajorityVerdict {
	/** More than half of the answers got it right. */
	mostlyRight: boolean;
	/** Screen reader text for the ✅ / ❌ mark. */
	label: string;
}

export function majorityVerdict(percentage: number, totalResponses: number): MajorityVerdict | null {
	if (!(totalResponses > 0)) return null;
	if (percentage > 50) return { mostlyRight: true, label: "most players got this right" };
	if (percentage === 50) return { mostlyRight: false, label: "half of the players got this right" };
	return { mostlyRight: false, label: "most players got this wrong" };
}
