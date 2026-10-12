import type { ParticipantCredentials } from "../types";

// Kept in localStorage (not sessionStorage like the older live quiz) so a player
// who closes the tab can come back to the same game, and to their results, on
// this device. Screens offer "Not you?" to clear it on shared computers.

const key = (joinCode: string) => `mindspear:fungame:${joinCode.trim().toUpperCase()}`;

export function loadCredentials(joinCode: string): ParticipantCredentials | null {
	try {
		const raw = window.localStorage.getItem(key(joinCode));
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<ParticipantCredentials>;
		return value.token && value.sessionId && value.participantId && value.publicChannelKey
			? (value as ParticipantCredentials)
			: null;
	} catch {
		return null;
	}
}

export function saveCredentials(credentials: ParticipantCredentials): void {
	try {
		window.localStorage.setItem(key(credentials.joinCode), JSON.stringify(credentials));
	} catch {
		// Private mode or storage full: the game still works until the tab closes.
	}
}

export function clearCredentials(joinCode: string): void {
	try {
		window.localStorage.removeItem(key(joinCode));
	} catch {
		// ignore
	}
}

/** The name and email last used on this device, to prefill the join form. */
export function loadLastIdentity(): { name: string; email: string } | null {
	try {
		const raw = window.localStorage.getItem("mindspear:fungame:last-identity");
		return raw ? (JSON.parse(raw) as { name: string; email: string }) : null;
	} catch {
		return null;
	}
}

export function saveLastIdentity(name: string, email: string): void {
	try {
		window.localStorage.setItem("mindspear:fungame:last-identity", JSON.stringify({ name, email }));
	} catch {
		// ignore
	}
}
