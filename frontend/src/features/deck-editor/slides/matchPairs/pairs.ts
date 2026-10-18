import type { MatchPairsAggregate, MatchPairsOptionPayload, RunOption, SlideOf, SlideOption } from "@/features/deck/types";
import { QUIZ_LIMITS } from "@/features/deck/types";
import { previewOptionKey } from "@/features/deck/lib/quiz";
import { sampleCount } from "../shared/samples";

// match_pairs option bookkeeping, mirroring MatchPairsSlideType::answerKey:
// a pair is the left and the right option sharing a valid pair_key; anything
// else (a lone side, a duplicate, a bad payload) is ignored by the server.

export interface PairRow {
	key: string;
	left: SlideOption | null;
	right: SlideOption | null;
	/** More cells with this key and side than one: ignored by the server. */
	extras: SlideOption[];
}

function payloadOf(option: SlideOption): Partial<MatchPairsOptionPayload> {
	return (option.payload ?? {}) as Partial<MatchPairsOptionPayload>;
}

function validKey(value: unknown): value is string {
	return typeof value === "string" && QUIZ_LIMITS.authorKeyPattern.test(value);
}

/**
 * Authoring pairs in the server's pair order — by the pair's left cell, like
 * answerKey (which walks the left cells in position order) — plus cells
 * without a usable payload. A row without a left cell sits at its right cell.
 */
export function authoringPairs(options: SlideOption[]): { rows: PairRow[]; orphans: SlideOption[] } {
	const sorted = [...options].sort((a, b) => a.position - b.position || a.id - b.id);
	const rows = new Map<string, PairRow>();
	const orphans: SlideOption[] = [];
	for (const option of sorted) {
		const { side, pair_key: key } = payloadOf(option);
		if ((side !== "left" && side !== "right") || !validKey(key)) {
			orphans.push(option);
			continue;
		}
		const row = rows.get(key) ?? { key, left: null, right: null, extras: [] };
		if (row[side]) row.extras.push(option);
		else row[side] = option;
		rows.set(key, row);
	}
	// Every row has a left or a right cell (it was created from one).
	const anchor = (row: PairRow) => (row.left ?? row.right)!;
	const ordered = [...rows.values()].sort((a, b) => anchor(a).position - anchor(b).position || anchor(a).id - anchor(b).id);
	return { rows: ordered, orphans };
}

/** Every option of a row: left, right and the ignored duplicates. */
export function rowCells(row: PairRow): SlideOption[] {
	return [row.left, row.right, ...row.extras].filter((option): option is SlideOption => !!option);
}

/** Complete pairs (one left + one right) in left author order — what the server scores. */
export function completePairs(options: SlideOption[]): { left: SlideOption; right: SlideOption }[] {
	return authoringPairs(options)
		.rows.filter((row) => row.left && row.right && row.extras.length === 0)
		.map((row) => ({ left: row.left!, right: row.right! }))
		.sort((a, b) => a.left.position - b.left.position || a.left.id - b.left.id);
}

/** Run cells by side (participant order: left author order, right shuffled). */
export function runSides<O extends Pick<RunOption<string, { side: string }>, "payload">>(options: O[]): { lefts: O[]; rights: O[] } {
	return {
		lefts: options.filter((option) => option.payload?.side === "left"),
		rights: options.filter((option) => option.payload?.side !== "left"),
	};
}

/** Editor canvas preview of the reveal (ids = previewOptionKey, like slideToRunView). */
export function sampleMatchPairsAggregate(slide: SlideOf<"match_pairs">): MatchPairsAggregate {
	const pairs = completePairs(slide.options);
	const total = 24;
	const size = pairs.length;
	const correctCounts = pairs.map((_, index) => Math.min(total, 10 + sampleCount(index, 1) / 2));
	const matrix = pairs.map((_, i) => pairs.map((__, j) => (i === j ? Math.round(correctCounts[i]) : (i + j) % 3 === 0 ? 2 : 0)));
	const pct = (count: number) => Math.round((count / total) * 10_000) / 100;
	const correct = Math.round(Math.min(...correctCounts, total) * 0.6);
	return {
		total_responses: total,
		correct_responses: size > 0 ? correct : 0,
		partially_correct_responses: size > 0 ? total - correct - 3 : 0,
		incorrect_responses: size > 0 ? 3 : 0,
		correct_percentage: size > 0 ? pct(correct) : 0,
		pairs: pairs.map((pair, index) => ({
			left_id: previewOptionKey(pair.left.id),
			right_id: previewOptionKey(pair.right.id),
			correct_count: matrix[index][index],
			correct_percentage: pct(matrix[index][index]),
		})),
		connection_counts: matrix,
		correct: { pairs: pairs.map((pair) => ({ left_id: previewOptionKey(pair.left.id), right_id: previewOptionKey(pair.right.id) })) },
	};
}
