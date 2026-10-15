import type { OutlineEntry } from "@/features/file-library/types";

/** A chapter (or sub-chapter) and the pages it covers, both ends included. */
export interface Chapter {
	key: string;
	title: string;
	/** 1 = top level. */
	level: number;
	start: number;
	end: number;
	/** Titles from the top-level chapter down to this one. */
	path: string[];
	/** Index of the parent chapter in the list, or null for top level. */
	parent: number | null;
	hasChildren: boolean;
}

const MAX_CHAPTERS = 500;

/**
 * Turns outline entries (title, level, start page) into chapters with page
 * ranges: a chapter runs until the next entry at the same or a higher level.
 */
export function buildChapters(outline: OutlineEntry[], lastPage: number): Chapter[] {
	const entries = outline
		.map((e) => ({ ...e, title: e.title.replace(/\s+/g, " ").trim() }))
		.filter((e) => e.title && e.page >= 1 && e.page <= lastPage)
		.slice(0, MAX_CHAPTERS);
	if (entries.length === 0) return [];

	const minLevel = Math.min(...entries.map((e) => e.level));
	const stack: number[] = [];
	const chapters: Chapter[] = entries.map((entry, i) => {
		const level = entry.level - minLevel + 1;

		let end = lastPage;
		for (let j = i + 1; j < entries.length; j++) {
			if (entries[j].level <= entry.level && entries[j].page >= entry.page) {
				end = Math.max(entry.page, entries[j].page - 1);
				break;
			}
		}

		while (stack.length && entries[stack[stack.length - 1]].level >= entry.level) stack.pop();
		const parent = stack.length ? stack[stack.length - 1] : null;
		stack.push(i);

		return { key: String(i), title: entry.title, level, start: entry.page, end, path: [], parent, hasChildren: false };
	});

	chapters.forEach((chapter) => {
		chapter.path = chapter.parent === null ? [chapter.title] : [...chapters[chapter.parent].path, chapter.title];
		if (chapter.parent !== null) chapters[chapter.parent].hasChildren = true;
	});
	return chapters;
}

/** The most specific chapter that contains a page, if any. */
export function chapterOfPage(chapters: Chapter[], page: number): Chapter | null {
	let best: Chapter | null = null;
	for (const chapter of chapters) {
		if (chapter.start <= page && page <= chapter.end && (!best || chapter.level >= best.level)) best = chapter;
	}
	return best;
}
