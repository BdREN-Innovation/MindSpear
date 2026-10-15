"use client";

import { useCallback, useSyncExternalStore } from "react";

// "Add to home screen" (plan §4.1). Chrome/Edge/Samsung fire
// beforeinstallprompt: we keep the event (preventDefault stops the
// mini-infobar) and offer our own banner after a successful join. iOS has
// no such event: we show a Share → "Add to Home Screen" hint instead.
// Never shown in the installed app (display-mode: standalone); a dismissal
// is remembered on the device.

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISSED_KEY = "mindspear:play:install-dismissed";
const ELIGIBLE_KEY = "mindspear:play:install-eligible";

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedNow = false;
let captured = false;
let version = 0;
const listeners = new Set<() => void>();

function notify() {
	version += 1;
	listeners.forEach((listener) => listener());
}

/** Start listening for beforeinstallprompt / appinstalled (idempotent; call early on /play pages). */
export function captureInstallPrompt(): void {
	if (captured || typeof window === "undefined") return;
	captured = true;
	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		deferredPrompt = event as BeforeInstallPromptEvent;
		notify();
	});
	window.addEventListener("appinstalled", () => {
		deferredPrompt = null;
		installedNow = true;
		notify();
	});
}

export function isStandalone(): boolean {
	if (typeof window === "undefined") return false;
	try {
		if (window.matchMedia("(display-mode: standalone)").matches) return true;
		if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
	} catch {
		// matchMedia unavailable: fall through.
	}
	return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
	if (typeof navigator === "undefined") return false;
	const ua = navigator.userAgent;
	// iPadOS 13+ reports itself as a Mac with touch.
	return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function readFlag(kind: "local" | "session", key: string): boolean {
	try {
		return (kind === "local" ? window.localStorage : window.sessionStorage).getItem(key) === "1";
	} catch {
		return false;
	}
}

function writeFlag(kind: "local" | "session", key: string): void {
	try {
		(kind === "local" ? window.localStorage : window.sessionStorage).setItem(key, "1");
	} catch {
		// Storage disabled: the banner just shows again next time.
	}
}

/** Call after a successful join: the banner may show from now on (this tab). */
export function markInstallEligible(): void {
	writeFlag("session", ELIGIBLE_KEY);
	notify();
}

export type InstallMode = "prompt" | "ios";

export interface InstallPromptState {
	/** What to offer now, or null (not eligible, dismissed, installed, unsupported). */
	mode: InstallMode | null;
	/** Show the browser's install dialog (mode 'prompt'). Resolves true when accepted. */
	install: () => Promise<boolean>;
	/** Hide for good on this device. */
	dismiss: () => void;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	let media: MediaQueryList | null = null;
	try {
		media = window.matchMedia("(display-mode: standalone)");
		media.addEventListener("change", listener);
	} catch {
		media = null;
	}
	return () => {
		listeners.delete(listener);
		media?.removeEventListener("change", listener);
	};
}

function currentMode(): InstallMode | null {
	if (installedNow || isStandalone()) return null;
	if (!readFlag("session", ELIGIBLE_KEY) || readFlag("local", DISMISSED_KEY)) return null;
	if (deferredPrompt) return "prompt";
	if (isIos()) return "ios";
	return null;
}

export function useInstallPrompt(): InstallPromptState {
	// Re-read on every notify (version) so storage flags are picked up.
	useSyncExternalStore(
		subscribe,
		() => version,
		() => 0
	);
	const mode = typeof window === "undefined" ? null : currentMode();

	const install = useCallback(async () => {
		const event = deferredPrompt;
		if (!event) return false;
		deferredPrompt = null;
		try {
			await event.prompt();
			const choice = await event.userChoice;
			if (choice.outcome === "accepted") installedNow = true;
			else writeFlag("local", DISMISSED_KEY);
			return choice.outcome === "accepted";
		} catch {
			return false;
		} finally {
			notify();
		}
	}, []);

	const dismiss = useCallback(() => {
		writeFlag("local", DISMISSED_KEY);
		notify();
	}, []);

	return { mode, install, dismiss };
}
