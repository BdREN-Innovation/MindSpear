import type { GenerateRequest, GeneratedFor, GenerationTarget } from "./types";

/** Calls the Next.js AI route with the user's sign-in token. */
export async function generateFromText<T extends GenerationTarget>(req: GenerateRequest & { target: T }, signal?: AbortSignal): Promise<GeneratedFor<T>> {
	const token = typeof window !== "undefined" ? window.localStorage.getItem("auth_token") : null;
	let res: Response;
	try {
		res = await fetch("/api/ai/generate-questions", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: JSON.stringify(req),
			signal,
		});
	} catch (error) {
		if ((error as Error)?.name === "AbortError") throw error;
		throw new Error("Can't reach the server. Check your connection and try again.");
	}
	const data = (await res.json().catch(() => null)) as (GeneratedFor<T> & { error?: string }) | null;
	if (!res.ok || !data) {
		throw new Error(data?.error || "Failed to generate questions. Please try again.");
	}
	return data;
}
