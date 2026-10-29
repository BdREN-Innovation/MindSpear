"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { sessionApiFor } from "@/features/deck/api/sessionApi";
import { useHostQaFeed } from "@/features/deck/live/qaFeed";
import { useDeckHostChannel } from "@/features/deck/live/useDeckHostChannel";
import { useDeckSessionChannel } from "@/features/deck/live/useDeckSessionChannel";
import { DeckThemeProvider, getDeckTheme } from "@/features/deck/theme";
import type { Deck, DeckProduct, HostSessionState, ParticipantRunView, SlideAggregate } from "@/features/deck/types";
import type { HostActions, PresenterSessionInfo } from "@/features/deck-editor/slides/types";
import { productCopy } from "@/features/deck/productCopy";
import { useFullscreen } from "../hooks/useFullscreen";
import { useHostControls } from "../hooks/useHostControls";
import { usePresenterKeyboard } from "../hooks/usePresenterKeyboard";
import { aggregateEntries, aggregateResponses } from "../lib/format";
import { isActiveState, primaryActionFor, revealsOnLeave, runKindOf, stateLabel } from "../lib/runKind";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConnectionBanner } from "./ConnectionBanner";
import { ControlBar, type AnsweredTally, type ResponseTally } from "./ControlBar";
import { JoinBanner } from "./JoinBanner";
import { QaModerationSheet } from "./QaModerationSheet";
import { QrSidebar } from "./QrSidebar";
import { GetReadyOverlay, RunTimerChip } from "./RunTimer";
import { SessionSummary } from "./SessionSummary";
import { SlideStage } from "./SlideStage";

// The running session (plan §6.1–§6.6). State comes from
// useDeckSessionChannel (public channel + host channel merge + REST resync);
// every host action's response (a full HOST STATE) is fed back in as a
// snapshot, so the screen moves even when the socket is slow or down.
//
// Quiz sessions (product 'quiz'): the primary action runs Start → (get
// ready) → Reveal → Next, a spinner Spin → (reveals by itself) → Next, and
// leaderboard slides only navigate. During answering the bar shows
// "x / y answered"; the Presenters get `quiz` (count, spin, leaderboard,
// reveal delta). Leaving a quiz run that is still answering reveals it
// (server side), so the arrow / slide list ask first. The bar's trophy
// button inserts a leaderboard slide right after the current one and shows
// it (advance insert_leaderboard; it asks first when that reveals a run).

type Confirm =
	| { kind: "back" }
	| { kind: "jump"; target: ParticipantRunView }
	/** Quiz: forward away from a run that is still answering (it gets revealed). */
	| { kind: "leave"; target: ParticipantRunView | null }
	/** Quiz: insert a leaderboard while the current run is still answering (it gets revealed). */
	| { kind: "leaderboard" }
	| { kind: "end" }
	| { kind: "exit" };

export interface LivePresenterProps {
	deckId: number;
	/** Default quest. */
	product?: DeckProduct;
	deck: Deck | null;
	initialState: HostSessionState;
	resumed: boolean;
	onPresentAgain: () => void;
}

