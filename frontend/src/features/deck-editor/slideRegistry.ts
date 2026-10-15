import type { DeckProduct, SlideCategory, SlideTypeKey } from "@/features/deck/types";
import { SLIDE_TYPE_KEYS } from "@/features/deck/types";
import type { SlideTypeEntry } from "./slides/types";

import { entry as pollSingle } from "./slides/pollSingle";
import { entry as pollMulti } from "./slides/pollMulti";
import { entry as wordCloud } from "./slides/wordCloud";
import { entry as openEnded } from "./slides/openEnded";
import { entry as scales } from "./slides/scales";
import { entry as ranking } from "./slides/ranking";
import { entry as qaAudience } from "./slides/qaAudience";
import { entry as pointsAllocation } from "./slides/pointsAllocation";
import { entry as rating } from "./slides/rating";
import { entry as matrix2x2 } from "./slides/matrix2x2";
import { entry as pinOnImage } from "./slides/pinOnImage";
import { entry as heading } from "./slides/heading";
import { entry as paragraph } from "./slides/paragraph";
import { entry as bullets } from "./slides/bullets";
import { entry as numbered } from "./slides/numbered";
import { entry as quote } from "./slides/quote";
import { entry as image } from "./slides/image";
import { entry as video } from "./slides/video";
import { entry as bigText } from "./slides/bigText";
import { entry as qrCode } from "./slides/qrCode";

// Frontend twin of the backend SlideTypeRegistry: the single source of truth
// for which components render a slide type. Shells look types up by the
// backend key (`slide.type` / `run.type`) and never switch on it.

/** Catalog order (SlidePicker order). */
const ENTRIES: SlideTypeEntry[] = [
	pollSingle,
	pollMulti,
	wordCloud,
	openEnded,
	scales,
	ranking,
	qaAudience,
	pointsAllocation,
	rating,
	matrix2x2,
	pinOnImage,
	heading,
	paragraph,
	bullets,
	numbered,
	quote,
	image,
	video,
	bigText,
	qrCode,
];

export const SLIDE_REGISTRY: Readonly<Record<SlideTypeKey, SlideTypeEntry>> = Object.freeze(
	Object.fromEntries(ENTRIES.map((entry) => [entry.key, entry])) as Record<SlideTypeKey, SlideTypeEntry>
);

if (process.env.NODE_ENV !== "production") {
	const missing = SLIDE_TYPE_KEYS.filter((key) => !SLIDE_REGISTRY[key]);
	if (missing.length || ENTRIES.length !== SLIDE_TYPE_KEYS.length) {
		console.error("slideRegistry: entries do not match the backend type keys", { missing });
	}
}

export const SLIDE_CATEGORY_LABELS: Record<SlideCategory, string> = {
	poll: "Polls",
	interactive: "Interactive",
	content: "Content",
};

/** The entry for a backend type key, or undefined for an unknown key (render a fallback). */
export function getSlideType(key: string | null | undefined): SlideTypeEntry | undefined {
	return key ? (SLIDE_REGISTRY as Record<string, SlideTypeEntry | undefined>)[key] : undefined;
}

/** Like getSlideType, but throws for an unknown key. */
export function requireSlideType(key: string): SlideTypeEntry {
	const entry = getSlideType(key);
	if (!entry) throw new Error(`Unknown slide type "${key}"`);
	return entry;
}

/** Types a product offers (the SlidePicker list), in catalog order. */
export function slideTypesForProduct(product: DeckProduct): SlideTypeEntry[] {
	return ENTRIES.filter((entry) => entry.products.includes(product));
}

/** slideTypesForProduct grouped by category (poll, interactive, content). */
export function slideTypesByCategory(product: DeckProduct): Record<SlideCategory, SlideTypeEntry[]> {
	const groups: Record<SlideCategory, SlideTypeEntry[]> = { poll: [], interactive: [], content: [] };
	for (const entry of slideTypesForProduct(product)) groups[entry.category].push(entry);
	return groups;
}

export type { SlideTypeEntry } from "./slides/types";
