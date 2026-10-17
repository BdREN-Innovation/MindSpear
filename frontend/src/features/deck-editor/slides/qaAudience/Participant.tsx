"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Heart, RefreshCw, Send, Star } from "lucide-react";
import { toDeckApiError } from "@/features/deck/api/errors";
import type { QaFeedSort, QaParticipantItem } from "@/features/deck/types";
import { cn } from "@/lib/utils";
import type { ParticipantProps } from "../types";
import { haptic, submitErrorMessage, usePrefersReducedMotion } from "../shared";
import { displayTitle } from "../shared/labels";
import { cleanQuestion } from "../shared/text";
import { sampleParticipantQuestions } from "./sample";

// qa_audience participant (plan §7.3 / §7.4): "Ask a question…" box on top
// (cleared after each send; ask as many as you like), the feed below with a
// Top / Newest toggle and tap-to-upvote hearts, answered questions in their
// own struck-through section. Everything goes through the `qa` helper
// (useParticipantQaFeed: REST read + qa.question.* events, optimistic
// upvotes). Questions are taken while the run is `open`. Q&A doesn't go
// through ParticipantProps.onSubmit, so the shell never sees these failures:
// this screen shows its own errors (unlike the answer types).

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

const SORTS: { value: QaFeedSort; label: string }[] = [
	{ value: "top", label: "Top" },
	{ value: "new", label: "Newest" },
];

function QuestionRow({
	question,
	canVote,
	onVote,
	reduceMotion,
}: {
	question: QaParticipantItem;
	canVote: boolean;
	onVote: (question: QaParticipantItem) => void;
	reduceMotion: boolean;
}) {
	return (
		<motion.li
			layout={!reduceMotion}
			initial={reduceMotion ? false : { opacity: 0, y: -8 }}
			animate={{ opacity: 1, y: 0 }}
			exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0 }}
			className="flex items-start gap-3 rounded-xl border p-3"
			style={{
				borderColor: question.is_mine ? "var(--deck-primary, #F79945)" : "var(--deck-border, #E5E7EB)",
				background: "var(--deck-surface, #fff)",
			}}
		>
			<span
				aria-hidden
				className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg"
				style={{ background: "var(--deck-surface-muted, #F3F4F6)" }}
			>
				{question.participant_emoji ?? "💬"}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p
					className={cn("m-0 break-words text-base leading-snug [overflow-wrap:anywhere]", question.is_answered && "line-through decoration-2")}
					style={{ color: question.is_answered ? "var(--deck-text-muted, #4B5563)" : "var(--deck-text, #111928)" }}
				>
					{question.body}
				</p>
				{question.is_mine || question.is_starred || question.is_answered ? (
					<div className="flex flex-wrap gap-1.5 text-xs font-semibold">
						{question.is_mine ? (
							<span className="rounded-full px-2 py-0.5" style={{ background: "color-mix(in srgb, var(--deck-primary, #F79945) 18%, transparent)" }}>
								You asked
							</span>
						) : null}
						{question.is_starred && !question.is_answered ? (
							<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "var(--deck-surface-muted, #F3F4F6)" }}>
								<Star className="h-3 w-3" fill="currentColor" aria-hidden />
								Picked by the host
							</span>
						) : null}
						{question.is_answered ? (
							<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "var(--deck-surface-muted, #F3F4F6)", color: "var(--deck-success, #15803D)" }}>
								<CheckCircle2 className="h-3 w-3" aria-hidden />
								Answered
							</span>
						) : null}
					</div>
				) : null}
			</div>
			<button
				type="button"
				aria-pressed={question.has_upvoted}
				aria-label={`${question.has_upvoted ? "Remove your upvote" : "Upvote"}: ${question.body.slice(0, 80)}. ${question.upvote_count} ${question.upvote_count === 1 ? "upvote" : "upvotes"}.`}
				disabled={!canVote}
				onClick={() => onVote(question)}
				className={cn(
					"flex min-h-12 min-w-12 shrink-0 touch-manipulation flex-col items-center justify-center rounded-xl px-1 transition motion-safe:active:scale-90 disabled:cursor-not-allowed disabled:opacity-60",
					FOCUS_RING
				)}
				style={{ color: question.has_upvoted ? "var(--deck-danger, #DC2626)" : "var(--deck-text-muted, #4B5563)" }}
			>
				<Heart className="h-6 w-6" fill={question.has_upvoted ? "currentColor" : "none"} strokeWidth={2} aria-hidden />
				<span className="text-xs font-bold tabular-nums">{question.upvote_count}</span>
			</button>
		</motion.li>
	);
}

