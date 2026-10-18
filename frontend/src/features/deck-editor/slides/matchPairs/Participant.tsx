/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { chartColor } from "@/features/deck/theme";
import { runScoring } from "@/features/deck/lib/quiz";
import type { MatchPairConnection, OpaqueOptionId, RunOption } from "@/features/deck/types";
import type { ParticipantProps } from "../types";
import { SubmitBar, haptic } from "../shared";
import { numberedLabel } from "../shared/labels";
import { AnswerSummary, ParticipantLayout, ParticipantNotice } from "../shared/participantKit";
import { quizDisplayTitle, resolveStanding } from "../shared/quizLabels";
import {
	FirstAnswerLockedIn,
	LockedIn,
	OptionsHiddenView,
	PointsBar,
	QuizResultBanner,
	ResultHeading,
	ResultRow,
	optionsHidden,
	quizPhase,
	useQuizAnswer,
} from "../shared/quizParticipant";
import { runSides } from "./pairs";

// match_pairs on the phone (plan §3.2): two columns, left in author order,
// right shuffled by the server (both rendered exactly in the run view's
// order, which may be this player's own). Tap a cell on one side, then a cell on the
// other to connect them (a line is drawn); tap a connected cell again to
// re-pair or undo. Connections stay editable until Submit, which sends
// {pairs: [{left_id, right_id}]} with the run's opaque ids. Final once sent.

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

type Cell = RunOption<OpaqueOptionId, { side: "left" | "right" }>;
type Selection = { side: "left" | "right"; id: OpaqueOptionId } | null;
interface Line {
	key: string;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	color: string;
}

export function MatchPairsParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode, scoring, reveal, standing, quiz }: ParticipantProps<"match_pairs">) {
	const answer = useQuizAnswer(run.id, mySubmission, onSubmit);
	const { lefts, rights } = runSides(run.options as Cell[]);
	const labelOf = new Map<OpaqueOptionId, string>([
		...lefts.map((cell, index) => [cell.id, numberedLabel(cell, index, "Item")] as const),
		...rights.map((cell, index) => [cell.id, numberedLabel(cell, index, "Match")] as const),
	]);
	const cellOf = new Map<OpaqueOptionId, Cell>([...lefts, ...rights].map((cell) => [cell.id, cell]));

	const sent = Array.isArray(answer.latest?.pairs) ? answer.latest.pairs : [];
	const stored = sent.filter((pair) => cellOf.has(pair.left_id) && cellOf.has(pair.right_id));
	const answered = stored.length > 0 || answer.alreadyAnswered;
	const phase = quizPhase(run.state, mode, answered);
	const title = quizDisplayTitle(run.title, "match_pairs");

	if (phase !== "result" && optionsHidden(run)) {
		return sent.length > 0 || answer.alreadyAnswered ? (
			<FirstAnswerLockedIn theme={theme} title={title} />
		) : (
			<OptionsHiddenView theme={theme} title={title} state={run.state} hint="The items to match appear on your phone when the question starts." />
		);
	}

	if (phase === "result") {
		const correctPairs = reveal?.correct_answer?.pairs ?? aggregate?.correct?.pairs ?? [];
		const correctRight = new Map(correctPairs.map((pair) => [pair.left_id, pair.right_id]));
		const mine = new Map(stored.map((pair) => [pair.left_id, pair.right_id]));
		const known = correctRight.size > 0;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<QuizResultBanner runId={run.id} result={reveal} answered={answered} standing={resolveStanding(reveal, standing)} participantCount={quiz?.participant_count} />
				<section className="flex flex-col gap-2" aria-label="Pairs">
					<ResultHeading>{stored.length > 0 ? "Your matches" : "Correct matches"}</ResultHeading>
					<ul className="m-0 flex list-none flex-col gap-2 p-0">
						{lefts.map((left) => {
							const chosen = mine.get(left.id);
							const right = correctRight.get(left.id);
							const ok = chosen !== undefined && chosen === right;
							const shown = stored.length > 0 ? chosen : right;
							// An unmatched item scores nothing, so it reads as wrong.
							const tone = !known ? "neutral" : stored.length === 0 ? "correct" : ok ? "correct" : "wrong";
							return (
								<ResultRow
									key={left.id}
									tone={tone}
									imageUrl={left.image_url}
									label={
										<>
											{labelOf.get(left.id)} <span aria-hidden>→</span>
											<span className="sr-only"> matched with </span> {shown ? labelOf.get(shown) : "not matched"}
										</>
									}
									note={known && stored.length > 0 && !ok && right ? `Correct: ${labelOf.get(right)}` : undefined}
								/>
							);
						})}
					</ul>
				</section>
			</ParticipantLayout>
		);
	}

	if (phase === "locked_in") {
		if (stored.length === 0) return <FirstAnswerLockedIn theme={theme} title={title} />;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<LockedIn>
					<AnswerSummary label="Your matches">
						<ul className="m-0 flex list-none flex-col gap-1.5 p-0">
							{stored.map((pair) => (
								<li key={pair.left_id} className="break-words font-semibold">
									{labelOf.get(pair.left_id)} → {labelOf.get(pair.right_id)}
								</li>
							))}
						</ul>
					</AnswerSummary>
				</LockedIn>
			</ParticipantLayout>
		);
	}

	return (
		<MatchBoard
			key={run.id}
			lefts={lefts}
			rights={rights}
			labelOf={labelOf}
			title={title}
			theme={theme}
			answering={phase === "answering"}
			disabled={disabled}
			busy={answer.busy}
			error={answer.fieldError}
			points={<PointsBar scoring={scoring ?? runScoring(run)} votingStartedAt={run.voting_started_at} active={phase === "answering"} />}
			onSend={(pairs) => void answer.submit({ pairs }, { pairs })}
		/>
	);
}

