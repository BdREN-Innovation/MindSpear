"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import type { StoredAnswerMap } from "@/features/deck/types";
import type { ParticipantProps } from "../types";
import { SubmitBar, SubmittedState, useSubmit } from "../shared";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, notVotingMessage, useAnswerHistory } from "../pollSingle/common";

// open_ended on the phone (plan §7.3): a multi-line answer with a character
// counter and a Submit bar. With max_submissions_per_participant > 1 the
// server appends each response (until the cap), so "Send another" starts a
// blank answer; at 1 a new submit replaces the old one, so "Edit response"
// reopens it filled in.

type Stored = StoredAnswerMap["open_ended"];
type Entry = Stored["entries"][number];

function storedEntries(answer: Stored | null | undefined): Entry[] {
	return Array.isArray(answer?.entries) ? answer.entries.filter((entry) => typeof entry?.body === "string" && entry.body !== "") : [];
}

export function OpenEndedParticipant({ run, mySubmission, onSubmit, disabled, theme, mode }: ParticipantProps<"open_ended">) {
	const review = mode === "review";
	const maxLength = Math.max(1, run.config.max_length ?? 500);
	const maxSubmissions = Math.max(1, run.config.max_submissions_per_participant ?? 1);
	const multiple = maxSubmissions > 1;

	const { submit, busy, errorMessage, reset } = useSubmit(onSubmit);
	const { latest, sent, record } = useAnswerHistory<Stored>(run.id, mySubmission);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const formId = useId();
	const fieldId = useId();
	const counterId = useId();

	const entries = useMemo(
		() => (multiple ? [...storedEntries(mySubmission), ...sent.flatMap((answer) => storedEntries(answer))] : storedEntries(latest)),
		[latest, multiple, mySubmission, sent]
	);
	const remaining = multiple ? Math.max(0, maxSubmissions - entries.length) : 1;
	const locked = disabled || review;
	const title = run.title;

	if (review || (entries.length > 0 && !editing)) {
		const canSendMore = multiple && remaining > 0;
		return (
			<ParticipantLayout theme={theme} title={title} fallbackTitle="Open ended">
				{entries.length === 0 ? (
					<ParticipantNotice>You didn&apos;t respond to this slide.</ParticipantNotice>
				) : (
					<SubmittedState
						message={review ? null : "Waiting for the host to continue."}
						editHint={
							!locked && multiple
								? canSendMore
									? `You can send ${remaining} more ${remaining === 1 ? "response" : "responses"}.`
									: "You've sent all your responses."
								: undefined
						}
						onEdit={
							locked || (multiple && !canSendMore)
								? undefined
								: () => {
										reset();
										setDraft(multiple ? "" : (entries[0]?.body ?? ""));
										setEditing(true);
									}
						}
						editLabel={multiple ? "Send another response" : "Edit response"}
						className="px-0 py-6"
					>
						<AnswerSummary label={entries.length === 1 ? "Your response" : `Your ${entries.length} responses`}>
							<ul className="m-0 flex list-none flex-col gap-2 p-0">
								{entries.map((entry, index) => (
									<li
										key={`${entry.submitted_at}-${index}`}
										className="whitespace-pre-line break-words rounded-lg px-3 py-2 text-base"
										style={{ background: "var(--deck-surface-muted, #F3F4F6)" }}
									>
										{entry.body}
									</li>
								))}
							</ul>
						</AnswerSummary>
					</SubmittedState>
				)}
			</ParticipantLayout>
		);
	}

	const text = draft.trim();
	const length = draft.length;
	const nearLimit = length >= maxLength * 0.9;
	const lockedMessage = disabled ? notVotingMessage(run.state) : null;

	const onFormSubmit = (event: FormEvent) => {
		event.preventDefault();
		if (!text || busy || locked) return;
		void submit({ text }).then((ok) => {
			if (!ok) return;
			// submitted_at is the server's; this local copy only fills in until state is refetched.
			record({ entries: [{ body: text, submitted_at: new Date().toISOString() }] });
			setDraft("");
			setEditing(false);
		});
	};

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			fallbackTitle="Open ended"
			subtitle={multiple && entries.length > 0 ? `Response ${entries.length + 1} of up to ${maxSubmissions}` : undefined}
			footer={
				<SubmitBar
					type="submit"
					form={formId}
					label={!multiple && entries.length > 0 ? "Update response" : "Submit"}
					loading={busy}
					disabled={disabled || text === ""}
					error={errorMessage}
				/>
			}
		>
			{lockedMessage ? <ParticipantNotice>{lockedMessage}</ParticipantNotice> : null}
			<form id={formId} onSubmit={onFormSubmit} className="flex flex-col gap-2" noValidate>
				<label htmlFor={fieldId} className="sr-only">
					Your response
				</label>
				<textarea
					id={fieldId}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					maxLength={maxLength}
					rows={6}
					disabled={locked}
					placeholder="Type your answer…"
					aria-describedby={counterId}
					className={cn(
						"min-h-36 w-full resize-y rounded-xl border-2 px-4 py-3 text-base leading-relaxed outline-none disabled:opacity-60",
						"focus-visible:border-[color:var(--deck-primary,#F79945)] focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus,#C46620)]"
					)}
					style={{
						borderColor: "var(--deck-border, #E5E7EB)",
						background: "var(--deck-surface, #fff)",
						color: "var(--deck-text, #111928)",
					}}
				/>
				<p
					id={counterId}
					aria-live={nearLimit ? "polite" : "off"}
					className="m-0 self-end text-sm tabular-nums"
					style={{ color: nearLimit ? "var(--deck-danger, #B91C1C)" : "var(--deck-text-muted, #4B5563)" }}
				>
					{length} / {maxLength}
					<span className="sr-only"> characters</span>
				</p>
			</form>
			{editing ? (
				<button
					type="button"
					onClick={() => {
						reset();
						setDraft("");
						setEditing(false);
					}}
					disabled={busy}
					className="min-h-11 self-center rounded-lg px-4 text-sm font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus,#C46620)]"
					style={{ color: "var(--deck-text-muted, #4B5563)" }}
				>
					Cancel
				</button>
			) : null}
		</ParticipantLayout>
	);
}