export function LivePresenter({ deckId, product = "quest", deck, initialState, resumed, onPresentAgain }: LivePresenterProps) {
	const router = useRouter();
	const sessionId = initialState.session_id;
	const api = sessionApiFor(product);
	const copy = productCopy(product);
	const editorHref = copy.editHref(deckId);

	// Latest action response; the channel hook applies each new one as a snapshot.
	const [seed, setSeed] = useState<HostSessionState>(initialState);
	const fetchState = useCallback((signal: AbortSignal) => api.getState(sessionId, signal), [api, sessionId]);

	const channel = useDeckSessionChannel<HostSessionState>({
		product,
		publicChannelKey: initialState.public_channel_key,
		fetchState,
		initialState: seed,
		hostSessionId: sessionId,
		// slide.changed carries no aggregate; re-read so a revisited run shows its results and the runs list stays fresh.
		resyncOnSlideChange: true,
		pollWhileDisconnectedMs: 5000,
	});
	const hostChannel = useDeckHostChannel({ product, sessionId });
	const { resync } = channel;
	const latest = channel.latestState ?? seed;
	const ended = channel.sessionStatus === "ended";

	const { pending, advance, end } = useHostControls({ sessionId, api, onState: setSeed, resync });
	const busy = pending !== null;
	const fullscreen = useFullscreen();

	const theme = useMemo(() => getDeckTheme(deck?.settings.theme), [deck?.settings.theme]);
	const joinCode = latest.join?.join_code ?? latest.join_code;

	/* ---------------- current run ---------------- */

	const run = channel.currentRun;
	const runOrSlim = run ?? channel.slimRun;
	const runId = runOrSlim?.id ?? null;
	const kind = runKindOf(runOrSlim);
	const runState = channel.runState;
	const state = runState?.state ?? runOrSlim?.state ?? null;
	const position = runOrSlim?.position ?? null;
	const totalSlides = channel.totalSlides ?? latest.session.total_slides;
	const isFirst = position === null || position <= 1;
	const isLast = position !== null && position >= totalSlides;
	const primary = primaryActionFor(kind, state, isLast);

	// slide.changed clears the aggregate until the resync lands; keep showing
	// the last one we had for this same run instead of flashing empty results.
	const [held, setHeld] = useState<{ runId: number; aggregate: SlideAggregate } | null>(null);
	useEffect(() => {
		if (runId !== null && channel.aggregate) setHeld({ runId, aggregate: channel.aggregate });
	}, [runId, channel.aggregate]);
	const aggregate = channel.aggregate ?? (held && held.runId === runId ? held.aggregate : null);

	const runs = useMemo(
		() =>
			(latest.runs ?? []).map((item) =>
				run && item.id === run.id && state ? ({ ...item, state } as ParticipantRunView) : item
			),
		[latest.runs, run, state]
	);

	const qaFeed = useHostQaFeed({
		product,
		sessionId,
		runId: kind === "qa" ? runId : null,
		qaEvents: channel.qaEvents,
		enabled: kind === "qa" && !ended,
	});

	// Same definition as the stage: open_ended counts entries ("4 responses"),
	// and the bar adds the people behind them when that differs ("· 3 people").
	// answer.submitted counts answer rows (people) and often lands before the aggregate.
	const responses = useMemo<ResponseTally | null>(() => {
		if (kind !== "poll" || runId === null) return null;
		const people = Math.max(aggregateResponses(aggregate) ?? 0, hostChannel.responseCounts[runId] ?? 0);
		const entries = aggregateEntries(aggregate);
		if (entries === null) return { count: people, people: null };
		return { count: Math.max(entries, people), people };
	}, [kind, runId, aggregate, hostChannel.responseCounts]);

	// Quiz extras of THIS run (the block resets on slide.changed; a stale one is ignored).
	const quiz = channel.quiz && channel.quiz.slide_run_id === runId ? channel.quiz : null;

	// "12 / 30 answered": the public submitted count, the host aggregate and
	// answer.submitted can each be ahead of the others; answers never go away.
	const answered = useMemo<AnsweredTally | null>(() => {
		if (kind !== "quiz" || runId === null || state === "waiting") return null;
		const count = Math.max(
			quiz?.submitted_count ?? 0,
			aggregateResponses(aggregate) ?? 0,
			hostChannel.responseCounts[runId] ?? 0
		);
		return { count, of: quiz?.participant_count ?? channel.participantCount };
	}, [kind, runId, state, quiz, aggregate, hostChannel.responseCounts, channel.participantCount]);

	const loadLeaderboard = useCallback(
		(limit?: number) => api.getLeaderboard(sessionId, limit ? { limit } : {}),
		[api, sessionId]
	);

	const hostActions = useMemo<HostActions>(
		() => ({
			sessionId,
			product,
			qa: kind === "qa" ? qaFeed : undefined,
			loadAggregatePage: runId !== null ? (page: number) => api.getAggregate(sessionId, runId, { page }) : undefined,
			loadLeaderboard: product === "quiz" ? loadLeaderboard : undefined,
		}),
		[api, sessionId, product, kind, qaFeed, runId, loadLeaderboard]
	);

	const sessionInfo = useMemo<PresenterSessionInfo>(
		() => ({ sessionId, join: latest.join ?? null, participantCount: channel.participantCount, totalSlides }),
		[sessionId, latest.join, channel.participantCount, totalSlides]
	);

	/* ---------------- side effects ---------------- */

	useEffect(() => {
		if (resumed)
			toast.info(`This ${copy.noun} was already live: you're back in that session.`, {
				toastId: `deck-resumed-${sessionId}`,
			});
	}, [resumed, sessionId, copy.noun]);

	useEffect(() => {
		const previous = document.title;
		document.title = `Presenting · ${latest.session.deck_title || copy.Noun}`;
		return () => {
			document.title = previous;
		};
	}, [latest.session.deck_title, copy.Noun]);

	// Without the private host channel, hidden-results aggregates and Q&A
	// moderation copies never arrive: fall back to reading state.
	useEffect(() => {
		if (!hostChannel.error || ended) return;
		const timer = window.setInterval(() => void resync(), 5000);
		return () => window.clearInterval(timer);
	}, [hostChannel.error, ended, resync]);

	// Ended elsewhere (session.ended): one read for the summary's final numbers.
	useEffect(() => {
		if (ended && latest.session.status !== "ended") void resync();
	}, [ended, latest.session.status, resync]);

	/* ---------------- UI state ---------------- */

	const [qrOpen, setQrOpen] = useState(deck?.settings.show_qr_sidebar ?? true);
	const [bannerOpen, setBannerOpen] = useState(true);
	const [slideListOpen, setSlideListOpen] = useState(false);
	const [moderationOpen, setModerationOpen] = useState(false);
	const [confirm, setConfirm] = useState<Confirm | null>(null);

	/* ---------------- actions ---------------- */

	const goBack = useCallback(
		async (force: boolean) => {
			const outcome = await advance({ action: "previous_slide", ...(force ? { force: true } : {}) });
			if (outcome === "requires_force") setConfirm({ kind: "back" });
		},
		[advance]
	);

	const jumpTo = useCallback(
		async (target: ParticipantRunView, force: boolean) => {
			const outcome = await advance({ action: "jump_to", target_run_id: target.id, ...(force ? { force: true } : {}) });
			if (outcome === "requires_force") setConfirm({ kind: "jump", target });
		},
		[advance]
	);

	// Quiz / spinner runs that are still answering get revealed when the host leaves them.
	const leavingReveals = revealsOnLeave(kind) && isActiveState(state);

	const onPrimary = () => {
		if (busy || ended || confirm) return;
		if (primary.kind === "wait") return;
		if (primary.kind === "end") {
			setConfirm({ kind: "end" });
			return;
		}
		void advance({ action: primary.action });
	};

	const onPrevious = () => {
		if (busy || ended || isFirst || !runOrSlim) return;
		// Leaving an open vote backwards closes it for good: ask first (server needs force).
		if (isActiveState(state)) setConfirm({ kind: "back" });
		else void goBack(false);
	};

	const onNext = () => {
		if (busy || ended || isLast) return;
		if (leavingReveals) setConfirm({ kind: "leave", target: null });
		else void advance({ action: "next_slide" });
	};

	const onJump = (target: ParticipantRunView) => {
		setSlideListOpen(false);
		if (busy || ended || target.id === runId) return;
		const backwards = position !== null && target.position < position;
		if (backwards && isActiveState(state)) setConfirm({ kind: "jump", target });
		else if (leavingReveals) setConfirm({ kind: "leave", target });
		else void jumpTo(target, false);
	};

	const onExit = () => {
		if (ended) router.push(editorHref);
		else setConfirm({ kind: "exit" });
	};

	// Quiz: a leaderboard slide right after this one, shown at once (not after a leaderboard).
	const canInsertLeaderboard = product === "quiz" && !!runOrSlim && kind !== "leaderboard";
	const onInsertLeaderboard = () => {
		if (busy || ended || confirm || !canInsertLeaderboard) return;
		if (leavingReveals) setConfirm({ kind: "leaderboard" });
		else void advance({ action: "insert_leaderboard" });
	};

	const endSession = async (thenExit: boolean) => {
		const ok = await end();
		setConfirm(null);
		if (ok && thenExit) router.push(editorHref);
	};

	const toggleModeration = () => {
		if (kind === "qa") setModerationOpen((open) => !open);
	};

	usePresenterKeyboard(
		{
			onPrimary,
			onPrevious,
			onEscape: () => {
				if (slideListOpen) setSlideListOpen(false);
				else if (moderationOpen && kind === "qa") setModerationOpen(false);
				else onExit();
			},
			onToggleQr: () => setQrOpen((open) => !open),
			onToggleModeration: toggleModeration,
			onToggleFullscreen: fullscreen.toggle,
		},
		!confirm && !ended
	);

	/* ---------------- render ---------------- */

	if (ended) {
		return (
			<DeckThemeProvider theme={theme} className="h-full w-full">
				<SessionSummary
					deckId={deckId}
					product={product}
					state={latest}
					participantCount={channel.participantCount}
					onPresentAgain={onPresentAgain}
					loadLeaderboard={product === "quiz" ? loadLeaderboard : undefined}
				/>
			</DeckThemeProvider>
		);
	}

	const label = stateLabel(kind, state);
	const announcement =
		position !== null
			? `Slide ${position} of ${totalSlides}${run?.title ? `: ${run.title}` : ""}.${label ? ` ${label}.` : ""}`
			: "";
	const activeVerb = kind === "qa" ? "Q&A" : "Voting";
	const backTitle = revealsOnLeave(kind)
		? kind === "spin"
			? "Stop the wheel and go back?"
			: "Reveal the answer and go back?"
		: `Close ${activeVerb === "Q&A" ? "Q&A" : "voting"} and go back?`;
	const backDescription = revealsOnLeave(kind)
		? kind === "spin"
			? "The wheel is still spinning. Going back stops it where it lands."
			: "Players are still answering this slide. Going back reveals the answer now, and answering can't be reopened."
		: `${activeVerb} is still open on this slide. Going back closes it, and it can't be reopened.`;

	return (
		<DeckThemeProvider
			theme={theme}
			as="main"
			className="relative flex h-full w-full overflow-hidden bg-[var(--deck-bg)] text-[var(--deck-text)]"
		>
			<h1 className="sr-only">Presenting {latest.session.deck_title || copy.noun}</h1>
			<p className="sr-only" aria-live="polite">
				{announcement}
			</p>

			{qrOpen && <QrSidebar joinCode={joinCode} participantCount={channel.participantCount} onClose={() => setQrOpen(false)} />}

			<div className="flex min-w-0 flex-1 flex-col">
				{bannerOpen && <JoinBanner joinCode={joinCode} onDismiss={() => setBannerOpen(false)} />}
				<ConnectionBanner
					status={channel.status}
					error={channel.error}
					hostChannelError={!!hostChannel.error}
					isResyncing={channel.isResyncing}
					onResync={() => void resync()}
				/>

				<div className="relative min-h-0 flex-1">
					<SlideStage
						run={run}
						slimRun={channel.slimRun}
						state={state}
						aggregate={aggregate}
						theme={theme}
						host={hostActions}
						session={sessionInfo}
						quiz={quiz}
						// Inside the scaled slide, so the Presenters' fixed clearance for it fits at any screen size.
						cornerOverlay={<RunTimerChip kind={kind} runState={runState} />}
					/>
					<GetReadyOverlay runState={runState} kind={kind} />
					{kind === "qa" && moderationOpen && (
						<QaModerationSheet feed={qaFeed} onClose={() => setModerationOpen(false)} />
					)}
				</div>

				<ControlBar
					runs={runs}
					currentRunId={runId}
					position={position}
					totalSlides={totalSlides}
					primary={primary}
					pending={pending}
					canPrevious={!isFirst}
					canNext={!isLast && position !== null}
					onPrimary={onPrimary}
					onPrevious={onPrevious}
					onNext={onNext}
					onJump={onJump}
					slideListOpen={slideListOpen}
					onSlideListOpenChange={setSlideListOpen}
					participantCount={channel.participantCount}
					responses={responses}
					answered={answered}
					connection={channel.status}
					qrOpen={qrOpen}
					onToggleQr={() => setQrOpen((open) => !open)}
					moderation={
						kind === "qa"
							? {
									open: moderationOpen,
									count: qaFeed.questions.filter((question) => !question.is_hidden).length,
									onToggle: toggleModeration,
								}
							: null
					}
					insertLeaderboard={
						product === "quiz"
							? {
									onInsert: onInsertLeaderboard,
									disabled: !canInsertLeaderboard,
									title:
										kind === "leaderboard"
											? "The leaderboard is showing"
											: "Show the leaderboard now (adds a leaderboard slide after this one)",
								}
							: null
					}
					fullscreen={fullscreen}
					onEnd={() => setConfirm({ kind: "end" })}
					onExit={onExit}
				/>
			</div>

			<ConfirmDialog
				open={confirm?.kind === "back" || confirm?.kind === "jump"}
				title={backTitle}
				description={backDescription}
				confirm={{
					label: revealsOnLeave(kind) ? (kind === "spin" ? "Go back" : "Reveal and go back") : "Close and go back",
					onSelect: () => {
						const current = confirm;
						setConfirm(null);
						if (current?.kind === "jump") void jumpTo(current.target, true);
						else void goBack(true);
					},
				}}
				cancelLabel="Stay here"
				onCancel={() => setConfirm(null)}
			/>
			<ConfirmDialog
				open={confirm?.kind === "leave"}
				title={kind === "spin" ? "Move on while the wheel spins?" : "Reveal the answer and move on?"}
				description={
					kind === "spin"
						? "The wheel stops where it lands and the next slide opens."
						: "Players are still answering. Moving on reveals this slide's answer now, and answering can't be reopened."
				}
				confirm={{
					label: kind === "spin" ? "Move on" : "Reveal and move on",
					onSelect: () => {
						const current = confirm;
						setConfirm(null);
						if (current?.kind !== "leave") return;
						if (current.target) void jumpTo(current.target, false);
						else void advance({ action: "next_slide" });
					},
				}}
				cancelLabel="Stay here"
				onCancel={() => setConfirm(null)}
			/>
			<ConfirmDialog
				open={confirm?.kind === "leaderboard"}
				title={kind === "spin" ? "Show the leaderboard while the wheel spins?" : "Reveal the answer and show the leaderboard?"}
				description={
					kind === "spin"
						? "The wheel stops where it lands and a leaderboard slide opens after this one."
						: "Players are still answering. Showing the leaderboard reveals this slide's answer now, and answering can't be reopened."
				}
				confirm={{
					label: kind === "spin" ? "Show leaderboard" : "Reveal and show leaderboard",
					onSelect: () => {
						setConfirm(null);
						void advance({ action: "insert_leaderboard" });
					},
				}}
				cancelLabel="Stay here"
				onCancel={() => setConfirm(null)}
			/>
			<ConfirmDialog
				open={confirm?.kind === "end"}
				title="End the session?"
				description={
					product === "quiz"
						? "Answering ends (an open question is revealed) and everyone is disconnected. This session can't be reopened."
						: "Voting closes and everyone is disconnected. This session can't be reopened."
				}
				confirm={{ label: "End session", tone: "danger", onSelect: () => void endSession(false) }}
				onCancel={() => setConfirm(null)}
				initialFocus="cancel"
				busy={pending === "end"}
			/>
			<ConfirmDialog
				open={confirm?.kind === "exit"}
				title="Leave present mode?"
				description={`The session stays live: participants keep their place, and presenting this ${copy.noun} again picks it back up.`}
				confirm={{ label: "Exit, keep it live", onSelect: () => router.push(editorHref) }}
				secondary={{ label: "End session and exit", tone: "danger", onSelect: () => void endSession(true) }}
				onCancel={() => setConfirm(null)}
				busy={pending === "end"}
			/>
		</DeckThemeProvider>
	);
}
