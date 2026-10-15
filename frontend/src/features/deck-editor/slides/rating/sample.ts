import type { RatingAggregate, SlideOf } from "@/features/deck/types";

// Fake results for the editor canvas, shaped like RatingSlideType::aggregate():
// a bell-ish histogram per item around a target mean, with the mean
// recomputed from the histogram so the numbers agree.

const TARGETS = [0.84, 0.66, 0.5, 0.74, 0.58, 0.7];
const COUNTS = [21, 19, 22, 18, 20, 17];

export function sampleRatingAggregate(slide: SlideOf<"rating">): RatingAggregate {
	const scale = slide.config.scale ?? 5;
	const spread = Math.max(0.8, scale / 5);
	const items = slide.options.map((option, index) => {
		const target = 1 + (scale - 1) * TARGETS[index % TARGETS.length];
		const count = COUNTS[index % COUNTS.length];
		const weights = Array.from({ length: scale }, (_, i) => Math.exp(-((i + 1 - target) ** 2) / (2 * spread ** 2)));
		const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
		const distribution = weights.map((weight, i) => ({ value: i + 1, count: Math.round((weight / weightSum) * count) }));
		const n = distribution.reduce((sum, row) => sum + row.count, 0);
		const mean = n > 0 ? Math.round((distribution.reduce((sum, row) => sum + row.value * row.count, 0) / n) * 100) / 100 : null;
		return { option_id: option.id, count: n, mean, distribution };
	});
	return { total_responses: Math.max(0, ...items.map((item) => item.count)), scale, items };
}
