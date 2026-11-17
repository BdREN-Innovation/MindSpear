import type { PollMultiConfig } from "@/features/deck/types";

/** Backend cap for min_selections / max_selections (PollMultiSlideType::MAX_SELECTIONS). */
export const MAX_SELECTIONS = 50;

/**
 * Effective [min, max] selections for this many options, exactly as
 * PollMultiSlideType::limits() checks answers: both are capped at the option
 * count, so a slide with fewer options than min_selections still works.
 */
export function selectionLimits(config: Pick<PollMultiConfig, "min_selections" | "max_selections">, optionCount: number): [number, number] {
	let min = Math.max(1, Math.trunc(Number(config.min_selections ?? 1)) || 1);
	let max = config.max_selections == null ? optionCount : Math.trunc(Number(config.max_selections));
	max = Math.max(1, Math.min(max, optionCount));
	min = Math.min(min, max);
	return [min, max];
}

/** "Pick 2", "Pick up to 3", "Pick 2 to 4", "Pick as many as you like". */
export function selectionHint(min: number, max: number, optionCount: number): string {
	if (min === max) return `Pick ${min}.`;
	if (min <= 1 && max >= optionCount) return "Pick as many as you like.";
	if (min <= 1) return `Pick up to ${max}.`;
	return `Pick ${min} to ${max}.`;
}
