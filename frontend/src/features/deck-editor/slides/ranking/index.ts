import { ArrowDownNarrowWide } from "lucide-react";
import type { RankingAggregate, SlideOf } from "@/features/deck/types";
import { defineSlideType } from "../types";
import { sampleCount } from "../pollSingle/common";
import { RankingEditor } from "./Editor";
import { RankingParticipant } from "./Participant";
import { RankingPresenter } from "./Presenter";

/** Editor canvas preview: stable made-up averages, sorted and ranked the way the backend does (ties share a rank). */
function sampleAggregate(slide: SlideOf<"ranking">): RankingAggregate {
	const n = slide.options.length;
	const responses = 20;
	const averages = slide.options.map((_, index) => Math.round((1 + ((sampleCount(index, 2) % 10) / 10) * Math.max(0, n - 1)) * 100) / 100);
	const sorted = slide.options.map((_, index) => index).sort((a, b) => averages[a] - averages[b] || a - b);

	let rank = 0;
	let previous: number | null = null;
	return {
		total_responses: responses,
		item_count: n,
		items: sorted.map((optionIndex, sortedIndex) => {
			const average = averages[optionIndex];
			if (average !== previous) {
				rank = sortedIndex + 1;
				previous = average;
			}
			return {
				option_id: slide.options[optionIndex].id,
				rank,
				average_position: average,
				count: responses,
				position_counts: Array.from({ length: n }, (_, p) => ({ position: p + 1, count: Math.max(0, Math.round(8 - Math.abs(p + 1 - average) * 3)) })),
			};
		}),
	};
}

export const entry = defineSlideType({
	key: "ranking",
	products: ["quest"],
	category: "poll",
	label: "Ranking",
	description: "Drag items into order and see the average ranking.",
	icon: ArrowDownNarrowWide,
	Editor: RankingEditor,
	Presenter: RankingPresenter,
	Participant: RankingParticipant,
	sampleAggregate,
});
