"use client";

import { useCallback, useState } from "react";
import { useSubmit } from "./useSubmit";

// The participant's answer on one run, for every live type (one helper for
// the poll and the interactive types):
//
// - `latest` is what the server holds as far as this screen knows: the last
//   answer sent from here until the shell hands a fresher `mySubmission`
//   (state refetch, reconnect, or the shell's provisional copy after a
//   submit); once that prop changes it is the truth again.
// - `sent` lists the answers sent from here since then, for the types whose
//   server appends (word cloud / open ended with multiple submissions).
// - `editing` switches a submitted view back to the form ("Change answer");
//   every type replaces or appends on resubmit, so the form is the same.
// - `submit(payload, stored)` sends through useSubmit (one request at a time,
//   the one submit haptic) and records `stored`, the local stand-in for what
//   the server keeps.
// - `fieldError` is the 422 message only: the shell shows every other failure.

interface LocalAnswers<S> {
	runId: number;
	/** The mySubmission these local answers were sent on top of. */
	base: S | null;
	values: S[];
}

export interface AnswerState<S, P> {
	latest: S | null;
	sent: S[];
	editing: boolean;
	/** Reopen the form (clears the last error). Seed the form's own state before calling. */
	edit: () => void;
	/** Back to the submitted view without sending. */
	cancelEdit: () => void;
	/** Resolves true on success (then `latest` is `stored` and editing ends). */
	submit: (payload: P, stored: S) => Promise<boolean>;
	busy: boolean;
	fieldError: string | null;
}

export function useAnswer<S, P>(runId: number, mySubmission: S | null, onSubmit: (payload: P) => Promise<void>): AnswerState<S, P> {
	const { submit: send, busy, fieldError, reset } = useSubmit(onSubmit);
	const [local, setLocal] = useState<LocalAnswers<S> | null>(null);
	// Keyed by run so a component reused for the next run never opens in edit mode.
	const [editingRun, setEditingRun] = useState<number | null>(null);

	const sent = local && local.runId === runId && local.base === mySubmission ? local.values : [];
	const latest: S | null = sent.length > 0 ? sent[sent.length - 1] : mySubmission;

	const submit = useCallback(
		async (payload: P, stored: S) => {
			// The base is the submission this answer goes on top of; if the shell
			// replaces mySubmission meanwhile, the local copy is dropped.
			const base = mySubmission;
			const ok = await send(payload);
			if (ok) {
				setLocal((previous) => {
					const keep = previous && previous.runId === runId && previous.base === base ? previous.values : [];
					return { runId, base, values: [...keep, stored] };
				});
				setEditingRun(null);
			}
			return ok;
		},
		[mySubmission, runId, send]
	);

	const edit = useCallback(() => {
		reset();
		setEditingRun(runId);
	}, [reset, runId]);

	const cancelEdit = useCallback(() => {
		reset();
		setEditingRun(null);
	}, [reset]);

	return { latest, sent, editing: editingRun === runId, edit, cancelEdit, submit, busy, fieldError };
}
