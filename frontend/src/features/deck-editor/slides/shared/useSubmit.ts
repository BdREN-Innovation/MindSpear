"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toDeckApiError, type DeckApiError } from "@/features/deck/api/errors";
import { haptic } from "./hooks";

// Participant answer submission: busy flag, one request at a time, and a
// readable message for every DeckApiError the answers endpoint can return
// (409 reasons, 422 answer_payload.*, 413, 429, offline, expired token).
//
// Who shows what (contract): the participant shell shows every non-422
// failure itself, so components render only `fieldError` (422 answer
// validation, next to the form). `errorMessage` stays for callers outside the
// shell. The one submit haptic fires here (the shell doesn't pulse on submit).

/** A participant-facing sentence for a failed submit. */
export function submitErrorMessage(error: DeckApiError): string {
	switch (error.code) {
		case "invalid_state":
			switch (error.reason) {
				case "time_up":
					return "Time's up. Your answer arrived after voting closed.";
				case "not_voting":
					return "Voting isn't open for this slide right now.";
				case "not_current_slide":
					return "The host has moved to another slide.";
				case "session_not_live":
					return "This session has ended.";
				case "no_answers":
					return "This slide doesn't take answers.";
				case "not_open":
					return "Questions are closed for this slide.";
				default:
					return error.message;
			}
		case "validation": {
			// answer_payload.* / body: the first message is already human-readable.
			const first = Object.values(error.validationErrors).flat()[0];
			return first ?? "Please check your answer and try again.";
		}
		case "payload_too_large":
			return "Your answer is too long to send.";
		case "too_many_requests": {
			const wait = typeof error.data.retry_after === "number" ? error.data.retry_after : null;
			return wait ? `You're going a bit fast. Try again in ${wait} s.` : "You're going a bit fast. Try again in a moment.";
		}
		case "unauthorized":
			return "Your place in this session has expired. Join again to keep answering.";
		case "network":
			return "You're offline. Check your connection and try again.";
		case "timeout":
			return "The connection is slow. Try again.";
		case "not_found":
			return "This slide is no longer available.";
		default:
			return error.message || "Something went wrong. Please try again.";
	}
}

export interface UseSubmitResult<P> {
	/** Sends the payload; resolves true on success, false on failure (see error). Ignored while busy. */
	submit: (payload: P) => Promise<boolean>;
	busy: boolean;
	/** The last failure (cleared by the next submit or reset()). */
	error: DeckApiError | null;
	errorMessage: string | null;
	/** The 422 validation message only (what components render; the shell shows the rest). */
	fieldError: string | null;
	/** True after a successful submit in this component's life (reset() clears it, e.g. "Change answer"). */
	submitted: boolean;
	reset: () => void;
}

/** Wraps ParticipantProps.onSubmit: one request at a time, the submit haptic on success, errors mapped to messages. */
export function useSubmit<P>(onSubmit: (payload: P) => Promise<void>): UseSubmitResult<P> {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<DeckApiError | null>(null);
	const [submitted, setSubmitted] = useState(false);
	const busyRef = useRef(false);
	const mounted = useRef(true);
	const onSubmitRef = useRef(onSubmit);
	onSubmitRef.current = onSubmit;

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const submit = useCallback(async (payload: P) => {
		if (busyRef.current) return false;
		busyRef.current = true;
		setBusy(true);
		setError(null);
		try {
			await onSubmitRef.current(payload);
			haptic("submit");
			if (mounted.current) setSubmitted(true);
			return true;
		} catch (reason) {
			if (mounted.current) setError(toDeckApiError(reason));
			return false;
		} finally {
			busyRef.current = false;
			if (mounted.current) setBusy(false);
		}
	}, []);

	const reset = useCallback(() => {
		setError(null);
		setSubmitted(false);
	}, []);

	const errorMessage = error ? submitErrorMessage(error) : null;
	const fieldError = error && (error.status === 422 || error.code === "validation") ? errorMessage : null;
	return { submit, busy, error, errorMessage, fieldError, submitted, reset };
}
