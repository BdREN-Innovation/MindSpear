"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion, type PanInfo } from "framer-motion";
import {
	CheckCircle2,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	CircleDashed,
	CircleMinus,
	CircleX,
	MessageCircleQuestion,
	Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { participantApiFor } from "@/features/deck/api/participantApi";
import { toDeckApiError } from "@/features/deck/api/errors";
import { getDeckTheme, type DeckTheme } from "@/features/deck/theme";
import type { DeckQaEvent } from "@/features/deck/live/channelState";
import { useParticipantQaFeed } from "@/features/deck/live/qaFeed";
import { useParticipantSession, type StoredParticipantSession } from "@/features/deck/live/participantSession";
import {
	isScoredQuizSlideTypeKey,
	quizResultOf,
	type DeckProduct,
	type LeaderboardResponse,
	type OpenEndedAggregate,
	type OpenEndedCard,
	type ReviewRun,
	type ReviewState,
	type SlideAggregate,
} from "@/features/deck/types";
import { CenteredLoading } from "../components/LiveStates";
import { Notice } from "../components/Notice";
import { SlideStage } from "../components/SlideStage";
import { friendlyError } from "../lib/errors";
import { deckThemeKeyFrom, isContentRun, runTitle, storedPayload } from "../lib/runs";
import { AppShell, PlayButton, TapFeedback, TopBar, pulse } from "../shell";

// /play/live/[publicChannelKey]/review — after the host ends the session
// (plan §7.5). GET {session}/review with the token the end revoked (still
// valid for reads). Two tabs: My Answers (my submission + results when the
// slide shares them) and All Slides (read-only walkthrough, results too).
// The type components get mode "review" ("Final results" wording). Q&A runs
// read their questions from the feed GET; open_ended runs swap the review's
// preview (10 newest cards, bodies cut) for full pages of the aggregate GET.
//
// The stored session names the product (quest or quiz routes). Quiz reviews
// add my final place (GET .../leaderboard: `me` + the top three) and, per
// scored slide, whether I was right and the points it gave (the revealed
// my_answer keys), which the type components also get as `reveal`.

const NO_EVENTS: DeckQaEvent[] = [];
const PODIUM = ["🥇", "🥈", "🥉"];

export function ReviewScreen({ publicChannelKey }: { publicChannelKey: string }) {
	const router = useRouter();
	const stored = useParticipantSession(null, publicChannelKey);

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
	const product: DeckProduct = stored.product ?? "quest";
	const api = participantApiFor(product);
	const isQuiz = product === "quiz";

	// Quiz: my final place and the top three (works with the token the end revoked).
	const [ranking, setRanking] = useState<LeaderboardResponse | null>(null);
	useEffect(() => {
		if (!isQuiz) return;
		const controller = new AbortController();
		api
			.getLeaderboard(stored.sessionId, stored.participantToken, { limit: 3, signal: controller.signal })
			.then(setRanking)
			.catch(() => {
				// The per-slide points still show; the place is a bonus.
			});
		return () => controller.abort();
	}, [isQuiz, api, stored.sessionId, stored.participantToken]);

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		setError(null);
		api
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
	}, [api, stored.sessionId, stored.participantToken, attempt, liveUrl, router]);

	const theme = useMemo(() => getDeckTheme(deckThemeKeyFrom(review)), [review]);
	const runs = useMemo(() => review?.runs ?? [], [review]);
	// Leaderboard slides only showed the standing at that moment; the final one is at the top.
	const walkthroughRuns = useMemo(() => runs.filter((run) => run.type !== "leaderboard"), [runs]);
	const questionRuns = useMemo(() => runs.filter((run) => !isContentRun(run)), [runs]);
	const answerRuns = questionRuns.filter((run) => run.type !== "qa_audience");
	const answeredCount = answerRuns.filter((run) => storedPayload(run.my_answer)).length;
	const scoredRuns = isQuiz ? answerRuns.filter((run) => isScoredQuizSlideTypeKey(run.type)) : [];
	const scoredResults = scoredRuns.map((run) => quizResultOf(run.my_answer));
	const correctCount = scoredResults.filter((result) => result?.is_correct).length;
	// Ratio types (match / order / categorise) give points for a partly right answer.
	const partlyCount = scoredResults.filter((result) => result && !result.is_correct && result.points_awarded > 0).length;
	const pointsFromRuns = scoredRuns.reduce((sum, run) => sum + (quizResultOf(run.my_answer)?.points_awarded ?? 0), 0);
	const me = ranking?.me ?? null;

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
								You answered {answeredCount} of {answerRuns.length} question{answerRuns.length === 1 ? "" : "s"}
								{scoredRuns.length > 0 ? scoreSummary(correctCount, partlyCount) : ""}.
							</p>
						)}
					</div>

					{isQuiz && (
						<FinalPlace
							rank={me?.rank ?? null}
							points={me?.total_points ?? pointsFromRuns}
							players={ranking?.participant_count ?? null}
							top={ranking?.leaderboard ?? []}
							myId={stored.participantId}
						/>
					)}

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
							<MyAnswers runs={questionRuns} review={review} stored={stored} theme={theme} product={product} />
						) : (
							<AllSlides runs={walkthroughRuns} review={review} stored={stored} theme={theme} product={product} />
						)}
					</div>
				</div>
			)}
		</AppShell>
	);
}