export function QaAudienceParticipant({ run, qa, disabled, mode }: ParticipantProps<"qa_audience">) {
	const reduceMotion = usePrefersReducedMotion();
	const ids = useId();
	const maxLength = Math.max(10, run.config.max_question_length ?? 280);
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sentNote, setSentNote] = useState<string | null>(null);
	const noteTimer = useRef<number | null>(null);
	const [previewSort, setPreviewSort] = useState<QaFeedSort>(run.config.sort === "newest" ? "new" : "top");

	useEffect(
		() => () => {
			if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
		},
		[]
	);

	const review = mode === "review";
	const isOpen = run.state === "open" || run.state === "voting";
	const canAsk = !!qa && isOpen && !disabled && !review;
	const canVote = !!qa && isOpen && !review;
	const sort = qa?.sort ?? previewSort;
	const questions = useMemo(() => {
		if (qa) return qa.questions;
		const samples = sampleParticipantQuestions();
		return sort === "new" ? [...samples].reverse() : samples;
	}, [qa, sort]);
	const open = questions.filter((question) => !question.is_answered);
	const answered = questions.filter((question) => question.is_answered);
	// Like LiveQaService: a question of only spaces / invisible characters is blank.
	const trimmed = cleanQuestion(text);

	const send = async (event?: FormEvent) => {
		event?.preventDefault();
		if (!qa || !canAsk || sending || !trimmed) return;
		setSending(true);
		setError(null);
		try {
			await qa.submit(trimmed);
			setText("");
			haptic("submit");
			setSentNote("Question sent. Ask another anytime.");
			if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
			noteTimer.current = window.setTimeout(() => setSentNote(null), 4000);
		} catch (reason) {
			setError(submitErrorMessage(toDeckApiError(reason)));
		} finally {
			setSending(false);
		}
	};

	const vote = (question: QaParticipantItem) => {
		if (!qa || !canVote) return;
		haptic("tap");
		qa.toggleUpvote(question.question_id).catch((reason) => {
			const deckError = toDeckApiError(reason);
			// 404: the host hid it meanwhile; the feed already dropped it.
			if (deckError.status !== 404) setError(submitErrorMessage(deckError));
		});
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void send();
		}
	};

	const setSort = (value: QaFeedSort) => (qa ? qa.setSort(value) : setPreviewSort(value));

	return (
		<div className="flex min-h-full w-full flex-col gap-5 px-4 pb-8 pt-5" style={{ color: "var(--deck-text, #111928)" }}>
			<h2 className="m-0 break-words text-xl font-bold leading-snug">{displayTitle(run.title, "qa_audience")}</h2>

			{review ? null : isOpen || !qa ? (
				<form onSubmit={send} className="flex flex-col gap-2" aria-describedby={`${ids}-count`}>
					<label htmlFor={`${ids}-input`} className="sr-only">
						Your question
					</label>
					<textarea
						id={`${ids}-input`}
						value={text}
						onChange={(event) => {
							setText(event.target.value.slice(0, maxLength));
							if (error) setError(null);
						}}
						onKeyDown={onKeyDown}
						placeholder="Ask a question…"
						rows={3}
						maxLength={maxLength}
						disabled={!canAsk || sending}
						className={cn("w-full resize-none rounded-xl border-2 px-3 py-3 text-base leading-snug disabled:opacity-60", FOCUS_RING)}
						style={{ borderColor: "var(--deck-border, #E5E7EB)", background: "var(--deck-surface, #fff)", color: "var(--deck-text, #111928)" }}
					/>
					<div className="flex items-center justify-between gap-3">
						<span id={`${ids}-count`} className="text-xs tabular-nums" style={{ color: text.length >= maxLength ? "var(--deck-danger, #B91C1C)" : "var(--deck-text-muted, #4B5563)" }}>
							{text.length} / {maxLength}
						</span>
						<button
							type="submit"
							disabled={!canAsk || sending || !trimmed}
							aria-busy={sending || undefined}
							className={cn(
								"flex min-h-12 touch-manipulation items-center gap-2 rounded-xl px-5 text-base font-semibold transition motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
								FOCUS_RING
							)}
							style={{ background: "var(--deck-primary, #F79945)", color: "var(--deck-on-primary, #111928)" }}
						>
							{sending ? (
								<span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />
							) : (
								<Send className="h-5 w-5" aria-hidden />
							)}
							{sending ? "Sending…" : "Send"}
						</button>
					</div>
					{error ? (
						<p role="alert" className="m-0 text-sm font-medium" style={{ color: "var(--deck-danger, #B91C1C)" }}>
							{error}
						</p>
					) : null}
					<p aria-live="polite" className="m-0 min-h-5 text-sm font-medium" style={{ color: "var(--deck-success, #15803D)" }}>
						{sentNote}
					</p>
				</form>
			) : (
				<p role="status" className="m-0 rounded-xl px-4 py-3 text-sm font-medium" style={{ background: "var(--deck-surface-muted, #F3F4F6)", color: "var(--deck-text-muted, #4B5563)" }}>
					{run.state === "closed" ? "Questions are closed for this slide." : "Questions open when the host starts this slide."}
				</p>
			)}

			<section aria-labelledby={`${ids}-feed`} className="flex flex-col gap-3">
				<div className="flex items-center justify-between gap-3">
					<h3 id={`${ids}-feed`} className="m-0 text-base font-bold">
						{qa?.ownOnly ? "Your questions" : "Questions"}
						<span className="ml-1.5 text-sm font-medium tabular-nums" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
							{questions.length}
						</span>
					</h3>
					<div role="radiogroup" aria-label="Sort questions" className="flex rounded-full p-1" style={{ background: "var(--deck-surface-muted, #F3F4F6)" }}>
						{SORTS.map((option) => {
							const selected = sort === option.value;
							return (
								<button
									key={option.value}
									type="button"
									role="radio"
									aria-checked={selected}
									onClick={() => setSort(option.value)}
									className={cn("min-h-11 rounded-full px-4 text-sm font-semibold transition", FOCUS_RING)}
									style={{
										background: selected ? "var(--deck-bg, #fff)" : "transparent",
										color: selected ? "var(--deck-text, #111928)" : "var(--deck-text-muted, #4B5563)",
										boxShadow: selected ? "0 1px 2px rgba(0,0,0,0.12)" : undefined,
									}}
								>
									{option.label}
								</button>
							);
						})}
					</div>
				</div>

				{qa?.ownOnly ? (
					<p className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						Only you and the host can see your questions.
					</p>
				) : null}

				{qa?.error && questions.length === 0 ? (
					<div role="alert" className="flex flex-col items-center gap-2 py-6 text-center text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						Couldn&apos;t load the questions.
						<button
							type="button"
							onClick={() => void qa.refresh()}
							className={cn("flex min-h-11 items-center gap-1.5 rounded-full px-4 font-semibold", FOCUS_RING)}
							style={{ background: "var(--deck-surface-muted, #F3F4F6)", color: "var(--deck-text, #111928)" }}
						>
							<RefreshCw className="h-4 w-4" aria-hidden />
							Try again
						</button>
					</div>
				) : qa?.loading && questions.length === 0 ? (
					<p role="status" className="m-0 py-6 text-center text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						Loading questions…
					</p>
				) : questions.length === 0 ? (
					<p role="status" className="m-0 py-6 text-center text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						{qa?.ownOnly ? "You haven't asked anything yet." : "No questions yet. Be the first to ask!"}
					</p>
				) : (
					<>
						<ul className="m-0 flex list-none flex-col gap-2 p-0">
							<AnimatePresence initial={false}>
								{open.map((question) => (
									<QuestionRow key={question.question_id} question={question} canVote={canVote} onVote={vote} reduceMotion={reduceMotion} />
								))}
							</AnimatePresence>
						</ul>
						{answered.length > 0 ? (
							<div className="flex flex-col gap-2">
								<h4 className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
									Answered
								</h4>
								<ul className="m-0 flex list-none flex-col gap-2 p-0">
									<AnimatePresence initial={false}>
										{answered.map((question) => (
											<QuestionRow key={question.question_id} question={question} canVote={canVote} onVote={vote} reduceMotion={reduceMotion} />
										))}
									</AnimatePresence>
								</ul>
							</div>
						) : null}
					</>
				)}
			</section>
		</div>
	);
}
