"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ControlButton, type ControlTone } from "./ControlButton";

// Small themed confirm used for "go back while voting", "end session" and
// "exit". Own component (not SweetAlert) so it shares the presenter's theme
// and keyboard rules: Esc cancels, Tab stays inside, Enter on the focused
// button. The presenter's global keys are off while it is open. Rendered in
// place (no portal) so it inherits the deck's --deck-* variables.

export interface ConfirmAction {
	label: string;
	tone?: ControlTone;
	onSelect: () => void;
}

export interface ConfirmDialogProps {
	open: boolean;
	title: string;
	description?: ReactNode;
	confirm: ConfirmAction;
	/** An extra choice shown between cancel and confirm (e.g. "Exit, keep it live"). */
	secondary?: ConfirmAction;
	cancelLabel?: string;
	onCancel: () => void;
	/** Which button gets focus: confirm for low-risk prompts, cancel for destructive ones. */
	initialFocus?: "confirm" | "cancel";
	busy?: boolean;
}

export function ConfirmDialog({
	open,
	title,
	description,
	confirm,
	secondary,
	cancelLabel = "Cancel",
	onCancel,
	initialFocus = "confirm",
	busy = false,
}: ConfirmDialogProps) {
	const titleId = useId();
	const descriptionId = useId();
	const panelRef = useRef<HTMLDivElement>(null);
	const confirmRef = useRef<HTMLButtonElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement as HTMLElement | null;
		(initialFocus === "cancel" ? cancelRef : confirmRef).current?.focus();
		return () => previous?.focus?.();
	}, [open, initialFocus]);

	if (!open) return null;

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		event.stopPropagation();
		if (event.key === "Escape") {
			event.preventDefault();
			if (!busy) onCancel();
			return;
		}
		if (event.key !== "Tab" || !panelRef.current) return;
		const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
		if (!focusable.length) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	return (
		<div
			className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/55 p-4"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !busy) onCancel();
			}}
			onKeyDown={onKeyDown}
			data-presenter-keys="ignore"
		>
			<div
				ref={panelRef}
				role="alertdialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={description ? descriptionId : undefined}
				className="w-full max-w-lg rounded-2xl border border-[var(--deck-border)] bg-[var(--deck-surface)] p-6 text-[var(--deck-text)] shadow-2xl"
			>
				<h2 id={titleId} className="text-xl font-bold">
					{title}
				</h2>
				{description && (
					<div id={descriptionId} className="mt-2 text-base text-[var(--deck-text-muted)]">
						{description}
					</div>
				)}
				<div className="mt-6 flex flex-wrap justify-end gap-3">
					<ControlButton ref={cancelRef} tone="outline" onClick={onCancel} disabled={busy}>
						{cancelLabel}
					</ControlButton>
					{secondary && (
						<ControlButton tone={secondary.tone ?? "outline"} onClick={secondary.onSelect} disabled={busy}>
							{secondary.label}
						</ControlButton>
					)}
					<ControlButton ref={confirmRef} tone={confirm.tone ?? "primary"} onClick={confirm.onSelect} disabled={busy}>
						{confirm.label}
					</ControlButton>
				</div>
			</div>
		</div>
	);
}
