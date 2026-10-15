"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion, type PanInfo } from "framer-motion";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, MessageCircleQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { questParticipantApi } from "@/features/deck/api/participantApi";
import { toDeckApiError } from "@/features/deck/api/errors";
import { getDeckTheme, type DeckTheme } from "@/features/deck/theme";
import type { DeckQaEvent } from "@/features/deck/live/channelState";
import { useParticipantQaFeed } from "@/features/deck/live/qaFeed";
import { useParticipantSession, type StoredParticipantSession } from "@/features/deck/live/participantSession";
import type { ReviewRun, ReviewState } from "@/features/deck/types";
import { CenteredLoading } from "../components/LiveStates";
import { Notice } from "../components/Notice";
import { SlideStage } from "../components/SlideStage";
import { friendlyError } from "../lib/errors";
import { PARTICIPANT_PRODUCT } from "../lib/joinCode";
import { deckThemeKeyFrom, isContentRun, storedPayload } from "../lib/runs";
import { AppShell, PlayButton, TapFeedback, TopBar, pulse } from "../shell";

// /play/live/[publicChannelKey]/review — after the host ends the session
// (plan §7.5). GET {session}/review with the token the end revoked (still
// valid for reads). Two tabs: My Answers (my submission + results when the
// slide shares them) and All Slides (read-only walkthrough). Q&A runs read
// their questions from the feed GET.

const product = PARTICIPANT_PRODUCT;
const NO_EVENTS: DeckQaEvent[] = [];

export function ReviewScreen({ publicChannelKey }: { publicChannelKey: string }) {
	const router = useRouter();
	const stored = useParticipantSession(product, publicChannelKey);

	useEffect(() => {
		if (stored === null) router.replace("/play?reason=no-session");
	}, [stored, router]);

	if (!stored) {
		return (
			<AppShell theme="default">
				<CenteredLoading label="Loading your results" />
			</AppShell>
		);
	}
	return <ReviewContent stored={stored} />;
}

type Tab = "mine" | "all";

