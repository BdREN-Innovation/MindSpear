import { SlidersHorizontal } from "lucide-react";
import type { ScalesAggregate, SlideOf } from "@/features/deck/types";
import { defineSlideType } from "../types";
import { sampleCount } from "../pollSingle/common";
import { ScalesEditor } from "./Editor";
import { ScalesParticipant } from "./Participant";
import { ScalesPresenter } from "./Presenter";
import { clampPoints } from "./scale";

/** Editor canvas preview: a stable made-up distribution per statement, leaning a different way each. */
function sampleAggregate(slide: SlideOf<"scales">): ScalesAggregate {
	const points = clampPoints(slide.config.scale_points);
	const responses = 24;
	const statements = slide.options.map((option, statementIndex) => {
		// Peak at a different value per statement, falling off around it.
		const peak = 1 + ((statementIndex * 2 + points - 1) % points);
		const weights = Array.from({ length: points }, (_, i) => Math.max(1, sampleCount(statementIndex, i) - Math.abs(i + 1 - peak) * 4));
		const totalWeight = weights.reduce((sum, w) => sum + w, 0);
		const counts = weights.map((w) => Math.round((w / totalWeight) * responses));
		const count = counts.reduce((sum, n) => sum + n, 0);
		const sum = counts.reduce((acc, n, i) => acc + n * (i + 1), 0);
		return {
			option_id: option.id,
			count,
			mean: count > 0 ? Math.round((sum / count) * 100) / 100 : null,
			distribution: counts.map((n, i) => ({ value: i + 1, count: n })),
		};
	});
	return { total_responses: responses, scale_points: points, statements };
}

export const entry = defineSlideType({
	key: "scales",
	products: ["quest"],
	category: "poll",
	label: "Scales",
	description: "Rate statements on a 2 to 10 point scale.",
	icon: SlidersHorizontal,
	Editor: ScalesEditor,
	Presenter: ScalesPresenter,
	Participant: ScalesParticipant,
	sampleAggregate,
});
