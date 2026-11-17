import { Columns3 } from "lucide-react";
import type { CategoriseAggregate, CategoriseOptionPayload, SlideOf } from "@/features/deck/types";
import { previewOptionKey } from "@/features/deck/lib/quiz";
import { defineSlideType } from "../types";
import { sampleCount } from "../shared/samples";
import { CategoriseEditor } from "./Editor";
import { CategoriseParticipant } from "./Participant";
import { CategorisePresenter } from "./Presenter";

/** Editor canvas preview of the reveal: the scorable items (ids = previewOptionKey) with stable made-up placements. */
function sampleAggregate(slide: SlideOf<"categorise">): CategoriseAggregate {
	const keys = (slide.config.categories ?? []).map((category) => category.key);
	const total = 24;
	const pct = (count: number) => Math.round((count / total) * 10_000) / 100;
	const items = [...slide.options]
		.sort((a, b) => a.position - b.position || a.id - b.id)
		.map((option) => ({ option, key: (option.payload as Partial<CategoriseOptionPayload>).correct_category_key ?? "" }))
		.filter(({ key }) => keys.includes(key))
		.map(({ option, key }, index) => {
			const right = Math.min(total, 8 + sampleCount(index, 4));
			const counts = keys.map((other, slot) => (other === key ? right : slot === (keys.indexOf(key) + 1) % keys.length ? total - right : 0));
			return { id: previewOptionKey(option.id), correct_category_key: key, correct_count: right, correct_percentage: pct(right), category_counts: counts };
		});
	return {
		total_responses: total,
		correct_responses: 8,
		partially_correct_responses: 13,
		incorrect_responses: 3,
		correct_percentage: pct(8),
		category_keys: keys,
		items,
		correct: { categories: keys.map((key) => ({ key, item_ids: items.filter((item) => item.correct_category_key === key).map((item) => item.id) })) },
	};
}

export const entry = defineSlideType({
	key: "categorise",
	products: ["quiz"],
	category: "poll",
	label: "Categorise",
	description: "Players sort items into the right categories.",
	icon: Columns3,
	Editor: CategoriseEditor,
	Presenter: CategorisePresenter,
	Participant: CategoriseParticipant,
	sampleAggregate,
});
