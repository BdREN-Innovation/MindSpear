import axios from "axios";
import type { DeckErrorCode, DeckErrorData } from "../types";

// Maps the backend envelope {status, message, data: {code, validation_errors, ...}}
// (DeckException::render / DeckValidation::response) to one typed error, so
// every deck screen branches on `code` instead of HTTP statuses.

const KNOWN_CODES: readonly DeckErrorCode[] = [
	"not_found",
	"conflict",
	"invalid_state",
	"unsupported_type",
	"forbidden",
	"unauthorized",
	"results_hidden",
	"too_many_requests",
	"payload_too_large",
	"slide_limit_reached",
];

export class DeckApiError extends Error {
	readonly name = "DeckApiError";

	constructor(
		message: string,
		/** data.code, or derived from the status when the backend sent none. */
		readonly code: DeckErrorCode,
		/** HTTP status; 0 when no response arrived. */
		readonly status: number,
		/** 422 field errors, keys as the backend sends them (`config.max_selections`, `slides.2.type`, `answer_payload.option_id`). */
		readonly validationErrors: Record<string, string[]> = {},
		/** Everything else in `data` (reason, requires_force, session_id, retry_after, ...). */
		readonly data: DeckErrorData = {}
	) {
		super(message);
	}

	/** First message for a field (exact key), e.g. fieldError('config.max_selections'). */
	fieldError(key: string): string | undefined {
		return this.validationErrors[key]?.[0];
	}

	/** Field errors under a prefix with the prefix removed: fieldErrors('config') → {max_selections: [...]}. */
	fieldErrors(prefix: string): Record<string, string[]> {
		const out: Record<string, string[]> = {};
		const head = prefix.endsWith(".") ? prefix : `${prefix}.`;
		for (const [key, messages] of Object.entries(this.validationErrors)) {
			if (key.startsWith(head)) out[key.slice(head.length)] = messages;
		}
		return out;
	}

	get isValidation(): boolean {
		return this.status === 422;
	}

	/** 409 invalid_state with data.reason. */
	get reason(): string | undefined {
		return typeof this.data.reason === "string" ? this.data.reason : undefined;
	}
}

export function isDeckApiError(error: unknown): error is DeckApiError {
	return error instanceof DeckApiError;
}

function codeForStatus(status: number): DeckErrorCode {
	switch (status) {
		case 401:
			return "unauthorized";
		case 403:
			return "forbidden";
		case 404:
			return "not_found";
		case 409:
			return "conflict";
		case 413:
			return "payload_too_large";
		case 422:
			return "validation";
		case 429:
			return "too_many_requests";
		default:
			return "unknown";
	}
}

/** Any thrown value (axios error, DeckApiError, Error) → DeckApiError. */
export function toDeckApiError(error: unknown): DeckApiError {
	if (error instanceof DeckApiError) return error;

	if (axios.isCancel(error)) {
		return new DeckApiError("Request cancelled.", "cancelled", 0);
	}

	if (axios.isAxiosError(error)) {
		if (error.code === "ERR_CANCELED") {
			return new DeckApiError("Request cancelled.", "cancelled", 0);
		}
		if (!error.response) {
			const timedOut = error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
			return new DeckApiError(
				timedOut
					? "The server took too long to answer. Check your connection and try again."
					: "Can't reach the server. Check your connection and try again.",
				timedOut ? "timeout" : "network",
				0
			);
		}

		const status = error.response.status;
		const body = error.response.data as { message?: unknown; data?: unknown } | undefined;
		const data: DeckErrorData =
			body && typeof body.data === "object" && body.data !== null ? { ...(body.data as DeckErrorData) } : {};
		const validationErrors = data.validation_errors ?? {};
		const rawCode = typeof data.code === "string" ? data.code : undefined;
		const code: DeckErrorCode =
			rawCode && (KNOWN_CODES as readonly string[]).includes(rawCode)
				? (rawCode as DeckErrorCode)
				: codeForStatus(status);

		// Laravel's throttle middleware answers 429 without data; read Retry-After.
		if (status === 429 && data.retry_after === undefined) {
			const header = Number(error.response.headers?.["retry-after"]);
			if (Number.isFinite(header)) data.retry_after = header;
		}

		const firstValidation = Object.values(validationErrors).flat()[0];
		const message =
			(status === 422 && firstValidation) ||
			(typeof body?.message === "string" && body.message) ||
			error.message ||
			"Something went wrong. Please try again.";

		delete data.validation_errors;
		return new DeckApiError(message, code, status, validationErrors, data);
	}

	if (error instanceof Error) {
		return new DeckApiError(error.message, "unknown", 0);
	}

	return new DeckApiError("Something went wrong. Please try again.", "unknown", 0);
}

/** Runs a request and rethrows any failure as a DeckApiError. */
export async function deckRequest<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		throw toDeckApiError(error);
	}
}