/** " and got 3 right" / " and got 2 right and 1 partly right" / " and got 1 partly right". */
function scoreSummary(correct: number, partly: number): string {
	if (partly === 0) return ` and got ${correct} right`;
	if (correct === 0) return ` and got ${partly} partly right`;
	return ` and got ${correct} right and ${partly} partly right`;
}

/** Quiz: "You finished #2 of 14 · 340 points" + the top three. */
function FinalPlace({
	rank,
	points,
	players,
	top,
	myId,
}: {
	rank: number | null;
	points: number;
	players: number | null;
	top: LeaderboardResponse["leaderboard"];
	myId: number;
}) {
	return (
		<section aria-label="Your final place" className="mx-4 mt-3 rounded-2xl border border-[var(--deck-border)] bg-[var(--deck-surface)] p-4">
			<div className="flex items-center gap-3">
				<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--deck-primary)] text-[var(--deck-on-primary)]">
					<Trophy className="h-6 w-6" aria-hidden />
				</span>
				<div className="min-w-0">
					<p className="text-lg font-bold leading-tight">
						{rank ? `You finished #${rank}${players ? ` of ${players}` : ""}` : "Your score"}
					</p>
					<p className="text-sm font-semibold tabular-nums text-[var(--deck-text-muted)]">{points} points</p>
				</div>
			</div>
			{top.length > 0 && (
				<ol className="mt-3 flex flex-col gap-1.5" aria-label="Top players">
					{top.map((row, index) => (
						<li
							key={row.participant_id}
							className={cn(
								"flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm",
								row.participant_id === myId
									? "bg-[var(--deck-surface-muted)] font-semibold ring-1 ring-[var(--deck-primary)]"
									: "bg-[var(--deck-surface-muted)]"
							)}
						>
							<span className="w-6 text-center" aria-hidden>
								{PODIUM[row.rank - 1] ?? PODIUM[index] ?? row.rank}
							</span>
							<span className="sr-only">Rank {row.rank}:</span>
							<span aria-hidden>{row.emoji_avatar}</span>
							<span className="min-w-0 flex-1 truncate">
								{row.display_name ?? "Player"}
								{row.participant_id === myId ? " (you)" : ""}
							</span>
							<span className="font-semibold tabular-nums">{row.total_points} pts</span>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

/** Quiz row status: ✓ +80 pts / partly right / ✗ 0 pts (null: not a revealed scored run). */
function QuizRowStatus({ run }: { run: ReviewRun }) {
	const result = isScoredQuizSlideTypeKey(run.type) ? quizResultOf(run.my_answer) : null;
	if (!result) return null;
	if (result.is_correct) {
		return (
			<>
				<CheckCircle2 className="h-3.5 w-3.5 text-[var(--deck-success)]" aria-hidden /> Correct · +{result.points_awarded} pts
			</>
		);
	}
	if (result.points_awarded > 0) {
		return (
			<>
				<CircleMinus className="h-3.5 w-3.5 text-[var(--deck-success)]" aria-hidden /> Partly right · +{result.points_awarded} pts
			</>
		);
	}
	return (
		<>
			<CircleX className="h-3.5 w-3.5 text-[var(--deck-danger)]" aria-hidden /> Wrong · 0 pts
		</>
	);
}

function MyAnswers({
	runs,
	review,
	stored,
	theme,
	product,
}: {
	runs: ReviewRun[];
	review: ReviewState;
	stored: StoredParticipantSession;
	theme: DeckTheme;
	product: DeckProduct;
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
				const scoredResult = isScoredQuizSlideTypeKey(run.type) ? quizResultOf(run.my_answer) : null;
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
								<span className="block truncate font-medium">{runTitle(run)}</span>
								<span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--deck-text-muted)]">
									{qa ? (
										<>
											<MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden /> Q&amp;A
										</>
									) : scoredResult ? (
										<QuizRowStatus run={run} />
									) : mine ? (
										<>
											<CheckCircle2 className="h-3.5 w-3.5 text-[var(--deck-success)]" aria-hidden /> Answered
										</>
									) : (
										<>
											<CircleDashed className="h-3.5 w-3.5" aria-hidden /> No answer
										</>
									)}
									{!qa && !scoredResult && run.results_visibility === "public" && run.aggregate ? " · results" : ""}
								</span>
							</span>
							<ChevronDown
								className={cn("h-5 w-5 shrink-0 text-[var(--deck-text-muted)] transition-transform", open && "rotate-180")}
								aria-hidden
							/>
						</TapFeedback>
						{open && (
							<div id={panelId} className="border-t border-[var(--deck-border)]">
								<ReviewRunStage
									run={run}
									sessionId={review.session_id}
									token={stored.participantToken}
									theme={theme}
									product={product}
								/>
							</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}

interface ReviewStageProps {
	run: ReviewRun;
	sessionId: number;
	token: string;
	theme: DeckTheme;
	product: DeckProduct;
}

/** One run in review: my answer, the final results when the slide shares them, Q&A from the feed. */
function ReviewRunStage(props: ReviewStageProps) {
	if (props.run.type === "qa_audience") return <ReviewQaStage {...props} />;
	if (isContentRun(props.run)) {
		return <SlideStage run={props.run} theme={props.theme} mySubmission={null} disabled mode="review" />;
	}
	return <ReviewAnswerStage {...props} />;
}

function ReviewAnswerStage({ run, sessionId, token, theme, product }: ReviewStageProps) {
	const shared = run.results_visibility === "public" ? run.aggregate : null;
	const openEnded = useOpenEndedPages(run, sessionId, token, shared, product);
	const reveal = product === "quiz" && isScoredQuizSlideTypeKey(run.type) ? quizResultOf(run.my_answer) : null;
	return (
		<>
			<SlideStage
				run={run}
				theme={theme}
				mySubmission={storedPayload(run.my_answer)}
				disabled
				aggregate={openEnded.aggregate ?? shared}
				mode="review"
				reveal={reveal}
			/>
			{(openEnded.hasMore || openEnded.error) && (
				<div className="flex flex-col items-center gap-2 px-4 pb-4">
					{openEnded.error && <Notice tone="error">{openEnded.error}</Notice>}
					<PlayButton variant="secondary" size="md" loading={openEnded.loading} onClick={openEnded.loadMore}>
						{openEnded.error ? "Try again" : "Show more responses"}
					</PlayButton>
				</div>
			)}
		</>
	);
}

/**
 * open_ended in review: the review carries the broadcast preview (10 newest
 * cards, bodies cut at 200 characters). Read the full-text pages (20 cards
 * each) from GET .../aggregate?page=N instead, one more page per "Show more".
 */
function useOpenEndedPages(
	run: ReviewRun,
	sessionId: number,
	token: string,
	shared: SlideAggregate | null,
	product: DeckProduct
) {
	const preview = run.type === "open_ended" ? (shared as OpenEndedAggregate | null) : null;
	const needed = !!preview && (preview.truncated || preview.total_entries > preview.items.length);
	const [cards, setCards] = useState<OpenEndedCard[] | null>(null);
	const [page, setPage] = useState(0);
	const [lastPage, setLastPage] = useState(1);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const load = useCallback(
		async (next: number) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setLoading(true);
			setError(null);
			try {
				const snapshot = await participantApiFor(product).getAggregate<OpenEndedAggregate>(sessionId, run.id, token, {
					page: next,
					signal: controller.signal,
				});
				if (controller.signal.aborted) return;
				const fresh = snapshot.aggregate.items ?? [];
				setCards((previous) => {
					const kept = next === 1 ? [] : (previous ?? []);
					const seen = new Set(kept.map((card) => card.id));
					return [...kept, ...fresh.filter((card) => !seen.has(card.id))];
				});
				setPage(next);
				setLastPage(snapshot.aggregate.last_page ?? next);
			} catch (reason) {
				const deckError = toDeckApiError(reason);
				if (deckError.code === "cancelled") return;
				setError(friendlyError(deckError, "review"));
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		},
		[run.id, sessionId, token, product]
	);

	useEffect(() => {
		if (needed) void load(1);
		return () => abortRef.current?.abort();
	}, [needed, load]);

	const hasMore = needed && cards !== null && page < lastPage;
	const aggregate: OpenEndedAggregate | null =
		needed && preview && cards
			? { ...preview, items: cards, page: 1, per_page: cards.length, last_page: hasMore ? lastPage : 1, truncated: hasMore }
			: null;

	return {
		aggregate,
		hasMore: hasMore && !error,
		error: needed ? error : null,
		loading,
		loadMore: () => void load(cards === null ? 1 : page + 1),
	};
}

function ReviewQaStage({ run, sessionId, token, theme, product }: ReviewStageProps) {
	const qa = useParticipantQaFeed({ product, sessionId, runId: run.id, token, qaEvents: NO_EVENTS });
	return <SlideStage run={run} theme={theme} mySubmission={null} disabled qa={qa} mode="review" />;
}

const SWIPE_DISTANCE = 60;

function AllSlides({
	runs,
	review,
	stored,
	theme,
	product,
}: {
	runs: ReviewRun[];
	review: ReviewState;
	stored: StoredParticipantSession;
	theme: DeckTheme;
	product: DeckProduct;
}) {
	const [index, setIndex] = useState(0);
	const reduceMotion = useReducedMotion();
	const direction = useRef(1);
	const run = runs[index];

	if (!run) {
		return <p className="px-6 py-10 text-center text-sm text-[var(--deck-text-muted)]">No slides to show.</p>;
	}

	// The arrow buttons buzz through TapFeedback; swipes buzz here.
	const go = (next: number, buzz = false) => {
		if (next < 0 || next >= runs.length) return;
		direction.current = next > index ? 1 : -1;
		setIndex(next);
		if (buzz) pulse("tap");
	};

	const onDragEnd = (_: unknown, info: PanInfo) => {
		if (info.offset.x < -SWIPE_DISTANCE) go(index + 1, true);
		else if (info.offset.x > SWIPE_DISTANCE) go(index - 1, true);
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
				<ReviewRunStage
					run={run}
					sessionId={review.session_id}
					token={stored.participantToken}
					theme={theme}
					product={product}
				/>
			</motion.div>
		</div>
	);
}
