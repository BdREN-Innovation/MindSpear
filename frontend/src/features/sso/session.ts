import { ssoApi } from "./api";

// Browser-side bookkeeping for BDREN sign-in. Nothing secret is kept here:
// the BDREN tokens never reach the browser, only Mindspear's own token does.

const STATE_KEY = "sso_state";
const PROVIDER_KEY = "auth_provider";
// Per tab (sessionStorage), for the silent sign-in (OIDC prompt=none) that makes Mindspear open signed in
// when the browser is signed in to BDREN, as Google's apps do:
const SILENT_KEY = "sso_silent"; // the attempt under way is silent
const NEXT_KEY = "sso_next"; // where to land once signed in
const FALLBACK_KEY = "sso_fallback"; // where a silent check that finds nobody signed in goes back to
const CHECKED_KEY = "sso_silent_checked"; // when a silent check last found nobody signed in
const SIGNED_OUT_KEY = "sso_signed_out"; // signed out here: no automatic sign-in until asked

// How long "nobody is signed in to BDREN" holds: long enough that one visit never asks twice, short enough
// that signing in to bdren.ai in another tab is picked up soon.
const NOT_SIGNED_IN_TTL_MS = 2 * 60 * 1000;

function store(key: string, value: string | null): void {
	try {
		if (value === null) sessionStorage.removeItem(key);
		else sessionStorage.setItem(key, value);
	} catch {
		// Private mode without storage: only the automatic sign-in is affected.
	}
}

function read(key: string): string | null {
	try {
		return sessionStorage.getItem(key);
	} catch {
		return null;
	}
}

/** Reads a one-time value and clears it. */
function take(key: string): string | null {
	const value = read(key);
	store(key, null);
	return value;
}

/** A path on this site, or null (no other origins, no protocol-relative tricks). */
export function safeNext(value: string | null | undefined): string | null {
	if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
	return value;
}

/**
 * Starts a login or link: remembers the state in this tab, then leaves for ZITADEL.
 * `silent`: prompt=none, so a browser signed in to BDREN comes straight back signed in, and any other comes
 * back with error=login_required (SsoCallback then returns to `fallback`). `next`: where to land once signed in. `fallback`: where a silent check
 * that finds nobody signed in goes back to (default: the sign-in page).
 */
export async function redirectToSso(
	mode: "login" | "link",
	options: { silent?: boolean; next?: string | null; fallback?: string | null } = {},
): Promise<void> {
	const silent = mode === "login" && options.silent === true;
	const { redirect_url, state } = mode === "link" ? await ssoApi.startLink() : await ssoApi.startLogin(silent);
	store(STATE_KEY, state);
	store(SILENT_KEY, silent ? "1" : null);
	store(NEXT_KEY, safeNext(options.next));
	store(FALLBACK_KEY, silent ? safeNext(options.fallback) : null);
	if (!silent) store(SIGNED_OUT_KEY, null); // asked to sign in: automatic sign-in may resume afterwards
	window.location.assign(redirect_url);
}

/** True when the attempt that returned was a silent one. */
export function takeSilentAttempt(): boolean {
	return take(SILENT_KEY) === "1";
}

/** Where the finished sign-in should land, if redirectToSso was given one. */
export function takeNext(): string | null {
	return safeNext(take(NEXT_KEY));
}

/** Where a silent check that found nobody signed in goes back to. */
export function takeFallback(): string {
	return safeNext(take(FALLBACK_KEY)) ?? "/auth/sign-in";
}

/** The person signed out of Mindspear in this tab and hasn't asked to sign in since. */
export function signedOutHere(): boolean {
	return read(SIGNED_OUT_KEY) !== null;
}

/** Automatic (silent) sign-in is allowed: not just signed out, and BDREN wasn't found signed out moments ago. */
export function silentSignInAllowed(): boolean {
	if (signedOutHere()) return false;
	const checkedAt = Number(read(CHECKED_KEY));
	return !checkedAt || Date.now() - checkedAt > NOT_SIGNED_IN_TTL_MS;
}

/** A silent check found nobody signed in to BDREN: don't ask again right away. */
export function noteNotSignedIn(): void {
	store(CHECKED_KEY, String(Date.now()));
}

/** The person signed out of Mindspear: never sign them back in automatically in this tab. */
export function noteSignedOut(): void {
	store(SIGNED_OUT_KEY, "1");
}

/** A sign-in finished: the "not signed in" and "signed out" notes no longer hold. */
export function clearSignInNotes(): void {
	store(CHECKED_KEY, null);
	store(SIGNED_OUT_KEY, null);
}

/**
 * True when `state` is the one this tab started, so a callback link someone else
 * sent can't sign this browser in to their account. Clears it either way.
 */
export function takeSsoState(state: string): boolean {
	try {
		const expected = sessionStorage.getItem(STATE_KEY);
		sessionStorage.removeItem(STATE_KEY);
		return expected === null ? true : expected === state;
	} catch {
		return true;
	}
}

export function markSignedInWithSso(): void {
	try {
		localStorage.setItem(PROVIDER_KEY, "bdren");
	} catch {
		// Ignore: only decides whether logout also ends the BDREN session.
	}
}

/**
 * ZITADEL's logout page when this session came from BDREN sign-in, else null.
 * Call before the Mindspear logout; send the browser there afterwards.
 */
export async function ssoLogoutUrl(): Promise<string | null> {
	try {
		if (localStorage.getItem(PROVIDER_KEY) !== "bdren") return null;
		localStorage.removeItem(PROVIDER_KEY);
		return (await ssoApi.config()).logout_url;
	} catch {
		return null;
	}
}
