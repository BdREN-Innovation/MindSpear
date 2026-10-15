"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, Minus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Chapter } from "../lib/chapters";
import type { DocumentPart } from "../lib/documentPages";

interface Props {
	chapters: Chapter[];
	parts: DocumentPart[];
	selected: Set<number>;
	/** "page" | "section" | "slide": how the range is described. */
	unit: string;
	/** Chapters longer than this can't be selected whole; they're marked. */
	maxParts: number;
	onToggle: (chapter: Chapter, select: boolean) => void;
}

type CheckState = "all" | "some" | "none";

/** The document's chapters as a collapsible tree; ticking one selects all of its pages. */
export function ChapterList({ chapters, parts, selected, unit, maxParts, onToggle }: Props) {
	// Small outlines open fully; big ones show the top level first.
	const [expanded, setExpanded] = useState<Set<number>>(() =>
		chapters.length <= 25 ? new Set(chapters.map((_, i) => i)) : new Set<number>(),
	);
	const [filter, setFilter] = useState("");

	const wordsByPage = useMemo(() => new Map(parts.map((p) => [p.id, p.wordCount])), [parts]);
	const query = filter.trim().toLowerCase();

	const stateOf = (chapter: Chapter): CheckState => {
		let count = 0;
		for (let page = chapter.start; page <= chapter.end; page++) if (selected.has(page)) count++;
		const total = chapter.end - chapter.start + 1;
		return count === 0 ? "none" : count === total ? "all" : "some";
	};

	const wordsOf = (chapter: Chapter) => {
		let words = 0;
		for (let page = chapter.start; page <= chapter.end; page++) words += wordsByPage.get(page) ?? 0;
		return words;
	};

	const isVisible = (index: number) => {
		if (query) return chapters[index].title.toLowerCase().includes(query);
		for (let parent = chapters[index].parent; parent !== null; parent = chapters[parent].parent) {
			if (!expanded.has(parent)) return false;
		}
		return true;
	};

	const toggleExpanded = (index: number) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(index)) next.delete(index);
			else next.add(index);
			return next;
		});

	const visible = chapters.map((chapter, index) => ({ chapter, index })).filter(({ index }) => isVisible(index));

	return (
		<div className="flex min-h-0 flex-col gap-2">
			{chapters.length > 12 ? (
				<div className="relative">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dark-5" aria-hidden />
					<input
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder="Find a chapter"
						aria-label="Find a chapter"
						className="h-8 w-full rounded-lg border border-stroke pl-8 pr-8 text-xs outline-none focus:border-primary dark:border-stroke-dark dark:bg-dark-2 dark:text-white"
					/>
					{filter ? (
						<button type="button" onClick={() => setFilter("")} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-dark-5 hover:text-dark">
							<X className="h-3.5 w-3.5" aria-hidden />
						</button>
					) : null}
				</div>
			) : null}

			<ul className="space-y-1" role="tree" aria-label="Chapters">
				{visible.length === 0 ? <li className="px-2 py-4 text-center text-xs text-dark-5">No chapter matches “{filter.trim()}”.</li> : null}
				{visible.map(({ chapter, index }) => {
					const state = stateOf(chapter);
					const pages = chapter.end - chapter.start + 1;
					const indent = query ? 0 : Math.min(chapter.level - 1, 4);
					return (
						<li
							key={chapter.key}
							role="treeitem"
							aria-level={chapter.level}
							aria-selected={state === "all"}
							aria-expanded={chapter.hasChildren && !query ? expanded.has(index) : undefined}
							style={{ paddingLeft: `${indent * 1.25}rem` }}
						>
							<div
								className={cn(
									"flex items-center gap-1 rounded-lg border transition",
									state === "all"
										? "border-primary bg-primary-50/60 dark:bg-dark-2"
										: state === "some"
											? "border-primary/40"
											: "border-stroke hover:border-primary/50 dark:border-stroke-dark",
								)}
							>
								{chapter.hasChildren && !query ? (
									<button
										type="button"
										onClick={() => toggleExpanded(index)}
										aria-label={expanded.has(index) ? `Collapse ${chapter.title}` : `Expand ${chapter.title}`}
										className="ml-1 flex h-7 w-6 shrink-0 items-center justify-center rounded text-dark-5 hover:bg-gray-2 dark:hover:bg-dark-3"
									>
										<ChevronRight className={cn("h-4 w-4 transition-transform", expanded.has(index) && "rotate-90")} aria-hidden />
									</button>
								) : (
									<span className="ml-1 w-6 shrink-0" aria-hidden />
								)}
								<button
									type="button"
									onClick={() => onToggle(chapter, state !== "all")}
									className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
								>
									<span
										className={cn(
											"flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border-2",
											state === "none" ? "border-gray-4 bg-white dark:bg-dark-2" : "border-primary bg-primary text-white",
										)}
									>
										{state === "all" ? <Check className="h-3 w-3" aria-hidden /> : state === "some" ? <Minus className="h-3 w-3" aria-hidden /> : null}
									</span>
									<span className="min-w-0 flex-1">
										<span className={cn("block truncate text-sm text-dark dark:text-white", chapter.level === 1 && "font-semibold")} title={chapter.path.join(" › ")}>
											{chapter.title}
										</span>
										<span className="block text-xs text-dark-5">
											{unit === "page" ? (pages === 1 ? `p. ${chapter.start}` : `pp. ${chapter.start}–${chapter.end}`) : pages === 1 ? `${unit} ${chapter.start}` : `${unit}s ${chapter.start}–${chapter.end}`}
											{" · "}
											{wordsOf(chapter).toLocaleString()} words
											{query && chapter.path.length > 1 ? ` · in ${chapter.path.slice(0, -1).join(" › ")}` : ""}
											{pages > maxParts ? (
												<span className="font-semibold text-yellow-dark-2">
													{" "}
													· over the {maxParts}-{unit} limit
												</span>
											) : null}
										</span>
									</span>
								</button>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
