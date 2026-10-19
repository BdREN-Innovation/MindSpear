import type { LiveModule, ParticipantTokenBundle } from "@/features/live/types";

const prefix = "mindspear:live";

const keyFor = (module: LiveModule, sessionId: number | string, key: string) =>
	`${prefix}:${module}:${sessionId}:${key}`;

export function storeParticipantTokenBundle(bundle: ParticipantTokenBundle): void {
	if (typeof window === "undefined") return;

	window.sessionStorage.setItem(
		keyFor(bundle.module, bundle.sessionId, "participant_token"),
		bundle.participantToken
	);
	window.sessionStorage.setItem(
		keyFor(bundle.module, bundle.sessionId, "attempt_id"),
		String(bundle.attemptId)
	);
	window.sessionStorage.setItem(
		keyFor(bundle.module, bundle.sessionId, "public_channel_key"),
		bundle.publicChannelKey
	);
}

export function getParticipantToken(module: LiveModule, sessionId: number | string | null): string | null {
	if (typeof window === "undefined" || !sessionId) return null;
	return window.sessionStorage.getItem(keyFor(module, sessionId, "participant_token"));
}

export function getStoredAttemptId(module: LiveModule, sessionId: number | string | null): number | null {
	if (typeof window === "undefined" || !sessionId) return null;
	const value = window.sessionStorage.getItem(keyFor(module, sessionId, "attempt_id"));
	return value ? Number(value) : null;
}

export function getStoredPublicChannelKey(
	module: LiveModule,
	sessionId: number | string | null
): string | null {
	if (typeof window === "undefined" || !sessionId) return null;
	return window.sessionStorage.getItem(keyFor(module, sessionId, "public_channel_key"));
}

export function clearLiveSessionStorage(module?: LiveModule, sessionId?: number | string): void {
	if (typeof window === "undefined") return;

	const namespace = sessionId && module ? `${prefix}:${module}:${sessionId}:` : prefix;
	Object.keys(window.sessionStorage).forEach((key) => {
		if (key.startsWith(namespace)) window.sessionStorage.removeItem(key);
	});
}

export function clearLegacyLiveStorage(): void {
	if (typeof window === "undefined") return;

	const legacyKeys = [
		"quest.session",
		"quiz.session",
		"quiz_currentQuestion",
		"quiz_questions",
		"quiz_questionsId",
		"leaderboardState",
		"userTimeSet",
		"currentId",
	];

	legacyKeys.forEach((key) => window.localStorage.removeItem(key));
	Object.keys(window.localStorage).forEach((key) => {
		if (
			key.startsWith("timer_") ||
			key.startsWith("attempt-") ||
			key.startsWith("timeExpired_") ||
			// "Answered" marks from an earlier session of the same quiz (same question ids).
			key.startsWith("answered_") ||
			key.startsWith("quest:joined:") ||
			key.startsWith("quiz:joined:")
		) {
			window.localStorage.removeItem(key);
		}
	});
}

/**
 * A player's place in a live session, kept per join link in this browser so they can carry on
 * after the tab closes or the browser restarts (the participant token above lives in tab-only
 * storage, so reopening the link used to start them over as a new player with no score).
 */
export type LiveSeat = {
	sessionId: number;
	attemptId: number;
	participantToken: string;
	publicChannelKey: string;
	name: string;
	playUrl: string;
};

const seatKey = (module: LiveModule, joinLink: string) => `${prefix}:seat:${module}:${joinLink}`;

export function rememberLiveSeat(module: LiveModule, joinLink: string, seat: LiveSeat): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(seatKey(module, joinLink), JSON.stringify(seat));
	} catch {}
}

export function getLiveSeat(module: LiveModule, joinLink: string | null): LiveSeat | null {
	if (typeof window === "undefined" || !joinLink) return null;
	try {
		const raw = window.localStorage.getItem(seatKey(module, joinLink));
		return raw ? (JSON.parse(raw) as LiveSeat) : null;
	} catch {
		return null;
	}
}

export function forgetLiveSeat(module: LiveModule, joinLink: string | null): void {
	if (typeof window === "undefined" || !joinLink) return;
	try {
		window.localStorage.removeItem(seatKey(module, joinLink));
	} catch {}
}
