import { TextCursorInput } from "lucide-react";
import type { ShortAnswerAggregate, SlideOf } from "@/features/deck/types";
import { defineSlideType } from "../types";
import { cleanWord } from "../shared/text";
import { ShortAnswerEditor } from "./Editor";
import { ShortAnswerParticipant } from "./Participant";
import { ShortAnswerPresenter } from "./Presenter";

/** Editor canvas preview of the reveal: the accepted answers as the common right answers, plus two wrong ones. */
function sampleAggregate(slide: SlideOf<"short_answer">): ShortAnswerAggregate {
	const accepted = [...new Set([...slide.options].sort((a, b) => a.position - b.position).map((option) => cleanWord(option.label ?? "")).filter(Boolean))];
	const rows = [
		...accepted.slice(0, 3).map((text, index) => ({ text, count: [14, 5, 2][index], is_correct: true })),
		{ text: "Not sure", count: 4, is_correct: false },
		{ text: "Something else", count: 3, is_correct: false },
	];
	const total = rows.reduce((sum, row) => sum + row.count, 0);
	const correct = rows.filter((row) => row.is_correct).reduce((sum, row) => sum + row.count, 0);
	const pct = (count: number) => Math.round((count / total) * 10_000) / 100;
	return {
		total_responses: total,
		correct_responses: correct,
		partially_correct_responses: 0,
		incorrect_responses: total - correct,
		correct_percentage: pct(correct),
		distinct_answers: rows.length,
		answers: rows.sort((a, b) => b.count - a.count).map((row) => ({ ...row, percentage: pct(row.count) })),
		answers_truncated: false,
		correct: { accepted_answers: accepted, case_sensitive: slide.config.case_sensitive ?? false },
	};
}

export const entry = defineSlideType({
	key: "short_answer",
	products: ["quiz"],
	category: "poll",
	label: "Short answer",
	description: "Players type the answer; it must match an accepted answer.",
	icon: TextCursorInput,
	Editor: ShortAnswerEditor,
	Presenter: ShortAnswerPresenter,
	Participant: ShortAnswerParticipant,
	sampleAggregate,
});
