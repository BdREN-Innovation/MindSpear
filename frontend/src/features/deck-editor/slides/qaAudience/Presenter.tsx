"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "react-toastify";
import { CheckCircle2, Heart, MessagesSquare, SkipForward, Star } from "lucide-react";
import { toDeckApiError } from "@/features/deck/api/errors";
import { sortQaItems } from "@/features/deck/live/qaFeed";
import type { QaHostItem } from "@/features/deck/types";
import { cn } from "@/lib/utils";
import type { PresenterProps } from "../types";
import { TIMER_CHIP_CLEARANCE } from "../pinOnImage/stageLayout";
import { PresenterStage, ResponseCount, ResultsEmpty, SlideTitle, usePrefersReducedMotion } from "../shared";
import { sampleHostQuestions } from "./sample";

// qa_audience presenter (plan §6.3 / §6.4): the featured question in big
// text, the next ones and the answered ones (struck through) beside it.
// Hidden questions are never shown. Featured = the one the host picked, else
// the first starred open question, else the top open one (the host feed is
// already "starred first, then the sort"). The moderation sheet belongs to
// the presenter shell; this view only offers quick actions on the featured
// question through host.qa (revealed on hover / keyboard focus so the
// audience sees a clean slide).

const UP_NEXT_MAX = 5;
const ANSWERED_MAX = 3;

function featuredSize(length: number): string {
	if (length <= 80) return "clamp(1.5rem, 4.2cqw, 4.5rem)";
	if (length <= 160) return "clamp(1.25rem, 3.3cqw, 3.5rem)";
	if (length <= 320) return "clamp(1.1rem, 2.5cqw, 2.75rem)";
	return "clamp(1rem, 1.8cqw, 2rem)";
}

function Votes({ count, size }: { count: number; size: string }) {
	return (
		<span className="inline-flex items-center gap-[0.4cqw] font-semibold tabular-nums" style={{ fontSize: size, color: "var(--deck-text-muted)" }}>
			<Heart className="h-[1em] w-[1em]" style={{ color: "var(--deck-danger)" }} fill="currentColor" aria-hidden />
			{count}
			<span className="sr-only">{count === 1 ? "upvote" : "upvotes"}</span>
		</span>
	);
}

