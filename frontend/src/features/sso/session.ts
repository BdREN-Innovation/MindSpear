import { ssoApi } from "./api";

// Browser-side bookkeeping for BDREN sign-in. Nothing secret is kept here:
// the BDREN tokens never reach the browser, only Mindspear's own token does.

const STATE_KEY = "sso_state";
const PROVIDER_KEY = "auth_provider";

/** Starts a login or link: remembers the state in this tab, then leaves for ZITADEL. */
export async function redirectToSso(mode: "login" | "link"): Promise<void> {
	const { redirect_url, state } = mode === "link" ? await ssoApi.startLink() : await ssoApi.startLogin();
	try {
		sessionStorage.setItem(STATE_KEY, state);
	} catch {
		// Private mode without storage: the callback then skips the same-browser check.
	}
	window.location.assign(redirect_url);
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
