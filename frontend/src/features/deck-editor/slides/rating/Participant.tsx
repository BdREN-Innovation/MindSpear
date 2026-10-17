/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RatingAggregate, RunOption } from "@/features/deck/types";
import type { ParticipantProps } from "../types";
import { SubmitBar, SubmittedState, usePrefersReducedMotion } from "../shared";
import { useAnswer } from "../shared/answer";
import { displayTitle, numberedLabel } from "../shared/labels";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, ResultsSection, countLabel, isReadOnlyView, notVotingMessage, resultsTitle } from "../shared/participantKit";
import { StarInput, StarMeter } from "./StarRow";

// rating participant (plan §7.3): one item per page with a star row, a
// pager (dots up to 8 items, otherwise "3 / 12"), auto-advance to the next
// unrated item after a rating, and Submit once enough items are rated
// (every item with require_all_items, else at least one). Sends the rated
// items only, in option order (RatingSlideType). Public results (aggregate
// passed) show everyone's average per item in every view.

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

export function RatingParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode }: ParticipantProps<"rating">) {
	const review = mode === "review";
	const readOnly = isReadOnlyView(mode, run.state);
	const scale = run.config.scale ?? 5;
	const requireAll = !!run.config.require_all_items;
	const items = run.options;
	const answer = useAnswer(run.id, mySubmission, onSubmit);
	const stored = useMemo(() => storedRatings(answer.latest), [answer.latest]);
	const hasStored = Object.keys(stored).length > 0;
	const [ratings, setRatings] = useState<Ratings>({});
	const [index, setIndex] = useState(0);
	const advanceTimer = useRef<number | null>(null);
	const reduceMotion = usePrefersReducedMotion();
	const locked = disabled || answer.busy || readOnly;
	const title = displayTitle(run.title, "rating");

	useEffect(
		() => () => {
			if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
		},
		[]
	);

	const ratedCount = items.filter((item) => ratings[item.id]).length;
	const canSubmit = requireAll ? ratedCount === items.length && items.length > 0 : ratedCount > 0;
	const current = items[Math.min(index, Math.max(0, items.length - 1))];
	const currentLabel = current ? numberedLabel(current, items.indexOf(current), "Item") : "";

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

	const results = aggregate ? (
		<RatingResults aggregate={aggregate} items={items} scale={scale} mine={stored} title={resultsTitle(mode, run.state)} />
	) : null;

	const summary = (
		<AnswerSummary label="Your ratings">
			<ul className="m-0 flex list-none flex-col gap-2 p-0">
				{items.map((item, i) => {
					const value = stored[item.id];
					return (
						<li key={item.id} className="flex items-center justify-between gap-3 text-sm">
							<span className="min-w-0 break-words font-medium">{numberedLabel(item, i, "Item")}</span>
							{value ? (
								<span className="shrink-0">
									<StarMeter value={value} scale={scale} size={scale > 7 ? "0.75rem" : "1rem"} />
									<span className="sr-only">
										{value} of {scale} stars
									</span>
								</span>
							) : (
								<span className="shrink-0" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
									Not rated
								</span>
							)}
						</li>
					);
				})}
			</ul>
		</AnswerSummary>
	);

	if (readOnly) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				{hasStored ? summary : review ? <ParticipantNotice>You didn&apos;t rate anything on this slide.</ParticipantNotice> : null}
				{results}
			</ParticipantLayout>
		);
	}

	if (hasStored && !answer.editing) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				<SubmittedState
					title="Your ratings are in"
					onEdit={
						disabled
							? undefined
							: () => {
									setRatings(stored);
									setIndex(0);
									answer.edit();
								}
					}
					editLabel="Change my ratings"
					editHint={!disabled ? "You can change them until voting closes." : undefined}
					className="px-0 py-6"
				>
					<div className="flex flex-col gap-4">
						{summary}
						{results}
					</div>
				</SubmittedState>
			</ParticipantLayout>
		);
	}

	const lockedMessage = disabled ? notVotingMessage(run.state) : null;
	const payload = { ratings: items.filter((item) => ratings[item.id]).map((item) => ({ option_id: item.id, value: ratings[item.id] })) };

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle={requireAll ? "Rate every item, then submit." : "Rate as many items as you like, then submit."}
			footer={
				<SubmitBar
					label={answer.editing ? "Update ratings" : "Submit"}
					onClick={() => void answer.submit(payload, payload)}
					loading={answer.busy}
					disabled={disabled || !canSubmit}
					hint={`${ratedCount} of ${items.length} rated${requireAll && ratedCount < items.length ? " · rate every item to submit" : ""}`}
					error={answer.fieldError}
				/>
			}
		>
			{lockedMessage ? <ParticipantNotice>{lockedMessage}</ParticipantNotice> : null}

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

			{answer.editing ? (
				<button
					type="button"
					onClick={answer.cancelEdit}
					disabled={answer.busy}
					className={cn("min-h-11 self-center rounded-lg px-4 text-sm font-semibold underline-offset-4 hover:underline", FOCUS_RING)}
					style={{ color: "var(--deck-text-muted, #4B5563)" }}
				>
					Keep my ratings
				</button>
			) : null}

			{results}
		</ParticipantLayout>
	);
}

/** Everyone's average stars per item, with the participant's own rating beside it. */
function RatingResults({
	aggregate,
	items,
	scale,
	mine,
	title,
}: {
	aggregate: RatingAggregate;
	items: RunOption[];
	scale: number;
	mine: Ratings;
	title: string;
}) {
	const byId = new Map(aggregate.items.map((item) => [item.option_id, item]));
	return (
		<ResultsSection title={title} summary={countLabel(aggregate.total_responses, "response", "responses")}>
			<ul className="m-0 flex list-none flex-col gap-2 p-0">
				{items.map((item, i) => {
					const result = byId.get(item.id);
					const mean = result?.mean ?? null;
					const count = result?.count ?? 0;
					const label = numberedLabel(item, i, "Item");
					const yours = mine[item.id];
					return (
						<li key={item.id} className="flex items-center justify-between gap-3 text-sm">
							<span className="min-w-0 break-words">
								{label}
								{yours ? (
									<span className="ml-1.5 text-xs" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
										you: {yours}
									</span>
								) : null}
							</span>
							<span className="flex shrink-0 items-center gap-2">
								<StarMeter value={mean} scale={scale} size={scale > 7 ? "0.75rem" : "0.95rem"} />
								<span className="min-w-[2.2em] text-right font-semibold tabular-nums">{mean !== null ? mean.toFixed(1) : "–"}</span>
								<span className="sr-only">
									{mean !== null ? `average ${mean} of ${scale} stars from ${count} ${count === 1 ? "rating" : "ratings"}` : "no ratings yet"}
								</span>
							</span>
						</li>
					);
				})}
			</ul>
		</ResultsSection>
	);
}
