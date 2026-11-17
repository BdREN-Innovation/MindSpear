/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useState, type ReactNode } from "react";
import { Undo2 } from "lucide-react";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { chartColor, type DeckTheme } from "@/features/deck/theme";
import { runScoring } from "@/features/deck/lib/quiz";
import type { CategorisePlacement, OpaqueOptionId, QuizCategory, RunOption } from "@/features/deck/types";
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
import { categoryName } from "./labels";

// categorise on the phone (plan §3.2): the shuffled items in a pool on top,
// the categories as buckets below (stacked on a phone). Drag an item into a
// bucket, or tap an item and then tap a bucket (the keyboard / no-drag path).
// Items keep exactly the run view's order (the server may shuffle per player).
// Tap a placed item to move it or put it back. Submit sends
// {placements: [{item_id, category_key}]} for the placed items (unplaced ones
// count as wrong). Final once sent.

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

type Item = RunOption<OpaqueOptionId, Record<never, never>>;

export function CategoriseParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode, scoring, reveal, standing, quiz }: ParticipantProps<"categorise">) {
	const answer = useQuizAnswer(run.id, mySubmission, onSubmit);
	const items = run.options as Item[];
	const categories = run.config.categories ?? [];
	const labelOf = new Map(items.map((item, index) => [item.id, numberedLabel(item, index, "Item")]));
	const itemOf = new Map(items.map((item) => [item.id, item]));
	const nameOf = new Map(categories.map((category, index) => [category.key, categoryName(category, index)]));

	const sent = Array.isArray(answer.latest?.placements) ? answer.latest.placements : [];
	const stored = sent.filter((placement) => itemOf.has(placement.item_id));
	const answered = stored.length > 0 || answer.alreadyAnswered;
	const phase = quizPhase(run.state, mode, answered);
	const title = quizDisplayTitle(run.title, "categorise");

	if (phase !== "result" && optionsHidden(run)) {
		return sent.length > 0 || answer.alreadyAnswered ? (
			<FirstAnswerLockedIn theme={theme} title={title} />
		) : (
			<OptionsHiddenView theme={theme} title={title} state={run.state} hint="The items to sort appear on your phone when the question starts." />
		);
	}

	if (phase === "result") {
		const correct = reveal?.correct_answer?.categories ?? aggregate?.correct?.categories ?? [];
		const home = new Map<OpaqueOptionId, string>();
		for (const category of correct) for (const id of category.item_ids) home.set(id, category.key);
		const mine = new Map(stored.map((placement) => [placement.item_id, placement.category_key]));
		const known = home.size > 0;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<QuizResultBanner runId={run.id} result={reveal} answered={answered} standing={resolveStanding(reveal, standing)} participantCount={quiz?.participant_count} />
				{categories.map((category, index) => {
					const shown = items.filter((item) => (stored.length > 0 ? mine.get(item.id) : home.get(item.id)) === category.key);
					return (
						<section key={category.key} className="flex flex-col gap-2" aria-label={categoryName(category, index)}>
							<ResultHeading>{categoryName(category, index)}</ResultHeading>
							{shown.length === 0 ? (
								<p className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
									Nothing placed here.
								</p>
							) : (
								<ul className="m-0 flex list-none flex-col gap-2 p-0">
									{shown.map((item) => {
										const right = home.get(item.id);
										const ok = right === category.key;
										return (
											<ResultRow
												key={item.id}
												tone={!known ? "neutral" : ok ? "correct" : "wrong"}
												imageUrl={item.image_url}
												label={labelOf.get(item.id)}
												note={known && !ok && right ? `Belongs in ${nameOf.get(right) ?? "another category"}` : undefined}
											/>
										);
									})}
								</ul>
							)}
						</section>
					);
				})}
				{stored.length > 0 && items.some((item) => !mine.has(item.id)) ? (
					<section className="flex flex-col gap-2" aria-label="Not placed">
						<ResultHeading>Not placed</ResultHeading>
						<ul className="m-0 flex list-none flex-col gap-2 p-0">
							{items
								.filter((item) => !mine.has(item.id))
								.map((item) => {
									const right = home.get(item.id);
									return (
										<ResultRow
											key={item.id}
											tone={known ? "wrong" : "neutral"}
											imageUrl={item.image_url}
											label={labelOf.get(item.id)}
											note={right ? `Belongs in ${nameOf.get(right) ?? "another category"}` : undefined}
										/>
									);
								})}
						</ul>
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
					<AnswerSummary label="Your sorting">
						<ul className="m-0 flex list-none flex-col gap-1.5 p-0">
							{categories.map((category, index) => {
								const placed = stored.filter((placement) => placement.category_key === category.key).map((placement) => labelOf.get(placement.item_id));
								return (
									<li key={category.key} className="break-words">
										<span className="font-semibold">{categoryName(category, index)}:</span> {placed.length > 0 ? placed.join(", ") : "—"}
									</li>
								);
							})}
						</ul>
					</AnswerSummary>
				</LockedIn>
			</ParticipantLayout>
		);
	}

	return (
		<SortBoard
			key={run.id}
			items={items}
			categories={categories}
			labelOf={labelOf}
			title={title}
			theme={theme}
			answering={phase === "answering"}
			disabled={disabled}
			busy={answer.busy}
			error={answer.fieldError}
			points={<PointsBar scoring={scoring ?? runScoring(run)} votingStartedAt={run.voting_started_at} active={phase === "answering"} />}
			onSend={(placements) => void answer.submit({ placements }, { placements })}
		/>
	);
}

function SortBoard({
	items,
	categories,
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
	items: Item[];
	categories: QuizCategory[];
	labelOf: Map<OpaqueOptionId, string>;
	title: string;
	theme: DeckTheme;
	answering: boolean;
	disabled: boolean;
	busy: boolean;
	error: string | null;
	points: ReactNode;
	onSend: (placements: CategorisePlacement[]) => void;
}) {
	const [placed, setPlaced] = useState<Map<OpaqueOptionId, string>>(() => new Map());
	const [selected, setSelected] = useState<OpaqueOptionId | null>(null);
	const [dragging, setDragging] = useState<OpaqueOptionId | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const locked = !answering || disabled || busy;
	const keys = new Set(categories.map((category) => category.key));
	const nameOf = new Map(categories.map((category, index) => [category.key, categoryName(category, index)]));

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		// A short press starts a drag; a quick swipe still scrolls and a tap still selects.
		useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } })
	);

	const place = (id: OpaqueOptionId, key: string | null) => {
		setPlaced((previous) => {
			const next = new Map(previous);
			if (key === null) next.delete(id);
			else next.set(id, key);
			return next;
		});
		setSelected(null);
		haptic("select");
		setAnnouncement(key === null ? `${labelOf.get(id)} back with the items.` : `${labelOf.get(id)} placed in ${nameOf.get(key)}.`);
	};

	const tapItem = (id: OpaqueOptionId) => {
		if (locked) return;
		setSelected((current) => (current === id ? null : id));
		haptic("tap");
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		setDragging(null);
		if (!over) return;
		const id = String(active.id);
		const target = String(over.id);
		if (target === "pool") place(id, null);
		else if (target.startsWith("bucket:") && keys.has(target.slice(7))) place(id, target.slice(7));
	};

	const pool = items.filter((item) => !placed.has(item.id));
	const placements: CategorisePlacement[] = items.filter((item) => placed.has(item.id)).map((item) => ({ item_id: item.id, category_key: placed.get(item.id)! }));
	const selectedPlaced = selected !== null && placed.has(selected);

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle="Drag each item into its category — or tap an item, then tap a category."
			footer={
				<SubmitBar
					label="Submit"
					onClick={() => placements.length > 0 && onSend(placements)}
					loading={busy}
					disabled={!answering || disabled || placements.length === 0}
					hint={`${placements.length} of ${items.length} placed${placements.length > 0 && placements.length < items.length ? " · unplaced items score nothing" : ""}`}
					error={error}
				/>
			}
		>
			{points}
			{!answering ? <ParticipantNotice>The question opens when the host starts it.</ParticipantNotice> : null}
			<DndContext sensors={sensors} onDragStart={({ active }) => setDragging(String(active.id))} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
				<DropZone id="pool" label="Items to sort" className="rounded-xl border-2 border-dashed p-2" active={dragging !== null}>
					{pool.length === 0 ? (
						<p className="m-0 px-1 py-2 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
							All items placed{selected ? " — drop one here to take it back" : ""}.
						</p>
					) : (
						<div className="flex flex-wrap gap-2">
							{pool.map((item) => (
								<Chip key={item.id} item={item} label={labelOf.get(item.id)!} selected={selected === item.id} disabled={locked} onTap={() => tapItem(item.id)} />
							))}
						</div>
					)}
				</DropZone>

				{selected !== null ? (
					<div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--deck-surface-muted, #F3F4F6)" }} role="status">
						<span className="min-w-0 break-words">
							<span className="font-semibold">{labelOf.get(selected)}</span> — tap a category to place it.
						</span>
						{selectedPlaced ? (
							<button
								type="button"
								onClick={() => place(selected, null)}
								className={cn("flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 font-semibold", FOCUS_RING)}
								style={{ background: "var(--deck-surface, #fff)", color: "var(--deck-text, #111928)" }}
							>
								<Undo2 className="h-4 w-4" aria-hidden />
								Take back
							</button>
						) : null}
					</div>
				) : null}

				<div className="flex flex-col gap-3">
					{categories.map((category, index) => {
						const inside = items.filter((item) => placed.get(item.id) === category.key);
						const color = chartColor(theme, index);
						return (
							<DropZone key={category.key} id={`bucket:${category.key}`} label={categoryName(category, index)} active={dragging !== null} color={color} className="rounded-xl border-2 p-2">
								<button
									type="button"
									onClick={() => selected !== null && place(selected, category.key)}
									disabled={locked || selected === null}
									className={cn("flex min-h-12 w-full items-center justify-between gap-2 rounded-lg px-2 text-left disabled:cursor-default", FOCUS_RING)}
									aria-label={selected !== null ? `Place ${labelOf.get(selected)} in ${categoryName(category, index)}` : `${categoryName(category, index)}, ${inside.length} items`}
								>
									<span className="flex min-w-0 items-center gap-2">
										<span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
										<span className="break-words text-base font-bold">{categoryName(category, index)}</span>
									</span>
									<span className="shrink-0 text-sm font-semibold" style={{ color: selected !== null && !locked ? "var(--deck-primary, #F79945)" : "var(--deck-text-muted, #4B5563)" }}>
										{selected !== null && !locked ? "Place here" : inside.length}
									</span>
								</button>
								{inside.length > 0 ? (
									<div className="flex flex-wrap gap-2 pt-1">
										{inside.map((item) => (
											<Chip key={item.id} item={item} label={labelOf.get(item.id)!} selected={selected === item.id} disabled={locked} onTap={() => tapItem(item.id)} color={color} />
										))}
									</div>
								) : null}
							</DropZone>
						);
					})}
				</div>

				<DragOverlay>
					{dragging ? (
						<span className="inline-flex min-h-12 items-center rounded-xl border-2 px-3 text-sm font-semibold shadow-lg" style={{ borderColor: "var(--deck-primary, #F79945)", background: "var(--deck-surface, #fff)", color: "var(--deck-text, #111928)" }}>
							{labelOf.get(dragging)}
						</span>
					) : null}
				</DragOverlay>
			</DndContext>
			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>
		</ParticipantLayout>
	);
}

