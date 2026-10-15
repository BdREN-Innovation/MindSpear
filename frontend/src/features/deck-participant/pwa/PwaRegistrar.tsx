"use client";

import { useEffect } from "react";
import { captureInstallPrompt } from "./installPrompt";
import { registerParticipantServiceWorker } from "./serviceWorker";

/** Mounted by app/(play)/layout.tsx: service worker + install-prompt capture on /play routes only. */
export function PwaRegistrar() {
	useEffect(() => {
		captureInstallPrompt();
		registerParticipantServiceWorker();
	}, []);
	return null;
}
