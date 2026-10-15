// Scale helpers shared by the scales Editor, Presenter and Participant.

export const MIN_SCALE_POINTS = 2;
export const MAX_SCALE_POINTS = 10;
/** ScalesSlideType: scale_labels.* max 60 characters. */
export const MAX_SCALE_LABEL = 60;

export function clampPoints(points: number | null | undefined): number {
	const value = Math.trunc(Number(points ?? 5));
	if (!Number.isFinite(value)) return 5;
	return Math.min(MAX_SCALE_POINTS, Math.max(MIN_SCALE_POINTS, value));
}

/**
 * Labels exactly `points` long. Mirrors ScalesSlideType::resizeLabels (keep the
 * end labels, blank the middle) so an optimistic scale_points change shows the
 * same labels the server will store.
 */
export function fitLabels(labels: (string | null)[] | null | undefined, points: number): (string | null)[] {
	const list = Array.isArray(labels) ? labels.map((label) => (typeof label === "string" && label.trim() !== "" ? label : null)) : [];
	if (list.length === points) return list;
	const resized: (string | null)[] = Array.from({ length: points }, () => null);
	resized[0] = list[0] ?? null;
	resized[points - 1] = list.length > 0 ? list[list.length - 1] : null;
	return resized;
}

/**
 * Low → high colour for value 1..points: the theme primary mixed into the
 * muted surface, light for low values and full strength for the top value.
 */
export function scaleColor(value: number, points: number): string {
	const t = points <= 1 ? 1 : (value - 1) / (points - 1);
	const strength = Math.round(18 + t * 82);
	return `color-mix(in srgb, var(--deck-primary, #F79945) ${strength}%, var(--deck-surface-muted, #F3F4F6))`;
}

/** Text colour that stays readable on scaleColor(value). */
export function scaleTextColor(value: number, points: number): string {
	const t = points <= 1 ? 1 : (value - 1) / (points - 1);
	return t >= 0.55 ? "var(--deck-on-primary, #111928)" : "var(--deck-text, #111928)";
}
