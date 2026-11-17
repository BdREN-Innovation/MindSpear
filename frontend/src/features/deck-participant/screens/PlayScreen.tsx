"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { participantApiFor } from "@/features/deck/api/participantApi";
import { toDeckApiError } from "@/features/deck/api/errors";
import { DeckThemeProvider, getDeckTheme } from "@/features/deck/theme";
import { useParticipantQaFeed } from "@/features/deck/live/qaFeed";
import {
	clearDeviceParticipant,
	clearParticipantSession,
	useParticipantSession,
	type StoredParticipantSession,
} from "@/features/deck/live/participantSession";
import { useDeckSessionChannel } from "@/features/deck/live/useDeckSessionChannel";
import { runScoring } from "@/features/deck/lib/quiz";
import {
	hasQuizResult,
	isScoredQuizSlideTypeKey,
	quizResultOf,
	type AnswerPayload,
	type MySubmission,
	type ParticipantRunView,
	type ParticipantSessionState,
} from "@/features/deck/types";
import type { ParticipantQuizInfo } from "@/features/deck-editor/slides/types";
import { ConnectionBanner } from "../components/ConnectionBanner";
import {
	CenteredLoading,
	GetReadyOverlay,
	LobbyView,
	StandingPill,
	SubmittedStrip,
	TimerBar,
	VotingClosedView,
	WaitingForHost,
} from "../components/LiveStates";
import { Notice } from "../components/Notice";
import { ReconnectScreen } from "../components/ReconnectScreen";
import { LeaveSessionSheet, ParticipantMenuSheet } from "../components/SessionSheets";
import { SlideStage } from "../components/SlideStage";
import { friendlyError } from "../lib/errors";
import { useBackGuard, useOnlineStatus, usePrevious } from "../lib/hooks";
import { useParticipantPresence } from "../lib/usePresence";
import { deckThemeKeyFrom, isContentRun, provisionalSubmission, runTitle, storedPayload } from "../lib/runs";
import { InstallBanner } from "../pwa/InstallBanner";
import { AppShell, TapFeedback, TopBar, pulse, useAnnouncer } from "../shell";

// /play/live/[publicChannelKey] — the live play screen (plan §7.2, §7.4, §7.6).
//
// State comes from useDeckSessionChannel with the participant state
// endpoint (token from sessionStorage), so a refresh or reconnect rehydrates
// the current run and my submission. The run's state picks the screen:
// waiting → get_ready (countdown) → voting/open (the type's Participant)
// → closed (results only when the state says they are public). Content
// slides render the Participant read-only. session.ended (or a revoked
// token) goes to the review screen.
//
// Traffic: one GET state on load / reconnect / slim or revisited slides
// (spread over 0–2 s by useDeckSessionChannel), one POST per answer — the
// stored answer is rebuilt locally (provisionalSubmission) instead of being
// read back, so a 500-phone room behind one NAT stays under the rate limit.
//
// The route names no product: the stored session (saved at join) says
// whether this is a Quest or a Quiz session, which picks the API
// (participantApiFor) and the channel. Quiz sessions add: run config.scoring
// for the type's points bar, the `reveal` state (my result from the one
// state read after the reveal, below) passed as props.reveal, my standing (top bar +
// props.standing), and the quiz block (submitted count, spin, leaderboard
// rows) for every run's component. The type components draw the points bar,
// "locked in" and the ✓ / ✗ "+N points" result; the shell adds none of them.
//
// After a quiz reveal each phone makes exactly ONE read, spread over 0–2 s:
// GET state, whose my_submission_for_current_slide carries my result and
// `standing` my total and rank (fresh for everyone, not only the reveal's
// top-10 leaderboard_delta). None of its own when a state read already
// carried the reveal (or one is coming because slide.revealed came slim /
// never came).
//
// Answers on scored quiz runs are final: a second POST is 409
// already_answered, which keeps the locked-in screen (the state read brings
// the first answer back). "Leave session" posts .../participants/leave;
// pagehide sends a keepalive leave and a reload rejoins as the same
// participant (lib/usePresence.ts).

/** Participants spread their one read after a reveal over this window. */
const REVEAL_READ_JITTER_MS = 2000;

