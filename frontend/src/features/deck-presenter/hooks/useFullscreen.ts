"use client";

import { useCallback, useEffect, useState } from "react";

// Fullscreen API on the whole document (not one element), so dialogs, toasts
// and popovers rendered into document.body stay visible while presenting.

type WebkitDocument = Document & {
	webkitFullscreenElement?: Element | null;
	webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

function fullscreenElement(): Element | null {
	const doc = document as WebkitDocument;
	return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export interface Fullscreen {
	isFullscreen: boolean;
	supported: boolean;
	toggle: () => void;
	exit: () => void;
}

export function useFullscreen(): Fullscreen {
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [supported, setSupported] = useState(false);

	useEffect(() => {
		const root = document.documentElement as WebkitElement;
		setSupported(!!(root.requestFullscreen || root.webkitRequestFullscreen));
		const sync = () => setIsFullscreen(!!fullscreenElement());
		sync();
		document.addEventListener("fullscreenchange", sync);
		document.addEventListener("webkitfullscreenchange", sync);
		return () => {
			document.removeEventListener("fullscreenchange", sync);
			document.removeEventListener("webkitfullscreenchange", sync);
		};
	}, []);

	const exit = useCallback(() => {
		if (!fullscreenElement()) return;
		const doc = document as WebkitDocument;
		try {
			void (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.())?.catch?.(() => undefined);
		} catch {
			// Already left (Esc) — nothing to do.
		}
	}, []);

	const toggle = useCallback(() => {
		if (fullscreenElement()) {
			exit();
			return;
		}
		const root = document.documentElement as WebkitElement;
		try {
			const request = root.requestFullscreen
				? root.requestFullscreen({ navigationUI: "hide" })
				: root.webkitRequestFullscreen?.();
			void request?.catch?.(() => undefined);
		} catch {
			// Denied (iframe without allowfullscreen, no user gesture): stay windowed.
		}
	}, [exit]);

	// Leaving present mode (navigation) should not leave the browser fullscreen.
	useEffect(() => exit, [exit]);

	return { isFullscreen, supported, toggle, exit };
}
