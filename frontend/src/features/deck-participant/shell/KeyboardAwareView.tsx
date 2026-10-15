"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useParticipantShell } from "./AppShell";
import { useKeyboardInset } from "./useKeyboardInset";

// Keeps form fields above the software keyboard (plan §4.2). Inside an
// AppShell the shell already lifts the whole frame by the keyboard height,
// so this only scrolls the focused field into view; on its own it also pads
// its bottom by the covered height. Degrades to a plain div where
// visualViewport is missing.

export interface KeyboardAwareViewProps {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}

export function KeyboardAwareView({ children, className, style }: KeyboardAwareViewProps) {
	const shell = useParticipantShell();
	const ownInset = useKeyboardInset();
	const inset = shell.managesKeyboard ? shell.keyboardInset : ownInset;
	const ref = useRef<HTMLDivElement>(null);
	const reduceMotion = useReducedMotion();

	useEffect(() => {
		if (!inset) return;
		const active = document.activeElement;
		if (active instanceof HTMLElement && ref.current?.contains(active)) {
			active.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
		}
	}, [inset, reduceMotion]);

	return (
		<div
			ref={ref}
			className={cn("transition-[padding] duration-150 ease-out", className)}
			style={!shell.managesKeyboard && inset ? { ...style, paddingBottom: inset } : style}
		>
			{children}
		</div>
	);
}

export { useKeyboardInset } from "./useKeyboardInset";
