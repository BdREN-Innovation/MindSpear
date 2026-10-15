import type { PointsAllocationAggregate, SlideOf } from "@/features/deck/types";

// Fake results for the editor canvas: a descending split over the options,
// shaped like PointsAllocationSlideType::aggregate().

const SHARES = [38, 26, 18, 11, 7];
const RESPONSES = 24;

export function samplePointsAggregate(slide: SlideOf<"points_allocation">): PointsAllocationAggregate {
	const total = slide.config.total_points ?? 100;
	const weights = slide.options.map((_, index) => SHARES[index] ?? Math.max(2, 7 - index));
	const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1;
	const distributed = total * RESPONSES;
	const options = slide.options.map((option, index) => {
		const points = Math.round((weights[index] / weightSum) * distributed);
		return {
			option_id: option.id,
			points,
			percentage: Math.round((points / distributed) * 10000) / 100,
			average_points: Math.round((points / RESPONSES) * 100) / 100,
		};
	});
	return {
		total_responses: RESPONSES,
		total_points: total,
		total_points_distributed: options.reduce((sum, option) => sum + option.points, 0),
		options,
	};
}
