/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useState } from "react";
import type { ParticipantProps } from "../types";
import { OptionCard, OptionCardGroup, SubmitBar, SubmittedState, useSubmit } from "../shared";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, notVotingMessage, optionLabel, useAnswerHistory } from "./common";
import { ParticipantPollResults, pollRows } from "./PollResults";

// poll_single on the phone (plan §7.3): full-width option cards. Default
// submit_mode 'instant' sends on tap; 'confirm' selects and waits for the
// Submit bar. The stored answer is replaced on every submit, so the vote can
// be changed while voting is open.

export function PollSingleParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode }: ParticipantProps<"poll_single">) {
	const review = mode === "review";
	const confirm = run.config.submit_mode === "confirm";
	const { submit, busy, errorMessage, reset } = useSubmit(onSubmit);
	const { latest, record } = useAnswerHistory(run.id, mySubmission);
	const [editing, setEditing] = useState(false);
	const [selected, setSelected] = useState<number | null>(null);

	// A stored payload can be `{}` (empty), so check the field rather than the object.
	const answeredId = typeof latest?.option_id === "number" ? latest.option_id : null;
	const title = run.title;
	const locked = disabled || review;

	const send = async (optionId: number) => {
		const ok = await submit({ option_id: optionId });
		if (ok) {
			record({ option_id: optionId });
			setEditing(false);
		}
	};

	if (review || (answeredId !== null && !editing)) {
		const index = run.options.findIndex((option) => option.id === answeredId);
		const chosen = index >= 0 ? run.options[index] : undefined;
		return (
			<ParticipantLayout theme={theme} title={title} fallbackTitle="Multiple choice">
				{answeredId === null ? (
					<ParticipantNotice>You didn&apos;t vote on this slide.</ParticipantNotice>
				) : (
					<SubmittedState
						title={confirm ? "Thanks, your answer is in" : "Thanks for voting!"}
						message={review ? null : "Waiting for the host to continue."}
						onEdit={
							locked
								? undefined
								: () => {
										reset();
										setSelected(answeredId);
										setEditing(true);
									}
						}
						editLabel="Change vote"
						className="px-0 py-6"
					>
						<div className="flex flex-col gap-4">
							<AnswerSummary label="Your vote">
								<div className="flex items-center gap-3">
									{chosen?.image_url ? (
										<img src={chosen.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" draggable={false} />
									) : null}
									<span className="break-words text-base font-semibold">{chosen ? optionLabel(chosen, index) : "An option that was removed"}</span>
								</div>
							</AnswerSummary>
							{aggregate ? <ParticipantPollResults rows={pollRows(run.options, aggregate.options)} highlight={[answeredId]} /> : null}
						</div>
					</SubmittedState>
				)}
			</ParticipantLayout>
		);
	}

	const lockedMessage = disabled ? notVotingMessage(run.state) : null;

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			fallbackTitle="Multiple choice"
			subtitle={confirm ? "Pick one option, then tap Submit." : "Tap an option to vote."}
			footer={
				confirm ? (
					<SubmitBar
						label={answeredId !== null ? "Update vote" : "Submit"}
						onClick={() => {
							if (selected !== null) void send(selected);
						}}
						loading={busy}
						disabled={disabled || selected === null}
						error={errorMessage}
					/>
				) : null
			}
		>
			{lockedMessage ? <ParticipantNotice>{lockedMessage}</ParticipantNotice> : null}
			{!confirm && errorMessage ? <ParticipantNotice tone="danger">{errorMessage}</ParticipantNotice> : null}

			<OptionCardGroup label={title?.trim() || "Options"}>
				{run.options.map((option, index) => (
					<OptionCard
						key={option.id}
						label={optionLabel(option, index)}
						imageUrl={option.image_url}
						index={index}
						selected={selected === option.id}
						disabled={disabled || busy}
						description={!confirm && busy && selected === option.id ? "Sending…" : undefined}
						onSelect={() => {
							setSelected(option.id);
							if (!confirm) void send(option.id);
						}}
					/>
				))}
			</OptionCardGroup>

			{editing ? (
				<button
					type="button"
					onClick={() => {
						reset();
						setEditing(false);
					}}
					disabled={busy}
					className="min-h-11 self-center rounded-lg px-4 text-sm font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus,#C46620)]"
					style={{ color: "var(--deck-text-muted, #4B5563)" }}
				>
					Keep my vote
				</button>
			) : null}
		</ParticipantLayout>
	);
}
