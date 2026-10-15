import type { DensityGrid, Point } from "@/features/deck/types";

// Percentage-plane helpers shared by pin_on_image and matrix_2x2 (both use
// 0..100 on each axis, backend PointCloud). Kept in this folder because
// slides/shared is owned by another agent.

/** Backend PointCloud::GRID_SIZE. */
export const GRID_SIZE = 20;

export function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

/** 0..100 rounded to 2 dp, exactly what the backend validates and stores. */
export function roundPercent(value: number): number {
	return Math.round(clampPercent(value) * 100) / 100;
}

export function isPoint(value: unknown): value is Point {
	const candidate = value as Partial<Point> | null;
	return !!candidate && typeof candidate.x === "number" && typeof candidate.y === "number";
}

/** Same binning as PointCloud::density (counts[row by y][col by x], 100 in the last cell). */
export function densityOf(points: Point[], size = GRID_SIZE): DensityGrid {
	const counts = Array.from({ length: size }, () => new Array<number>(size).fill(0));
	const cell = (value: number) => Math.max(0, Math.min(size - 1, Math.floor((value * size) / 100)));
	for (const point of points) counts[cell(point.y)][cell(point.x)]++;
	return { size, counts };
}

/** Small deterministic PRNG (mulberry32) so sample aggregates don't flicker between renders. */
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0 || 1;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** `count` points normally spread around `center` (Box–Muller), clamped to the plane. */
export function gaussianCluster(random: () => number, center: Point, spread: number, count: number): Point[] {
	const points: Point[] = [];
	for (let i = 0; i < count; i++) {
		const u = Math.max(random(), 1e-6);
		const v = random();
		const radius = Math.sqrt(-2 * Math.log(u)) * spread;
		points.push({
			x: roundPercent(center.x + radius * Math.cos(2 * Math.PI * v)),
			y: roundPercent(center.y + radius * Math.sin(2 * Math.PI * v)),
		});
	}
	return points;
}

/** Stable React keys for a point list that may contain exact duplicates. */
export function pointKeys(points: Point[]): string[] {
	const seen = new Map<string, number>();
	return points.map((point) => {
		const base = `${point.x}:${point.y}`;
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		return `${base}#${n}`;
	});
}

/** "x 42, y 70" with whole numbers, for screen readers. */
export function describePoint(point: Point): string {
	return `x ${Math.round(point.x)}, y ${Math.round(point.y)}`;
}
