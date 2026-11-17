"use client";

import { useState, type ReactNode } from "react";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { DeckTheme } from "@/features/deck/theme";
import type { OpaqueOptionId, RunOption, SentencePart } from "@/features/deck/types";
import { runScoring } from "@/features/deck/lib/quiz";
import { blankCount } from "@/features/deck/lib/blanks";
import type { ParticipantProps } from "../types";
import { SubmitBar, haptic } from "../shared";
import { AnswerSummary, ParticipantLayout, ParticipantNotice } from "../shared/participantKit";
import { quizDisplayTitle, resolveStanding } from "../shared/quizLabels";
import {
	FirstAnswerLockedIn,
	LockedIn,
	OptionsHiddenView,
	PointsBar,
	QuizResultBanner,
	ResultHeading,
	optionsHidden,
	quizPhase,
	useQuizAnswer,
} from "../shared/quizParticipant";
import { SentenceText, SentenceWithAnswers } from "../shared/sentence";

// drag_drop on the phone: the sentence with a drop slot in each blank and
// the word bank under it (the run's options, in this player's own order).
// Drag a word into a blank, or tap a word and then a blank (the keyboard /
// no-drag path). Tap a filled blank to send its word back. Submit sends
// {answers}: the word in each blank (null = empty). Final once sent.

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

type Word = RunOption<OpaqueOptionId, Record<never, never>>;

export function DragDropParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode, scoring, reveal, standing, quiz }: ParticipantProps<"drag_drop">) {
	const answer = useQuizAnswer(run.id, mySubmission, onSubmit);
	const parts = run.config.parts ?? [];
	const sent = Array.isArray(answer.latest?.answers) ? answer.latest.answers : null;
	const answered = (sent?.some((value) => !!value) ?? false) || answer.alreadyAnswered;
	const phase = quizPhase(run.state, mode, answered);
	const title = quizDisplayTitle(run.title, "drag_drop");

	if (phase !== "result" && optionsHidden(run)) {
		return sent || answer.alreadyAnswered ? (
			<FirstAnswerLockedIn theme={theme} title={title} />
		) : (
			<OptionsHiddenView theme={theme} title={title} state={run.state} hint="The words to drag appear on your phone when the question starts." />
		);
	}

	if (phase === "result") {
		const correct = reveal?.correct_answer?.blanks ?? aggregate?.correct?.blanks;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<QuizResultBanner runId={run.id} result={reveal} answered={answered} standing={resolveStanding(reveal, standing)} participantCount={quiz?.participant_count} />
				<section className="flex flex-col gap-2" aria-label={sent ? "Your answers" : "Answers"}>
					<ResultHeading>{sent ? "Your answers" : "Answers"}</ResultHeading>
					<SentenceWithAnswers parts={parts} mine={sent ?? correct?.map((blank) => blank.answers[0] ?? null) ?? []} correct={sent ? correct : undefined} caseSensitive />
				</section>
			</ParticipantLayout>
		);
	}

	if (phase === "locked_in") {
		if (!sent) return <FirstAnswerLockedIn theme={theme} title={title} />;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<LockedIn>
					<AnswerSummary label="Your answers">
						<SentenceWithAnswers parts={parts} mine={sent} caseSensitive />
					</AnswerSummary>
				</LockedIn>
			</ParticipantLayout>
		);
	}

	return (
		<DropBoard
			key={run.id}
			parts={parts}
			words={run.options as Word[]}
			title={title}
			theme={theme}
			answering={phase === "answering"}
			disabled={disabled}
			busy={answer.busy}
			error={answer.fieldError}
			points={<PointsBar scoring={scoring ?? runScoring(run)} votingStartedAt={run.voting_started_at} active={phase === "answering"} />}
			onSend={(answers) => void answer.submit({ answers }, { answers })}
		/>
	);
}

