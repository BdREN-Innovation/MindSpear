"use client";

import { useRef } from "react";
import {
	BarChart3,
	ChevronLeft,
	ChevronRight,
	List,
	Loader2,
	LogOut,
	Maximize,
	MessagesSquare,
	Minimize,
	Play,
	QrCode,
	Square,
	SkipForward,
	Users,
} from "lucide-react";
import type { DeckConnectionStatus } from "@/features/deck/live/channelState";
import type { ParticipantRunView } from "@/features/deck/types";
import { cn } from "@/lib/utils";
import type { PendingAction } from "../hooks/useHostControls";
import type { PrimaryAction } from "../lib/runKind";
import { ControlButton } from "./ControlButton";
import { SlideListPopover } from "./SlideListPopover";

// Bottom control bar (plan §6.2):
//   [exit] [≡ slides] ‹ 3 / 12 ›   [ primary action ]   📊 12 · 👥 42 ● · Q&A · QR · ⛶ · End
// Sized to fit a 1280 px projector with the QR sidebar open (~1000 px).
// Every action button is disabled while one request is in flight, so a
// double click can never advance twice.

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

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
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
	connection: DeckConnectionStatus;
	qrOpen: boolean;
	onToggleQr: () => void;
	/** Shown on Q&A runs only. */
	moderation: { open: boolean; count: number; onToggle: () => void } | null;
	fullscreen: { isFullscreen: boolean; supported: boolean; toggle: () => void };
	onEnd: () => void;
	onExit: () => void;
}

function PrimaryIcon({ primary, busy }: { primary: PrimaryAction; busy: boolean }) {
	if (busy || primary.kind === "wait")
		return <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />;
	if (primary.kind === "end") return <Square className="h-5 w-5" aria-hidden />;
	switch (primary.action) {
		case "start_voting":
			return <Play className="h-5 w-5" aria-hidden />;
		case "close_voting":
			return <Square className="h-5 w-5" aria-hidden />;
		default:
			return <SkipForward className="h-5 w-5" aria-hidden />;
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
		connection,
		qrOpen,
		onToggleQr,
		moderation,
		fullscreen,
		onEnd,
		onExit,
	} = props;
	const listTriggerRef = useRef<HTMLButtonElement>(null);
	const busy = pending !== null;
	const conn = CONNECTION[connection];
	const primaryBusy =
		busy && (pending === "end" ? primary.kind === "end" : primary.kind === "advance" && pending === primary.action);

	return (
		<nav
			aria-label="Presenter controls"
			className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--deck-border)] bg-[var(--deck-surface)] px-3 py-2 text-[var(--deck-text)]"
		>
			{/* Left: exit, slide list, prev / position / next */}
			<div className="flex min-w-0 items-center gap-1">
				<ControlButton icon onClick={onExit} aria-label="Exit present mode (Esc)" title="Exit present mode (Esc)">
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
				>
					<ChevronLeft className="h-6 w-6" aria-hidden />
				</ControlButton>
				<span className="min-w-[4.5rem] text-center text-base font-semibold tabular-nums" aria-live="polite">
					{position ?? "–"}
					<span className="text-[var(--deck-text-muted)]"> / {totalSlides ?? "–"}</span>
					<span className="sr-only"> slides</span>
				</span>
				<ControlButton icon onClick={onNext} disabled={busy || !canNext} aria-label="Next slide" title="Next slide">
					<ChevronRight className="h-6 w-6" aria-hidden />
				</ControlButton>
			</div>

			{/* Centre: the one state-dependent action */}
			<ControlButton
				tone="primary"
				size="lg"
				onClick={onPrimary}
				disabled={busy || primary.kind === "wait"}
				aria-keyshortcuts="ArrowRight Space"
				title={`${primary.label} (→ / Space)`}
				className="min-w-[11rem]"
			>
				<PrimaryIcon primary={primary} busy={primaryBusy} />
				{primary.label}
			</ControlButton>

			{/* Right: counters, panels, end */}
			<div className="flex min-w-0 items-center justify-end gap-1">
				{responses !== null && (
					<span
						className="flex items-center gap-1.5 whitespace-nowrap px-2 text-base font-semibold tabular-nums"
						title={`${plural(responses.count, "response", "responses")}${
							responses.people !== null ? ` from ${plural(responses.people, "person", "people")}` : ""
						} on this slide`}
					>
						<BarChart3 className="h-5 w-5" aria-hidden />
						{responses.people !== null && responses.people !== responses.count ? (
							<>
								{plural(responses.count, "response", "responses")}
								<span className="font-medium text-[var(--deck-text-muted)]">
									· {plural(responses.people, "person", "people")}
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
					className="flex items-center gap-1.5 whitespace-nowrap px-2 text-base font-semibold tabular-nums"
					title={`${participantCount ?? 0} participants · ${conn.label}`}
				>
					<Users className="h-5 w-5" aria-hidden />
					{participantCount ?? 0}
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
				<ControlButton
					icon
					onClick={onToggleQr}
					aria-pressed={qrOpen}
					aria-label="QR code sidebar (Q)"
					title="QR code sidebar (Q)"
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
					>
						{fullscreen.isFullscreen ? (
							<Minimize className="h-5 w-5" aria-hidden />
						) : (
							<Maximize className="h-5 w-5" aria-hidden />
						)}
					</ControlButton>
				)}
				<ControlButton tone="danger" onClick={onEnd} disabled={busy} className="ml-1 whitespace-nowrap">
					{pending === "end" ? (
						<Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
					) : null}
					End session
				</ControlButton>
			</div>
		</nav>
	);
}
