/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import {
	DndContext,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
	type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { cn } from "@/lib/utils";
import type { RankingAggregate, RunOption } from "@/features/deck/types";
import type { ParticipantProps } from "../types";
import { SubmitBar, SubmittedState, haptic } from "../shared";
import { useAnswer } from "../shared/answer";
import { displayTitle, numberedLabel } from "../shared/labels";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, ResultsSection, countLabel, isReadOnlyView, notVotingMessage, resultsTitle } from "../shared/participantKit";

// ranking on the phone (plan §7.3): drag the handle to reorder (mouse,
// touch, or keyboard: Space, arrows, Space), or tap an item for Move up /
// Move down buttons (a single-tap alternative to dragging). With
// require_full_ranking off, items can be left out ("Not ranked") and the
// answer is the ranked top-k prefix. Submit sends {order: [ids best first]}.
// Public results (aggregate passed) show the overall ranking in every view.

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

interface Lists {
	ranked: number[];
	unranked: number[];
}

/** Valid, complete lists for these options: unknown ids dropped, missing ids appended to the ranking. */
function settle(lists: Lists, ids: number[], requireFull: boolean): Lists {
	const valid = new Set(ids);
	const ranked = lists.ranked.filter((id, index, all) => valid.has(id) && all.indexOf(id) === index);
	const unranked = lists.unranked.filter((id, index, all) => valid.has(id) && !ranked.includes(id) && all.indexOf(id) === index);
	const missing = ids.filter((id) => !ranked.includes(id) && !unranked.includes(id));
	return requireFull ? { ranked: [...ranked, ...unranked, ...missing], unranked: [] } : { ranked: [...ranked, ...missing], unranked };
}

