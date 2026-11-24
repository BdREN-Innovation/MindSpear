"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ActionsMenuItem {
	label: string;
	icon: LucideIcon;
	onSelect: () => void;
	/** Red, for destructive actions such as Delete. */
	danger?: boolean;
	disabled?: boolean;
}

interface Props {
	/** Names the trigger for screen readers, e.g. "Actions for Biology quiz". */
	label: string;
	items: ActionsMenuItem[];
	className?: string;
}

const MENU_WIDTH = 168;
const ITEM_HEIGHT = 36;

/**
 * ⋮ button with a small menu of actions. The menu is rendered in a portal so
 * cards with overflow-hidden or scrolling lists can't clip it. Esc, a click
 * outside, scrolling or resizing closes it.
 */
export function ActionsMenu({ label, items, className }: Props) {
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const menuHeight = items.length * ITEM_HEIGHT + 8;

	// Below the button, right-aligned; flipped above when there's no room at the bottom.
	useLayoutEffect(() => {
		if (!open) return;
		const rect = buttonRef.current?.getBoundingClientRect();
		if (!rect) return;
		const below = rect.bottom + 4;
		const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, rect.top - menuHeight - 4) : below;
		const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
		setPosition({ top, left });
	}, [open, menuHeight]);

	useEffect(() => {
		if (!open) return;
		const close = (event: MouseEvent | KeyboardEvent) => {
			if (event instanceof KeyboardEvent) {
				if (event.key === "Escape") setOpen(false);
				return;
			}
			const target = event.target as Node;
			if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
		};
		const dismiss = () => setOpen(false);
		document.addEventListener("mousedown", close);
		document.addEventListener("keydown", close);
		window.addEventListener("resize", dismiss);
		window.addEventListener("scroll", dismiss, true);
		return () => {
			document.removeEventListener("mousedown", close);
			document.removeEventListener("keydown", close);
			window.removeEventListener("resize", dismiss);
			window.removeEventListener("scroll", dismiss, true);
		};
	}, [open]);

	return (
		<div className={cn("relative", className)}>
			<button
				ref={buttonRef}
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setOpen((v) => !v);
				}}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={label}
				title="More actions"
				className="flex h-8 w-8 items-center justify-center rounded-lg text-dark-5 transition hover:bg-gray-2 hover:text-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary-400 dark:hover:bg-dark-3 dark:hover:text-white"
			>
				<MoreVertical className="h-4 w-4" aria-hidden />
			</button>
			{open && position
				? createPortal(
						<div
							ref={menuRef}
							role="menu"
							style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
							className="fixed z-[1050] overflow-hidden rounded-xl border border-stroke bg-white py-1 shadow-lg dark:border-stroke-dark dark:bg-gray-dark"
						>
							{items.map(({ label: itemLabel, icon: Icon, onSelect, danger, disabled }) => (
								<button
									key={itemLabel}
									type="button"
									role="menuitem"
									disabled={disabled}
									onClick={(e) => {
										e.stopPropagation();
										setOpen(false);
										onSelect();
									}}
									className={cn(
										"flex h-9 w-full items-center gap-2 px-3 text-left text-sm hover:bg-gray-2 disabled:opacity-50 dark:hover:bg-dark-3",
										danger ? "text-red-dark" : "text-dark dark:text-white",
									)}
								>
									<Icon className="h-4 w-4" aria-hidden />
									{itemLabel}
								</button>
							))}
						</div>,
						document.body,
					)
				: null}
		</div>
	);
}
