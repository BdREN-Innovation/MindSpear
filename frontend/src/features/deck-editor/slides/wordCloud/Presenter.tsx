"use client";

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { chartColor } from "@/features/deck/theme";
import type { WordCloudWord } from "@/features/deck/types";
import type { PresenterProps } from "../types";
import { fallbackTitle } from "../shared/labels";
import { PresenterStage, ResponseCount, ResultsEmpty, SlideTitle, usePrefersReducedMotion } from "../shared";

// Word cloud presenter (plan §6.3), drawn with flex instead of a chart
// library: words wrap in centred rows, the most frequent sit in the middle
// (centre-out order), font size grows with the square root of the count so a
// runaway word doesn't swallow the slide, and sizes are in cqw so the cloud
// scales with the slide frame. New words pop in; existing ones glide to
// their new place (framer-motion layout) unless reduced motion is on.

interface PlacedWord {
	word: string;
	count: number;
	size: number;
	color: string;
	weight: number;
	/** CSS order: the visual slot (centre-out); the DOM keeps count order for screen readers. */
	order: number;
}

/** Interleave around the centre: [.., 4, 2, 0, 1, 3, ..] so the biggest words land mid-cloud. */
function centreOut<T>(items: T[]): T[] {
	const result: T[] = [];
	items.forEach((item, index) => {
		if (index % 2 === 0) result.push(item);
		else result.unshift(item);
	});
	return result;
}

/** Font size bounds (cqw) by how crowded the cloud is. */
function sizeRange(count: number): [number, number] {
	if (count <= 6) return [4, 11];
	if (count <= 15) return [3, 9];
	if (count <= 35) return [2.3, 6.8];
	return [1.7, 5];
}

function placeWords(words: WordCloudWord[], colorAt: (index: number) => string): PlacedWord[] {
	if (words.length === 0) return [];
	const counts = words.map((word) => word.count);
	const high = Math.max(...counts);
	const low = Math.min(...counts);
	const [small, big] = sizeRange(words.length);
	// The aggregate is sorted count desc, so the colour follows the rank and stays put while counts tick up.
	const slots = new Map(centreOut(words.map((_, index) => index)).map((index, slot) => [index, slot]));
	return words.map((word, index) => {
		const t = high === low ? 0.5 : (word.count - low) / (high - low);
		const size = small + (big - small) * Math.sqrt(t);
		return {
			word: word.word,
			count: word.count,
			size,
			color: colorAt(index),
			weight: t > 0.6 ? 800 : t > 0.25 ? 700 : 600,
			order: slots.get(index) ?? index,
		};
	});
}

export function WordCloudPresenter({ run, aggregate, theme, mode }: PresenterProps<"word_cloud">) {
	const reducedMotion = usePrefersReducedMotion();
	const words = useMemo(() => placeWords(aggregate?.words ?? [], (index) => chartColor(theme, index)), [aggregate, theme]);
	const waiting = aggregate === null && mode === "live";
	const fit = useFitScale(words, !waiting && words.length > 0);

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<header className="flex items-start justify-between gap-[3cqw]">
				<SlideTitle title={run.title} fallback={fallbackTitle("word_cloud")} />
				{aggregate ? <ResponseCount count={aggregate.total_responses} className="shrink-0 pt-[0.8cqw]" /> : null}
			</header>

			{waiting || words.length === 0 ? (
				<ResultsEmpty message={waiting ? "Waiting for responses…" : "Waiting for the first words…"} />
			) : (
				<div className="relative flex min-h-0 flex-1 flex-col">
					<LayoutGroup>
						<ul
							ref={fit.ref}
							aria-label="Word cloud, most mentioned first"
							className="m-0 flex min-h-0 flex-1 list-none flex-wrap content-center items-center justify-center gap-x-[1.8cqw] gap-y-[0.4cqw] overflow-hidden p-0"
						>
							<AnimatePresence initial={false}>
								{words.map((word) => (
									<motion.li
										key={word.word}
										layout={reducedMotion ? false : "position"}
										initial={reducedMotion ? false : { opacity: 0, scale: 0.3 }}
										animate={{ opacity: 1, scale: 1 }}
										exit={reducedMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.3 }}
										transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 24 }}
										className="max-w-full text-center leading-[1.1] [overflow-wrap:anywhere]"
										style={{ fontSize: `${(word.size * fit.scale).toFixed(2)}cqw`, color: word.color, fontWeight: word.weight, order: word.order }}
									>
										{word.word}
										<span className="sr-only">
											{" "}
											({word.count} {word.count === 1 ? "mention" : "mentions"})
										</span>
									</motion.li>
								))}
							</AnimatePresence>
						</ul>
					</LayoutGroup>
					{aggregate?.truncated ? (
						<p className="m-0 text-right" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.75rem, 1.3cqw, 1rem)" }}>
							Showing the top {aggregate.words.length} of {aggregate.distinct_words} words
						</p>
					) : null}
				</div>
			)}
		</PresenterStage>
	);
}

/** Height of the laid-out words, from offsets (not scrollHeight: in-flight layout transforms would inflate it). */
function contentHeight(list: HTMLElement): number {
	let top = Infinity;
	let bottom = -Infinity;
	for (const child of Array.from(list.children) as HTMLElement[]) {
		top = Math.min(top, child.offsetTop);
		bottom = Math.max(bottom, child.offsetTop + child.offsetHeight);
	}
	return bottom > top ? bottom - top : 0;
}

/**
 * Shrinks the cloud until it fits its box: after layout, while the words
 * overflow, the scale steps down (synchronously, before paint). A new word
 * set or a resized box starts again from full size, so the cloud grows back
 * when there is room. Sizes are cqw, so one fit holds while the slide scales.
 */
function useFitScale(words: PlacedWord[], active: boolean) {
	const ref = useRef<HTMLUListElement>(null);
	const [box, setBox] = useState("");
	const signature = `${box}|${words.map((word) => `${word.word}:${word.size.toFixed(2)}`).join(",")}`;
	const [state, setState] = useState({ signature, scale: 1 });
	const scale = state.signature === signature ? state.scale : 1;

	useLayoutEffect(() => {
		const list = ref.current;
		if (!list) return;
		const needed = contentHeight(list);
		if (needed > list.clientHeight + 1 && scale > 0.3) {
			// Height grows roughly with the square of the font size; aim just under the box.
			const step = Math.min(0.92, Math.sqrt(list.clientHeight / needed) * 0.97);
			setState({ signature, scale: Math.max(0.3, scale * step) });
		} else if (state.signature !== signature) {
			setState({ signature, scale });
		}
	}, [scale, signature, state.signature]);

	useLayoutEffect(() => {
		const list = ref.current;
		if (!list || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			setBox(`${Math.round(width / 8)}x${Math.round(height / 8)}`);
		});
		observer.observe(list);
		return () => observer.disconnect();
	}, [active]);

	return { ref, scale };
}
