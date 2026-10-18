import { ArrowUpDown } from "lucide-react";
import type { CorrectOrderAggregate, SlideOf } from "@/features/deck/types";
import { previewOptionKey } from "@/features/deck/lib/quiz";
import { defineSlideType } from "../types";
import { sampleCount } from "../shared/samples";
import { CorrectOrderEditor } from "./Editor";
import { CorrectOrderParticipant } from "./Participant";
import { CorrectOrderPresenter } from "./Presenter";

/** Editor canvas preview of the reveal (ids = previewOptionKey, like slideToRunView); most common answer swaps the first two. */
function sampleAggregate(slide: SlideOf<"correct_order">): CorrectOrderAggregate {
	const ids = [...slide.options].sort((a, b) => a.position - b.position || a.id - b.id).map((option) => previewOptionKey(option.id));
	const total = 24;
	const pct = (count: number) => Math.round((count / total) * 10_000) / 100;
	const counts = ids.map((_, index) => Math.min(total, 6 + sampleCount(index, 2)));
	const common = ids.length > 1 ? [ids[1], ids[0], ...ids.slice(2)] : ids;
	return {
		total_responses: total,
		correct_responses: 9,
		partially_correct_responses: 11,
		incorrect_responses: 4,
		correct_percentage: pct(9),
		items: ids.map((id, index) => ({ id, correct_position: index + 1, correct_count: counts[index], correct_percentage: pct(counts[index]) })),
		most_common_order: ids.length > 0 ? { order: common, count: 7 } : null,
		correct: { order: ids },
	};
}

export const entry = defineSlideType({
	key: "correct_order",
	products: ["quiz"],
	category: "poll",
	label: "Correct order",
	description: "Players drag the items into the right order.",
	icon: ArrowUpDown,
	Editor: CorrectOrderEditor,
	Presenter: CorrectOrderPresenter,
	Participant: CorrectOrderParticipant,
	sampleAggregate,
});
