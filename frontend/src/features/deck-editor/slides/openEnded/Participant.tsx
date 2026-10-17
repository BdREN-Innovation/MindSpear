"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import type { OpenEndedAggregate, StoredAnswerMap } from "@/features/deck/types";
import type { ParticipantProps } from "../types";
import { SubmitBar, SubmittedState } from "../shared";
import { useAnswer } from "../shared/answer";
import { displayTitle } from "../shared/labels";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, ResultsSection, countLabel, isReadOnlyView, notVotingMessage, resultsTitle } from "../shared/participantKit";
import { cleanResponse } from "../shared/text";

// open_ended on the phone (plan §7.3): a multi-line answer with a character
// counter and a Submit bar. With max_submissions_per_participant > 1 the
// server appends each response (until the cap), so "Send another" starts a
// blank answer; at 1 a new submit replaces the old one, so "Edit response"
// reopens it filled in. A response of only invisible characters is refused
// here like the backend would (cleanResponse). Public results list the
// newest responses in every view.

type Stored = StoredAnswerMap["open_ended"];
type Entry = Stored["entries"][number];

function storedEntries(answer: Stored | null | undefined): Entry[] {
	return Array.isArray(answer?.entries) ? answer.entries.filter((entry) => typeof entry?.body === "string" && entry.body !== "") : [];
}

export function OpenEndedParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode }: ParticipantProps<"open_ended">) {
	const review = mode === "review";
	const readOnly = isReadOnlyView(mode, run.state);
	const maxLength = Math.max(1, run.config.max_length ?? 500);
	const maxSubmissions = Math.max(1, run.config.max_submissions_per_participant ?? 1);
	const multiple = maxSubmissions > 1;

	const answer = useAnswer(run.id, mySubmission, onSubmit);
	const { latest, sent, busy } = answer;
	const [draft, setDraft] = useState("");
	const formId = useId();
	const fieldId = useId();
	const counterId = useId();

	const entries = useMemo(
		() => (multiple ? [...storedEntries(mySubmission), ...sent.flatMap((entry) => storedEntries(entry))] : storedEntries(latest)),
		[latest, multiple, mySubmission, sent]
	);
	const remaining = multiple ? Math.max(0, maxSubmissions - entries.length) : 1;
	const locked = disabled || readOnly;
	const title = displayTitle(run.title, "open_ended");
	const results = aggregate ? <ResponseResults aggregate={aggregate} title={resultsTitle(mode, run.state)} /> : null;

	const summary = (
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
	);

	if (readOnly) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				{entries.length > 0 ? summary : review ? <ParticipantNotice>You didn&apos;t respond to this slide.</ParticipantNotice> : null}
				{results}
			</ParticipantLayout>
		);
	}

	if (entries.length > 0 && !answer.editing) {
		const canSendMore = multiple && remaining > 0;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<SubmittedState
					editHint={
						!disabled && multiple
							? canSendMore
								? `You can send ${remaining} more ${remaining === 1 ? "response" : "responses"}.`
								: "You've sent all your responses."
							: undefined
					}
					onEdit={
						disabled || (multiple && !canSendMore)
							? undefined
							: () => {
									setDraft(multiple ? "" : (entries[0]?.body ?? ""));
									answer.edit();
								}
					}
					editLabel={multiple ? "Send another response" : "Edit response"}
					className="px-0 py-6"
				>
					<div className="flex flex-col gap-4">
						{summary}
						{results}
					</div>
				</SubmittedState>
			</ParticipantLayout>
		);
	}

	const text = cleanResponse(draft);
	const length = draft.length;
	const nearLimit = length >= maxLength * 0.9;
	const lockedMessage = disabled ? notVotingMessage(run.state) : null;

	const onFormSubmit = (event: FormEvent) => {
		event.preventDefault();
		if (!text || busy || locked) return;
		// submitted_at is the server's; this local copy only fills in until the shell has a fresher one.
		void answer.submit({ text }, { entries: [{ body: text, submitted_at: new Date().toISOString() }] }).then((ok) => {
			if (ok) setDraft("");
		});
	};

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle={multiple && entries.length > 0 ? `Response ${entries.length + 1} of up to ${maxSubmissions}` : undefined}
			footer={
				<SubmitBar
					type="submit"
					form={formId}
					label={!multiple && entries.length > 0 ? "Update response" : "Submit"}
					loading={busy}
					disabled={disabled || text === ""}
					error={answer.fieldError}
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
			{answer.editing ? (
				<button
					type="button"
					onClick={() => {
						setDraft("");
						answer.cancelEdit();
					}}
					disabled={busy}
					className="min-h-11 self-center rounded-lg px-4 text-sm font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus,#C46620)]"
					style={{ color: "var(--deck-text-muted, #4B5563)" }}
				>
					Cancel
				</button>
			) : null}
			{results}
		</ParticipantLayout>
	);
}

/** The responses the aggregate carries: the 10 newest live (broadcast preview), a full page in review. */
function ResponseResults({ aggregate, title }: { aggregate: OpenEndedAggregate; title: string }) {
	const items = aggregate.items;
	const people = aggregate.total_responses;
	const total = aggregate.total_entries;
	const summary = total !== people ? `${countLabel(total, "response", "responses")} · ${countLabel(people, "person", "people")}` : countLabel(total, "response", "responses");
	return (
		<ResultsSection title={title} summary={summary}>
			{items.length === 0 ? (
				<p className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					No responses yet.
				</p>
			) : (
				<ul aria-label="Newest responses" className="m-0 flex list-none flex-col gap-2 p-0">
					{items.map((card) => (
						<li
							key={card.id}
							className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
							style={{ borderColor: "var(--deck-border, #E5E7EB)", background: "var(--deck-surface, #fff)" }}
						>
							{card.participant_emoji ? (
								<span aria-hidden className="shrink-0 leading-snug">
									{card.participant_emoji}
								</span>
							) : null}
							<span className="min-w-0 whitespace-pre-line break-words leading-snug">
								{card.body}
								{card.body_truncated ? "…" : ""}
							</span>
						</li>
					))}
				</ul>
			)}
			{total > items.length && items.length > 0 ? (
				<p className="m-0 text-xs" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					Showing the {items.length} newest of {total}
				</p>
			) : null}
		</ResultsSection>
	);
}
