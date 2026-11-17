import { CircleDot } from "lucide-react";
import type { PollSingleAggregate, SlideOf } from "@/features/deck/types";
import { defineSlideType } from "../types";
import { sampleCount } from "../shared/samples";
import { PollSingleEditor } from "./Editor";
import { PollSingleParticipant } from "./Participant";
import { PollSinglePresenter } from "./Presenter";

/** Editor canvas preview: stable made-up votes per option. */
function sampleAggregate(slide: SlideOf<"poll_single">): PollSingleAggregate {
	const counts = slide.options.map((_, index) => sampleCount(index));
	const total = counts.reduce((sum, count) => sum + count, 0);
	return {
		total_responses: total,
		total_votes: total,
		options: slide.options.map((option, index) => ({
			option_id: option.id,
			count: counts[index],
			percentage: total > 0 ? Math.round((counts[index] / total) * 10_000) / 100 : 0,
		})),
	};
}

export const entry = defineSlideType({
	key: "poll_single",
	products: ["quest"],
	category: "poll",
	label: "Multiple choice",
	description: "Pick one option; results update live as votes arrive.",
	icon: CircleDot,
	Editor: PollSingleEditor,
	Presenter: PollSinglePresenter,
	Participant: PollSingleParticipant,
	sampleAggregate,
});