function ReviewContent({ stored }: { stored: StoredParticipantSession }) {
	const router = useRouter();
	const [review, setReview] = useState<ReviewState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [attempt, setAttempt] = useState(0);
	const [tab, setTab] = useState<Tab>("mine");
	const tabsId = useId();
	const liveUrl = `/play/live/${encodeURIComponent(stored.publicChannelKey)}`;

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		setError(null);
		questParticipantApi
			.getReview(stored.sessionId, stored.participantToken, controller.signal)
			.then((next) => {
				setReview(next);
				setLoading(false);
			})
			.catch((reason: unknown) => {
				const deckError = toDeckApiError(reason);
				if (deckError.code === "cancelled") return;
				if (deckError.reason === "session_not_ended") {
					router.replace(liveUrl);
					return;
				}
				if (deckError.status === 401 || deckError.status === 404) {
					router.replace("/play?reason=expired");
					return;
				}
				setError(friendlyError(deckError, "review"));
				setLoading(false);
			});
		return () => controller.abort();
	}, [stored.sessionId, stored.participantToken, attempt, liveUrl, router]);

	const theme = useMemo(() => getDeckTheme(deckThemeKeyFrom(review)), [review]);
	const runs = useMemo(() => review?.runs ?? [], [review]);
	const questionRuns = useMemo(() => runs.filter((run) => !isContentRun(run)), [runs]);
	const answerRuns = questionRuns.filter((run) => run.type !== "qa_audience");
	const answeredCount = answerRuns.filter((run) => storedPayload(run.my_answer)).length;

	const deckTitle = review?.session.deck_title ?? stored.deckTitle ?? "Session results";
	const name = review?.participant.display_name ?? stored.displayName;
	const emoji = review?.participant.emoji_avatar ?? stored.emojiAvatar;

	const tabs: { key: Tab; label: string }[] = [
		{ key: "mine", label: "My Answers" },
		{ key: "all", label: "All Slides" },
	];
	const onTabKey = (event: KeyboardEvent) => {
		if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
		event.preventDefault();
		const next: Tab = tab === "mine" ? "all" : "mine";
		setTab(next);
		document.getElementById(`${tabsId}-${next}-tab`)?.focus();
	};

	return (
		<AppShell
			theme={theme}
			topBar={
				<TopBar
					title={deckTitle}
					subtitle="Session ended"
					right={
						<span
							role="img"
							aria-label={`You: ${name}`}
							className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--deck-surface-muted)] text-[22px] leading-none"
						>
							{emoji}
						</span>
					}
				/>
			}
			footer={
				<PlayButton variant="secondary" onClick={() => router.push("/play")}>
					Join another session
				</PlayButton>
			}
		>
			{loading ? (
				<CenteredLoading label="Loading your results" />
			) : error || !review ? (
				<div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-5 py-8">
					<Notice tone="error">{error ?? "Something went wrong. Please try again."}</Notice>
					<PlayButton onClick={() => setAttempt((n) => n + 1)}>Try again</PlayButton>
				</div>
			) : (
				<div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
					<div className="px-5 pb-2 pt-5 text-center">
						<p className="text-2xl font-bold tracking-tight">Thanks for taking part, {name}!</p>
						{answerRuns.length > 0 && (
							<p className="mt-1 text-sm text-[var(--deck-text-muted)]">
								You answered {answeredCount} of {answerRuns.length} question{answerRuns.length === 1 ? "" : "s"}.
							</p>
						)}
					</div>

					<div
						role="tablist"
						aria-label="Review"
						className="sticky top-0 z-10 mx-4 mt-3 grid grid-cols-2 gap-1 rounded-full bg-[var(--deck-surface-muted)] p-1"
					>
						{tabs.map(({ key, label }) => (
							<TapFeedback
								key={key}
								id={`${tabsId}-${key}-tab`}
								role="tab"
								aria-selected={tab === key}
								aria-controls={`${tabsId}-${key}-panel`}
								tabIndex={tab === key ? 0 : -1}
								onKeyDown={onTabKey}
								onClick={() => setTab(key)}
								pressScale={0.98}
								className={cn(
									"min-h-11 rounded-full text-sm font-semibold transition-colors",
									tab === key
										? "bg-[var(--deck-surface)] text-[var(--deck-text)] shadow-sm"
										: "text-[var(--deck-text-muted)]"
								)}
							>
								{label}
							</TapFeedback>
						))}
					</div>

					<div
						id={`${tabsId}-${tab}-panel`}
						role="tabpanel"
						aria-labelledby={`${tabsId}-${tab}-tab`}
						className="flex flex-1 flex-col pb-4 pt-3"
					>
						{tab === "mine" ? (
							<MyAnswers runs={questionRuns} review={review} stored={stored} theme={theme} />
						) : (
							<AllSlides runs={runs} theme={theme} />
						)}
					</div>
				</div>
			)}
		</AppShell>
	);
}

