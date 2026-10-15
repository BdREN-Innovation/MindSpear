"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { useSubmit, type UseSubmitResult } from "../shared";

// Participant answer flow shared by the interactive types (pin_on_image,
// matrix_2x2, points_allocation, rating). Lives here because slides/shared is
// owned by another agent; it only builds on shared useSubmit.
//
// - The draft starts from the stored answer (mySubmission) and follows it
//   on reconnect until the participant edits it.
// - After a submit (or with a stored answer) the SubmittedState shows;
//   "Change answer" reopens the form (every one of these types replaces the
//   stored answer on resubmit).

export interface AnswerFlow<P> extends Omit<UseSubmitResult<P>, "submit"> {
	/** Submits; on success the submitted view shows again. */
	submit: (payload: P) => Promise<boolean>;
	/** Show the SubmittedState instead of the form. */
	showSubmitted: boolean;
	editing: boolean;
	/** Back to the form with the last answer filled in. */
	edit: () => void;
}

export function useAnswerFlow<P>(onSubmit: (payload: P) => Promise<void>, hasStoredAnswer: boolean, onSubmitted?: () => void): AnswerFlow<P> {
	const result = useSubmit(onSubmit);
	const [editing, setEditing] = useState(false);
	const { submit: send, reset } = result;
	const onSubmittedRef = useRef(onSubmitted);
	onSubmittedRef.current = onSubmitted;

	const submit = useCallback(
		async (payload: P) => {
			const ok = await send(payload);
			if (ok) {
				setEditing(false);
				onSubmittedRef.current?.();
			}
			return ok;
		},
		[send]
	);

	const edit = useCallback(() => {
		reset();
		setEditing(true);
	}, [reset]);

	return { ...result, submit, edit, editing, showSubmitted: (result.submitted || hasStoredAnswer) && !editing };
}

/**
 * Local draft seeded from the stored answer. `storedKey` (e.g. JSON of the
 * stored payload) tells when the server copy changed; the draft follows it
 * only while the participant hasn't touched it (markClean() after a submit).
 */
export function useDraft<T>(stored: T, storedKey: string): [T, (next: SetStateAction<T>) => void, () => void] {
	const [draft, setDraftState] = useState<T>(stored);
	const dirty = useRef(false);
	const lastKey = useRef(storedKey);
	const storedRef = useRef(stored);
	storedRef.current = stored;

	useEffect(() => {
		if (lastKey.current === storedKey) return;
		lastKey.current = storedKey;
		if (!dirty.current) setDraftState(storedRef.current);
	}, [storedKey]);

	const setDraft = useCallback((next: SetStateAction<T>) => {
		dirty.current = true;
		setDraftState(next);
	}, []);

	const markClean = useCallback(() => {
		dirty.current = false;
	}, []);

	return [draft, setDraft, markClean];
}
