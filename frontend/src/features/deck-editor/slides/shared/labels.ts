import type { RunOption, SlideTypeKey } from "@/features/deck/types";

// Labels every live type shares: option / item fallbacks, percentages, and
// the copy an untitled slide shows. The presenter and the phone read the same
// fallback so the big screen and the audience never disagree.

/** Option label with a readable fallback for empty options ("Option B"). */
export function optionLabel(option: Pick<RunOption, "label"> | undefined, index: number, noun = "Option"): string {
	const label = option?.label?.trim();
	if (label) return label;
	return `${noun} ${index < 26 ? String.fromCharCode(65 + index) : index + 1}`;
}

/** Statement / item label fallback with a number ("Statement 2"). */
export function numberedLabel(option: Pick<RunOption, "label"> | undefined, index: number, noun: string): string {
	const label = option?.label?.trim();
	return label || `${noun} ${index + 1}`;
}

/** Percentage text for chart labels: whole numbers, one decimal under 10 (e.g. "7.5%"). */
export function formatPercent(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "0%";
	return value < 10 && Math.round(value) !== value ? `${value.toFixed(1)}%` : `${Math.round(value)}%`;
}

/** What an untitled slide shows as its question, on the big screen and on phones alike. */
const FALLBACK_TITLES: Partial<Record<SlideTypeKey, string>> = {
	poll_single: "Vote for one option",
	poll_multi: "Pick your options",
	word_cloud: "Share a word",
	open_ended: "Share your thoughts",
	scales: "Rate these statements",
	ranking: "Rank these items",
	qa_audience: "Ask a question",
	points_allocation: "Distribute your points",
	rating: "Rate these",
	matrix_2x2: "Place your dot on the grid",
	pin_on_image: "Drop a pin on the image",
};

export function fallbackTitle(type: SlideTypeKey): string {
	return FALLBACK_TITLES[type] ?? "Untitled slide";
}

/** The slide question, or the type's fallback when it is empty. */
export function displayTitle(title: string | null | undefined, type: SlideTypeKey): string {
	return title?.trim() || fallbackTitle(type);
}
