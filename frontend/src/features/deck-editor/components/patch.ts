import type { OptionInput, Slide, SlideOption, SlidePatch } from "@/features/deck/types";

// Optimistic copies of what the backend does with a slide PATCH, so the
// editor can show a change before the server confirms it:
//   - config merges recursively (objects key by key; lists and scalars replace)
//   - title / body / timers / quiz scoring columns replace
//   - an option's label / payload / is_correct replace

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Backend SlideInput::merge(): objects merge key by key, lists and scalars replace. */
export function mergeConfig<T>(stored: T, incoming: unknown): T {
	if (!isPlainObject(stored) || !isPlainObject(incoming)) return incoming as T;
	const out: Json = { ...stored };
	for (const [key, value] of Object.entries(incoming)) {
		out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeConfig(out[key], value) : value;
	}
	return out as T;
}

/** Two queued patches as one (later wins; config merged). */
export function mergePatches(first: SlidePatch, second: SlidePatch): SlidePatch {
	const out: SlidePatch = { ...first, ...second };
	if (first.config && second.config) {
		out.config = mergeConfig(first.config, second.config) as SlidePatch["config"];
	}
	return out;
}

export function isEmptyPatch(patch: SlidePatch | undefined): boolean {
	return !patch || Object.keys(patch).length === 0;
}

/** The slide as it will look once the server applies `patch`. */
export function applySlidePatch(slide: Slide, patch: SlidePatch): Slide {
	const next = { ...slide } as Slide;
	if ("title" in patch) next.title = patch.title ?? null;
	if ("body" in patch) next.body = patch.body ?? null;
	if (patch.config) next.config = mergeConfig(slide.config, patch.config) as typeof next.config;
	if ("time_limit_seconds" in patch) next.timeLimitSeconds = patch.time_limit_seconds ?? null;
	if ("get_ready_seconds" in patch) next.getReadySeconds = patch.get_ready_seconds ?? null;
	if ("points_min" in patch) next.pointsMin = patch.points_min ?? null;
	if ("points_max" in patch) next.pointsMax = patch.points_max ?? null;
	if ("speed_bonus_enabled" in patch) next.speedBonusEnabled = patch.speed_bonus_enabled ?? null;
	return next;
}

/** Option label / payload / is_correct typed but not yet confirmed. */
export function applyOptionInput(slide: Slide, optionId: number, input: OptionInput): Slide {
	let changed = false;
	const options = slide.options.map((option): SlideOption => {
		if (option.id !== optionId) return option;
		changed = true;
		return {
			...option,
			...("label" in input ? { label: input.label ?? null } : {}),
			...("payload" in input ? { payload: input.payload ?? {} } : {}),
			...("is_correct" in input ? { isCorrect: input.is_correct ?? null } : {}),
		};
	});
	return changed ? ({ ...slide, options } as Slide) : slide;
}

/** Options in the given id order (unknown ids are skipped, missing ones appended), positions 1..n. */
export function reorderOptionsLocally(slide: Slide, orderedIds: number[]): Slide {
	const byId = new Map(slide.options.map((option) => [option.id, option]));
	const ordered: SlideOption[] = [];
	for (const id of orderedIds) {
		const option = byId.get(id);
		if (option) {
			ordered.push(option);
			byId.delete(id);
		}
	}
	ordered.push(...byId.values());
	return { ...slide, options: ordered.map((option, index) => ({ ...option, position: index + 1 })) } as Slide;
}

/** Array move (dnd-kit's arrayMove without the import). */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
	const next = items.slice();
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}
