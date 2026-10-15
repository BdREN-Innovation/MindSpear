"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from "framer-motion";
import { cn } from "@/lib/utils";
import { useDeckTheme } from "@/features/deck/theme";
import { ShellStyles } from "./shellStyles";

// iOS-style bottom sheet (plan §4.2): spring in from the bottom, drag the
// grab handle / header down to dismiss (distance or flick velocity), tap
// the backdrop or press Escape to close. Dragging starts only from the
// handle + header, so a scrolling body (the emoji grid) scrolls normally.
// Rendered in a portal; the deck palette is re-applied there because the
// --deck-* variables live on the shell element.

export interface SheetModalProps {
	open: boolean;
	onClose: () => void;
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	/** Sticky actions under the body. */
	footer?: ReactNode;
	/** false: no backdrop / drag / Escape dismissal (an explicit action must close it). */
	dismissible?: boolean;
	/** Visually hide the title (it still labels the dialog). */
	hideTitle?: boolean;
	/** Focus this element on open (default: the sheet itself). */
	initialFocusRef?: React.RefObject<HTMLElement | null>;
	/** Content rendered above the title (e.g. a big preview). */
	header?: ReactNode;
	className?: string;
}

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 600;

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SheetModal({
	open,
	onClose,
	title,
	description,
	children,
	footer,
	dismissible = true,
	hideTitle = false,
	initialFocusRef,
	header,
	className,
}: SheetModalProps) {
	const theme = useDeckTheme();
	const reduceMotion = useReducedMotion();
	const dragControls = useDragControls();
	const panelRef = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const descriptionId = useId();
	const [mounted, setMounted] = useState(false);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => setMounted(true), []);

	// Focus in on open, back to the opener on close; Escape; Tab stays inside.
	useEffect(() => {
		// Wait for the portal (mounted) so the panel exists when an open-on-mount sheet focuses.
		if (!open || !mounted) return;
		const opener = document.activeElement as HTMLElement | null;
		const frame = requestAnimationFrame(() => {
			(initialFocusRef?.current ?? panelRef.current)?.focus({ preventScroll: true });
		});
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && dismissible) {
				event.stopPropagation();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab" || !panelRef.current) return;
			const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
				(element) => element.offsetParent !== null
			);
			if (items.length === 0) {
				event.preventDefault();
				return;
			}
			const first = items[0];
			const last = items[items.length - 1];
			if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("keydown", onKeyDown);
			if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
		};
	}, [open, mounted, dismissible, initialFocusRef]);

	const onDragEnd = (_: unknown, info: PanInfo) => {
		if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) onClose();
	};

	if (!mounted) return null;

	const spring = reduceMotion
		? { duration: 0 }
		: { type: "spring" as const, stiffness: 380, damping: 36, mass: 0.9 };

	return createPortal(
		<AnimatePresence>
			{open && (
				<div
					className="ms-play-shell fixed inset-0 z-[1000] flex items-end justify-center font-sans"
					style={{ ...(theme.cssVars as CSSProperties), colorScheme: theme.isDark ? "dark" : "light" }}
				>
					<ShellStyles />
					<motion.div
						aria-hidden
						className="absolute inset-0 bg-black/50"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
						onClick={dismissible ? onClose : undefined}
					/>
					<motion.div
						ref={panelRef}
						role="dialog"
						aria-modal="true"
						aria-labelledby={titleId}
						aria-describedby={description ? descriptionId : undefined}
						tabIndex={-1}
						className={cn(
							"relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-[var(--deck-surface)] text-[var(--deck-text)] shadow-2xl outline-none",
							className
						)}
						style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
						initial={{ y: "100%" }}
						animate={{ y: 0 }}
						exit={{ y: "100%" }}
						transition={spring}
						drag={dismissible ? "y" : false}
						dragListener={false}
						dragControls={dragControls}
						dragConstraints={{ top: 0, bottom: 0 }}
						dragElastic={{ top: 0.04, bottom: 0.85 }}
						dragMomentum={false}
						onDragEnd={onDragEnd}
					>
						<div
							className={cn("shrink-0 touch-none select-none px-5 pb-2", dismissible && "cursor-grab active:cursor-grabbing")}
							onPointerDown={dismissible ? (event) => dragControls.start(event) : undefined}
						>
							<div className="flex justify-center pb-2 pt-3" aria-hidden>
								<span className="h-1.5 w-10 rounded-full bg-[var(--deck-border)]" />
							</div>
							{header}
							<h2 id={titleId} className={cn("text-lg font-semibold leading-snug", hideTitle && "sr-only")}>
								{title}
							</h2>
							{description && (
								<p id={descriptionId} className="mt-1 text-sm text-[var(--deck-text-muted)]">
									{description}
								</p>
							)}
						</div>
						{children && <div className="ms-play-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-2">{children}</div>}
						{footer && <div className="shrink-0 px-5 pt-3">{footer}</div>}
					</motion.div>
				</div>
			)}
		</AnimatePresence>,
		document.body
	);
}
