/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useState } from "react";
import type { ParticipantProps } from "../types";
import { OptionCard, OptionCardGroup, SubmitBar, SubmittedState } from "../shared";
import { useAnswer } from "../shared/answer";
import { displayTitle, optionLabel } from "../shared/labels";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, countLabel, isReadOnlyView, notVotingMessage, resultsTitle } from "../shared/participantKit";
import { ParticipantPollResults, pollRows } from "../shared/PollResults";

// poll_single on the phone (plan §7.3): full-width option cards. Default
// submit_mode 'instant' sends on tap; 'confirm' selects and waits for the
// Submit bar. The stored answer is replaced on every submit, so the vote can
// be changed while voting is open. Public results (aggregate passed) show
// under the cards, the submitted view and the read-only views alike.

export function PollSingleParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode }: ParticipantProps<"poll_single">) {
	const review = mode === "review";
	const readOnly = isReadOnlyView(mode, run.state);
	const confirm = run.config.submit_mode === "confirm";
	const answer = useAnswer(run.id, mySubmission, onSubmit);
	const [selected, setSelected] = useState<number | null>(null);

	// A stored payload can be `{}` (empty), so check the field rather than the object.
	const answeredId = typeof answer.latest?.option_id === "number" ? answer.latest.option_id : null;
	const title = displayTitle(run.title, "poll_single");

	const results = aggregate ? (
		<ParticipantPollResults
			rows={pollRows(run.options, aggregate.options)}
			highlight={answeredId !== null ? [answeredId] : []}
			title={resultsTitle(mode, run.state)}
			summary={countLabel(aggregate.total_votes, "vote", "votes")}
		/>
	) : null;

	const send = (optionId: number) => void answer.submit({ option_id: optionId }, { option_id: optionId });

	const summary = () => {
		const index = run.options.findIndex((option) => option.id === answeredId);
		const chosen = index >= 0 ? run.options[index] : undefined;
		return (
			<AnswerSummary label="Your vote">
				<div className="flex items-center gap-3">
					{chosen?.image_url ? <img src={chosen.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" draggable={false} /> : null}
					<span className="break-words text-base font-semibold">{chosen ? optionLabel(chosen, index) : "An option that was removed"}</span>
				</div>
			</AnswerSummary>
		);
	};

	if (readOnly) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				{answeredId !== null ? summary() : review ? <ParticipantNotice>You didn&apos;t vote on this slide.</ParticipantNotice> : null}
				{results}
			</ParticipantLayout>
		);
	}

	if (answeredId !== null && !answer.editing) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				<SubmittedState
					title={confirm ? "Thanks, your answer is in" : "Thanks for voting!"}
					onEdit={
						disabled
							? undefined
							: () => {
									setSelected(answeredId);
									answer.edit();
								}
					}
					editLabel="Change vote"
					className="px-0 py-6"
				>
					<div className="flex flex-col gap-4">
						{summary()}
						{results}
					</div>
				</SubmittedState>
			</ParticipantLayout>
		);
	}

	const lockedMessage = disabled ? notVotingMessage(run.state) : null;

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle={confirm ? "Pick one option, then tap Submit." : "Tap an option to vote."}
			footer={
				confirm ? (
					<SubmitBar
						label={answeredId !== null ? "Update vote" : "Submit"}
						onClick={() => {
							if (selected !== null) send(selected);
						}}
						loading={answer.busy}
						disabled={disabled || selected === null}
						error={answer.fieldError}
					/>
				) : null
			}
		>
			{lockedMessage ? <ParticipantNotice>{lockedMessage}</ParticipantNotice> : null}
			{!confirm && answer.fieldError ? <ParticipantNotice tone="danger">{answer.fieldError}</ParticipantNotice> : null}

			<OptionCardGroup label={title}>
				{run.options.map((option, index) => (
					<OptionCard
						key={option.id}
						label={optionLabel(option, index)}
						imageUrl={option.image_url}
						index={index}
						selected={selected === option.id}
						disabled={disabled || answer.busy}
						// Instant mode: the tap is the submit, so only the submit pulse fires.
						hapticFeedback={confirm}
						description={!confirm && answer.busy && selected === option.id ? "Sending…" : undefined}
						onSelect={() => {
							setSelected(option.id);
							if (!confirm) send(option.id);
						}}
					/>
				))}
			</OptionCardGroup>

			{answer.editing ? (
				<button
					type="button"
					onClick={answer.cancelEdit}
					disabled={answer.busy}
					className="min-h-11 self-center rounded-lg px-4 text-sm font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus,#C46620)]"
					style={{ color: "var(--deck-text-muted, #4B5563)" }}
				>
					Keep my vote
				</button>
			) : null}

			{results}
		</ParticipantLayout>
	);
}
