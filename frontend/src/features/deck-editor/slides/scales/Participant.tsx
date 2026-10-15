"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OptionValue, RunOption } from "@/features/deck/types";
import type { ParticipantProps } from "../types";
import { SubmitBar, SubmittedState, haptic, usePrefersReducedMotion, useSubmit } from "../shared";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, notVotingMessage, numberedLabel, useAnswerHistory } from "../pollSingle/common";
import { clampPoints, fitLabels } from "./scale";

// scales on the phone (plan §7.3): per statement a row of numbered pills
// (tap to pick 1..N, arrow keys move within the row). Up to 3 statements sit
// on one screen; more get one statement per page with a pager, and picking a
// value for a new statement moves on to the next one. Submit sends the
// answered statements in option order (all of them when
// require_all_statements is on).

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

/** More statements than this get the one-per-page pager. */
const STACK_LIMIT = 3;

type Ratings = Record<number, number>;

function toRatings(list: OptionValue[] | undefined | null): Ratings {
	const ratings: Ratings = {};
	for (const entry of Array.isArray(list) ? list : []) {
		if (typeof entry?.option_id === "number" && typeof entry.value === "number") ratings[entry.option_id] = entry.value;
	}
	return ratings;
}

export function ScalesParticipant({ run, mySubmission, onSubmit, disabled, theme, mode }: ParticipantProps<"scales">) {
	const review = mode === "review";
	const points = clampPoints(run.config.scale_points);
	const labels = fitLabels(run.config.scale_labels, points);
	const requireAll = run.config.require_all_statements === true;
	const statements = run.options;
	const paged = statements.length > STACK_LIMIT;

	const { submit, busy, errorMessage, reset } = useSubmit(onSubmit);
	const { latest, record } = useAnswerHistory(run.id, mySubmission);
	const [editing, setEditing] = useState(false);
	const [ratings, setRatings] = useState<Ratings>({});
	const [page, setPage] = useState(0);
	const reducedMotion = usePrefersReducedMotion();
	const advanceTimer = useRef<number | null>(null);

	useEffect(
		() => () => {
			if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
		},
		[]
	);

	const answered = toRatings(latest?.ratings);
	const hasAnswer = Object.keys(answered).length > 0;
	const locked = disabled || review;
	const title = run.title;

	if (review || (hasAnswer && !editing)) {
		return (
			<ParticipantLayout theme={theme} title={title} fallbackTitle="Scales">
				{!hasAnswer ? (
					<ParticipantNotice>You didn&apos;t answer this slide.</ParticipantNotice>
				) : (
					<SubmittedState
						message={review ? null : "Waiting for the host to continue."}
						onEdit={
							locked
								? undefined
								: () => {
										reset();
										setRatings(answered);
										setPage(0);
										setEditing(true);
									}
						}
						editLabel="Change answers"
						className="px-0 py-6"
					>
						<AnswerSummary label="Your answers">
							<ul className="m-0 flex list-none flex-col gap-2 p-0">
								{statements.map((statement, index) => {
									const value = answered[statement.id];
									return (
										<li key={statement.id} className="flex items-start justify-between gap-3 text-sm">
											<span className="min-w-0 break-words">{numberedLabel(statement, index, "Statement")}</span>
											<span className="shrink-0 text-right font-semibold">
												{value ? `${value} / ${points}${labels[value - 1] ? ` · ${labels[value - 1]}` : ""}` : "Skipped"}
											</span>
										</li>
									);
								})}
							</ul>
						</AnswerSummary>
					</SubmittedState>
				)}
			</ParticipantLayout>
		);
	}

	const ratedCount = statements.filter((statement) => ratings[statement.id]).length;
	const canSubmit = ratedCount > 0 && (!requireAll || ratedCount === statements.length);
	const lockedMessage = disabled ? notVotingMessage(run.state) : null;
	const current = Math.min(page, Math.max(0, statements.length - 1));
	const visible = paged ? statements.slice(current, current + 1) : statements;

	const pick = (statementId: number, value: number) => {
		const isNew = !ratings[statementId];
		setRatings({ ...ratings, [statementId]: value });
		// Paged: a first answer moves on to the next statement after a beat.
		if (paged && isNew && current < statements.length - 1) {
			if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
			advanceTimer.current = window.setTimeout(() => setPage((p) => Math.min(p + 1, statements.length - 1)), reducedMotion ? 0 : 350);
		}
	};

	const send = () => {
		if (!canSubmit) return;
		const payload = statements.filter((statement) => ratings[statement.id]).map((statement) => ({ option_id: statement.id, value: ratings[statement.id] }));
		void submit({ ratings: payload }).then((ok) => {
			if (ok) {
				record({ ratings: payload });
				setEditing(false);
			}
		});
	};

	const hint = requireAll
		? `${ratedCount} of ${statements.length} rated${ratedCount < statements.length ? ", rate all to submit" : ""}`
		: `${ratedCount} of ${statements.length} rated`;

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			fallbackTitle="Scales"
			subtitle={statements.length === 1 ? "Pick a value." : requireAll ? "Rate every statement." : "Rate the statements you have a view on."}
			footer={
				<SubmitBar
					label={hasAnswer ? "Update answers" : "Submit"}
					onClick={send}
					loading={busy}
					disabled={disabled || !canSubmit}
					hint={hint}
					error={errorMessage}
				/>
			}
		>
			{lockedMessage ? <ParticipantNotice>{lockedMessage}</ParticipantNotice> : null}

			{paged ? (
				<Pager
					current={current}
					total={statements.length}
					answered={statements.map((statement) => !!ratings[statement.id])}
					onPrevious={() => setPage(Math.max(0, current - 1))}
					onNext={() => setPage(Math.min(statements.length - 1, current + 1))}
				/>
			) : null}

			<div className="flex flex-col gap-6">
				{visible.map((statement) => {
					const index = statements.indexOf(statement);
					return (
						<StatementPills
							key={statement.id}
							statement={statement}
							index={index}
							points={points}
							labels={labels}
							value={ratings[statement.id] ?? null}
							disabled={disabled || busy}
							onPick={(value) => pick(statement.id, value)}
						/>
					);
				})}
			</div>

			{editing ? (
				<button
					type="button"
					onClick={() => {
						reset();
						setEditing(false);
					}}
					disabled={busy}
					className={cn("min-h-11 self-center rounded-lg px-4 text-sm font-semibold underline-offset-4 hover:underline", FOCUS_RING)}
					style={{ color: "var(--deck-text-muted, #4B5563)" }}
				>
					Keep my answers
				</button>
			) : null}
		</ParticipantLayout>
	);
}

