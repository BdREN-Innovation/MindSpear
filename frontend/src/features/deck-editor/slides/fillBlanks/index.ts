import { Brackets } from "lucide-react";
import type { BlanksAggregate, FillBlanksConfig, SlideOf } from "@/features/deck/types";
import { parseSentence } from "@/features/deck/lib/blanks";
import { defineSlideType } from "../types";
import { sampleCount } from "../shared/samples";
import { FillBlanksEditor } from "./Editor";
import { FillBlanksParticipant } from "./Participant";
import { FillBlanksPresenter } from "./Presenter";

/** Editor canvas preview of the reveal: stable made-up results per blank, the answer key from the sentence. */
export function sampleBlanksAggregate(config: Partial<FillBlanksConfig>): BlanksAggregate {
	const answers = parseSentence(config.text ?? "").answers;
	const total = 24;
	const pct = (count: number) => Math.round((count / total) * 10_000) / 100;
	return {
		total_responses: total,
		correct_responses: 9,
		partially_correct_responses: answers.length > 1 ? 11 : 0,
		incorrect_responses: answers.length > 1 ? 4 : 15,
		correct_percentage: pct(9),
		blanks: answers.map((_, index) => {
			const right = Math.min(total, 10 + sampleCount(index, 5));
			return { correct_count: right, correct_percentage: pct(right) };
		}),
		correct: {
			blanks: answers.map((answer, index) => ({
				answers: config.blanks?.[index]?.mode === "dropdown" ? [answer] : [answer, ...(config.blanks?.[index]?.alternatives ?? [])],
			})),
		},
	};
}

export const entry = defineSlideType({
	key: "fill_blanks",
	products: ["quiz"],
	category: "poll",
	label: "Fill in the blanks",
	description: "Players complete the sentence by typing or choosing the missing words.",
	icon: Brackets,
	Editor: FillBlanksEditor,
	Presenter: FillBlanksPresenter,
	Participant: FillBlanksParticipant,
	sampleAggregate: (slide: SlideOf<"fill_blanks">) => sampleBlanksAggregate(slide.config),
});
