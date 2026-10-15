"use client";

// Registers public/sw.js for the participant app only (scope /play).
// Production builds register by default (NEXT_PUBLIC_PWA_DISABLED=true opts
// out). In development the worker would cache dev chunks and fight hot
// reload, so it registers only when NEXT_PUBLIC_PWA_DEV=true or
// localStorage "mindspear:pwa-dev" = "1"; otherwise any earlier dev
// registration is removed.

export const PWA_SCOPE = "/play";
const SW_URL = "/sw.js";
const DEV_FLAG_KEY = "mindspear:pwa-dev";

function devFlagOn(): boolean {
	if (process.env.NEXT_PUBLIC_PWA_DEV === "true") return true;
	try {
		return window.localStorage.getItem(DEV_FLAG_KEY) === "1";
	} catch {
		return false;
	}
}

export function serviceWorkerWanted(): boolean {
	if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
	// Service workers need https (http://localhost counts as secure).
	if (!window.isSecureContext) return false;
	if (process.env.NODE_ENV === "production") return process.env.NEXT_PUBLIC_PWA_DISABLED !== "true";
	return devFlagOn();
}

let started = false;

export function registerParticipantServiceWorker(): void {
	if (started || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
	started = true;

	if (!serviceWorkerWanted()) {
		navigator.serviceWorker
			.getRegistration(PWA_SCOPE)
			.then((registration) => registration?.unregister())
			.catch(() => undefined);
		return;
	}

	const register = () => {
		navigator.serviceWorker.register(SW_URL, { scope: PWA_SCOPE }).catch((error: unknown) => {
			console.warn("MindSpear service worker registration failed", error);
		});
	};

	// After load, so the worker's precache never competes with the first paint.
	if (document.readyState === "complete") register();
	else window.addEventListener("load", register, { once: true });
}
