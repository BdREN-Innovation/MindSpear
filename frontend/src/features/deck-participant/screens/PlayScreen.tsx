"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { questParticipantApi } from "@/features/deck/api/participantApi";
import { toDeckApiError } from "@/features/deck/api/errors";
import { DeckThemeProvider, getDeckTheme } from "@/features/deck/theme";
import { useParticipantQaFeed } from "@/features/deck/live/qaFeed";
import {
	clearParticipantSession,
	useParticipantSession,
	type StoredParticipantSession,
} from "@/features/deck/live/participantSession";
import { useDeckSessionChannel } from "@/features/deck/live/useDeckSessionChannel";
import { useServerClock } from "@/features/deck/live/useServerClock";
import type {
	AnswerPayload,
	MySubmission,
	ParticipantRunView,
	ParticipantSessionState,
	RunState,
} from "@/features/deck/types";
import { ConnectionBanner } from "../components/ConnectionBanner";
import {
	CenteredLoading,
	GetReadyOverlay,
	LobbyView,
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
import { PARTICIPANT_PRODUCT } from "../lib/joinCode";
import { deckThemeKeyFrom, isAnswerRun, isContentRun, provisionalSubmission, storedPayload } from "../lib/runs";
import { InstallBanner } from "../pwa/InstallBanner";
import { AppShell, TapFeedback, TopBar, pulse, useAnnounce } from "../shell";

// /play/live/[publicChannelKey] — the live play screen (plan §7.2, §7.4, §7.6).
//
// State comes from useDeckSessionChannel with the participant state
// endpoint (token from sessionStorage), so a refresh or reconnect rehydrates
// the current run and my submission. The run's state picks the screen:
// waiting → get_ready (countdown) → voting/open (the type's Participant)
// → closed (results only when the state says they are public). Content
// slides render the Participant read-only. session.ended (or a revoked
// token) goes to the review screen.

const product = PARTICIPANT_PRODUCT;

export function PlayScreen({ publicChannelKey }: { publicChannelKey: string }) {
	const router = useRouter();
	const stored = useParticipantSession(product, publicChannelKey);

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
	return <LiveSession stored={stored} />;
}

/** Remembered per tab so a reload keeps the deck colours before the first state arrives. */
const themeMemory = new Map<string, string>();

function LiveSession({ stored }: { stored: StoredParticipantSession }) {
	const router = useRouter();
	const online = useOnlineStatus();
	const { sessionId, participantToken: token, publicChannelKey } = stored;

	const fetchState = useCallback(
		(signal: AbortSignal) => questParticipantApi.getState(sessionId, token, signal),
		[sessionId, token]
	);
	const channel = useDeckSessionChannel<ParticipantSessionState>({
		product,
		publicChannelKey,
		fetchState,
		pollWhileDisconnectedMs: 10_000,
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
		router.replace("/play?reason=expired");
	}, [sessionGone, sessionId, router]);

	// First load failed (network): retry with backoff while showing the reconnect screen.
	const [retryCount, setRetryCount] = useState(0);
	const loadFailed = !latestState && !!error && !tokenRejected && !sessionGone;
	useEffect(() => {
		if (!loadFailed || isResyncing) return;
		const delay = Math.min(15_000, 2_000 * 2 ** Math.min(retryCount, 3));
		const timer = window.setTimeout(() => {
			setRetryCount((n) => n + 1);
			void resync();
		}, delay);
		return () => window.clearTimeout(timer);
	}, [loadFailed, isResyncing, retryCount, resync]);
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

	// The state snapshot is the server's word for its current run.
	useEffect(() => {
		const run = latestState?.current_run;
		if (!run) return;
		const mine = latestState.my_submission_for_current_slide;
		setSubmissions((previous) => {
			if (mine) return previous[run.id] === mine ? previous : { ...previous, [run.id]: mine };
			// "Not answered" only fills a gap: a submit may have landed after this read started.
			return run.id in previous ? previous : { ...previous, [run.id]: null };
		});
	}, [latestState]);

	// A run first seen already past `waiting` (the host went back to it) may
	// hold an earlier answer: ask once. Runs seen from `waiting` on need no
	// read, so opening voting never sends the whole room to my-answer.
	const firstSeen = useRef(new Map<number, RunState>());
	useEffect(() => {
		if (!currentRun) return;
		if (!firstSeen.current.has(currentRun.id)) firstSeen.current.set(currentRun.id, currentRun.state);
		if (!isAnswerRun(currentRun) || firstSeen.current.get(currentRun.id) === "waiting") return;
		if (currentRun.id in submissionsRef.current) return;
		if (latestState?.current_run?.id === currentRun.id) return;
		const runId = currentRun.id;
		const controller = new AbortController();
		questParticipantApi
			.getMyAnswer(sessionId, runId, token, controller.signal)
			.then((submission) =>
				setSubmissions((previous) => (previous[runId] ? previous : { ...previous, [runId]: submission }))
			)
			.catch(() => undefined);
		return () => controller.abort();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentRun?.id, currentRun?.state]);

	const mySubmission = currentRun ? (submissions[currentRun.id] ?? null) : null;

	/* ------------------------------ submit ------------------------------ */

	const announce = useAnnounce();
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<{ runId: number; message: string } | null>(null);
	const currentRunRef = useRef<ParticipantRunView | null>(currentRun);
	currentRunRef.current = currentRun;

	// The type component gets the DeckApiError back (it shows 422 field errors
	// inline); the shell shows everything else in the bottom strip.
	const onSubmit = useCallback(
		async (payload: unknown) => {
			const run = currentRunRef.current;
			if (!run) throw toDeckApiError(new Error("No slide is open right now."));
			setSubmitting(true);
			setSubmitError(null);
			try {
				await questParticipantApi.submitAnswer(sessionId, run.id, token, payload as AnswerPayload);
				const provisional = provisionalSubmission(run, payload, submissionsRef.current[run.id]);
				setSubmissions((previous) => ({ ...previous, [run.id]: provisional }));
				pulse("submit");
				// Swap the guess for the stored (normalised) answer.
				questParticipantApi
					.getMyAnswer(sessionId, run.id, token)
					.then((submission) => {
						if (submission) setSubmissions((previous) => ({ ...previous, [run.id]: submission }));
					})
					.catch(() => undefined);
			} catch (reason) {
				const deckError = toDeckApiError(reason);
				pulse("warning");
				if (deckError.status !== 422) setSubmitError({ runId: run.id, message: friendlyError(deckError, "answer") });
				// The run moved on / closed / the token died: catch up with the server.
				if (deckError.code === "invalid_state" || deckError.status === 401) void resync();
				throw deckError;
			} finally {
				setSubmitting(false);
			}
		},
		[sessionId, token, resync]
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

	/* --------------------------- timer + a11y --------------------------- */

	const state = runState?.state ?? currentRun?.state ?? null;
	const timed = state === "get_ready" || state === "voting";
	const clock = useServerClock({
		endsAt: timed ? runState?.ends_at : null,
		durationSeconds: timed ? runState?.duration_seconds : null,
	});

	const previousRunId = usePrevious(currentRun?.id);
	const previousState = usePrevious(state);
	useEffect(() => {
		if (!currentRun || !state) return;
		if (previousRunId !== currentRun.id) {
			const position = `Slide ${currentRun.position}${channel.totalSlides ? ` of ${channel.totalSlides}` : ""}`;
			announce(`${position}: ${currentRun.title || "new slide"}.${state === "voting" ? " Voting is open." : ""}`);
			return;
		}
		if (previousState === state) return;
		if (state === "get_ready") announce("Get ready.");
		if (state === "voting") {
			announce("Voting is now open.");
			pulse("tap");
		}
		if (state === "open") announce("Questions are now open.");
		if (state === "closed") announce(isQa ? "Questions are closed." : "Voting is closed.");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentRun?.id, state]);

	const tenSecondsFor = useRef<string | null>(null);
	const seconds = clock.secondsRemaining;
	useEffect(() => {
		if (state !== "voting" || seconds === null || !currentRun) return;
		const key = `${currentRun.id}:${runState?.ends_at}`;
		if (seconds <= 10 && seconds > 0 && tenSecondsFor.current !== key) {
			tenSecondsFor.current = key;
			announce(`${seconds} seconds left.`);
		}
	}, [seconds, state, currentRun, runState?.ends_at, announce]);

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
		clearParticipantSession(product, sessionId);
		router.replace("/play?reason=left");
	};

	/* ------------------------------ render ------------------------------ */

	const deckTitle = latestState?.session.deck_title ?? stored.deckTitle ?? "Live session";
	const name = latestState?.participant.display_name ?? stored.displayName;
	const emoji = latestState?.participant.emoji_avatar ?? stored.emojiAvatar;
	const total = channel.totalSlides;
	const position = currentRun?.position ?? slimRun?.position ?? null;
	const progressLabel = position ? `Slide ${position}${total ? ` of ${total}` : ""}` : undefined;
	const visibleAggregate = channel.resultsVisibility === "public" ? channel.aggregate : null;
	const answering = state === "voting" || state === "open" || state === "get_ready";
	const answered = !!storedPayload(mySubmission);

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
		body = <SlideStage run={currentRun} theme={theme} mySubmission={null} disabled mode="live" />;
	} else if (state === "get_ready") {
		body = <GetReadyOverlay run={currentRun} seconds={clock.secondsRemaining} />;
	} else if (state === "voting" || state === "open") {
		body = (
			<>
				{state === "voting" && <TimerBar seconds={clock.secondsRemaining} progress={clock.progress} />}
				<SlideStage
					run={currentRun}
					theme={theme}
					mySubmission={storedPayload(mySubmission)}
					onSubmit={onSubmit}
					disabled={submitting || !online}
					aggregate={visibleAggregate}
					qa={isQa ? qa : undefined}
					mode="live"
				/>
			</>
		);
	} else if (state === "closed") {
		body = (
			<VotingClosedView run={currentRun} answered={answered} resultsVisible={!!visibleAggregate}>
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
	) : currentRun && state === "voting" && !isQa && answered ? (
		<SubmittedStrip message="Answer sent · waiting for the host" />
	) : null;

	return (
		<>
			<AppShell
				theme={theme}
				transitionKey={currentRun?.id ?? (latestState ? "lobby" : "loading")}
				topBar={
					<TopBar
						title={deckTitle}
						subtitle={progressLabel}
						onBack={() => setLeaveOpen(true)}
						backIcon="close"
						backLabel="Leave session"
						right={
							<TapFeedback
								onClick={() => setMenuOpen(true)}
								aria-label={`You: ${name}. Settings`}
								className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--deck-surface-muted)] text-[22px] leading-none"
							>
								<span aria-hidden>{emoji}</span>
							</TapFeedback>
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
