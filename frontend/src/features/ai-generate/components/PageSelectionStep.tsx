/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { BookOpen, Check, LayoutGrid, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Chapter } from "../lib/chapters";
import { documentUnit, type DocumentPart, type LoadedDocument } from "../lib/documentPages";
import { parsePageSelection } from "../lib/pageRange";
import { MAX_TEXT_CHARS } from "../types";
import { ChapterList } from "./ChapterList";

export const MAX_SELECTED_PARTS = 30;

interface Props {
	doc: LoadedDocument;
	selected: Set<number>;
	onChange: (next: Set<number>) => void;
	/** A chapter was ticked (e.g. to suggest it as the topic). */
	onChapterSelected?: (chapter: Chapter) => void;
	/** PPTX: where the slide images stand (they arrive after the text). */
	slideImages?: "loading" | "ready" | "unavailable" | null;
	className?: string;
}

export function PageSelectionStep({ doc, selected, onChange, onChapterSelected, slideImages = null, className }: Props) {
	const [range, setRange] = useState("");
	const [notice, setNotice] = useState<string | null>(null);
	const hasChapters = doc.chapters.length > 0;
	const [mode, setMode] = useState<"chapters" | "pages">(hasChapters ? "chapters" : "pages");
	const ids = doc.parts.map((p) => p.id);
	const unit = documentUnit(doc);
	const chosen = doc.parts.filter((p) => selected.has(p.id));
	const words = chosen.reduce((sum, p) => sum + p.wordCount, 0);
	const chars = chosen.reduce((sum, p) => sum + p.text.length, 0);

	const set = (next: number[]) => {
		if (next.length > MAX_SELECTED_PARTS) {
			setNotice(`You can select a maximum of ${MAX_SELECTED_PARTS} ${unit}s; the first ${MAX_SELECTED_PARTS} were selected.`);
			next = next.slice(0, MAX_SELECTED_PARTS);
		} else {
			setNotice(null);
		}
		onChange(new Set(next));
	};

	const applyRange = () => {
		const numbers = doc.parts.map((p) => p.number);
		const { numbers: picked, unmatched } = parsePageSelection(range, numbers);
		const available = `This document has ${unit}s ${Math.min(...numbers)}–${Math.max(...numbers)}.`;
		if (picked.length === 0) {
			setNotice(range.trim() ? `No ${unit} matches “${range.trim()}”. ${available}` : `Type ${unit} numbers first, for example 1-5, 8.`);
			return;
		}
		const wanted = new Set(picked);
		set(doc.parts.filter((p) => wanted.has(p.number)).map((p) => p.id));
		setMode("pages"); // Show what was picked.
		if (unmatched.length > 0 && picked.length <= MAX_SELECTED_PARTS) {
			setNotice(`Skipped “${unmatched.join(", ")}”. ${available}`);
		}
	};

	const toggleChapter = (chapter: Chapter, select: boolean) => {
		const next = new Set(selected);
		const pages = ids.filter((id) => id >= chapter.start && id <= chapter.end);
		if (!select) {
			pages.forEach((id) => next.delete(id));
			setNotice(null);
			onChange(next);
			return;
		}
		pages.forEach((id) => next.add(id));
		if (next.size > MAX_SELECTED_PARTS) {
			setNotice(
				pages.length > MAX_SELECTED_PARTS
					? `“${chapter.title}” has ${pages.length} ${unit}s. You can select a maximum of ${MAX_SELECTED_PARTS} ${unit}s — choose a sub-chapter, or switch to “By ${unit}” and pick ${unit}s from it.`
					: `Adding “${chapter.title}” would select ${next.size} ${unit}s. You can select a maximum of ${MAX_SELECTED_PARTS} ${unit}s — clear some first.`,
			);
			return;
		}
		setNotice(null);
		onChange(next);
		onChapterSelected?.(chapter);
	};

	const toggle = (part: DocumentPart) => {
		const next = new Set(selected);
		if (next.has(part.id)) {
			next.delete(part.id);
			setNotice(null);
		} else if (next.size >= MAX_SELECTED_PARTS) {
			setNotice(`You can select a maximum of ${MAX_SELECTED_PARTS} ${unit}s.`);
			return;
		} else {
			next.add(part.id);
		}
		onChange(next);
	};

	return (
		<div className={cn("flex min-h-0 flex-col gap-3", className)}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<p className="text-sm font-semibold text-dark dark:text-white">
						{mode === "chapters" && hasChapters ? "Choose chapters" : `Choose ${unit}s`}{" "}
						<span className="font-normal text-dark-5">
							· {selected.size} of {doc.parts.length} {unit}s selected
						</span>
					</p>
					<p className="text-xs text-dark-5">{words.toLocaleString()} words selected</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{hasChapters ? (
						<div className="flex h-8 items-center rounded-lg border border-stroke p-0.5 dark:border-stroke-dark" role="radiogroup" aria-label="Select by">
							{(
								[
									["chapters", "By chapter", BookOpen],
									["pages", `By ${unit}`, LayoutGrid],
								] as const
							).map(([value, label, Icon]) => (
								<button
									key={value}
									type="button"
									role="radio"
									aria-checked={mode === value}
									onClick={() => setMode(value)}
									className={cn(
										"flex h-full items-center gap-1 rounded-md px-2 text-xs font-semibold transition",
										mode === value ? "bg-primary text-white" : "text-dark-5 hover:text-dark dark:hover:text-white",
									)}
								>
									<Icon className="h-3.5 w-3.5" aria-hidden />
									{label}
								</button>
							))}
						</div>
					) : null}
					<form
						onSubmit={(e) => {
							e.preventDefault();
							applyRange();
						}}
						className="flex items-center gap-1"
					>
						<input
							value={range}
							onChange={(e) => setRange(e.target.value)}
							placeholder="e.g. 1-5, 8"
							aria-label={`Select ${unit}s by number`}
							className="h-8 w-28 rounded-lg border border-stroke px-2 text-xs outline-none focus:border-primary dark:border-stroke-dark dark:bg-dark-2 dark:text-white"
						/>
						<button type="submit" className="h-8 rounded-lg border border-stroke px-2 text-xs font-semibold text-dark hover:bg-gray-2 dark:border-stroke-dark dark:text-white dark:hover:bg-dark-2">
							Apply
						</button>
					</form>
					<button type="button" onClick={() => set(ids)} className="h-8 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-primary-50 dark:hover:bg-dark-2">
						Select all
					</button>
					<button type="button" onClick={() => set([])} className="h-8 rounded-lg px-2 text-xs font-semibold text-dark-5 hover:bg-gray-2 dark:hover:bg-dark-2">
						Clear
					</button>
				</div>
			</div>

			{notice ? (
				<p role="status" className="rounded-lg bg-yellow-light-4 px-3 py-2 text-xs text-yellow-dark-2">
					{notice}
				</p>
			) : null}
			{slideImages === "loading" ? (
				<p role="status" className="flex items-center gap-2 text-xs text-dark-5">
					<Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
					Preparing the slide images… you can already pick slides.
				</p>
			) : null}
			{slideImages === "unavailable" ? <p className="text-xs text-dark-5">Slide images aren&apos;t available for this file right now. You can still pick slides by their text.</p> : null}
			{chars > MAX_TEXT_CHARS ? (
				<p className="rounded-lg bg-yellow-light-4 px-3 py-2 text-xs text-yellow-dark-2">
					That&apos;s a lot of text — it will be shortened evenly across the selected {unit}s to about {Math.round(MAX_TEXT_CHARS / 1000)}k characters. Select fewer {unit}s for more detailed questions.
				</p>
			) : null}

			<div className="min-h-0 flex-1 overflow-y-auto pr-1">
				{mode === "chapters" && hasChapters ? (
					<ChapterList chapters={doc.chapters} parts={doc.parts} selected={selected} unit={unit} maxParts={MAX_SELECTED_PARTS} onToggle={toggleChapter} />
				) : doc.kind !== "text" ? (
					<ul className={cn("grid gap-3", doc.kind === "slides" ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4")}>
						{doc.parts.map((part) => {
							const isOn = selected.has(part.id);
							return (
								<li key={part.id}>
									<button
										type="button"
										onClick={() => toggle(part)}
										aria-pressed={isOn}
										className={cn(
											"relative block w-full overflow-hidden rounded-lg border-2 bg-white text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
											isOn ? "border-primary shadow-md" : "border-stroke opacity-80 hover:opacity-100 dark:border-stroke-dark",
										)}
									>
										{part.thumbnail ? (
											<img src={part.thumbnail} alt="" className="block w-full" />
										) : doc.kind === "slides" ? (
											<span className="block aspect-video overflow-hidden bg-gray-1 p-2 pr-8 text-xs text-dark-5">
												<span className="line-clamp-4">{part.text}</span>
											</span>
										) : (
											<div className="aspect-[3/4] bg-gray-2" />
										)}
										<span className={cn("absolute left-1.5 z-10 rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold text-dark shadow-sm", doc.kind === "slides" ? "bottom-1.5" : "top-1.5")}>{part.number}</span>
										<span
											className={cn(
												"absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2",
												isOn ? "border-primary bg-primary text-white" : "border-gray-4 bg-white",
											)}
										>
											{isOn ? <Check className="h-3 w-3" aria-hidden /> : null}
										</span>
										{part.wordCount === 0 ? (
											<span className="absolute inset-x-0 bottom-0 bg-dark/70 px-1 py-0.5 text-center text-[10px] text-white">No text</span>
										) : null}
										<span className="sr-only">{part.label}</span>
									</button>
								</li>
							);
						})}
					</ul>
				) : (
					<ul className="space-y-2">
						{doc.parts.map((part) => {
							const isOn = selected.has(part.id);
							return (
								<li key={part.id}>
									<button
										type="button"
										onClick={() => toggle(part)}
										aria-pressed={isOn}
										className={cn(
											"flex w-full gap-3 rounded-xl border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
											isOn ? "border-primary bg-primary-50/60 dark:bg-dark-2" : "border-stroke hover:border-primary/50 dark:border-stroke-dark",
										)}
									>
										<span
											className={cn(
												"mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2",
												isOn ? "border-primary bg-primary text-white" : "border-gray-4 bg-white dark:bg-dark-2",
											)}
										>
											{isOn ? <Check className="h-3 w-3" aria-hidden /> : null}
										</span>
										<span className="min-w-0 flex-1">
											<span className="flex items-center justify-between gap-2">
												<span className="truncate text-sm font-semibold text-dark dark:text-white">{part.label}</span>
												<span className="shrink-0 text-xs text-dark-5">{part.wordCount.toLocaleString()} words</span>
											</span>
											<span className="mt-1 line-clamp-2 text-xs text-dark-5">{part.text}</span>
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}