export function PlayScreen({ publicChannelKey }: { publicChannelKey: string }) {
	const router = useRouter();
	const loaded = useParticipantSession(null, publicChannelKey);
	// A rejoin that came back as a different participant (lib/usePresence.ts).
	const [replaced, setReplaced] = useState<StoredParticipantSession | null>(null);
	const stored = replaced && replaced.publicChannelKey === publicChannelKey ? replaced : loaded;

	useEffect(() => {
		if (stored === null) router.replace("/play?reason=no-session");
	}, [stored, router]);

	if (!stored) {
		return (
			<AppShell theme="default">
				<CenteredLoading label="Opening the session" />
			</AppShell>
		);
	}
	return <LiveSession key={stored.participantToken} stored={stored} onReplaced={setReplaced} />;
}

/** Remembered per tab so a reload keeps the deck colours before the first state arrives. */
const themeMemory = new Map<string, string>();

function LiveSession({
	stored,
	onReplaced,
}: {
	stored: StoredParticipantSession;
	onReplaced: (next: StoredParticipantSession) => void;
}) {
	const router = useRouter();
	const online = useOnlineStatus();
	const { sessionId, participantToken: token, publicChannelKey } = stored;
	const product = stored.product ?? "quest";
	const api = participantApiFor(product);
	const isQuiz = product === "quiz";

	const fetchState = useCallback(
		(signal: AbortSignal) => api.getState(sessionId, token, signal),
		[api, sessionId, token]
	);
	const channel = useDeckSessionChannel<ParticipantSessionState>({
		product,
		publicChannelKey,
		fetchState,
		// Backs off 5 s → 60 s (jittered) while the socket is down.
		pollWhileDisconnectedMs: 5_000,
	});
	const { currentRun, slimRun, runState, latestState, sessionStatus, status, error, isResyncing, resync } = channel;

	const reviewUrl = `/play/live/${encodeURIComponent(publicChannelKey)}/review`;
	const ended = sessionStatus === "ended";
	const tokenRejected = error?.status === 401;
	const sessionGone = error?.status === 404;

	// Ended (event or snapshot) or the token was revoked by the end → review.
	useEffect(() => {
		if (ended || tokenRejected) router.replace(reviewUrl);
	}, [ended, tokenRejected, reviewUrl, router]);

	useEffect(() => {
		if (!sessionGone) return;
		clearParticipantSession(product, sessionId);
		clearDeviceParticipant(product, sessionId);
		router.replace("/play?reason=expired");
	}, [sessionGone, product, sessionId, router]);

	// First load failed (network): retry with jittered backoff (honouring a
	// 429's retry_after) while showing the reconnect screen.
	const [retryCount, setRetryCount] = useState(0);
	const loadFailed = !latestState && !!error && !tokenRejected && !sessionGone;
	useEffect(() => {
		if (!loadFailed || isResyncing) return;
		const base = Math.min(15_000, 2_000 * 2 ** Math.min(retryCount, 3));
		const retryAfter = error?.code === "too_many_requests" ? Number(error.data.retry_after) * 1000 : 0;
		const delay = Math.max(base / 2 + Math.random() * (base / 2), Number.isFinite(retryAfter) ? retryAfter : 0);
		const timer = window.setTimeout(() => {
			setRetryCount((n) => n + 1);
			void resync();
		}, delay);
		return () => window.clearTimeout(timer);
	}, [loadFailed, isResyncing, retryCount, resync, error]);
	useEffect(() => {
		if (latestState) setRetryCount(0);
	}, [latestState]);

	// Theme: from the state when the backend sends one, remembered per channel.
	const stateTheme = deckThemeKeyFrom(latestState);
	if (stateTheme) themeMemory.set(publicChannelKey, stateTheme);
	const theme = useMemo(
		() => getDeckTheme(stateTheme ?? themeMemory.get(publicChannelKey) ?? null),
		[stateTheme, publicChannelKey]
	);

	/* -------------------------- my submissions -------------------------- */

	const [submissions, setSubmissions] = useState<Record<number, MySubmission | null>>({});
	const submissionsRef = useRef(submissions);
	submissionsRef.current = submissions;

	// The state snapshot is the server's word for its current run. A run the
	// host went back to is re-read by the channel (slide.changed past
	// `waiting`), so an earlier answer arrives here too — no my-answer GET.
	useEffect(() => {
		const run = latestState?.current_run;
		if (!run) return;
		const mine = latestState.my_submission_for_current_slide;
		setSubmissions((previous) => {
			// A read that started before the reveal must not drop a result we already hold.
			if (mine && hasQuizResult(previous[run.id]) && !hasQuizResult(mine)) return previous;
			if (mine) return previous[run.id] === mine ? previous : { ...previous, [run.id]: mine };
			// "Not answered" only fills a gap: a submit may have landed after this read started.
			return run.id in previous ? previous : { ...previous, [run.id]: null };
		});
	}, [latestState]);

	const mySubmission = currentRun ? (submissions[currentRun.id] ?? null) : null;

	/* ------------------------------ submit ------------------------------ */

	// The live region is the AppShell's; this screen sits outside it, so it shares one.
	const announcer = useAnnouncer();
	const { announce } = announcer;
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<{ runId: number; message: string } | null>(null);
	const currentRunRef = useRef<ParticipantRunView | null>(currentRun);
	currentRunRef.current = currentRun;

	// The type component gets the DeckApiError back (it shows 422 field errors
	// inline); the shell shows everything else in the bottom strip. The submit
	// haptic belongs to the component (useSubmit); the shell only buzzes errors.
	const onSubmit = useCallback(
		async (payload: unknown) => {
			const run = currentRunRef.current;
			if (!run) throw toDeckApiError(new Error("No slide is open right now."));
			setSubmitting(true);
			setSubmitError(null);
			try {
				await api.submitAnswer(sessionId, run.id, token, payload as AnswerPayload);
				// The POST answers 204: rebuild what the server stored with the same
				// merge rules. A later state read (reconnect / revisit) replaces it.
				const provisional = provisionalSubmission(run, payload, submissionsRef.current[run.id]);
				setSubmissions((previous) => ({ ...previous, [run.id]: provisional }));
			} catch (reason) {
				const deckError = toDeckApiError(reason);
				if (deckError.reason === "already_answered") {
					// Answers are final on scored quiz runs: the first one (e.g. a POST whose
					// response was lost) stands. Stay locked in; the state read brings it back.
					setSubmissions((previous) =>
						storedPayload(previous[run.id])
							? previous
							: { ...previous, [run.id]: provisionalSubmission(run, payload, previous[run.id]) }
					);
					announce("Your answer is already locked in.");
					void resync();
					return;
				}
				pulse("error");
				if (deckError.status !== 422) setSubmitError({ runId: run.id, message: friendlyError(deckError, "answer") });
				// The run moved on / closed / the token died: catch up with the server.
				if (deckError.code === "invalid_state" || deckError.status === 401) void resync();
				throw deckError;
			} finally {
				setSubmitting(false);
			}
		},
		[api, sessionId, token, resync, announce]
	);

	/* ---------------------------- Q&A helper ---------------------------- */

	const isQa = currentRun?.type === "qa_audience";
	const qa = useParticipantQaFeed({
		product,
		sessionId,
		runId: isQa ? currentRun?.id : null,
		token,
		qaEvents: channel.qaEvents,
		enabled: isQa,
	});

	/* ------------------------------- a11y ------------------------------- */

	// The countdown clocks live in TimerBar / GetReadyOverlay (they tick 4×/s;
	// this screen and the answer component only render on state changes).
	const state = runState?.state ?? currentRun?.state ?? null;

	/* ------------------------------- quiz ------------------------------- */

	const scoredRun = isQuiz && !!currentRun && isScoredQuizSlideTypeKey(currentRun.type);
	const scoring = isQuiz ? runScoring(currentRun) : null;
	const standing = isQuiz ? channel.standing : null;
	const liveQuiz = channel.quiz;
	const participantQuiz = useMemo<ParticipantQuizInfo | null>(
		() =>
			isQuiz && liveQuiz && currentRun && liveQuiz.slide_run_id === currentRun.id
				? { ...liveQuiz, participant_id: stored.participantId }
				: null,
		[isQuiz, liveQuiz, currentRun, stored.participantId]
	);

	// After a reveal: ONE state read per phone and run (see the header), spread
	// over 0–2 s. "Landed" = slide.revealed brought the public aggregate, or a
	// state read in `reveal` did; until then the channel's own state read (slim
	// / lost slide.revealed) is on its way, and that read is the one.
	const revealReads = useRef(new Set<number>());
	const revealRunId = scoredRun && state === "reveal" ? (currentRun?.id ?? null) : null;
	const revealLanded = revealRunId !== null && channel.resultsVisibility === "public" && channel.aggregate !== null;
	const latestStateRef = useRef(latestState);
	latestStateRef.current = latestState;
	useEffect(() => {
		if (revealRunId === null || !revealLanded || revealReads.current.has(revealRunId)) return;
		const runId = revealRunId;
		const reads = revealReads.current;
		// A state read of this run in `reveal` carried my_submission (with correctness) and `standing`.
		const stateCarriedIt = () => {
			const run = latestStateRef.current?.current_run;
			return run?.id === runId && run.state === "reveal";
		};
		reads.add(runId);
		if (stateCarriedIt()) return;
		let done = false;
		const timer = window.setTimeout(() => {
			done = true;
			if (!stateCarriedIt()) void resync();
		}, Math.random() * REVEAL_READ_JITTER_MS);
		return () => {
			window.clearTimeout(timer);
			if (!done) reads.delete(runId);
		};
	}, [revealRunId, revealLanded, resync]);

	const previousRunId = usePrevious(currentRun?.id);
	const previousState = usePrevious(state);
	useEffect(() => {
		if (!currentRun || !state) return;
		if (previousRunId !== currentRun.id) {
			const position = `Slide ${currentRun.position}${channel.totalSlides ? ` of ${channel.totalSlides}` : ""}`;
			announce(`${position}: ${runTitle(currentRun)}.${state === "voting" ? " Voting is open." : ""}`);
			return;
		}
		if (previousState === state) return;
		if (state === "get_ready") announce("Get ready.");
		if (state === "voting") {
			announce(scoredRun ? "Answering is open." : "Voting is now open.");
			pulse("tap");
		}
		if (state === "open") announce("Questions are now open.");
		if (state === "closed") announce(isQa ? "Questions are closed." : "Voting is closed.");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentRun?.id, state]);

	// Slides slide in from the right going forward, from the left going back (plan §4.3).
	// (Adjusted while rendering — React's "previous props" pattern — so the new
	// run mounts with the right direction on its first frame.)
	const [slideMove, setSlideMove] = useState<{ runId: number | null; position: number | null; direction: 1 | -1 | 0 }>({
		runId: null,
		position: null,
		direction: 0,
	});
	if (currentRun && slideMove.runId !== currentRun.id) {
		const before = slideMove.position;
		setSlideMove({
			runId: currentRun.id,
			position: currentRun.position,
			direction: before === null ? 0 : currentRun.position >= before ? 1 : -1,
		});
	}

	const previousStatus = usePrevious(status);
	useEffect(() => {
		if ((status === "reconnecting" || status === "disconnected") && previousStatus === "connected") {
			announce("Connection lost. Reconnecting.");
		}
		if (status === "connected" && (previousStatus === "reconnecting" || previousStatus === "disconnected")) {
			announce("Reconnected.");
		}
	}, [status, previousStatus, announce]);

	/* --------------------------- leave session -------------------------- */

	const [leaveOpen, setLeaveOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	useBackGuard(!ended && !tokenRejected && !sessionGone, () => {
		setMenuOpen(false);
		setLeaveOpen(true);
	});
	const leave = () => {
		setLeaveOpen(false);
		// Off the room's counts at once (and out of the quiz's "everyone answered" check).
		// The device token stays: joining again with the code brings this participant back.
		void api.leave(sessionId, token).catch(() => undefined);
		clearParticipantSession(product, sessionId);
		router.replace("/play?reason=left");
	};

	// pagehide → keepalive leave; a reload / bfcache restore → rejoin as the same participant.
	const stateRef = useRef(state);
	stateRef.current = state;
	useParticipantPresence({
		api,
		stored,
		enabled: !ended && !tokenRejected && !sessionGone,
		// Mid-answer on a quiz question: a reload must not reveal it early for everyone.
		shouldStay: () => {
			const run = currentRunRef.current;
			const runState = stateRef.current;
			if (!isQuiz || !run || !isScoredQuizSlideTypeKey(run.type)) return false;
			if (runState !== "voting" && runState !== "get_ready") return false;
			return !storedPayload(submissionsRef.current[run.id]);
		},
		onReplaced,
	});

	/* ------------------------------ render ------------------------------ */

	const deckTitle = latestState?.session.deck_title ?? stored.deckTitle ?? "Live session";
	const name = latestState?.participant.display_name ?? stored.displayName;
	const emoji = latestState?.participant.emoji_avatar ?? stored.emojiAvatar;
	const total = channel.totalSlides;
	const position = currentRun?.position ?? slimRun?.position ?? null;
	const progressLabel = position ? `Slide ${position}${total ? ` of ${total}` : ""}` : undefined;
	// Public results go to the type component in every state (voting, closed):
	// it shows them whether or not this participant answered.
	const resultsPublic = channel.resultsVisibility === "public";
	const visibleAggregate = resultsPublic ? channel.aggregate : null;
	const answering = state === "voting" || state === "open" || state === "get_ready";
	const answered = !!storedPayload(mySubmission);
	const reveal = scoredRun && state === "reveal" ? quizResultOf(mySubmission) : null;
	// Quiz extras for every run's component (all null on Quest).
	const quizProps = isQuiz ? { scoring, standing, quiz: participantQuiz } : {};

	let body: React.ReactNode;
	if (!latestState && !currentRun) {
		body = loadFailed ? (
			<ReconnectScreen message={friendlyError(error, "state")} onRetry={resync} retrying={isResyncing} />
		) : (
			<CenteredLoading label="Joining the session" />
		);
	} else if (!currentRun) {
		body = slimRun ? (
			<CenteredLoading label="Loading the next slide" />
		) : (
			<LobbyView name={name} emoji={emoji} deckTitle={deckTitle} />
		);
	} else if (isContentRun(currentRun)) {
		// Content, plus the quiz spinner and leaderboard (no answers; their live data is in `quiz`).
		body = <SlideStage run={currentRun} theme={theme} mySubmission={null} disabled mode="live" {...quizProps} />;
	} else if (state === "get_ready") {
		body = (
			<GetReadyOverlay run={currentRun} endsAt={runState?.ends_at} durationSeconds={runState?.duration_seconds} />
		);
	} else if (state === "voting" || state === "open") {
		body = (
			<>
				{state === "voting" && <TimerBar endsAt={runState?.ends_at} durationSeconds={runState?.duration_seconds} />}
				<SlideStage
					run={currentRun}
					theme={theme}
					mySubmission={storedPayload(mySubmission)}
					onSubmit={onSubmit}
					disabled={submitting || !online}
					aggregate={visibleAggregate}
					qa={isQa ? qa : undefined}
					mode="live"
					{...quizProps}
				/>
			</>
		);
	} else if (state === "reveal") {
		// Quiz: the type's revealed view (my result, the correct answer, results).
		body = (
			<SlideStage
				run={currentRun}
				theme={theme}
				mySubmission={storedPayload(mySubmission)}
				disabled
				aggregate={visibleAggregate}
				mode="live"
				reveal={reveal}
				{...quizProps}
			/>
		);
	} else if (state === "closed") {
		body = (
			<VotingClosedView run={currentRun} answered={answered} resultsVisible={resultsPublic}>
				<SlideStage
					run={currentRun}
					theme={theme}
					mySubmission={storedPayload(mySubmission)}
					disabled
					aggregate={visibleAggregate}
					qa={isQa ? qa : undefined}
					mode="live"
				/>
			</VotingClosedView>
		);
	} else {
		body = <WaitingForHost run={currentRun} />;
	}

	const runError = submitError && submitError.runId === currentRun?.id ? submitError.message : null;
	const footer = runError ? (
		<Notice tone="error" className="mb-1">
			{runError}
		</Notice>
	) : currentRun && state === "voting" && !isQa && !scoredRun && answered ? (
		// Quiz types show their own "Answer locked in" screen.
		<SubmittedStrip message="Answer sent · waiting for the host" />
	) : null;

	return (
		<>
			<AppShell
				theme={theme}
				announcer={announcer}
				transitionKey={currentRun?.id ?? (latestState ? "lobby" : "loading")}
				transitionDirection={slideMove.direction}
				topBar={
					<TopBar
						title={deckTitle}
						subtitle={progressLabel}
						onBack={() => setLeaveOpen(true)}
						backIcon="close"
						backLabel="Leave session"
						right={
							<>
								{isQuiz && <StandingPill standing={standing} />}
								<TapFeedback
								onClick={() => setMenuOpen(true)}
								aria-label={`You: ${name}. Settings`}
								className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--deck-surface-muted)] text-[22px] leading-none"
							>
								<span aria-hidden>{emoji}</span>
								</TapFeedback>
							</>
						}
					/>
				}
				banner={
					<ConnectionBanner
						status={status}
						online={online}
						failed={!!error && !!latestState && !tokenRejected && !sessionGone}
						resyncing={isResyncing}
						onRetry={() => void resync()}
					/>
				}
				footer={footer}
			>
				{body}
				{!answering && latestState && (
					<div className="mt-auto pt-4">
						<InstallBanner />
					</div>
				)}
			</AppShell>
			{/* Sheets portal to <body>; the provider hands them the deck palette. */}
			<DeckThemeProvider theme={theme} className="contents">
				<LeaveSessionSheet open={leaveOpen} onStay={() => setLeaveOpen(false)} onLeave={leave} />
				<ParticipantMenuSheet
					open={menuOpen}
					onClose={() => setMenuOpen(false)}
					name={name}
					emoji={emoji}
					deckTitle={deckTitle}
					onLeave={() => {
						setMenuOpen(false);
						setLeaveOpen(true);
					}}
				/>
			</DeckThemeProvider>
		</>
	);
}
