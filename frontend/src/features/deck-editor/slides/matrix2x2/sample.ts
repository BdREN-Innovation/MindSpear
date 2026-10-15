import type { Matrix2x2Aggregate, SlideOf } from "@/features/deck/types";
import { densityOf, gaussianCluster, seededRandom } from "../pinOnImage/pointMath";

/** Fake results for the editor canvas: a main cluster top-right and a smaller one bottom-left (y 100 = top). */
export function sampleMatrixAggregate(slide: SlideOf<"matrix_2x2">): Matrix2x2Aggregate {
	const random = seededRandom(slide.id * 17 + 3);
	const points = [
		...gaussianCluster(random, { x: 70, y: 70 }, 10, 14),
		...gaussianCluster(random, { x: 30, y: 34 }, 12, 7),
		...gaussianCluster(random, { x: 60, y: 30 }, 16, 4),
	];
	const centroid = {
		x: Math.round((points.reduce((sum, point) => sum + point.x, 0) / points.length) * 100) / 100,
		y: Math.round((points.reduce((sum, point) => sum + point.y, 0) / points.length) * 100) / 100,
	};
	return {
		total_responses: points.length,
		total_points: points.length,
		points,
		density: densityOf(points),
		centroid,
	};
}