function MatchBoard({
	lefts,
	rights,
	labelOf,
	title,
	theme,
	answering,
	disabled,
	busy,
	error,
	points,
	onSend,
}: {
	lefts: Cell[];
	rights: Cell[];
	labelOf: Map<OpaqueOptionId, string>;
	title: string;
	theme: ParticipantProps<"match_pairs">["theme"];
	answering: boolean;
	disabled: boolean;
	busy: boolean;
	error: string | null;
	points: ReactNode;
	onSend: (pairs: MatchPairConnection[]) => void;
}) {
	// left id → right id
	const [links, setLinks] = useState<Map<OpaqueOptionId, OpaqueOptionId>>(() => new Map());
	const [selection, setSelection] = useState<Selection>(null);
	const [announcement, setAnnouncement] = useState("");
	const [lines, setLines] = useState<Line[]>([]);
	const boardRef = useRef<HTMLDivElement>(null);
	const cellRefs = useRef(new Map<OpaqueOptionId, HTMLButtonElement>());
	const locked = !answering || disabled || busy;

	const leftIndex = new Map(lefts.map((cell, index) => [cell.id, index]));
	const rightOwner = new Map([...links].map(([left, right]) => [right, left]));
	const colorFor = (left: OpaqueOptionId) => chartColor(theme, leftIndex.get(left) ?? 0);

	// Redraw the connection lines from the cells' boxes (after layout, on resize).
	const leftKey = lefts.map((cell) => cell.id).join(",");
	const measure = useCallback(() => {
		const board = boardRef.current;
		if (!board) return;
		const box = board.getBoundingClientRect();
		const order = leftKey.split(",");
		const next: Line[] = [];
		for (const [left, right] of links) {
			const a = cellRefs.current.get(left)?.getBoundingClientRect();
			const b = cellRefs.current.get(right)?.getBoundingClientRect();
			if (!a || !b) continue;
			next.push({
				key: `${left}-${right}`,
				x1: Math.round(a.right - box.left),
				y1: Math.round(a.top + a.height / 2 - box.top),
				x2: Math.round(b.left - box.left),
				y2: Math.round(b.top + b.height / 2 - box.top),
				color: chartColor(theme, Math.max(0, order.indexOf(left))),
			});
		}
		setLines((previous) =>
			previous.length === next.length &&
			previous.every((line, i) => line.key === next[i].key && line.x1 === next[i].x1 && line.y1 === next[i].y1 && line.x2 === next[i].x2 && line.y2 === next[i].y2 && line.color === next[i].color)
				? previous
				: next
		);
	}, [links, theme, leftKey]);

	useLayoutEffect(() => {
		measure();
		const board = boardRef.current;
		if (!board || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(board);
		return () => observer.disconnect();
	}, [measure]);

	const connect = (left: OpaqueOptionId, right: OpaqueOptionId) => {
		setLinks((previous) => {
			const next = new Map(previous);
			for (const [l, r] of next) if (r === right) next.delete(l);
			next.set(left, right);
			return next;
		});
		setSelection(null);
		haptic("select");
		setAnnouncement(`${labelOf.get(left)} matched with ${labelOf.get(right)}.`);
	};

	const tap = (side: "left" | "right", id: OpaqueOptionId) => {
		if (locked) return;
		if (selection && selection.side !== side) {
			if (side === "right") connect(selection.id, id);
			else connect(id, selection.id);
			return;
		}
		if (selection && selection.id === id) {
			setSelection(null);
			return;
		}
		// Tapping a connected cell with nothing selected undoes its connection and selects it to re-pair.
		const linkedLeft = side === "left" ? (links.has(id) ? id : null) : (rightOwner.get(id) ?? null);
		if (linkedLeft !== null) {
			setLinks((previous) => {
				const next = new Map(previous);
				next.delete(linkedLeft);
				return next;
			});
			setAnnouncement(`${labelOf.get(id)} unmatched. Tap a cell on the other side to match it.`);
		}
		setSelection({ side, id });
		haptic("tap");
	};

	const pairs: MatchPairConnection[] = lefts.filter((cell) => links.has(cell.id)).map((cell) => ({ left_id: cell.id, right_id: links.get(cell.id)! }));

	const renderCell = (cell: Cell, side: "left" | "right") => {
		const owner = side === "left" ? (links.has(cell.id) ? cell.id : null) : (rightOwner.get(cell.id) ?? null);
		const selected = selection?.id === cell.id;
		const color = owner !== null ? colorFor(owner) : null;
		const partner = owner === null ? null : side === "left" ? links.get(cell.id) : owner;
		return (
			<button
				key={cell.id}
				type="button"
				ref={(node) => {
					if (node) cellRefs.current.set(cell.id, node);
					else cellRefs.current.delete(cell.id);
				}}
				onClick={() => tap(side, cell.id)}
				disabled={locked}
				aria-pressed={selected}
				aria-label={`${labelOf.get(cell.id)}${partner ? `, matched with ${labelOf.get(partner)}` : ", not matched"}`}
				className={cn(
					"flex min-h-14 w-full touch-manipulation items-center gap-2 rounded-xl border-2 px-2.5 py-2 text-left transition motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
					FOCUS_RING
				)}
				style={{
					borderColor: selected ? "var(--deck-primary, #F79945)" : (color ?? "var(--deck-border, #E5E7EB)"),
					background: selected
						? "color-mix(in srgb, var(--deck-primary, #F79945) 16%, var(--deck-surface, #fff))"
						: color
							? `color-mix(in srgb, ${color} 10%, var(--deck-surface, #fff))`
							: "var(--deck-surface, #fff)",
					color: "var(--deck-text, #111928)",
					borderStyle: selected ? "solid" : undefined,
				}}
			>
				{cell.image_url ? <img src={cell.image_url} alt="" draggable={false} className="h-10 w-10 shrink-0 rounded-md object-cover" /> : null}
				<span className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug">{labelOf.get(cell.id)}</span>
				{color ? <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} /> : null}
			</button>
		);
	};

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle="Tap an item, then tap its match. Tap a matched item to change it."
			footer={
				<SubmitBar
					label="Submit"
					onClick={() => pairs.length > 0 && onSend(pairs)}
					loading={busy}
					disabled={!answering || disabled || pairs.length === 0}
					hint={`${pairs.length} of ${lefts.length} matched${pairs.length > 0 && pairs.length < lefts.length ? " · unmatched items score nothing" : ""}`}
					error={error}
				/>
			}
		>
			{points}
			{!answering ? <ParticipantNotice>The question opens when the host starts it.</ParticipantNotice> : null}
			<div ref={boardRef} className="relative grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-8 gap-y-2">
				<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
					{lines.map((line) => (
						<g key={line.key}>
							<line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={line.color} strokeWidth={4} strokeLinecap="round" />
							<circle cx={line.x1} cy={line.y1} r={5} fill={line.color} />
							<circle cx={line.x2} cy={line.y2} r={5} fill={line.color} />
						</g>
					))}
				</svg>
				<div role="group" aria-label="Items" className="flex flex-col gap-2">
					{lefts.map((cell) => renderCell(cell, "left"))}
				</div>
				<div role="group" aria-label="Matches" className="flex flex-col gap-2">
					{rights.map((cell) => renderCell(cell, "right"))}
				</div>
			</div>
			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>
		</ParticipantLayout>
	);
}
