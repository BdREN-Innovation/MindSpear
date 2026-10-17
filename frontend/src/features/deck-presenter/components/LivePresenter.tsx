"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { questSessionApi } from "@/features/deck/api/sessionApi";
import { useHostQaFeed } from "@/features/deck/live/qaFeed";
import { useDeckHostChannel } from "@/features/deck/live/useDeckHostChannel";
import { useDeckSessionChannel } from "@/features/deck/live/useDeckSessionChannel";
import { DeckThemeProvider, getDeckTheme } from "@/features/deck/theme";
import type { Deck, HostSessionState, ParticipantRunView, SlideAggregate } from "@/features/deck/types";
import type { HostActions, PresenterSessionInfo } from "@/features/deck-editor/slides/types";
import { useFullscreen } from "../hooks/useFullscreen";
import { useHostControls } from "../hooks/useHostControls";
import { usePresenterKeyboard } from "../hooks/usePresenterKeyboard";
import { aggregateEntries, aggregateResponses } from "../lib/format";
import { isActiveState, primaryActionFor, runKindOf, stateLabel } from "../lib/runKind";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConnectionBanner } from "./ConnectionBanner";
import { ControlBar, type ResponseTally } from "./ControlBar";
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

type Confirm = { kind: "back" } | { kind: "jump"; target: ParticipantRunView } | { kind: "end" } | { kind: "exit" };

export interface LivePresenterProps {
	deckId: number;
	deck: Deck | null;
	initialState: HostSessionState;
	resumed: boolean;
	onPresentAgain: () => void;
}

export function LivePresenter({ deckId, deck, initialState, resumed, onPresentAgain }: LivePresenterProps) {
	const router = useRouter();
	const sessionId = initialState.session_id;
	const editorHref = `/quests/${deckId}/edit`;

	// Latest action response; the channel hook applies each new one as a snapshot.
	const [seed, setSeed] = useState<HostSessionState>(initialState);
	const fetchState = useCallback((signal: AbortSignal) => questSessionApi.getState(sessionId, signal), [sessionId]);

	const channel = useDeckSessionChannel<HostSessionState>({
		product: "quest",
		publicChannelKey: initialState.public_channel_key,
		fetchState,
		initialState: seed,
		hostSessionId: sessionId,
		// slide.changed carries no aggregate; re-read so a revisited run shows its results and the runs list stays fresh.
		resyncOnSlideChange: true,
		pollWhileDisconnectedMs: 5000,
	});
	const hostChannel = useDeckHostChannel({ product: "quest", sessionId });
	const { resync } = channel;
	const latest = channel.latestState ?? seed;
	const ended = channel.sessionStatus === "ended";

	const { pending, advance, end } = useHostControls({ sessionId, onState: setSeed, resync });
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
		product: "quest",
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

	const hostActions = useMemo<HostActions>(
		() => ({
			sessionId,
			product: "quest",
			qa: kind === "qa" ? qaFeed : undefined,
			loadAggregatePage:
				runId !== null ? (page: number) => questSessionApi.getAggregate(sessionId, runId, { page }) : undefined,
		}),
		[sessionId, kind, qaFeed, runId]
	);

	const sessionInfo = useMemo<PresenterSessionInfo>(
		() => ({ sessionId, join: latest.join ?? null, participantCount: channel.participantCount, totalSlides }),
		[sessionId, latest.join, channel.participantCount, totalSlides]
	);

	/* ---------------- side effects ---------------- */

	useEffect(() => {
		if (resumed)
			toast.info("This quest was already live: you're back in that session.", { toastId: `deck-resumed-${sessionId}` });
	}, [resumed, sessionId]);

	useEffect(() => {
		const previous = document.title;
		document.title = `Presenting · ${latest.session.deck_title || "Quest"}`;
		return () => {
			document.title = previous;
		};
	}, [latest.session.deck_title]);

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
		void advance({ action: "next_slide" });
	};

	const onJump = (target: ParticipantRunView) => {
		setSlideListOpen(false);
		if (busy || ended || target.id === runId) return;
		const backwards = position !== null && target.position < position;
		if (backwards && isActiveState(state)) setConfirm({ kind: "jump", target });
		else void jumpTo(target, false);
	};

	const onExit = () => {
		if (ended) router.push(editorHref);
		else setConfirm({ kind: "exit" });
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
					state={latest}
					participantCount={channel.participantCount}
					onPresentAgain={onPresentAgain}
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

	return (
		<DeckThemeProvider
			theme={theme}
			as="main"
			className="relative flex h-full w-full overflow-hidden bg-[var(--deck-bg)] text-[var(--deck-text)]"
		>
			<h1 className="sr-only">Presenting {latest.session.deck_title || "quest"}</h1>
			<p className="sr-only" aria-live="polite">
				{announcement}
			</p>

			{qrOpen && <QrSidebar joinCode={joinCode} participantCount={channel.participantCount} />}

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
						// Inside the scaled slide, so the Presenters' fixed clearance for it fits at any screen size.
						cornerOverlay={<RunTimerChip kind={kind} runState={runState} />}
					/>
					<GetReadyOverlay runState={runState} />
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
					fullscreen={fullscreen}
					onEnd={() => setConfirm({ kind: "end" })}
					onExit={onExit}
				/>
			</div>

			<ConfirmDialog
				open={confirm?.kind === "back" || confirm?.kind === "jump"}
				title={`Close ${activeVerb === "Q&A" ? "Q&A" : "voting"} and go back?`}
				description={`${activeVerb} is still open on this slide. Going back closes it, and it can't be reopened.`}
				confirm={{
					label: "Close and go back",
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
				open={confirm?.kind === "end"}
				title="End the session?"
				description="Voting closes and everyone is disconnected. This session can't be reopened."
				confirm={{ label: "End session", tone: "danger", onSelect: () => void endSession(false) }}
				onCancel={() => setConfirm(null)}
				initialFocus="cancel"
				busy={pending === "end"}
			/>
			<ConfirmDialog
				open={confirm?.kind === "exit"}
				title="Leave present mode?"
				description="The session stays live: participants keep their place, and presenting this quest again picks it back up."
				confirm={{ label: "Exit, keep it live", onSelect: () => router.push(editorHref) }}
				secondary={{ label: "End session and exit", tone: "danger", onSelect: () => void endSession(true) }}
				onCancel={() => setConfirm(null)}
				busy={pending === "end"}
			/>
		</DeckThemeProvider>
	);
}
