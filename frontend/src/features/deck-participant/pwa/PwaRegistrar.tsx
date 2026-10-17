"use client";

import { useEffect } from "react";
import { captureInstallPrompt } from "./installPrompt";
import { registerParticipantServiceWorker } from "./serviceWorker";

/**
 * Mounted by app/(play)/layout.tsx: service worker + install-prompt capture on
 * /play routes only. `version` = the Next build id (cache version of the worker).
 */
export function PwaRegistrar({ version }: { version?: string | null }) {
	useEffect(() => {
		captureInstallPrompt();
		registerParticipantServiceWorker(version);
	}, [version]);
	return null;
}
