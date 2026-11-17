import type { DragDropConfig, FillBlanksConfig, QuizScoringConfig, Slide, SlideOption } from "@/features/deck/types";
import { isScoredQuizSlideTypeKey } from "@/features/deck/types";
import { compareForm, parseSentence, cleanWords } from "@/features/deck/lib/blanks";
import { earnablePoints, previewOptionKey } from "@/features/deck/lib/quiz";
import { cleanWord } from "@/features/deck/lib/text";

// The full-screen preview's phone answers are never sent anywhere: this
// scores one against the authoring slide, with the same rules the server's
// quiz types use (AbstractQuizType::judge and QuizScoring), so the preview
// phone can show "Correct! +N points" after "Show results". Opaque option ids
// are the preview stand-ins (previewOptionKey), like slideToRunView makes.

export interface PreviewResult {
	is_correct: boolean;
	points_awarded: number;
	/** 0..1. */
	credit: number;
}

function isMarkedCorrect(option: SlideOption): boolean {
	if (option.isCorrect !== null && option.isCorrect !== undefined) return option.isCorrect === true;
	return (option.payload as { is_correct?: unknown } | null)?.is_correct === true;
}

function sorted(options: SlideOption[]): SlideOption[] {
	return [...options].sort((a, b) => a.position - b.position || a.id - b.id);
}

function ratio(hits: number, total: number): number {
	return total > 0 ? Math.max(0, Math.min(hits, total)) / total : 0;
}

/** Share of the answer that is right (0..1), or null when the payload is not an answer of the slide's type. */
export function previewCredit(slide: Slide, payload: unknown): number | null {
	const answer = (payload ?? {}) as Record<string, unknown>;
	const options = sorted(slide.options);

	switch (slide.type) {
		case "pick_answer_single":
		case "pick_answer_multi":
		case "true_false": {
			const correct = new Set(options.filter(isMarkedCorrect).map((option) => option.id));
			if (Array.isArray(answer.option_ids)) {
				const picked = new Set(answer.option_ids.filter((id): id is number => typeof id === "number"));
				const exact = correct.size > 0 && picked.size === correct.size && [...picked].every((id) => correct.has(id));
				return exact ? 1 : 0;
			}
			return typeof answer.option_id === "number" ? (correct.has(answer.option_id) ? 1 : 0) : null;
		}
		case "short_answer": {
			if (typeof answer.text !== "string") return null;
			const caseSensitive = (slide.config as { case_sensitive?: boolean }).case_sensitive ?? false;
			const accepted = options.map((option) => cleanWord(option.label ?? "")).filter(Boolean);
			const form = compareForm(answer.text, caseSensitive);
			return form !== "" && accepted.some((value) => compareForm(value, caseSensitive) === form) ? 1 : 0;
		}
		case "fill_blanks":
		case "drag_drop": {
			if (!Array.isArray(answer.answers)) return null;
			const values: unknown[] = answer.answers;
			const config = slide.config as Partial<FillBlanksConfig & DragDropConfig>;
			const fill = slide.type === "fill_blanks";
			const caseSensitive = fill ? (config.case_sensitive ?? false) : true;
			const blanks = parseSentence(config.text ?? "").answers;
			const hits = blanks.filter((blankAnswer, index) => {
				const value = values[index];
				if (typeof value !== "string" || value.trim() === "") return false;
				const setting = fill ? config.blanks?.[index] : undefined;
				const accepted = fill && setting?.mode !== "dropdown" ? [blankAnswer, ...cleanWords(setting?.alternatives)] : [blankAnswer];
				return accepted.some((candidate) => compareForm(candidate, caseSensitive) === compareForm(value, caseSensitive));
			}).length;
			return ratio(hits, blanks.length);
		}
		case "correct_order": {
			if (!Array.isArray(answer.order)) return null;
			const order = answer.order;
			return ratio(options.filter((option, index) => order[index] === previewOptionKey(option.id)).length, options.length);
		}
		case "categorise": {
			if (!Array.isArray(answer.placements)) return null;
			const categories = new Set(((slide.config as { categories?: { key: string }[] }).categories ?? []).map((category) => category.key));
			const home = new Map<string, string>();
			for (const option of options) {
				const key = (option.payload as { correct_category_key?: unknown }).correct_category_key;
				if (typeof key === "string" && categories.has(key)) home.set(previewOptionKey(option.id), key);
			}
			const placed = new Map<string, string>();
			for (const placement of answer.placements as { item_id?: unknown; category_key?: unknown }[]) {
				if (typeof placement?.item_id === "string" && typeof placement.category_key === "string" && !placed.has(placement.item_id)) {
					placed.set(placement.item_id, placement.category_key);
				}
			}
			return ratio([...home].filter(([id, key]) => placed.get(id) === key).length, home.size);
		}
		case "match_pairs": {
			if (!Array.isArray(answer.pairs)) return null;
			const side = new Map<string, { side: unknown; pair: unknown }>();
			for (const option of options) {
				const payload = option.payload as { side?: unknown; pair_key?: unknown };
				side.set(previewOptionKey(option.id), { side: payload.side, pair: payload.pair_key });
			}
			const lefts = new Set([...side.values()].filter((cell) => cell.side === "left").map((cell) => cell.pair));
			const pairs = new Set([...side.values()].filter((cell) => cell.side === "right" && lefts.has(cell.pair)).map((cell) => cell.pair)).size;
			const hits = (answer.pairs as { left_id?: unknown; right_id?: unknown }[]).filter((pair) => {
				const left = side.get(String(pair?.left_id));
				const right = side.get(String(pair?.right_id));
				return left?.side === "left" && right?.side === "right" && left.pair === right.pair;
			}).length;
			return ratio(hits, pairs);
		}
		default:
			return null;
	}
}

/** The phone's result for `payload` answered `elapsedMs` into the question; null for slides that are not scored. */
export function previewResult(slide: Slide, payload: unknown, scoring: QuizScoringConfig | null, elapsedMs: number): PreviewResult | null {
	if (!isScoredQuizSlideTypeKey(slide.type) || !scoring) return null;
	const credit = previewCredit(slide, payload) ?? 0;
	return { is_correct: credit >= 1, points_awarded: earnablePoints(scoring, elapsedMs, credit), credit };
}
