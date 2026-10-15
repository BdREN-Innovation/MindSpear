/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParticipantProps } from "../types";
import { SubmitBar, SubmittedState, usePrefersReducedMotion } from "../shared";
import { useAnswerFlow, useDraft } from "../pinOnImage/answerFlow";
import { StarInput, StarMeter } from "./StarRow";

// rating participant (plan §7.3): one item per page with a star row, a
// pager (dots up to 8 items, otherwise "3 / 12"), auto-advance to the next
// unrated item after a rating, and Submit once enough items are rated
// (every item with require_all_items, else at least one). Sends the rated
// items only, in option order (RatingSlideType).

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

type Ratings = Record<number, number>;

function storedRatings(value: unknown): Ratings {
	const rows = (value as { ratings?: unknown } | null)?.ratings;
	const result: Ratings = {};
	if (!Array.isArray(rows)) return result;
	for (const row of rows) {
		const { option_id: id, value: stars } = (row ?? {}) as { option_id?: unknown; value?: unknown };
		if (typeof id === "number" && typeof stars === "number") result[id] = stars;
	}
	return result;
}

export function RatingParticipant({ run, mySubmission, onSubmit, disabled, aggregate, mode }: ParticipantProps<"rating">) {
	const scale = run.config.scale ?? 5;
	const requireAll = !!run.config.require_all_items;
	const items = run.options;
	const stored = useMemo(() => storedRatings(mySubmission), [mySubmission]);
	const hasStored = Object.keys(stored).length > 0;
	const [ratings, setRatings, markClean] = useDraft<Ratings>(stored, JSON.stringify(stored));
	const flow = useAnswerFlow(onSubmit, hasStored, markClean);
	const [index, setIndex] = useState(0);
	const advanceTimer = useRef<number | null>(null);
	const reduceMotion = usePrefersReducedMotion();
	const review = mode === "review";
	const locked = disabled || flow.busy || review;

	useEffect(
		() => () => {
			if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
		},
		[]
	);

	const ratedCount = items.filter((item) => ratings[item.id]).length;
	const canSubmit = requireAll ? ratedCount === items.length && items.length > 0 : ratedCount > 0;
	const current = items[Math.min(index, Math.max(0, items.length - 1))];
	const currentLabel = current ? current.label?.trim() || `Item ${items.indexOf(current) + 1}` : "";

	const goTo = (next: number) => setIndex(Math.max(0, Math.min(items.length - 1, next)));

	const rate = (value: number) => {
		if (locked || !current) return;
		const wasRated = !!ratings[current.id];
		setRatings((previous) => ({ ...previous, [current.id]: value }));
		// Move on to the next unrated item, but not when correcting a rating.
		if (!wasRated) {
			const after = items.findIndex((item, i) => i > index && !ratings[item.id]);
			const target = after >= 0 ? after : items.findIndex((item, i) => i < index && !ratings[item.id]);
			if (target >= 0) {
				if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
				advanceTimer.current = window.setTimeout(() => setIndex(target), reduceMotion ? 0 : 350);
			}
		}
	};

	const averageOf = (id: number) => aggregate?.items.find((item) => item.option_id === id)?.mean ?? null;

	if (flow.showSubmitted || review) {
		const shown = flow.showSubmitted ? ratings : stored;
		const any = Object.keys(shown).length > 0;
		return (
			<SubmittedState
				title={review ? "Your ratings" : "Your ratings are in"}
				message={review ? (any ? null : "You didn't rate anything on this slide.") : "Waiting for the host to continue."}
				onEdit={!review && !disabled ? flow.edit : undefined}
				editLabel="Change my ratings"
				editHint={!review && !disabled ? "You can change them until voting closes." : undefined}
			>
				{any ? (
					<ul className="m-0 flex list-none flex-col gap-2 p-0 text-left">
						{items.map((item, i) => {
							const value = shown[item.id];
							const average = averageOf(item.id);
							return (
								<li key={item.id} className="flex items-center justify-between gap-3 text-sm">
									<span className="min-w-0 break-words font-medium">{item.label?.trim() || `Item ${i + 1}`}</span>
									<span className="flex shrink-0 flex-col items-end gap-0.5">
										{value ? (
											<>
												<StarMeter value={value} scale={scale} size={scale > 7 ? "0.75rem" : "1rem"} />
												<span className="sr-only">
													{value} of {scale} stars
												</span>
											</>
										) : (
											<span style={{ color: "var(--deck-text-muted, #4B5563)" }}>Not rated</span>
										)}
										{average !== null ? (
											<span className="text-xs" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
												Everyone: {average.toFixed(1)}
											</span>
										) : null}
									</span>
								</li>
							);
						})}
					</ul>
				) : null}
			</SubmittedState>
		);
	}

	return (
		<div className="flex min-h-full w-full flex-col" style={{ color: "var(--deck-text, #111928)" }}>
			<div className="flex flex-1 flex-col gap-5 px-4 pb-4 pt-5">
				<div className="flex flex-col gap-1">
					<h2 className="m-0 break-words text-xl font-bold leading-snug">{run.title || "Rate these"}</h2>
					<p className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						{requireAll ? "Rate every item, then submit." : "Rate as many items as you like, then submit."}
					</p>
				</div>

				{current ? (
					<section aria-label={`Item ${index + 1} of ${items.length}`} className="flex flex-col items-center gap-4 rounded-2xl p-5 text-center" style={{ background: "var(--deck-surface, #F9FAFB)", border: "1px solid var(--deck-border, #E5E7EB)" }}>
						<p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted, #4B5563)" }} aria-live="polite">
							Item {index + 1} of {items.length}
						</p>
						{current.image_url ? <img src={current.image_url} alt="" className="h-28 w-28 rounded-xl object-cover" /> : null}
						<h3 className="m-0 break-words text-lg font-bold leading-snug">{currentLabel}</h3>
						<StarInput key={current.id} label={`Rate ${currentLabel}`} value={ratings[current.id] ?? null} scale={scale} onChange={rate} disabled={locked} />
						<p className="m-0 min-h-5 text-sm font-medium" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
							{ratings[current.id] ? `${ratings[current.id]} of ${scale}` : "Tap a star"}
						</p>
					</section>
				) : (
					<p role="status" className="m-0 text-center" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						Nothing to rate on this slide.
					</p>
				)}

				{items.length > 1 ? (
					<nav aria-label="Items" className="flex items-center justify-between gap-2">
						<button
							type="button"
							onClick={() => goTo(index - 1)}
							disabled={index === 0}
							aria-label="Previous item"
							className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40", FOCUS_RING)}
							style={{ background: "var(--deck-surface-muted, #F3F4F6)" }}
						>
							<ChevronLeft className="h-5 w-5" aria-hidden />
						</button>
						{items.length <= 8 ? (
							<div className="flex flex-wrap items-center justify-center">
								{items.map((item, i) => (
									<button
										key={item.id}
										type="button"
										onClick={() => goTo(i)}
										aria-label={`Item ${i + 1}${ratings[item.id] ? `, rated ${ratings[item.id]}` : ", not rated"}`}
										aria-current={i === index ? "step" : undefined}
										className={cn("flex h-11 w-8 items-center justify-center rounded-full", FOCUS_RING)}
									>
										<span
											aria-hidden
											className="block rounded-full transition-all"
											style={{
												width: i === index ? 12 : 8,
												height: i === index ? 12 : 8,
												background: ratings[item.id] ? "var(--deck-primary, #F79945)" : "var(--deck-border, #D1D5DB)",
												outline: i === index ? "2px solid var(--deck-text, #111928)" : undefined,
												outlineOffset: 2,
											}}
										/>
									</button>
								))}
							</div>
						) : (
							<span className="text-sm font-semibold tabular-nums" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
								{index + 1} / {items.length}
							</span>
						)}
						<button
							type="button"
							onClick={() => goTo(index + 1)}
							disabled={index >= items.length - 1}
							aria-label="Next item"
							className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40", FOCUS_RING)}
							style={{ background: "var(--deck-surface-muted, #F3F4F6)" }}
						>
							<ChevronRight className="h-5 w-5" aria-hidden />
						</button>
					</nav>
				) : null}
			</div>

			<SubmitBar
				label={flow.editing ? "Update ratings" : "Submit"}
				onClick={() =>
					void flow.submit({
						ratings: items.filter((item) => ratings[item.id]).map((item) => ({ option_id: item.id, value: ratings[item.id] })),
					})
				}
				loading={flow.busy}
				disabled={disabled || review || !canSubmit}
				hint={`${ratedCount} of ${items.length} rated${requireAll && ratedCount < items.length ? " · rate every item to submit" : ""}`}
				error={flow.errorMessage}
			/>
		</div>
	);
}
