/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
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
import { runScoring } from "@/features/deck/lib/quiz";
import type { OpaqueOptionId, RunOption } from "@/features/deck/types";
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

// correct_order on the phone: the server-shuffled items as a sortable list,
// in exactly the run view's order (the server may shuffle per participant;
// until the player moves something, a fresher view's order wins). Drag the
// handle (mouse, touch, or keyboard: Space, arrows, Space), or tap an item for
// Move up / Move down. Submit sends {order: [every id, top first]} with the
// run's opaque ids. Final once sent.

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

type Item = RunOption<OpaqueOptionId, Record<never, never>>;

export function CorrectOrderParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode, scoring, reveal, standing, quiz }: ParticipantProps<"correct_order">) {
	const answer = useQuizAnswer(run.id, mySubmission, onSubmit);
	const items = run.options as Item[];
	const byId = new Map(items.map((item, index) => [item.id, { item, label: numberedLabel(item, index, "Item") }]));
	const labelOf = (id: UniqueIdentifier) => byId.get(String(id))?.label ?? "Item";

	const sentOrder = Array.isArray(answer.latest?.order) ? answer.latest.order : [];
	const stored = sentOrder.filter((id) => byId.has(id));
	const answered = stored.length > 0 || answer.alreadyAnswered;
	const phase = quizPhase(run.state, mode, answered);
	const title = quizDisplayTitle(run.title, "correct_order");

	if (phase !== "result" && optionsHidden(run)) {
		return sentOrder.length > 0 || answer.alreadyAnswered ? <FirstAnswerLockedIn theme={theme} title={title} /> : <OptionsHiddenView theme={theme} title={title} state={run.state} />;
	}

	if (phase === "result") {
		const correct = reveal?.correct_answer?.order ?? aggregate?.correct?.order ?? [];
		const known = correct.length > 0;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<QuizResultBanner runId={run.id} result={reveal} answered={answered} standing={resolveStanding(reveal, standing)} participantCount={quiz?.participant_count} />
				{stored.length > 0 ? (
					<section className="flex flex-col gap-2" aria-label="Your order">
						<ResultHeading>Your order</ResultHeading>
						<ol className="m-0 flex list-none flex-col gap-2 p-0">
							{stored.map((id, index) => {
								const ok = correct[index] === id;
								const place = correct.indexOf(id);
								return (
									<ResultRow
										key={id}
										tone={!known ? "neutral" : ok ? "correct" : "wrong"}
										imageUrl={byId.get(id)?.item.image_url}
										label={`${index + 1}. ${labelOf(id)}`}
										note={known && !ok && place >= 0 ? `Belongs at #${place + 1}` : undefined}
									/>
								);
							})}
						</ol>
					</section>
				) : null}
				{known && (reveal?.is_correct !== true || stored.length === 0) ? (
					<section className="flex flex-col gap-2" aria-label="Correct order">
						<ResultHeading>Correct order</ResultHeading>
						<ol className="m-0 flex list-none flex-col gap-2 p-0">
							{correct.map((id, index) => (
								<ResultRow key={id} tone="correct" imageUrl={byId.get(id)?.item.image_url} label={`${index + 1}. ${labelOf(id)}`} />
							))}
						</ol>
					</section>
				) : null}
			</ParticipantLayout>
		);
	}

	if (phase === "locked_in") {
		if (stored.length === 0) return <FirstAnswerLockedIn theme={theme} title={title} />;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<LockedIn>
					<AnswerSummary label="Your order">
						<ol className="m-0 flex list-none flex-col gap-1.5 p-0">
							{stored.map((id, index) => (
								<li key={id} className="break-words font-semibold">
									{index + 1}. {labelOf(id)}
								</li>
							))}
						</ol>
					</AnswerSummary>
				</LockedIn>
			</ParticipantLayout>
		);
	}

	return (
		<OrderBoard
			key={run.id}
			ids={items.map((item) => item.id)}
			byId={byId}
			labelOf={labelOf}
			title={title}
			theme={theme}
			answering={phase === "answering"}
			disabled={disabled}
			busy={answer.busy}
			error={answer.fieldError}
			points={<PointsBar scoring={scoring ?? runScoring(run)} votingStartedAt={run.voting_started_at} active={phase === "answering"} />}
			onSend={(order) => void answer.submit({ order }, { order })}
		/>
	);
}