function StatementPills({
	statement,
	index,
	points,
	labels,
	value,
	disabled,
	onPick,
}: {
	statement: RunOption;
	index: number;
	points: number;
	labels: (string | null)[];
	value: number | null;
	disabled: boolean;
	onPick: (value: number) => void;
}) {
	const label = numberedLabel(statement, index, "Statement");
	const groupRef = useRef<HTMLDivElement>(null);
	// Two rows past 6 points so every pill keeps a ≥ 48 px target on a phone.
	const columns = points <= 6 ? points : Math.ceil(points / 2);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
		if (!delta || disabled) return;
		event.preventDefault();
		const next = Math.min(points, Math.max(1, (value ?? (delta > 0 ? 0 : points + 1)) + delta));
		onPick(next);
		groupRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
	};

	return (
		<section className="flex flex-col gap-3">
			<h3 className="m-0 break-words text-lg font-semibold leading-snug">{label}</h3>
			<div
				ref={groupRef}
				role="radiogroup"
				aria-label={label}
				onKeyDown={onKeyDown}
				className="grid gap-2"
				style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
			>
				{Array.from({ length: points }, (_, i) => {
					const option = i + 1;
					const selected = value === option;
					const tabbable = value === null ? option === 1 : selected;
					return (
						<button
							key={option}
							type="button"
							role="radio"
							data-value={option}
							aria-checked={selected}
							aria-label={labels[i] ? `${option}, ${labels[i]}` : String(option)}
							tabIndex={tabbable ? 0 : -1}
							disabled={disabled}
							onClick={() => {
								haptic(10);
								onPick(option);
							}}
							className={cn(
								"flex min-h-12 touch-manipulation items-center justify-center rounded-full border-2 text-lg font-bold tabular-nums transition motion-safe:active:scale-95 disabled:cursor-not-allowed disabled:opacity-60",
								FOCUS_RING
							)}
							style={{
								borderColor: selected ? "var(--deck-primary, #F79945)" : "var(--deck-border, #E5E7EB)",
								background: selected ? "var(--deck-primary, #F79945)" : "var(--deck-surface, #fff)",
								color: selected ? "var(--deck-on-primary, #111928)" : "var(--deck-text, #111928)",
							}}
						>
							{option}
						</button>
					);
				})}
			</div>
			<div className="flex items-start justify-between gap-4 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
				<span className="min-w-0 break-words">{labels[0] ?? ""}</span>
				<span className="min-w-0 break-words text-right">{labels[points - 1] ?? ""}</span>
			</div>
			<p aria-live="polite" className="m-0 min-h-5 text-center text-sm font-semibold">
				{value !== null && labels[value - 1] && value !== 1 && value !== points ? labels[value - 1] : ""}
			</p>
		</section>
	);
}

function Pager({
	current,
	total,
	answered,
	onPrevious,
	onNext,
}: {
	current: number;
	total: number;
	answered: boolean[];
	onPrevious: () => void;
	onNext: () => void;
}) {
	return (
		<nav aria-label="Statements" className="flex items-center justify-between gap-2">
			<button
				type="button"
				onClick={onPrevious}
				disabled={current === 0}
				aria-label="Previous statement"
				className={cn("flex h-12 w-12 items-center justify-center rounded-full border-2 disabled:opacity-40", FOCUS_RING)}
				style={{ borderColor: "var(--deck-border, #E5E7EB)", background: "var(--deck-surface, #fff)" }}
			>
				<ChevronLeft className="h-5 w-5" aria-hidden />
			</button>
			<div className="flex min-w-0 flex-col items-center gap-1.5">
				<span aria-live="polite" className="text-sm font-semibold tabular-nums">
					Statement {current + 1} of {total}
				</span>
				{total <= 12 ? (
					<span className="flex gap-1.5" aria-hidden>
						{answered.map((done, index) => (
							<span
								key={index}
								className="h-2 w-2 rounded-full"
								style={{
									background: index === current ? "var(--deck-text, #111928)" : done ? "var(--deck-primary, #F79945)" : "var(--deck-border, #D1D5DB)",
								}}
							/>
						))}
					</span>
				) : null}
			</div>
			<button
				type="button"
				onClick={onNext}
				disabled={current >= total - 1}
				aria-label="Next statement"
				className={cn("flex h-12 w-12 items-center justify-center rounded-full border-2 disabled:opacity-40", FOCUS_RING)}
				style={{ borderColor: "var(--deck-border, #E5E7EB)", background: "var(--deck-surface, #fff)" }}
			>
				<ChevronRight className="h-5 w-5" aria-hidden />
			</button>
		</nav>
	);
}
