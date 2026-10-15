"use client";

import { useRef } from "react";
import { LogOut, Vibrate } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlayButton, SheetModal, useHaptics } from "../shell";

// The live screen's two sheets: "Leave session?" (plan §4.3, also opened by
// hardware back) and the "me" menu behind the avatar (vibration setting,
// leave).

export function LeaveSessionSheet({
	open,
	onStay,
	onLeave,
}: {
	open: boolean;
	onStay: () => void;
	onLeave: () => void;
}) {
	const stayRef = useRef<HTMLButtonElement>(null);
	return (
		<SheetModal
			open={open}
			onClose={onStay}
			title="Leave session?"
			description="You'll lose your place. You can join again with the code, but as a new participant."
			initialFocusRef={stayRef}
			footer={
				<div className="flex flex-col gap-2">
					<PlayButton ref={stayRef} onClick={onStay}>
						Stay
					</PlayButton>
					<PlayButton variant="ghost" className="text-[var(--deck-danger)]" onClick={onLeave} icon={<LogOut className="h-4 w-4" aria-hidden />}>
						Leave session
					</PlayButton>
				</div>
			}
		/>
	);
}

export function ParticipantMenuSheet({
	open,
	onClose,
	name,
	emoji,
	deckTitle,
	onLeave,
}: {
	open: boolean;
	onClose: () => void;
	name: string;
	emoji: string;
	deckTitle?: string | null;
	onLeave: () => void;
}) {
	const haptics = useHaptics();
	const unavailable = !haptics.supported
		? "This device can't vibrate."
		: haptics.reducedMotion
			? "Off while your device asks for reduced motion."
			: null;
	const checked = haptics.enabled && !unavailable;

	return (
		<SheetModal
			open={open}
			onClose={onClose}
			title={name}
			description={deckTitle ?? undefined}
			header={
				<div className="flex justify-center pb-3 pt-1">
					<span
						role="img"
						aria-label="Your avatar"
						className="flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-[var(--deck-primary)] bg-[var(--deck-bg)] text-[44px] leading-none"
					>
						{emoji}
					</span>
				</div>
			}
			footer={
				<PlayButton variant="secondary" onClick={onLeave} icon={<LogOut className="h-4 w-4" aria-hidden />}>
					Leave session
				</PlayButton>
			}
		>
			<div className="flex items-center gap-3 rounded-2xl bg-[var(--deck-surface-muted)] px-4 py-3">
				<Vibrate className="h-5 w-5 shrink-0 text-[var(--deck-text-muted)]" aria-hidden />
				<div className="min-w-0 flex-1">
					<p id="ms-play-haptics-label" className="text-sm font-medium">
						Vibration
					</p>
					<p className="text-xs text-[var(--deck-text-muted)]">{unavailable ?? "A short buzz when you tap and submit."}</p>
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={checked}
					aria-labelledby="ms-play-haptics-label"
					disabled={!!unavailable}
					onClick={() => {
						const next = !haptics.enabled;
						haptics.setEnabled(next);
						if (next) haptics.pulse("tap");
					}}
					className={cn(
						"relative inline-flex h-11 w-[60px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
						checked ? "bg-[var(--deck-primary)]" : "bg-[var(--deck-border)]"
					)}
				>
					<span
						aria-hidden
						className={cn(
							"absolute h-7 w-7 rounded-full bg-white shadow transition-transform",
							checked ? "translate-x-[26px]" : "translate-x-[6px]"
						)}
					/>
				</button>
			</div>
		</SheetModal>
	);
}