function DropZone({ id, label, children, className, active, color }: { id: string; label: string; children: ReactNode; className?: string; active: boolean; color?: string }) {
	const { setNodeRef, isOver } = useDroppable({ id });
	return (
		<section
			ref={setNodeRef}
			aria-label={label}
			className={cn("transition-colors", className)}
			style={{
				borderColor: isOver ? "var(--deck-primary, #F79945)" : (color ?? "var(--deck-border, #E5E7EB)"),
				background: isOver
					? "color-mix(in srgb, var(--deck-primary, #F79945) 12%, var(--deck-surface, #fff))"
					: active
						? "var(--deck-surface-muted, #F3F4F6)"
						: "var(--deck-surface, #fff)",
			}}
		>
			{children}
		</section>
	);
}

function Chip({ item, label, selected, disabled, onTap, color }: { item: Item; label: string; selected: boolean; disabled: boolean; onTap: () => void; color?: string }) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, disabled });
	return (
		<button
			type="button"
			ref={setNodeRef}
			{...attributes}
			{...listeners}
			// No keyboard drag (it has no buckets to step through): Enter / Space select, then a bucket places it.
			aria-pressed={selected}
			onClick={onTap}
			disabled={disabled}
			className={cn(
				"inline-flex min-h-12 max-w-full touch-manipulation select-none items-center gap-2 rounded-xl border-2 px-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
				isDragging && "opacity-40",
				FOCUS_RING
			)}
			style={{
				borderColor: selected ? "var(--deck-primary, #F79945)" : (color ?? "var(--deck-border, #E5E7EB)"),
				background: selected ? "color-mix(in srgb, var(--deck-primary, #F79945) 16%, var(--deck-surface, #fff))" : "var(--deck-surface, #fff)",
				color: "var(--deck-text, #111928)",
				WebkitTouchCallout: "none",
			}}
		>
			{item.image_url ? <img src={item.image_url} alt="" draggable={false} className="h-8 w-8 shrink-0 rounded-md object-cover" /> : null}
			<span className="min-w-0 break-words">{label}</span>
		</button>
	);
}