function OrderBoard({
	ids,
	byId,
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
	ids: OpaqueOptionId[];
	byId: Map<OpaqueOptionId, { item: Item; label: string }>;
	labelOf: (id: UniqueIdentifier) => string;
	title: string;
	theme: ParticipantProps<"correct_order">["theme"];
	answering: boolean;
	disabled: boolean;
	busy: boolean;
	error: string | null;
	points: ReactNode;
	onSend: (order: OpaqueOptionId[]) => void;
}) {
	// null until the player moves something: the run view's order as given.
	const [moved, setOrder] = useState<OpaqueOptionId[] | null>(null);
	const [expandedId, setExpandedId] = useState<OpaqueOptionId | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const rawOrder = moved ?? ids;
	// Every item exactly once, even if the options changed under us.
	const order = [...rawOrder.filter((id, index, all) => byId.has(id) && all.indexOf(id) === index), ...ids.filter((id) => !rawOrder.includes(id))];
	const locked = !answering || disabled || busy;

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		// The handle has touch-action: none, so a short move starts the drag without fighting page scroll.
		useSensor(TouchSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);

	const move = (id: OpaqueOptionId, delta: number) => {
		const from = order.indexOf(id);
		const to = from + delta;
		if (from < 0 || to < 0 || to >= order.length) return;
		haptic("select");
		setOrder(arrayMove(order, from, to));
		setAnnouncement(`${labelOf(id)} moved to position ${to + 1} of ${order.length}.`);
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const from = order.indexOf(String(active.id));
		const to = order.indexOf(String(over.id));
		if (from < 0 || to < 0) return;
		haptic("select");
		setOrder(arrayMove(order, from, to));
	};
	const positionOf = (id: UniqueIdentifier) => order.indexOf(String(id)) + 1;

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle="Put the items in the correct order: drag the handle, or tap an item to move it."
			footer={<SubmitBar label="Submit order" onClick={() => onSend(order.slice())} loading={busy} disabled={!answering || disabled} hint="First at the top." error={error} />}
		>
			{points}
			{!answering ? <ParticipantNotice>The question opens when the host starts it.</ParticipantNotice> : null}
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
						onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}, position ${positionOf(active.id)} of ${order.length}.`,
						onDragOver: ({ active, over }) => (over ? `${labelOf(active.id)} is over position ${positionOf(over.id)}.` : `${labelOf(active.id)} is not over a position.`),
						onDragEnd: ({ active, over }) => (over ? `${labelOf(active.id)} dropped at position ${positionOf(over.id)}.` : `${labelOf(active.id)} dropped.`),
						onDragCancel: ({ active }) => `Move cancelled. ${labelOf(active.id)} stays at position ${positionOf(active.id)}.`,
					},
				}}
			>
				<SortableContext items={order} strategy={verticalListSortingStrategy}>
					<ol aria-label="Your order, first at the top" className="m-0 flex list-none flex-col gap-2 p-0">
						{order.map((id, index) => (
							<SortableRow
								key={id}
								id={id}
								position={index + 1}
								item={byId.get(id)!.item}
								label={labelOf(id)}
								disabled={locked}
								expanded={expandedId === id}
								onToggle={() => setExpandedId(expandedId === id ? null : id)}
								onMove={(delta) => move(id, delta)}
								canUp={index > 0}
								canDown={index < order.length - 1}
							/>
						))}
					</ol>
				</SortableContext>
			</DndContext>
			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>
		</ParticipantLayout>
	);
}

function SortableRow({
	id,
	position,
	item,
	label,
	disabled,
	expanded,
	onToggle,
	onMove,
	canUp,
	canDown,
}: {
	id: OpaqueOptionId;
	position: number;
	item: Item;
	label: string;
	disabled: boolean;
	expanded: boolean;
	onToggle: () => void;
	onMove: (delta: number) => void;
	canUp: boolean;
	canDown: boolean;
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
				<span
					aria-hidden
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums"
					style={{ background: "var(--deck-surface-muted, #F3F4F6)", color: "var(--deck-text-muted, #4B5563)" }}
				>
					{position}
				</span>
				<button
					type="button"
					onClick={onToggle}
					disabled={disabled}
					aria-expanded={expanded}
					className={cn("flex min-h-12 min-w-0 flex-1 touch-manipulation items-center gap-3 rounded-lg text-left disabled:cursor-not-allowed", FOCUS_RING)}
				>
					{item.image_url ? <img src={item.image_url} alt="" draggable={false} className="h-10 w-10 shrink-0 rounded-md object-cover" /> : null}
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
				<div className="flex gap-2 border-t px-3 py-2" style={{ borderColor: "var(--deck-border, #E5E7EB)" }}>
					<MoveButton onClick={() => onMove(-1)} disabled={disabled || !canUp} icon={<ArrowUp className="h-4 w-4" aria-hidden />} ariaLabel={`Move up: ${label}, now at position ${position}`}>
						Move up
					</MoveButton>
					<MoveButton onClick={() => onMove(1)} disabled={disabled || !canDown} icon={<ArrowDown className="h-4 w-4" aria-hidden />} ariaLabel={`Move down: ${label}, now at position ${position}`}>
						Move down
					</MoveButton>
				</div>
			) : null}
		</li>
	);
}

/** `ariaLabel` starts with the visible text ("Move up: Paris, …") so voice control still matches it. */
function MoveButton({ onClick, disabled, icon, ariaLabel, children }: { onClick: () => void; disabled?: boolean; icon: ReactNode; ariaLabel: string; children: ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={ariaLabel}
			className={cn("flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40", FOCUS_RING)}
			style={{ borderColor: "var(--deck-border, #E5E7EB)", background: "var(--deck-surface-muted, #F3F4F6)", color: "var(--deck-text, #111928)" }}
		>
			{icon}
			{children}
		</button>
	);
}
