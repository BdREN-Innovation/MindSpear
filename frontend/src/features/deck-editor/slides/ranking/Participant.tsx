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
import type { RunOption } from "@/features/deck/types";
import type { ParticipantProps } from "../types";
import { SubmitBar, SubmittedState, haptic, useSubmit } from "../shared";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, notVotingMessage, numberedLabel, useAnswerHistory } from "../pollSingle/common";

// ranking on the phone (plan §7.3): drag the handle to reorder (mouse,
// touch, or keyboard: Space, arrows, Space), or tap an item for Move up /
// Move down buttons (a single-tap alternative to dragging). With
// require_full_ranking off, items can be left out ("Not ranked") and the
// answer is the ranked top-k prefix. Submit sends {order: [ids best first]}.

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

export function RankingParticipant({ run, mySubmission, onSubmit, disabled, theme, mode }: ParticipantProps<"ranking">) {
	const review = mode === "review";
	const requireFull = run.config.require_full_ranking !== false;
	const ids = run.options.map((option) => option.id);
	const byId = new Map(run.options.map((option, index) => [option.id, { option, index }]));
	const labelOf = (id: UniqueIdentifier) => {
		const match = byId.get(Number(id));
		return match ? numberedLabel(match.option, match.index, "Item") : "Item";
	};

	const { submit, busy, errorMessage, reset } = useSubmit(onSubmit);
	const { latest, record } = useAnswerHistory(run.id, mySubmission);
	const [editing, setEditing] = useState(false);
	const [rawLists, setLists] = useState<Lists>(() => ({ ranked: ids, unranked: [] }));
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const [announcement, setAnnouncement] = useState("");

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		// The handle has touch-action: none, so a short move starts the drag without fighting page scroll.
		useSensor(TouchSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);

	const answeredOrder = Array.isArray(latest?.order) ? latest.order.filter((id) => byId.has(id)) : [];
	const hasAnswer = answeredOrder.length > 0;
	const locked = disabled || review;
	const title = run.title;

	if (review || (hasAnswer && !editing)) {
		const left = ids.filter((id) => !answeredOrder.includes(id));
		return (
			<ParticipantLayout theme={theme} title={title} fallbackTitle="Ranking">
				{!hasAnswer ? (
					<ParticipantNotice>You didn&apos;t rank this slide.</ParticipantNotice>
				) : (
					<SubmittedState
						title="Thanks, your ranking is in"
						message={review ? null : "Waiting for the host to continue."}
						onEdit={
							locked
								? undefined
								: () => {
										reset();
										setLists(settle({ ranked: answeredOrder, unranked: left }, ids, requireFull));
										setExpandedId(null);
										setEditing(true);
									}
						}
						editLabel="Change ranking"
						className="px-0 py-6"
					>
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
					</SubmittedState>
				)}
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
		haptic(10);
		setLists({ ranked: arrayMove(ranked, from, to), unranked });
		setAnnouncement(`${labelOf(id)} moved to position ${to + 1} of ${ranked.length}.`);
	};

	const leaveOut = (id: number) => {
		setLists({ ranked: ranked.filter((other) => other !== id), unranked: [...unranked, id] });
		setExpandedId(null);
		setAnnouncement(`${labelOf(id)} left out of your ranking.`);
	};

	const addBack = (id: number) => {
		haptic(10);
		setLists({ ranked: [...ranked, id], unranked: unranked.filter((other) => other !== id) });
		setAnnouncement(`${labelOf(id)} added at position ${ranked.length + 1}.`);
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const from = ranked.indexOf(Number(active.id));
		const to = ranked.indexOf(Number(over.id));
		if (from < 0 || to < 0) return;
		haptic(10);
		setLists({ ranked: arrayMove(ranked, from, to), unranked });
	};

	const send = () => {
		if (!canSubmit) return;
		const order = ranked.slice();
		void submit({ order }).then((ok) => {
			if (ok) {
				record({ order });
				setEditing(false);
			}
		});
	};

	const positionOf = (id: UniqueIdentifier) => ranked.indexOf(Number(id)) + 1;

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			fallbackTitle="Ranking"
			subtitle="Put your favourite at the top: drag the handle, or tap an item to move it."
			footer={
				<SubmitBar
					label={hasAnswer ? "Update ranking" : "Submit ranking"}
					onClick={send}
					loading={busy}
					disabled={disabled || !canSubmit}
					hint={requireFull ? "Rank every item, best first." : `${ranked.length} of ${ids.length} ranked`}
					error={errorMessage}
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
					Keep my ranking
				</button>
			) : null}
		</ParticipantLayout>
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
