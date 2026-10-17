import { ListChecks } from "lucide-react";
import type { PollMultiAggregate, SlideOf } from "@/features/deck/types";
import { defineSlideType } from "../types";
import { sampleCount } from "../shared/samples";
import { PollMultiEditor } from "./Editor";
import { PollMultiParticipant } from "./Participant";
import { PollMultiPresenter } from "./Presenter";

/** Editor canvas preview: stable made-up picks; percentages are of participants (can add up to > 100). */
function sampleAggregate(slide: SlideOf<"poll_multi">): PollMultiAggregate {
	const counts = slide.options.map((_, index) => sampleCount(index, 1));
	const selections = counts.reduce((sum, count) => sum + count, 0);
	const responses = Math.max(1, ...counts) + 6;
	return {
		total_responses: responses,
		total_votes: selections,
		average_selections_per_participant: Math.round((selections / responses) * 100) / 100,
		options: slide.options.map((option, index) => ({
			option_id: option.id,
			count: counts[index],
			percentage: Math.round((counts[index] / responses) * 10_000) / 100,
		})),
	};
}

export const entry = defineSlideType({
	key: "poll_multi",
	products: ["quest"],
	category: "poll",
	label: "Multiple select",
	description: "Pick several options, with an optional minimum and maximum.",
	icon: ListChecks,
	Editor: PollMultiEditor,
	Presenter: PollMultiPresenter,
	Participant: PollMultiParticipant,
	sampleAggregate,
});
