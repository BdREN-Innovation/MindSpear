"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { cn } from "@/lib/utils";
import { ControlButton } from "./ControlButton";

// The control bar's ⋯ menu: holds the controls a narrow bar has no room for.
// ↑/↓/Home/End move between items, Esc closes and returns focus to ⋯. After a
// mouse pick focus is not put back on ⋯, so the next Space / → press drives
// the deck (the same rule as ControlButton).

export interface OverflowMenuItem {
	key: string;
	label: string;
	icon: ReactNode;
	onSelect: () => void;
	disabled?: boolean;
	/** Toggles (QR sidebar, full screen): announced as checked / not checked. */
	checked?: boolean;
	tone?: "danger";
	/** Starts a new group (a divider above it). */
	separated?: boolean;
	/** Keyboard shortcut shown on the right, e.g. "Q". */
	shortcut?: string;
	/** Classes for the item's block wrapper, e.g. a container query that shows it only when the bar hides its button. */
	className?: string;
}

export interface OverflowMenuProps {
	items: OverflowMenuItem[];
	/** Shown above the items (e.g. counters the bar has hidden). */
	header?: ReactNode;
	className?: string;
}

/** Items the user can reach: enabled and not hidden by a container query. */
function reachableItems(menu: HTMLElement | null): HTMLButtonElement[] {
	return Array.from(menu?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']") ?? []).filter(
		(item) => !item.disabled && item.getClientRects().length > 0
	);
}

export function OverflowMenu({ items, header, className }: OverflowMenuProps) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		reachableItems(menuRef.current)[0]?.focus();

		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
			setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	const close = (refocus: boolean) => {
		setOpen(false);
		if (refocus) triggerRef.current?.focus();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			close(true);
			return;
		}
		if (event.key === "Tab") {
			close(false);
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
		event.preventDefault();
		const reachable = reachableItems(menuRef.current);
		if (!reachable.length) return;
		const index = reachable.indexOf(document.activeElement as HTMLButtonElement);
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? reachable.length - 1
					: (index + (event.key === "ArrowDown" ? 1 : -1) + reachable.length) % reachable.length;
		reachable[next]?.focus();
	};

	const select = (item: OverflowMenuItem, event: MouseEvent<HTMLButtonElement>) => {
		// detail 0: chosen with Enter / Space, so keep the keyboard user's place.
		close(event.detail === 0);
		item.onSelect();
	};

	return (
		<div className={cn("relative", className)}>
			<ControlButton
				ref={triggerRef}
				icon
				aria-label="More controls"
				title="More controls"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-pressed={open}
				onClick={() => setOpen((value) => !value)}
			>
				<Ellipsis className="h-5 w-5" aria-hidden />
			</ControlButton>
			{open && (
				<div
					ref={menuRef}
					role="menu"
					aria-label="More controls"
					data-presenter-keys="ignore"
					onKeyDown={onKeyDown}
					className="absolute bottom-full right-0 z-40 mb-3 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-[var(--deck-border)] bg-[var(--deck-surface)] p-1.5 text-[var(--deck-text)] shadow-2xl"
				>
					{header}
					{items.map((item) => (
						<div key={item.key} className={item.className}>
							{item.separated && <div role="separator" className="mx-2 my-1.5 border-t border-[var(--deck-border)]" />}
							<button
								type="button"
								role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
								aria-checked={item.checked}
								disabled={item.disabled}
								onClick={(event) => select(item, event)}
								className={cn(
									"flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium transition",
									"hover:bg-[var(--deck-surface-muted)] focus-visible:bg-[var(--deck-surface-muted)] focus-visible:outline-none",
									"disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none",
									item.tone === "danger" && "text-[var(--deck-danger)]"
								)}
							>
								<span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
									{item.icon}
								</span>
								<span className="min-w-0 flex-1 truncate">{item.label}</span>
								{item.checked && <span className="text-sm text-[var(--deck-text-muted)]">On</span>}
								{item.shortcut && (
									<kbd className="rounded-md border border-[var(--deck-border)] px-1.5 font-sans text-xs text-[var(--deck-text-muted)]">
										{item.shortcut}
									</kbd>
								)}
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