function DropBoard({
	parts,
	words,
	title,
	theme,
	answering,
	disabled,
	busy,
	error,
	points,
	onSend,
}: {
	parts: SentencePart[];
	words: Word[];
	title: string;
	theme: DeckTheme;
	answering: boolean;
	disabled: boolean;
	busy: boolean;
	error: string | null;
	points: ReactNode;
	onSend: (answers: (string | null)[]) => void;
}) {
	const count = blankCount(parts);
	const [slots, setSlots] = useState<(OpaqueOptionId | null)[]>(() => Array.from({ length: count }, () => null));
	const [selected, setSelected] = useState<OpaqueOptionId | null>(null);
	const [dragging, setDragging] = useState<OpaqueOptionId | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const locked = !answering || disabled || busy;
	const labelOf = new Map(words.map((word) => [word.id, word.label ?? ""]));

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		// A short press starts a drag; a quick swipe still scrolls and a tap still selects.
		useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } })
	);

	/** Puts word `id` in blank `index` (null = back to the bank); a word already there goes where `id` came from. */
	const place = (id: OpaqueOptionId, index: number | null) => {
		setSlots((previous) => {
			const next = [...previous];
			const from = next.indexOf(id);
			if (from !== -1) next[from] = null;
			if (index !== null) {
				const displaced = next[index];
				next[index] = id;
				if (displaced && from !== -1) next[from] = displaced;
			}
			return next;
		});
		setSelected(null);
		haptic("select");
		setAnnouncement(index === null ? `${labelOf.get(id)} back in the word bank.` : `${labelOf.get(id)} placed in blank ${index + 1}.`);
	};

	const tapWord = (id: OpaqueOptionId) => {
		if (locked) return;
		setSelected((current) => (current === id ? null : id));
		haptic("tap");
	};

	const tapSlot = (index: number) => {
		if (locked) return;
		if (selected !== null) place(selected, index);
		else if (slots[index]) place(slots[index]!, null);
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		setDragging(null);
		if (!over) return;
		const id = String(active.id);
		const target = String(over.id);
		if (target === "bank") place(id, null);
		else if (target.startsWith("slot:")) place(id, Number(target.slice(5)));
	};

	const bank = words.filter((word) => !slots.includes(word.id));
	const filled = slots.filter(Boolean).length;
	const answers = slots.map((id) => (id ? (labelOf.get(id) ?? null) : null));

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle="Drag the words into the blanks — or tap a word, then tap a blank."
			footer={
				<SubmitBar
					label="Submit"
					onClick={() => filled > 0 && onSend(answers)}
					loading={busy}
					disabled={!answering || disabled || filled === 0}
					hint={`${filled} of ${count} filled${filled > 0 && filled < count ? " · empty blanks score nothing" : ""}`}
					error={error}
				/>
			}
		>
			{points}
			{!answering ? <ParticipantNotice>The question opens when the host starts it.</ParticipantNotice> : null}
			<DndContext sensors={sensors} onDragStart={({ active }) => setDragging(String(active.id))} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
				<SentenceText
					parts={parts}
					className="m-0 text-lg leading-[3]"
					renderBlank={(index) => (
						<Slot
							index={index}
							word={slots[index] ? { id: slots[index]!, label: labelOf.get(slots[index]!) ?? "" } : null}
							armed={selected !== null && !locked}
							selected={selected !== null && slots[index] === selected}
							disabled={locked}
							onTap={() => tapSlot(index)}
						/>
					)}
				/>

				{selected !== null ? (
					<p className="m-0 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--deck-surface-muted, #F3F4F6)" }} role="status">
						<span className="font-semibold">{labelOf.get(selected)}</span> — tap a blank to place it.
					</p>
				) : null}

				<Bank active={dragging !== null}>
					{bank.length === 0 ? (
						<p className="m-0 px-1 py-2 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
							All words used — tap a blank to take its word back.
						</p>
					) : (
						<div className="flex flex-wrap gap-2">
							{bank.map((word) => (
								<WordChip key={word.id} id={word.id} label={word.label ?? ""} selected={selected === word.id} disabled={locked} onTap={() => tapWord(word.id)} />
							))}
						</div>
					)}
				</Bank>

				<DragOverlay>
					{dragging ? (
						<span
							className="inline-flex min-h-11 items-center rounded-xl border-2 px-3 text-base font-semibold shadow-lg"
							style={{ borderColor: "var(--deck-primary, #F79945)", background: "var(--deck-surface, #fff)", color: "var(--deck-text, #111928)" }}
						>
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

function Bank({ active, children }: { active: boolean; children: ReactNode }) {
	const { setNodeRef, isOver } = useDroppable({ id: "bank" });
	return (
		<section
			ref={setNodeRef}
			aria-label="Word bank"
			className="rounded-xl border-2 border-dashed p-2 transition-colors"
			style={{
				borderColor: isOver ? "var(--deck-primary, #F79945)" : "var(--deck-border, #E5E7EB)",
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

/** A blank: a drop target and a button (place the selected word, or send its word back). */
function Slot({
	index,
	word,
	armed,
	selected,
	disabled,
	onTap,
}: {
	index: number;
	word: { id: OpaqueOptionId; label: string } | null;
	armed: boolean;
	selected: boolean;
	disabled: boolean;
	onTap: () => void;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: `slot:${index}` });
	const drag = useDraggable({ id: word?.id ?? `empty:${index}`, disabled: disabled || !word });
	return (
		<span ref={setNodeRef} className="mx-1 inline-block align-middle">
			<button
				type="button"
				ref={drag.setNodeRef}
				{...(word ? drag.attributes : {})}
				{...(word ? drag.listeners : {})}
				onClick={onTap}
				disabled={disabled}
				aria-label={word ? `Blank ${index + 1}: ${word.label}. Tap to take it back.` : armed ? `Place the word in blank ${index + 1}` : `Blank ${index + 1}, empty`}
				className={cn(
					"inline-flex min-h-11 min-w-24 touch-manipulation select-none items-center justify-center rounded-lg border-2 px-3 text-base font-semibold transition disabled:cursor-not-allowed",
					word ? "border-solid" : "border-dashed",
					drag.isDragging && "opacity-40",
					FOCUS_RING
				)}
				style={{
					borderColor: isOver || selected || (armed && !word) ? "var(--deck-primary, #F79945)" : "var(--deck-border, #D1D5DB)",
					background: isOver
						? "color-mix(in srgb, var(--deck-primary, #F79945) 14%, var(--deck-surface, #fff))"
						: word
							? "var(--deck-surface, #fff)"
							: "var(--deck-surface-muted, #F3F4F6)",
					color: word ? "var(--deck-text, #111928)" : "var(--deck-text-muted, #4B5563)",
					WebkitTouchCallout: "none",
				}}
			>
				{word ? word.label : index + 1}
			</button>
		</span>
	);
}

function WordChip({ id, label, selected, disabled, onTap }: { id: OpaqueOptionId; label: string; selected: boolean; disabled: boolean; onTap: () => void }) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
	return (
		<button
			type="button"
			ref={setNodeRef}
			{...attributes}
			{...listeners}
			// No keyboard drag (no slots to step through): Enter / Space select, then a blank places it.
			aria-pressed={selected}
			onClick={onTap}
			disabled={disabled}
			className={cn(
				"inline-flex min-h-11 max-w-full touch-manipulation select-none items-center rounded-xl border-2 px-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
				isDragging && "opacity-40",
				FOCUS_RING
			)}
			style={{
				borderColor: selected ? "var(--deck-primary, #F79945)" : "var(--deck-border, #E5E7EB)",
				background: selected ? "color-mix(in srgb, var(--deck-primary, #F79945) 16%, var(--deck-surface, #fff))" : "var(--deck-surface, #fff)",
				color: "var(--deck-text, #111928)",
				WebkitTouchCallout: "none",
			}}
		>
			<span className="min-w-0 break-words">{label}</span>
		</button>
	);
}
