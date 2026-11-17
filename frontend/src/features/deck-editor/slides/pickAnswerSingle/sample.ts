import type { PickAnswerMultiAggregate, SlideOf } from "@/features/deck/types";
import { optionIsCorrect } from "../shared/quizLabels";
import { sampleCount } from "../shared/samples";

// Editor canvas preview of a pick answer reveal: stable made-up counts per
// option (the backend aggregate shape), correctness from the options' marks
// (is_correct, or the payload.is_correct fallback like the server).
// Shared by pick_answer_single (multi when several are marked), true_false
// and the retired pick_answer_multi.

export function sampleChoiceAggregate(
	slide: SlideOf<"pick_answer_single"> | SlideOf<"pick_answer_multi"> | SlideOf<"true_false">,
	mode: "single" | "multi" = slide.options.filter((option) => optionIsCorrect(option)).length > 1 ? "multi" : "single"
): PickAnswerMultiAggregate {
	const options = [...slide.options].sort((a, b) => a.position - b.position || a.id - b.id);
	const correctIds = options.filter((option) => optionIsCorrect(option)).map((option) => option.id);
	const counts = options.map((_, index) => sampleCount(index, 3));
	// single: every response picks one option; multi: 30 respondents, each option picked by some of them.
	const total = mode === "single" ? counts.reduce((sum, count) => sum + count, 0) : 30;
	const pct = (count: number) => (total > 0 ? Math.round((Math.min(count, total) / total) * 10_000) / 100 : 0);
	const correctResponses =
		mode === "single"
			? options.reduce((sum, option, index) => sum + (optionIsCorrect(option) ? counts[index] : 0), 0)
			: correctIds.length > 0
				? Math.min(...options.map((option, index) => (optionIsCorrect(option) ? counts[index] : Infinity)))
				: 0;
	return {
		total_responses: total,
		correct_responses: correctResponses,
		partially_correct_responses: 0,
		incorrect_responses: Math.max(0, total - correctResponses),
		correct_percentage: pct(correctResponses),
		options: options.map((option, index) => ({
			option_id: option.id,
			count: counts[index],
			percentage: pct(counts[index]),
			is_correct: optionIsCorrect(option),
		})),
		correct: { option_ids: correctIds },
	};
}
