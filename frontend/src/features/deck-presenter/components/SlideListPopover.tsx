"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { CheckCircle2, Radio } from "lucide-react";
import { getSlideType } from "@/features/deck-editor/slideRegistry";
import type { ParticipantRunView } from "@/features/deck/types";
import { cn } from "@/lib/utils";
import { isActiveState, runKindOf, stateLabel } from "../lib/runKind";

// Slide rail popover (≡): every run of the session; picking one sends
// jump_to. ↑/↓ move between slides, Esc closes, focus starts on the current
// slide and returns to the trigger on close.

export interface SlideListPopoverProps {
	runs: ParticipantRunView[];
	currentRunId: number | null;
	disabled: boolean;
	onJump: (run: ParticipantRunView) => void;
	onClose: () => void;
	/** Clicks on it do not count as "outside" (it toggles the popover itself). */
	triggerRef: React.RefObject<HTMLElement | null>;
}

export function SlideListPopover({ runs, currentRunId, disabled, onJump, onClose, triggerRef }: SlideListPopoverProps) {
	const listRef = useRef<HTMLDivElement>(null);
	// Live events re-render the parent every few hundred ms; the mount effect
	// (initial focus, outside-click listener) must not re-run on each one.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		const list = listRef.current;
		const current = list?.querySelector<HTMLButtonElement>("[aria-current='true']") ?? list?.querySelector("button");
		current?.focus();
		current?.scrollIntoView({ block: "nearest" });

		const trigger = triggerRef.current;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (list?.contains(target) || trigger?.contains(target)) return;
			onCloseRef.current();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			trigger?.focus?.();
		};
	}, [triggerRef]);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
		event.preventDefault();
		const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
		if (!buttons.length) return;
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? buttons.length - 1
					: Math.min(buttons.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)));
		buttons[next]?.focus();
	};

	return (
		<div
			ref={listRef}
			role="dialog"
			aria-label="Slides"
			data-presenter-keys="ignore"
			onKeyDown={onKeyDown}
			className="absolute bottom-full left-0 z-40 mb-3 flex max-h-[min(60vh,560px)] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--deck-border)] bg-[var(--deck-surface)] text-[var(--deck-text)] shadow-2xl"
		>
			<p className="border-b border-[var(--deck-border)] px-4 py-3 text-sm font-semibold uppercase tracking-wider text-[var(--deck-text-muted)]">
				Slides · {runs.length}
			</p>
			<ol className="flex-1 overflow-y-auto p-2">
				{runs.map((run) => {
					const entry = getSlideType(run.type);
					const Icon = entry?.icon;
					const kind = runKindOf(run);
					const current = run.id === currentRunId;
					const label = stateLabel(kind, run.state);
					return (
						<li key={run.id}>
							<button
								type="button"
								aria-current={current ? "true" : undefined}
								disabled={disabled}
								onClick={() => (current ? onClose() : onJump(run))}
								className={cn(
									"flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition motion-reduce:transition-none",
									"hover:bg-[var(--deck-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--deck-focus)]",
									"disabled:cursor-not-allowed disabled:opacity-60",
									current && "bg-[var(--deck-surface-muted)] ring-1 ring-[var(--deck-primary)]"
								)}
							>
								<span className="w-7 shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--deck-text-muted)]">
									{run.position}
								</span>
								{Icon && <Icon className="h-5 w-5 shrink-0 text-[var(--deck-text-muted)]" aria-hidden />}
								<span className="min-w-0 flex-1">
									<span className="block truncate font-medium">
										{run.title?.trim() || entry?.label || run.type}
									</span>
									<span className="block truncate text-xs text-[var(--deck-text-muted)]">
										{entry?.label ?? run.type}
										{current ? " · Showing now" : ""}
									</span>
								</span>
								{label && run.state === "closed" && (
									<CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--deck-success)]" aria-hidden />
								)}
								{label && isActiveState(run.state) && (
									<Radio className="h-5 w-5 shrink-0 text-[var(--deck-primary)]" aria-hidden />
								)}
								{label && run.state !== "waiting" && <span className="sr-only">{label}</span>}
							</button>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
