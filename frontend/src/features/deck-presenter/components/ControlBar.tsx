"use client";

import { useRef } from "react";
import {
	BarChart3,
	CheckCheck,
	ChevronLeft,
	ChevronRight,
	Eye,
	List,
	Loader2,
	LogOut,
	Maximize,
	MessagesSquare,
	Minimize,
	Play,
	QrCode,
	RotateCw,
	Square,
	SkipForward,
	Trophy,
	Users,
} from "lucide-react";
import type { DeckConnectionStatus } from "@/features/deck/live/channelState";
import type { ParticipantRunView } from "@/features/deck/types";
import { cn } from "@/lib/utils";
import type { PendingAction } from "../hooks/useHostControls";
import type { PrimaryAction } from "../lib/runKind";
import { ControlButton } from "./ControlButton";
import { OverflowMenu, type OverflowMenuItem } from "./OverflowMenu";
import { SlideListPopover } from "./SlideListPopover";

// Bottom control bar (plan §6.2):
//   [exit] [≡ slides] ‹ 3 / 12 ›   [ primary action ]   📊 12 · 👥 42 ● · Q&A · 🏆 · QR · ⛶ · End
// (🏆 = quiz only: insert a leaderboard slide after the current one and show it.)
// Every action button is disabled while one request is in flight, so a
// double click can never advance twice.
//
// It stays one row at any width. It follows its own width (a container
// query, so opening the QR sidebar counts too) and, as it narrows:
//   below 68rem  labels shorten ("12 / 30", "End"); screen readers keep the full words
//   below 60rem  🏆, QR, full screen and End move into the ⋯ menu
//   below 48rem  exit and ‹ › move there too, and the participant count gives way to
//                the answer tally (the menu header shows both)
//   below 26rem  the counters move into the menu header as well
// The primary action takes the space that is left; its label truncates last.
// Tailwind only generates class names it finds written out, so they stay literal.
const SHORT_LABEL = "[@container(max-width:68rem)]:sr-only";
const HIDE_BELOW_60 = "[@container(max-width:60rem)]:hidden";
const SHOW_BELOW_60 = "hidden [@container(max-width:60rem)]:block";
const HIDE_BELOW_48 = "[@container(max-width:48rem)]:hidden";
const SHOW_BELOW_48 = "hidden [@container(max-width:48rem)]:block";
const HIDE_BELOW_26 = "[@container(max-width:26rem)]:hidden";

const COUNTER = "flex items-center gap-1.5 whitespace-nowrap px-2 text-base font-semibold tabular-nums";

const CONNECTION: Record<DeckConnectionStatus, { label: string; dot: string }> = {
	connected: { label: "Live", dot: "bg-[var(--deck-success)]" },
	connecting: { label: "Connecting", dot: "bg-yellow-dark animate-pulse motion-reduce:animate-none" },
	reconnecting: { label: "Reconnecting", dot: "bg-yellow-dark animate-pulse motion-reduce:animate-none" },
	disconnected: { label: "Offline", dot: "bg-[var(--deck-danger)]" },
	idle: { label: "Not connected", dot: "bg-[var(--deck-text-muted)]" },
};

/** Responses on the current run; `people` is set for multi-entry types (open_ended), where the two can differ. */
export interface ResponseTally {
	count: number;
	people: number | null;
}

