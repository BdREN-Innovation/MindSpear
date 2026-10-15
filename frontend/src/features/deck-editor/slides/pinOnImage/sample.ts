import type { PinOnImageAggregate, SlideOf } from "@/features/deck/types";
import { densityOf, gaussianCluster, seededRandom } from "./pointMath";

/** Fake results for the editor canvas: a few pin clusters (y 0 = top edge). */
export function samplePinAggregate(slide: SlideOf<"pin_on_image">): PinOnImageAggregate {
	const random = seededRandom(slide.id * 31 + 5);
	const pins = [
		...gaussianCluster(random, { x: 34, y: 38 }, 7, 14),
		...gaussianCluster(random, { x: 68, y: 62 }, 9, 9),
		...gaussianCluster(random, { x: 56, y: 24 }, 12, 5),
	];
	const perParticipant = Math.max(1, slide.config.max_pins_per_participant ?? 1);
	return {
		total_responses: Math.ceil(pins.length / perParticipant),
		total_pins: pins.length,
		pins,
		density: densityOf(pins),
	};
}
