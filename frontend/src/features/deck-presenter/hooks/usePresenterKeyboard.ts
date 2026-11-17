"use client";

import { useEffect, useRef } from "react";

// Plan §6.6 keyboard controls. Presentation clickers send PageDown / PageUp
// (some send arrows), so those map to next / previous too.
//   → Space PageDown   primary action
//   ← PageUp           previous slide
//   Esc                close the open panel, else exit (confirmed while live)
//   Q                  QR sidebar     M  Q&A moderation     F  fullscreen
// Ignored while typing, with Ctrl/Cmd/Alt held, inside an element marked
// data-presenter-keys="ignore" (the slide list handles its own arrows), and
// for Space/Enter on a focused button or link (the browser clicks it).

export interface PresenterKeyHandlers {
	onPrimary: () => void;
	onPrevious: () => void;
	onEscape: () => void;
	onToggleQr: () => void;
	onToggleModeration: () => void;
	onToggleFullscreen: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	if (tag === "TEXTAREA" || tag === "SELECT") return true;
	if (tag === "INPUT") {
		const type = (target as HTMLInputElement).type;
		return !["button", "checkbox", "radio", "range", "reset", "submit", "color", "file"].includes(type);
	}
	return false;
}

function isActivatable(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && !!target.closest("button, a[href], [role='button'], summary, input");
}

export function usePresenterKeyboard(handlers: PresenterKeyHandlers, enabled: boolean): void {
	const ref = useRef(handlers);
	ref.current = handlers;

	useEffect(() => {
		if (!enabled) return;

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
			if (isTypingTarget(event.target)) return;
			if (event.target instanceof HTMLElement && event.target.closest("[data-presenter-keys='ignore']")) return;

			const h = ref.current;
			switch (event.key) {
				case "ArrowRight":
				case "PageDown":
				case " ":
				case "Spacebar":
					if ((event.key === " " || event.key === "Spacebar") && isActivatable(event.target)) return;
					event.preventDefault();
					// A held key must not walk through the deck.
					if (!event.repeat) h.onPrimary();
					return;
				case "ArrowLeft":
				case "PageUp":
					event.preventDefault();
					if (!event.repeat) h.onPrevious();
					return;
				case "Escape":
					h.onEscape();
					return;
				case "q":
				case "Q":
					if (!event.repeat) h.onToggleQr();
					return;
				case "m":
				case "M":
					if (!event.repeat) h.onToggleModeration();
					return;
				case "f":
				case "F":
					if (!event.repeat) h.onToggleFullscreen();
					return;
				default:
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [enabled]);
}