function MyAnswers({
	runs,
	review,
	stored,
	theme,
}: {
	runs: ReviewRun[];
	review: ReviewState;
	stored: StoredParticipantSession;
	theme: DeckTheme;
}) {
	const [expanded, setExpanded] = useState<number | null>(null);

	if (runs.length === 0) {
		return <p className="px-6 py-10 text-center text-sm text-[var(--deck-text-muted)]">This session had no questions.</p>;
	}

	return (
		<ul className="flex flex-col gap-3 px-4">
			{runs.map((run) => {
				const open = expanded === run.id;
				const qa = run.type === "qa_audience";
				const mine = storedPayload(run.my_answer);
				const panelId = `ms-review-run-${run.id}`;
				return (
					<li key={run.id} className="overflow-hidden rounded-2xl border border-[var(--deck-border)] bg-[var(--deck-surface)]">
						<TapFeedback
							aria-expanded={open}
							aria-controls={panelId}
							onClick={() => setExpanded(open ? null : run.id)}
							pressScale={0.99}
							className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
						>
							<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--deck-surface-muted)] text-xs font-semibold">
								{run.position}
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate font-medium">{run.title || "Untitled slide"}</span>
								<span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--deck-text-muted)]">
									{qa ? (
										<>
											<MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden /> Q&amp;A
										</>
									) : mine ? (
										<>
											<CheckCircle2 className="h-3.5 w-3.5 text-[var(--deck-success)]" aria-hidden /> Answered
										</>
									) : (
										<>
											<CircleDashed className="h-3.5 w-3.5" aria-hidden /> No answer
										</>
									)}
									{!qa && run.results_visibility === "public" && run.aggregate ? " · results" : ""}
								</span>
							</span>
							<ChevronDown
								className={cn("h-5 w-5 shrink-0 text-[var(--deck-text-muted)] transition-transform", open && "rotate-180")}
								aria-hidden
							/>
						</TapFeedback>
						{open && (
							<div id={panelId} className="border-t border-[var(--deck-border)]">
								{qa ? (
									<ReviewQaStage run={run} sessionId={review.session_id} token={stored.participantToken} theme={theme} />
								) : (
									<SlideStage
										run={run}
										theme={theme}
										mySubmission={mine}
										disabled
										aggregate={run.results_visibility === "public" ? run.aggregate : null}
										mode="review"
									/>
								)}
							</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}

function ReviewQaStage({
	run,
	sessionId,
	token,
	theme,
}: {
	run: ReviewRun;
	sessionId: number;
	token: string;
	theme: DeckTheme;
}) {
	const qa = useParticipantQaFeed({ product, sessionId, runId: run.id, token, qaEvents: NO_EVENTS });
	return <SlideStage run={run} theme={theme} mySubmission={null} disabled qa={qa} mode="review" />;
}

const SWIPE_DISTANCE = 60;

function AllSlides({ runs, theme }: { runs: ReviewRun[]; theme: DeckTheme }) {
	const [index, setIndex] = useState(0);
	const reduceMotion = useReducedMotion();
	const direction = useRef(1);
	const run = runs[index];

	if (!run) {
		return <p className="px-6 py-10 text-center text-sm text-[var(--deck-text-muted)]">No slides to show.</p>;
	}

	const go = (next: number) => {
		if (next < 0 || next >= runs.length) return;
		direction.current = next > index ? 1 : -1;
		setIndex(next);
		pulse("tap");
	};

	const onDragEnd = (_: unknown, info: PanInfo) => {
		if (info.offset.x < -SWIPE_DISTANCE) go(index + 1);
		else if (info.offset.x > SWIPE_DISTANCE) go(index - 1);
	};

	return (
		<div
			className="flex flex-1 flex-col"
			onKeyDown={(event) => {
				if (event.key === "ArrowRight") go(index + 1);
				if (event.key === "ArrowLeft") go(index - 1);
			}}
		>
			<div className="flex items-center justify-between gap-2 px-3">
				<TapFeedback
					onClick={() => go(index - 1)}
					disabled={index === 0}
					aria-label="Previous slide"
					className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--deck-surface-muted)] disabled:opacity-30"
				>
					<ChevronLeft className="h-6 w-6" aria-hidden />
				</TapFeedback>
				<p className="text-sm font-medium text-[var(--deck-text-muted)]" aria-live="polite">
					Slide {index + 1} of {runs.length}
				</p>
				<TapFeedback
					onClick={() => go(index + 1)}
					disabled={index === runs.length - 1}
					aria-label="Next slide"
					className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--deck-surface-muted)] disabled:opacity-30"
				>
					<ChevronRight className="h-6 w-6" aria-hidden />
				</TapFeedback>
			</div>
			<motion.div
				key={run.id}
				className="mx-4 mt-2 flex min-h-[50vh] flex-1 touch-pan-y flex-col overflow-hidden rounded-2xl border border-[var(--deck-border)]"
				initial={reduceMotion ? false : { opacity: 0, x: 40 * direction.current }}
				animate={{ opacity: 1, x: 0 }}
				transition={{ type: "spring", stiffness: 380, damping: 34 }}
				drag={runs.length > 1 ? "x" : false}
				dragConstraints={{ left: 0, right: 0 }}
				dragElastic={0.25}
				onDragEnd={onDragEnd}
			>
				<SlideStage run={run} theme={theme} mySubmission={null} disabled mode="review" />
			</motion.div>
		</div>
	);
}