export function RankingParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode }: ParticipantProps<"ranking">) {
	const review = mode === "review";
	const readOnly = isReadOnlyView(mode, run.state);
	const requireFull = run.config.require_full_ranking !== false;
	const ids = run.options.map((option) => option.id);
	const byId = new Map(run.options.map((option, index) => [option.id, { option, index }]));
	const labelOf = (id: UniqueIdentifier) => {
		const match = byId.get(Number(id));
		return match ? numberedLabel(match.option, match.index, "Item") : "Item";
	};

	const answer = useAnswer(run.id, mySubmission, onSubmit);
	const { busy } = answer;
	const [rawLists, setLists] = useState<Lists>(() => ({ ranked: ids, unranked: [] }));
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const [announcement, setAnnouncement] = useState("");

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		// The handle has touch-action: none, so a short move starts the drag without fighting page scroll.
		useSensor(TouchSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);

	const answeredOrder = Array.isArray(answer.latest?.order) ? answer.latest.order.filter((id) => byId.has(id)) : [];
	const hasAnswer = answeredOrder.length > 0;
	const title = displayTitle(run.title, "ranking");
	const left = ids.filter((id) => !answeredOrder.includes(id));
	const results = aggregate ? (
		<OverallRanking aggregate={aggregate} labelOf={labelOf} mine={answeredOrder} title={resultsTitle(mode, run.state)} />
	) : null;

	const summary = (
		<AnswerSummary label="Your ranking">
			<ol className="m-0 flex list-none flex-col gap-2 p-0">
				{answeredOrder.map((id, index) => (
					<li key={id} className="flex items-start gap-3">
						<RankBadge position={index + 1} />
						<span className="min-w-0 break-words pt-0.5 font-semibold">{labelOf(id)}</span>
					</li>
				))}
			</ol>
			{left.length > 0 ? (
				<p className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					Not ranked: {left.map((id) => labelOf(id)).join(", ")}
				</p>
			) : null}
		</AnswerSummary>
	);

	if (readOnly) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				{hasAnswer ? summary : review ? <ParticipantNotice>You didn&apos;t rank this slide.</ParticipantNotice> : null}
				{results}
			</ParticipantLayout>
		);
	}

	if (hasAnswer && !answer.editing) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				<SubmittedState
					title="Thanks, your ranking is in"
					onEdit={
						disabled
							? undefined
							: () => {
									setLists(settle({ ranked: answeredOrder, unranked: left }, ids, requireFull));
									setExpandedId(null);
									answer.edit();
								}
					}
					editLabel="Change ranking"
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

	const lists = settle(rawLists, ids, requireFull);
	const { ranked, unranked } = lists;
	const lockedMessage = disabled ? notVotingMessage(run.state) : null;
	const canSubmit = ranked.length > 0 && (!requireFull || ranked.length === ids.length);

	const move = (id: number, delta: number) => {
		const from = ranked.indexOf(id);
		const to = from + delta;
		if (from < 0 || to < 0 || to >= ranked.length) return;
		haptic("select");
		setLists({ ranked: arrayMove(ranked, from, to), unranked });
		setAnnouncement(`${labelOf(id)} moved to position ${to + 1} of ${ranked.length}.`);
	};

	const leaveOut = (id: number) => {
		setLists({ ranked: ranked.filter((other) => other !== id), unranked: [...unranked, id] });
		setExpandedId(null);
		setAnnouncement(`${labelOf(id)} left out of your ranking.`);
	};

	const addBack = (id: number) => {
		haptic("select");
		setLists({ ranked: [...ranked, id], unranked: unranked.filter((other) => other !== id) });
		setAnnouncement(`${labelOf(id)} added at position ${ranked.length + 1}.`);
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const from = ranked.indexOf(Number(active.id));
		const to = ranked.indexOf(Number(over.id));
		if (from < 0 || to < 0) return;
		haptic("select");
		setLists({ ranked: arrayMove(ranked, from, to), unranked });
	};

	const send = () => {
		if (!canSubmit) return;
		const order = ranked.slice();
		void answer.submit({ order }, { order });
	};

	const positionOf = (id: UniqueIdentifier) => ranked.indexOf(Number(id)) + 1;

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle="Put your favourite at the top: drag the handle, or tap an item to move it."
			footer={
				<SubmitBar
					label={hasAnswer ? "Update ranking" : "Submit ranking"}
					onClick={send}
					loading={busy}
					disabled={disabled || !canSubmit}
					hint={requireFull ? "Rank every item, best first." : `${ranked.length} of ${ids.length} ranked`}
					error={answer.fieldError}
				/>
			}
		>
			{lockedMessage ? <ParticipantNotice>{lockedMessage}</ParticipantNotice> : null}

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[restrictToVerticalAxis, restrictToParentElement]}
				onDragStart={() => setExpandedId(null)}
				onDragEnd={onDragEnd}
				accessibility={{
					screenReaderInstructions: {
						draggable: "To move an item, press Space on its handle, use the arrow keys, then press Space to drop it or Escape to cancel.",
					},
					announcements: {
						onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}, position ${positionOf(active.id)} of ${ranked.length}.`,
						onDragOver: ({ active, over }) =>
							over ? `${labelOf(active.id)} is over position ${positionOf(over.id)}.` : `${labelOf(active.id)} is not over a position.`,
						onDragEnd: ({ active, over }) =>
							over ? `${labelOf(active.id)} dropped at position ${positionOf(over.id)}.` : `${labelOf(active.id)} dropped.`,
						onDragCancel: ({ active }) => `Move cancelled. ${labelOf(active.id)} stays at position ${positionOf(active.id)}.`,
					},
				}}
			>
				<SortableContext items={ranked} strategy={verticalListSortingStrategy}>
					<ol aria-label="Your ranking, best first" className="m-0 flex list-none flex-col gap-2 p-0">
						{ranked.map((id, index) => {
							const match = byId.get(id);
							if (!match) return null;
							return (
								<SortableItem
									key={id}
									id={id}
									position={index + 1}
									option={match.option}
									label={labelOf(id)}
									disabled={disabled || busy}
									expanded={expandedId === id}
									onToggle={() => setExpandedId(expandedId === id ? null : id)}
									onMove={(delta) => move(id, delta)}
									canUp={index > 0}
									canDown={index < ranked.length - 1}
									onLeaveOut={requireFull ? undefined : () => leaveOut(id)}
								/>
							);
						})}
					</ol>
				</SortableContext>
			</DndContext>

			{!requireFull && ranked.length === 0 ? <ParticipantNotice>Add at least one item to your ranking.</ParticipantNotice> : null}

			{!requireFull && unranked.length > 0 ? (
				<section aria-label="Not ranked" className="flex flex-col gap-2">
					<h3 className="m-0 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						Not ranked
					</h3>
					<ul className="m-0 flex list-none flex-col gap-2 p-0">
						{unranked.map((id) => (
							<li key={id}>
								<button
									type="button"
									onClick={() => addBack(id)}
									disabled={disabled || busy}
									className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl border-2 border-dashed px-3 text-left disabled:opacity-60", FOCUS_RING)}
									style={{ borderColor: "var(--deck-border, #E5E7EB)", color: "var(--deck-text, #111928)" }}
								>
									<Plus className="h-5 w-5 shrink-0" aria-hidden />
									<span className="min-w-0 flex-1 break-words font-semibold">{labelOf(id)}</span>
									<span className="sr-only">, add to your ranking</span>
								</button>
							</li>
						))}
					</ul>
				</section>
			) : null}

			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>

			{answer.editing ? (
				<button
					type="button"
					onClick={answer.cancelEdit}
					disabled={busy}
					className={cn("min-h-11 self-center rounded-lg px-4 text-sm font-semibold underline-offset-4 hover:underline", FOCUS_RING)}
					style={{ color: "var(--deck-text-muted, #4B5563)" }}
				>
					Keep my ranking
				</button>
			) : null}

			{results}
		</ParticipantLayout>
	);
}

/** Everyone's ranking: the aggregate order (ties share a rank) with the average position. */
function OverallRanking({
	aggregate,
	labelOf,
	mine,
	title,
}: {
	aggregate: RankingAggregate;
	labelOf: (id: UniqueIdentifier) => string;
	mine: number[];
	title: string;
}) {
	const hasResults = aggregate.total_responses > 0;
	return (
		<ResultsSection title={title} summary={countLabel(aggregate.total_responses, "response", "responses")}>
			{hasResults ? (
				<ol aria-label="Overall ranking, best first" className="m-0 flex list-none flex-col gap-2 p-0">
					{aggregate.items.map((item) => {
						const yours = mine.indexOf(item.option_id);
						return (
							<li key={item.option_id} className="flex items-center gap-3 text-sm">
								<RankBadge position={item.rank ?? 0} />
								<span className="min-w-0 flex-1 break-words font-semibold">
									{labelOf(item.option_id)}
									{yours >= 0 ? (
										<span className="ml-1.5 text-xs font-normal" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
											you: #{yours + 1}
										</span>
									) : null}
								</span>
								<span className="shrink-0 tabular-nums" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
									{item.average_position !== null ? `avg ${item.average_position.toFixed(1)}` : "–"}
								</span>
							</li>
						);
					})}
				</ol>
			) : (
				<p className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					No rankings yet.
				</p>
			)}
		</ResultsSection>
	);
}

function RankBadge({ position }: { position: number }) {
	return (
		<span
			aria-hidden
			className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums"
			style={{
				background: position <= 3 ? "var(--deck-primary, #F79945)" : "var(--deck-surface-muted, #F3F4F6)",
				color: position <= 3 ? "var(--deck-on-primary, #111928)" : "var(--deck-text-muted, #4B5563)",
			}}
		>
			{position}
		</span>
	);
}

function SortableItem({
	id,
	position,
	option,
	label,
	disabled,
	expanded,
	onToggle,
	onMove,
	canUp,
	canDown,
	onLeaveOut,
}: {
	id: number;
	position: number;
	option: RunOption;
	label: string;
	disabled: boolean;
	expanded: boolean;
	onToggle: () => void;
	onMove: (delta: number) => void;
	canUp: boolean;
	canDown: boolean;
	onLeaveOut?: () => void;
}) {
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });

	return (
		<li
			ref={setNodeRef}
			className={cn("flex flex-col rounded-xl border-2", isDragging && "shadow-lg")}
			style={{
				transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
				transition,
				position: "relative",
				zIndex: isDragging ? 10 : undefined,
				borderColor: isDragging || expanded ? "var(--deck-primary, #F79945)" : "var(--deck-border, #E5E7EB)",
				background: "var(--deck-surface, #fff)",
				color: "var(--deck-text, #111928)",
			}}
		>
			<div className="flex items-center gap-2 py-1 pl-3 pr-1">
				<RankBadge position={position} />
				<button
					type="button"
					onClick={onToggle}
					disabled={disabled}
					aria-expanded={expanded}
					className={cn("flex min-h-12 min-w-0 flex-1 touch-manipulation items-center gap-3 rounded-lg text-left disabled:cursor-not-allowed", FOCUS_RING)}
				>
					{option.image_url ? <img src={option.image_url} alt="" draggable={false} className="h-10 w-10 shrink-0 rounded-md object-cover" /> : null}
					<span className="min-w-0 break-words text-base font-semibold leading-snug">{label}</span>
					<span className="sr-only">, position {position}. Show move buttons.</span>
				</button>
				<button
					type="button"
					ref={setActivatorNodeRef}
					{...attributes}
					{...listeners}
					disabled={disabled}
					aria-label={`Drag ${label}, position ${position}`}
					className={cn(
						"flex h-12 w-12 shrink-0 touch-none items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-50",
						isDragging ? "cursor-grabbing" : "cursor-grab",
						FOCUS_RING
					)}
					style={{ color: "var(--deck-text-muted, #4B5563)" }}
				>
					<GripVertical className="h-6 w-6" aria-hidden />
				</button>
			</div>
			{expanded ? (
				<div className="flex flex-wrap gap-2 border-t px-3 py-2" style={{ borderColor: "var(--deck-border, #E5E7EB)" }}>
					<ActionButton onClick={() => onMove(-1)} disabled={disabled || !canUp} icon={<ArrowUp className="h-4 w-4" aria-hidden />}>
						Move up
					</ActionButton>
					<ActionButton onClick={() => onMove(1)} disabled={disabled || !canDown} icon={<ArrowDown className="h-4 w-4" aria-hidden />}>
						Move down
					</ActionButton>
					{onLeaveOut ? (
						<ActionButton onClick={onLeaveOut} disabled={disabled} icon={<X className="h-4 w-4" aria-hidden />}>
							Leave out
						</ActionButton>
					) : null}
				</div>
			) : null}
		</li>
	);
}

function ActionButton({ onClick, disabled, icon, children }: { onClick: () => void; disabled?: boolean; icon: ReactNode; children: ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn("flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40", FOCUS_RING)}
			style={{ borderColor: "var(--deck-border, #E5E7EB)", background: "var(--deck-surface-muted, #F3F4F6)", color: "var(--deck-text, #111928)" }}
		>
			{icon}
			{children}
		</button>
	);
}
