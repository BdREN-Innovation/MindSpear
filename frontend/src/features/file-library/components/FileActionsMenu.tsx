"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
	fileName: string;
	onRename: () => void;
	onDownload: () => void;
	onDelete: () => void;
	className?: string;
}

const MENU_WIDTH = 160;
const MENU_HEIGHT = 128;

/**
 * ⋮ menu with Rename / Download / Delete. Rendered in a portal so cards with
 * overflow-hidden or scrolling lists can't clip it.
 */
export function FileActionsMenu({ fileName, onRename, onDownload, onDelete, className }: Props) {
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	// Below the button, right-aligned; flipped above when there's no room at the bottom.
	const place = () => {
		const rect = buttonRef.current?.getBoundingClientRect();
		if (!rect) return;
		const below = rect.bottom + 4;
		const top = below + MENU_HEIGHT > window.innerHeight - 8 ? Math.max(8, rect.top - MENU_HEIGHT - 4) : below;
		const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
		setPosition({ top, left });
	};

	useLayoutEffect(() => {
		if (open) place();
	}, [open]);

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

	const item = (label: string, Icon: typeof Pencil, action: () => void, danger = false) => (
		<button
			type="button"
			role="menuitem"
			onClick={(e) => {
				e.stopPropagation();
				setOpen(false);
				action();
			}}
			className={cn(
				"flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-2 dark:hover:bg-dark-3",
				danger ? "text-red-dark" : "text-dark dark:text-white",
			)}
		>
			<Icon className="h-4 w-4" aria-hidden />
			{label}
		</button>
	);

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
				aria-label={`Actions for ${fileName}`}
				className="flex h-8 w-8 items-center justify-center rounded-lg text-dark-5 transition hover:bg-gray-2 hover:text-dark dark:hover:bg-dark-3 dark:hover:text-white"
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
							{item("Rename", Pencil, onRename)}
							{item("Download", Download, onDownload)}
							{item("Delete", Trash2, onDelete, true)}
						</div>,
						document.body,
					)
				: null}
		</div>
	);
}
