"use client";

import { useEffect, useState } from "react";
import { redirectToSso, silentSignInAllowed } from "./session";
import { useSsoConfig } from "./useSsoConfig";

/**
 * Like Google's apps: a browser already signed in to BDREN is signed in to Mindspear without a click.
 * When `active`, asks BDREN silently (prompt=none): signed in → straight to `next`; nobody signed in →
 * back to `fallback` with nothing shown. Asks again when the person comes back to the tab. Skipped right
 * after "Log out" and for a short while after a check that found nobody signed in (silentSignInAllowed).
 * Returns true while the check may still leave the page (config loading or redirecting).
 */
export function useSilentSignIn({ active, next, fallback }: { active: boolean; next: string; fallback: string }): boolean {
	const config = useSsoConfig();
	const [checking, setChecking] = useState(active);

	useEffect(() => {
		if (!active) {
			setChecking(false);
			return;
		}
		if (config === undefined) return; // still loading
		if (!config?.enabled || !silentSignInAllowed()) {
			setChecking(false);
			return;
		}
		redirectToSso("login", { silent: true, next, fallback }).catch(() => setChecking(false));
	}, [active, config, next, fallback]);

	// Coming back to this tab (e.g. after signing in to bdren.ai in another one): ask BDREN again.
	useEffect(() => {
		if (!active || !config?.enabled) return;
		const onVisible = () => {
			if (document.visibilityState === "visible" && silentSignInAllowed()) {
				void redirectToSso("login", { silent: true, next, fallback }).catch(() => undefined);
			}
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [active, config, next, fallback]);

	return checking;
}
