import axios, { AxiosHeaders, type AxiosRequestConfig } from "axios";
import { funGamesConfig } from "../config";
import { serverClock } from "../lib/serverClock";

export type FunGamesErrorCode =
	| "notConfigured"
	| "aborted"
	| "network"
	| "timeout"
	| "unauthorized"
	| "forbidden"
	| "notFound"
	| "conflict"
	| "validation"
	| "rateLimited"
	| "server"
	| "unknown";

const DEFAULT_MESSAGES: Record<FunGamesErrorCode, string> = {
	notConfigured: "Fun Games isn't configured for this environment.",
	aborted: "The request was cancelled.",
	network: "Can't reach the server. Check your connection.",
	timeout: "The server took too long to respond.",
	unauthorized: "Your session has expired.",
	forbidden: "You don't have access to this.",
	notFound: "We couldn't find that.",
	conflict: "This changed on the server. Reload and try again.",
	validation: "Some fields need attention.",
	rateLimited: "Too many attempts. Wait a moment and try again.",
	server: "The server ran into a problem. Try again shortly.",
	unknown: "Something went wrong.",
};

export class FunGamesApiError extends Error {
	readonly code: FunGamesErrorCode;
	readonly status: number | null;
	/** Field → messages, for validation errors. */
	readonly fields?: Record<string, string[]>;
	/** The response's `data`, e.g. `{issues}` when publishing fails or `{rows}` for an import. */
	readonly details?: Record<string, unknown>;

	constructor(
		code: FunGamesErrorCode,
		message?: string,
		status: number | null = null,
		fields?: Record<string, string[]>,
		details?: Record<string, unknown>,
	) {
		super(message || DEFAULT_MESSAGES[code]);
		this.name = "FunGamesApiError";
		this.code = code;
		this.status = status;
		this.fields = fields;
		this.details = details;
	}

	/** The request may succeed if retried once the connection is back. */
	get isRetryable(): boolean {
		return this.code === "network" || this.code === "timeout" || this.code === "server";
	}

	/** First message for a field, e.g. `error.field("email")`. */
	field(name: string): string | undefined {
		return this.fields?.[name]?.[0];
	}
}

export const isAbortError = (error: unknown): boolean =>
	error instanceof FunGamesApiError && error.code === "aborted";

export const statusToCode = (status: number): FunGamesErrorCode => {
	if (status === 401) return "unauthorized";
	if (status === 403) return "forbidden";
	if (status === 404) return "notFound";
	if (status === 409) return "conflict";
	if (status === 400 || status === 422) return "validation";
	if (status === 429) return "rateLimited";
	if (status >= 500) return "server";
	return "unknown";
};

/** Laravel's `{status, message, data}` error bodies, including 422 `data.validation_errors`. */
export function toFunGamesError(error: unknown): FunGamesApiError {
	if (error instanceof FunGamesApiError) return error;
	if (axios.isCancel(error)) return new FunGamesApiError("aborted");
	if (!axios.isAxiosError(error)) {
		return new FunGamesApiError("unknown", error instanceof Error ? error.message : undefined);
	}
	if (!error.response) {
		return new FunGamesApiError(
			error.code === "ECONNABORTED" || error.code === "ETIMEDOUT" ? "timeout" : "network",
		);
	}

	const { status, data } = error.response;
	const code = statusToCode(status);
	if (!data || typeof data !== "object") return new FunGamesApiError(code, undefined, status);

	const body = data as { message?: unknown; data?: { validation_errors?: unknown } };
	const fields =
		body.data?.validation_errors && typeof body.data.validation_errors === "object"
			? (body.data.validation_errors as Record<string, string[]>)
			: undefined;
	// Laravel's generic "Validation Error" adds nothing; prefer the first field message.
	const firstField = fields ? Object.values(fields)[0]?.[0] : undefined;
	const message =
		code === "validation" && firstField
			? firstField
			: typeof body.message === "string" && body.message && status < 500
				? body.message
				: undefined;
	const details = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : undefined;
	return new FunGamesApiError(code, message, status, fields, details);
}

const http = axios.create({
	timeout: funGamesConfig.requestTimeoutMs,
	headers: { "Content-Type": "application/json", Accept: "application/json" },
});

/** Find a `serverTime` in the unwrapped data (top level, or on a nested session/ack). */
function findServerTime(data: unknown): string | null {
	if (!data || typeof data !== "object") return null;
	const body = data as Record<string, unknown>;
	for (const candidate of [body.serverTime, body.session, body.ack]) {
		if (typeof candidate === "string") return candidate;
		if (candidate && typeof candidate === "object") {
			const nested = (candidate as { serverTime?: unknown }).serverTime;
			if (typeof nested === "string") return nested;
		}
	}
	return null;
}

export interface FunGamesRequest extends AxiosRequestConfig {
	/** Participant calls: sent as X-Participant-Token, and no login token is sent. */
	participantToken?: string;
}

/** Calls the Fun Games API and returns the `data` part of the response envelope. */
export async function funGamesRequest<T>({ participantToken, ...config }: FunGamesRequest): Promise<T> {
	if (!funGamesConfig.apiBaseUrl) throw new FunGamesApiError("notConfigured");

	const headers = AxiosHeaders.from((config.headers as AxiosHeaders | undefined) ?? {});
	if (participantToken) {
		headers.set("X-Participant-Token", participantToken);
	} else if (typeof window !== "undefined") {
		// Host calls use the app's login token (see utils/axiosInstance.ts). A 401 is
		// shown on the screen rather than signing the user out of the whole app.
		const token = window.localStorage.getItem("auth_token");
		if (token) headers.set("Authorization", `Bearer ${token}`);
	}

	const sentAt = Date.now();
	try {
		const response = await http.request<{ data?: T }>({
			...config,
			baseURL: funGamesConfig.apiBaseUrl,
			headers,
		});
		const data = (response.data?.data ?? {}) as T;
		const serverTime = findServerTime(data);
		if (serverTime) serverClock.sampleRequest(serverTime, sentAt, Date.now());
		return data;
	} catch (error) {
		throw toFunGamesError(error);
	}
}
