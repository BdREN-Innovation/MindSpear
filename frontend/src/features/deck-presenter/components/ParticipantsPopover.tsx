"use client";

import { useEffect, useRef } from "react";
import type { RoomParticipant } from "@/features/deck/types";
import { ParticipantNames } from "./ParticipantNames";

// Control bar popover (👥): who is in the room, newest first. Esc or a click
// outside closes it; focus returns to the trigger.

export interface ParticipantsPopoverProps {
	participants: RoomParticipant[];
	total: number;
	onClose: () => void;
	/** Clicks on it do not count as "outside" (it toggles the popover itself). */
	triggerRef: React.RefObject<HTMLElement | null>;
}

export function ParticipantsPopover({ participants, total, onClose, triggerRef }: ParticipantsPopoverProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	// Live events re-render the parent often; the listeners must not be re-added each time.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		const panel = panelRef.current;
		panel?.focus();
		const trigger = triggerRef.current;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (panel?.contains(target) || trigger?.contains(target)) return;
			onCloseRef.current();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			trigger?.focus?.();
		};
	}, [triggerRef]);

	return (
		<div
			ref={panelRef}
			role="dialog"
			aria-label="Who has joined"
			tabIndex={-1}
			data-presenter-keys="ignore"
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				onClose();
			}}
			className="absolute bottom-full right-0 z-40 mb-3 flex max-h-[min(60vh,520px)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--deck-border)] bg-[var(--deck-surface)] text-[var(--deck-text)] shadow-2xl focus:outline-none"
		>
			<p className="border-b border-[var(--deck-border)] px-4 py-3 text-sm font-semibold uppercase tracking-wider text-[var(--deck-text-muted)]">
				In the room · {total}
			</p>
			<div className="min-h-0 overflow-y-auto p-3">
				<ParticipantNames participants={participants} total={total} max={200} className="justify-start" />
			</div>
		</div>
	);
}