/** Quiz runs: "12 / 30 answered" (answers on the run / participants in the room). */
export interface AnsweredTally {
	count: number;
	of: number | null;
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

function answeredText(answered: AnsweredTally): string {
	return `${answered.count}${answered.of !== null ? ` of ${answered.of}` : ""} answered`;
}

function responsesText(responses: ResponseTally): string {
	const people = responses.people !== null ? ` from ${plural(responses.people, "person", "people")}` : "";
	return `${plural(responses.count, "response", "responses")}${people}`;
}

export interface ControlBarProps {
	runs: ParticipantRunView[];
	currentRunId: number | null;
	position: number | null;
	totalSlides: number | null;
	primary: PrimaryAction;
	pending: PendingAction | null;
	canPrevious: boolean;
	canNext: boolean;
	onPrimary: () => void;
	onPrevious: () => void;
	onNext: () => void;
	onJump: (run: ParticipantRunView) => void;
	slideListOpen: boolean;
	onSlideListOpenChange: (open: boolean) => void;
	participantCount: number | null;
	/** Responses on the current run (answer slides), else null. */
	responses: ResponseTally | null;
	/** Quiz runs: answered count (shown instead of `responses`), else null. */
	answered?: AnsweredTally | null;
	connection: DeckConnectionStatus;
	qrOpen: boolean;
	onToggleQr: () => void;
	/** Shown on Q&A runs only. */
	moderation: { open: boolean; count: number; onToggle: () => void } | null;
	/** Quiz sessions: insert a leaderboard right after the current slide and move to it (null elsewhere). */
	insertLeaderboard?: { onInsert: () => void; disabled: boolean; title: string } | null;
	fullscreen: { isFullscreen: boolean; supported: boolean; toggle: () => void };
	onEnd: () => void;
	onExit: () => void;
}

function PrimaryIcon({ primary, busy }: { primary: PrimaryAction; busy: boolean }) {
	const className = "h-5 w-5 shrink-0";
	if (busy || primary.kind === "wait")
		return <Loader2 className={cn(className, "animate-spin motion-reduce:animate-none")} aria-hidden />;
	if (primary.kind === "end") return <Square className={className} aria-hidden />;
	switch (primary.icon) {
		case "start":
			return <Play className={className} aria-hidden />;
		case "stop":
			return <Square className={className} aria-hidden />;
		case "reveal":
			return <Eye className={className} aria-hidden />;
		case "spin":
			return <RotateCw className={className} aria-hidden />;
		default:
			return <SkipForward className={className} aria-hidden />;
	}
}

export function ControlBar(props: ControlBarProps) {
	const {
		runs,
		currentRunId,
		position,
		totalSlides,
		primary,
		pending,
		canPrevious,
		canNext,
		onPrimary,
		onPrevious,
		onNext,
		onJump,
		slideListOpen,
		onSlideListOpenChange,
		participantCount,
		responses,
		answered = null,
		connection,
		qrOpen,
		onToggleQr,
		moderation,
		insertLeaderboard = null,
		fullscreen,
		onEnd,
		onExit,
	} = props;
	const listTriggerRef = useRef<HTMLButtonElement>(null);
	const busy = pending !== null;
	const conn = CONNECTION[connection];
	const primaryBusy =
		busy && (pending === "end" ? primary.kind === "end" : primary.kind === "advance" && pending === primary.action);
	const participants = participantCount ?? 0;
	const tally = answered !== null ? answeredText(answered) : responses !== null ? responsesText(responses) : null;

	// The ⋯ menu: the tools first, then (narrow bars only) the navigation, End last.
	const menuItems: OverflowMenuItem[] = [
		...(insertLeaderboard
			? [
					{
						key: "leaderboard",
						label: "Show leaderboard",
						icon: <Trophy className="h-5 w-5" />,
						onSelect: insertLeaderboard.onInsert,
						disabled: busy || insertLeaderboard.disabled,
					},
				]
			: []),
		{
			key: "qr",
			label: "QR code sidebar",
			icon: <QrCode className="h-5 w-5" />,
			onSelect: onToggleQr,
			checked: qrOpen,
			shortcut: "Q",
		},
		...(fullscreen.supported
			? [
					{
						key: "fullscreen",
						label: "Full screen",
						icon: fullscreen.isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />,
						onSelect: fullscreen.toggle,
						checked: fullscreen.isFullscreen,
						shortcut: "F",
					},
				]
			: []),
		{
			key: "previous",
			label: "Previous slide",
			icon: <ChevronLeft className="h-5 w-5" />,
			onSelect: onPrevious,
			disabled: busy || !canPrevious,
			shortcut: "←",
			separated: true,
			className: SHOW_BELOW_48,
		},
		{
			key: "next",
			label: "Skip to next slide",
			icon: <ChevronRight className="h-5 w-5" />,
			onSelect: onNext,
			disabled: busy || !canNext,
			className: SHOW_BELOW_48,
		},
		{
			key: "exit",
			label: "Exit present mode",
			icon: <LogOut className="h-5 w-5 -scale-x-100" />,
			onSelect: onExit,
			shortcut: "Esc",
			className: SHOW_BELOW_48,
		},
		{
			key: "end",
			label: "End session",
			icon: <Square className="h-5 w-5" />,
			onSelect: onEnd,
			disabled: busy,
			tone: "danger",
			separated: true,
		},
	];

	// relative z-40: the container query makes the bar a stacking context, and
	// the popovers it opens must stay above the stage's overlays.
	return (
		<nav
			aria-label="Presenter controls"
			className="relative z-40 flex shrink-0 items-center gap-3 border-t border-[var(--deck-border)] bg-[var(--deck-surface)] px-3 py-2 text-[var(--deck-text)] [container-type:inline-size]"
		>
			{/* Left: exit, slide list, prev / position / next */}
			<div className="flex shrink-0 items-center gap-1">
				<ControlButton
					icon
					onClick={onExit}
					aria-label="Exit present mode (Esc)"
					title="Exit present mode (Esc)"
					className={HIDE_BELOW_48}
				>
					<LogOut className="h-5 w-5 -scale-x-100" aria-hidden />
				</ControlButton>
				<div className="relative">
					<ControlButton
						ref={listTriggerRef}
						icon
						aria-label="All slides"
						title="All slides"
						aria-expanded={slideListOpen}
						aria-haspopup="dialog"
						aria-pressed={slideListOpen}
						onClick={() => onSlideListOpenChange(!slideListOpen)}
					>
						<List className="h-5 w-5" aria-hidden />
					</ControlButton>
					{slideListOpen && (
						<SlideListPopover
							runs={runs}
							currentRunId={currentRunId}
							disabled={busy}
							onJump={onJump}
							onClose={() => onSlideListOpenChange(false)}
							triggerRef={listTriggerRef}
						/>
					)}
				</div>
				<ControlButton
					icon
					onClick={onPrevious}
					disabled={busy || !canPrevious}
					aria-label="Previous slide (←)"
					title="Previous slide (←)"
					aria-keyshortcuts="ArrowLeft"
					className={HIDE_BELOW_48}
				>
					<ChevronLeft className="h-6 w-6" aria-hidden />
				</ControlButton>
				<span className="min-w-[4.5rem] text-center text-base font-semibold tabular-nums" aria-live="polite">
					{position ?? "–"}
					<span className="text-[var(--deck-text-muted)]"> / {totalSlides ?? "–"}</span>
					<span className="sr-only"> slides</span>
				</span>
				<ControlButton
					icon
					onClick={onNext}
					disabled={busy || !canNext}
					aria-label="Next slide"
					title="Next slide"
					className={HIDE_BELOW_48}
				>
					<ChevronRight className="h-6 w-6" aria-hidden />
				</ControlButton>
			</div>

			{/* Centre: the one state-dependent action, in whatever space is left */}
			<div className="flex min-w-0 flex-1 justify-center">
				<ControlButton
					tone="primary"
					size="lg"
					onClick={onPrimary}
					disabled={busy || primary.kind === "wait"}
					aria-keyshortcuts="ArrowRight Space"
					title={`${primary.label} (→ / Space)`}
					className="min-w-[min(11rem,100%)] max-w-full shrink [@container(max-width:48rem)]:px-4 [@container(max-width:48rem)]:text-base"
				>
					<PrimaryIcon primary={primary} busy={primaryBusy} />
					<span className="truncate">{primary.label}</span>
				</ControlButton>
			</div>

			{/* Right: counters, panels, end; whatever does not fit is in ⋯ */}
			<div className="flex shrink-0 items-center gap-1">
				{answered !== null ? (
					<span className={cn(COUNTER, HIDE_BELOW_26)} title={`${answeredText(answered)} on this slide`} aria-live="polite">
						<CheckCheck className="h-5 w-5" aria-hidden />
						{answered.count}
						{answered.of !== null && <span className="text-[var(--deck-text-muted)]"> / {answered.of}</span>}
						<span className={cn("font-medium text-[var(--deck-text-muted)]", SHORT_LABEL)}>
							{" "}
							answered
						</span>
					</span>
				) : null}
				{answered === null && responses !== null && (
					<span className={cn(COUNTER, HIDE_BELOW_26)} title={`${responsesText(responses)} on this slide`}>
						<BarChart3 className="h-5 w-5" aria-hidden />
						{responses.people !== null && responses.people !== responses.count ? (
							<>
								{responses.count}
								<span className={SHORT_LABEL}>
									{" "}
									{responses.count === 1 ? "response" : "responses"}
								</span>
								<span className="font-medium text-[var(--deck-text-muted)]">
									· {responses.people}
									<span className={SHORT_LABEL}>
										{" "}
										{responses.people === 1 ? "person" : "people"}
									</span>
								</span>
							</>
						) : (
							<>
								{responses.count}
								<span className="sr-only"> {responses.count === 1 ? "response" : "responses"}</span>
							</>
						)}
					</span>
				)}
				<span
					className={cn(COUNTER, tally !== null && HIDE_BELOW_48, HIDE_BELOW_26)}
					title={`${participants} participants · ${conn.label}`}
				>
					<Users className="h-5 w-5" aria-hidden />
					{participants}
					<span className="sr-only"> participants</span>
					<span className={cn("ml-1 h-2.5 w-2.5 rounded-full", conn.dot)} aria-hidden />
					<span className="sr-only">, connection {conn.label}</span>
				</span>
				{moderation && (
					<ControlButton
						icon
						onClick={moderation.onToggle}
						aria-pressed={moderation.open}
						aria-label="Q&A moderation (M)"
						title="Q&A moderation (M)"
						className="relative"
					>
						<MessagesSquare className="h-5 w-5" aria-hidden />
						{moderation.count > 0 && (
							<span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-[var(--deck-primary)] px-1 text-xs font-bold leading-5 text-[var(--deck-on-primary)]">
								{moderation.count > 99 ? "99+" : moderation.count}
							</span>
						)}
					</ControlButton>
				)}
				{insertLeaderboard && (
					<ControlButton
						icon
						onClick={insertLeaderboard.onInsert}
						disabled={busy || insertLeaderboard.disabled}
						aria-label={insertLeaderboard.title}
						title={insertLeaderboard.title}
						className={HIDE_BELOW_60}
					>
						{pending === "insert_leaderboard" ? (
							<Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
						) : (
							<Trophy className="h-5 w-5" aria-hidden />
						)}
					</ControlButton>
				)}
				<ControlButton
					icon
					onClick={onToggleQr}
					aria-pressed={qrOpen}
					aria-label="QR code sidebar (Q)"
					title="QR code sidebar (Q)"
					className={HIDE_BELOW_60}
				>
					<QrCode className="h-5 w-5" aria-hidden />
				</ControlButton>
				{fullscreen.supported && (
					<ControlButton
						icon
						onClick={fullscreen.toggle}
						aria-pressed={fullscreen.isFullscreen}
						aria-label="Full screen (F)"
						title={fullscreen.isFullscreen ? "Exit full screen (F)" : "Full screen (F)"}
						className={HIDE_BELOW_60}
					>
						{fullscreen.isFullscreen ? (
							<Minimize className="h-5 w-5" aria-hidden />
						) : (
							<Maximize className="h-5 w-5" aria-hidden />
						)}
					</ControlButton>
				)}
				<ControlButton
					tone="danger"
					onClick={onEnd}
					disabled={busy}
					className={cn("ml-1 whitespace-nowrap", HIDE_BELOW_60)}
				>
					{pending === "end" ? (
						<Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
					) : null}
					<span>
						End<span className={SHORT_LABEL}> session</span>
					</span>
				</ControlButton>
				<OverflowMenu
					className={SHOW_BELOW_60}
					items={menuItems}
					header={
						<div
							className={cn(
								"mb-1.5 space-y-1 border-b border-[var(--deck-border)] px-3 pb-2.5 pt-1.5 text-sm text-[var(--deck-text-muted)]",
								SHOW_BELOW_48
							)}
						>
							<p className="flex items-center gap-2 font-semibold text-[var(--deck-text)]">
								<Users className="h-4 w-4" aria-hidden />
								{plural(participants, "participant", "participants")}
								<span className={cn("h-2 w-2 rounded-full", conn.dot)} aria-hidden />
								<span className="font-medium text-[var(--deck-text-muted)]">{conn.label}</span>
							</p>
							{tally !== null && <p>{tally} on this slide</p>}
						</div>
					}
				/>
			</div>
		</nav>
	);
}