export function QaAudiencePresenter({ run, mode, host, state }: PresenterProps<"qa_audience">) {
	const reduceMotion = usePrefersReducedMotion();
	const qa = host?.qa;
	const [pickedId, setPickedId] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);

	const questions = useMemo<QaHostItem[]>(() => {
		const source = qa ? qa.questions : mode === "preview" ? sortQaItems(sampleHostQuestions(), "top", true) : [];
		return source.filter((question) => !question.is_hidden);
	}, [qa, mode]);

	const open = questions.filter((question) => !question.is_answered);
	const answered = questions.filter((question) => question.is_answered);
	const featured = open.find((question) => question.question_id === pickedId) ?? open.find((question) => question.is_starred) ?? open[0] ?? null;
	const upNext = open.filter((question) => question !== featured).slice(0, UP_NEXT_MAX);
	const canModerate = !!qa && mode === "live";

	const moderate = async (question: QaHostItem, flags: Parameters<NonNullable<typeof qa>["moderate"]>[1]) => {
		if (!qa || busy) return;
		setBusy(true);
		try {
			await qa.moderate(question.question_id, flags);
		} catch (reason) {
			toast.error(toDeckApiError(reason).message || "Could not update the question.");
		} finally {
			setBusy(false);
		}
	};

	const next = () => {
		if (!featured || open.length < 2) return;
		const index = open.indexOf(featured);
		setPickedId(open[(index + 1) % open.length].question_id);
	};

	const fade = reduceMotion ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0 } } } : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -12 } };

	return (
		<PresenterStage>
			{/* Right padding keeps the shell's timer chip area (top-right ~220×56 px) clear. */}
			<div className="flex items-start justify-between gap-[2cqw]" style={TIMER_CHIP_CLEARANCE}>
				<SlideTitle title={run.title} fallback="Ask me anything" size="md" />
				<div className="flex shrink-0 items-center gap-[1.5cqw]">
					{state === "closed" ? (
						<span className="rounded-full px-[1cqw] py-[0.3cqw] font-semibold" style={{ fontSize: "clamp(0.75rem, 1.2cqw, 1rem)", background: "var(--deck-surface-muted)", color: "var(--deck-text-muted)" }}>
							Questions closed
						</span>
					) : null}
					<ResponseCount count={questions.length} noun={["question", "questions"]} />
				</div>
			</div>

			{questions.length === 0 ? (
				<ResultsEmpty
					message={state === "closed" ? "No questions were asked" : "Waiting for questions…"}
					icon={<MessagesSquare className="h-[6cqw] w-[6cqw] min-h-10 min-w-10" style={{ color: "var(--deck-primary)" }} aria-hidden />}
				/>
			) : (
				<div className="flex min-h-0 flex-1 gap-[3cqw]">
					{/* Featured question */}
					<div
						className="group relative flex min-w-0 flex-[3] flex-col justify-center gap-[2cqw] rounded-[1.5cqw] p-[3cqw]"
						style={{ background: "var(--deck-surface)", border: "1px solid var(--deck-border)" }}
					>
						<AnimatePresence mode="wait" initial={false}>
							{featured ? (
								<motion.div key={featured.question_id} className="flex min-h-0 flex-col gap-[2cqw]" transition={{ duration: reduceMotion ? 0 : 0.3 }} {...fade}>
									<div className="flex items-center gap-[1cqw]" style={{ fontSize: "clamp(0.875rem, 1.6cqw, 1.4rem)" }}>
										{featured.participant_emoji ? (
											<span aria-hidden className="leading-none" style={{ fontSize: "2.4cqw" }}>
												{featured.participant_emoji}
											</span>
										) : null}
										{featured.is_starred ? (
											<span className="inline-flex items-center gap-[0.4cqw] rounded-full px-[1cqw] py-[0.3cqw] font-semibold" style={{ background: "var(--deck-primary)", color: "var(--deck-on-primary)" }}>
												<Star className="h-[1em] w-[1em]" fill="currentColor" aria-hidden />
												Starred
											</span>
										) : null}
										<Votes count={featured.upvote_count} size="clamp(0.875rem, 1.8cqw, 1.6rem)" />
									</div>
									<blockquote
										aria-live="polite"
										className="m-0 overflow-hidden font-bold leading-snug [overflow-wrap:anywhere]"
										style={{ fontSize: featuredSize(featured.body.length), color: "var(--deck-text)", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 7 }}
									>
										{featured.body}
									</blockquote>
								</motion.div>
							) : (
								<motion.p key="all-answered" className="m-0 font-semibold" style={{ fontSize: "clamp(1.25rem, 3cqw, 3rem)", color: "var(--deck-text-muted)" }} {...fade}>
									All questions answered
								</motion.p>
							)}
						</AnimatePresence>

						{canModerate && featured ? (
							<div className="flex flex-wrap gap-[1cqw] opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
								{(
									[
										{ label: "Mark answered", icon: CheckCircle2, onClick: () => moderate(featured, { is_answered: true }) },
										{
											label: featured.is_starred ? "Unstar" : "Star",
											icon: Star,
											onClick: () => moderate(featured, { is_starred: !featured.is_starred }),
										},
										...(open.length > 1 ? [{ label: "Next question", icon: SkipForward, onClick: next }] : []),
									] as const
								).map(({ label, icon: Icon, onClick }) => (
									<button
										key={label}
										type="button"
										onClick={() => void onClick()}
										disabled={busy}
										className="inline-flex min-h-11 items-center gap-[0.5cqw] rounded-full px-[1.4cqw] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus)] disabled:opacity-50"
										style={{ fontSize: "clamp(0.75rem, 1.2cqw, 1rem)", background: "var(--deck-surface-muted)", color: "var(--deck-text)" }}
									>
										<Icon className="h-[1.1em] w-[1.1em]" aria-hidden />
										{label}
									</button>
								))}
							</div>
						) : null}
					</div>

					{/* Up next + answered */}
					{upNext.length > 0 || answered.length > 0 ? (
						<div className="flex min-h-0 min-w-0 flex-[2] flex-col gap-[1.5cqw] overflow-hidden">
							{upNext.length > 0 ? (
								<section className="flex min-h-0 flex-col gap-[0.8cqw]" aria-label="Up next">
									<h2 className="m-0 font-semibold uppercase tracking-wide" style={{ fontSize: "clamp(0.7rem, 1.1cqw, 0.95rem)", color: "var(--deck-text-muted)" }}>
										Up next
									</h2>
									<ul className="m-0 flex list-none flex-col gap-[0.8cqw] p-0">
										<AnimatePresence initial={false}>
											{upNext.map((question) => {
												const content = (
													<>
														{question.is_starred ? <Star className="mt-[0.2em] h-[1em] w-[1em] shrink-0" style={{ color: "var(--deck-primary)" }} fill="currentColor" aria-label="Starred" /> : null}
														<span className="min-w-0 flex-1 overflow-hidden [overflow-wrap:anywhere]" style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2 }}>
															{question.body}
														</span>
														<Votes count={question.upvote_count} size="0.9em" />
													</>
												);
												return (
													<motion.li key={question.question_id} layout={!reduceMotion} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
														{canModerate ? (
															<button
																type="button"
																onClick={() => setPickedId(question.question_id)}
																aria-label={`Show this question: ${question.body}`}
																className="flex w-full items-start gap-[0.8cqw] rounded-[0.8cqw] p-[1cqw] text-left outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus)]"
																style={{ fontSize: "clamp(0.8rem, 1.45cqw, 1.3rem)", background: "var(--deck-surface)", border: "1px solid var(--deck-border)", color: "var(--deck-text)" }}
															>
																{content}
															</button>
														) : (
															<div
																className="flex items-start gap-[0.8cqw] rounded-[0.8cqw] p-[1cqw]"
																style={{ fontSize: "clamp(0.8rem, 1.45cqw, 1.3rem)", background: "var(--deck-surface)", border: "1px solid var(--deck-border)" }}
															>
																{content}
															</div>
														)}
													</motion.li>
												);
											})}
										</AnimatePresence>
									</ul>
								</section>
							) : null}

							{answered.length > 0 ? (
								<section className="flex min-h-0 flex-col gap-[0.6cqw]" aria-label="Answered">
									<h2 className="m-0 font-semibold uppercase tracking-wide" style={{ fontSize: "clamp(0.7rem, 1.1cqw, 0.95rem)", color: "var(--deck-text-muted)" }}>
										Answered
									</h2>
									<ul className="m-0 flex list-none flex-col gap-[0.5cqw] p-0">
										{answered.slice(0, ANSWERED_MAX).map((question) => (
											<li
												key={question.question_id}
												className={cn("flex items-start gap-[0.8cqw] px-[1cqw] line-through decoration-2")}
												style={{ fontSize: "clamp(0.75rem, 1.25cqw, 1.1rem)", color: "var(--deck-text-muted)" }}
											>
												<CheckCircle2 className="mt-[0.2em] h-[1em] w-[1em] shrink-0" style={{ color: "var(--deck-success)" }} aria-hidden />
												<span className="min-w-0 flex-1 truncate">{question.body}</span>
											</li>
										))}
									</ul>
								</section>
							) : null}
						</div>
					) : null}
				</div>
			)}
		</PresenterStage>
	);
}
