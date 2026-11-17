import type { GenerateRequest, GeneratedFor, GenerationTarget } from "./types";

/**
 * Where the AI server (ai-server/, FastAPI) is reached from the browser: an
 * absolute URL (CORS_ORIGINS on the server must allow this site) or a path
 * such as /ai-api that next.config.ts rewrites to it (AI_PROXY_URL).
 */
const AI_API_URL = (process.env.NEXT_PUBLIC_AI_API_URL ?? "").trim().replace(/\/$/, "");

/** Calls the AI server with the user's sign-in token. */
export async function generateFromText<T extends GenerationTarget>(req: GenerateRequest & { target: T }, signal?: AbortSignal): Promise<GeneratedFor<T>> {
	if (!AI_API_URL) throw new Error("AI generation is not configured (NEXT_PUBLIC_AI_API_URL).");
	const token = typeof window !== "undefined" ? window.localStorage.getItem("auth_token") : null;
	let res: Response;
	try {
		res = await fetch(`${AI_API_URL}/v1/generate`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: JSON.stringify(req),
			signal,
		});
	} catch (error) {
		if ((error as Error)?.name === "AbortError") throw error;
		throw new Error("Can't reach the AI server. Check your connection and try again.");
	}
	const data = (await res.json().catch(() => null)) as (GeneratedFor<T> & { error?: string }) | null;
	if (!res.ok || !data) {
		throw new Error(data?.error || "Failed to generate questions. Please try again.");
	}
	return data;
}
