"use client";

import type { RoomParticipant } from "@/features/deck/types";
import { cn } from "@/lib/utils";

// Names of the people in the room, newest first, as chips (the join sidebar
// and the participants popover). The newest one is marked so a join is
// noticed from across the room.

export function participantName(participant: RoomParticipant): string {
	return participant.display_name?.trim() || "Guest";
}

export interface ParticipantNamesProps {
	participants: RoomParticipant[];
	total: number;
	/** Chips shown before "+N more". */
	max?: number;
	className?: string;
}

export function ParticipantNames({ participants, total, max = 40, className }: ParticipantNamesProps) {
	if (total === 0) {
		return <p className={cn("text-sm text-[var(--deck-text-muted)]", className)}>No one has joined yet.</p>;
	}
	const shown = participants.slice(0, max);
	const more = Math.max(0, total - shown.length);

	return (
		<ul className={cn("flex flex-wrap justify-center gap-1.5", className)} aria-label="Who has joined">
			{shown.map((participant, index) => (
				<li
					key={participant.participant_id}
					className={cn(
						"flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium",
						index === 0
							? "border-[var(--deck-primary)] bg-[var(--deck-surface-muted)] motion-safe:animate-[pulse_1.2s_ease-in-out_1]"
							: "border-[var(--deck-border)] bg-[var(--deck-surface)]"
					)}
				>
					<span aria-hidden className="text-base leading-none">
						{participant.emoji_avatar || "🙂"}
					</span>
					<span className="truncate">{participantName(participant)}</span>
				</li>
			))}
			{more > 0 ? (
				<li className="flex items-center rounded-full px-2.5 py-1 text-sm font-semibold text-[var(--deck-text-muted)]">+{more} more</li>
			) : null}
		</ul>
	);
}
