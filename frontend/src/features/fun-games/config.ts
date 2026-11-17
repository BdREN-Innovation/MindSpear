import { env } from "@/config/env";

export const funGamesConfig = {
	/** Serve every Fun Games call from the in-browser mock (NEXT_PUBLIC_FUN_GAMES_MOCK=1). */
	mock: env.funGamesMock === "1" || env.funGamesMock === "true",
	/** Laravel module base, e.g. https://mindspear.app/api/v1/fun-games */
	apiBaseUrl: env.apiBaseUrl ? `${env.apiBaseUrl.replace(/\/$/, "")}/fun-games` : "",
	requestTimeoutMs: 10000,
	/** Session state is re-fetched this often while realtime is connected (safety net)… */
	pollConnectedMs: 15000,
	/** …and this often while it isn't (Reverb down, not configured, or offline). */
	pollDisconnectedMs: 3000,
} as const;

/**
 * Public join page for a session, as encoded in the QR code. Uses the origin the
 * host is on, so a dev or staging host never sends players to production.
 */
export function joinUrl(joinCode: string): string {
	const origin =
		typeof window !== "undefined" ? window.location.origin : env.appUrl;
	return `${origin.replace(/\/$/, "")}/attempt/fun-games/${encodeURIComponent(joinCode)}`;
}
