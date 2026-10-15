"use client";

import { useState } from "react";
import type { ParticipantProps } from "../types";
import { OptionCard, OptionCardGroup, SubmitBar, SubmittedState, haptic, useSubmit } from "../shared";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, notVotingMessage, optionLabel, useAnswerHistory } from "../pollSingle/common";
import { ParticipantPollResults, pollRows } from "../pollSingle/PollResults";
import { selectionHint, selectionLimits } from "./limits";

// poll_multi on the phone (plan §7.3): checkbox cards and a sticky Submit
// bar. The min / max limits match the backend check (capped at the option
// count); a tap past the maximum is refused with a hint instead of silently
// dropping another choice (except max 1, where a tap swaps the choice).

export function PollMultiParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode }: ParticipantProps<"poll_multi">) {
	const review = mode === "review";
	const { submit, busy, errorMessage, reset } = useSubmit(onSubmit);
	const { latest, record } = useAnswerHistory(run.id, mySubmission);
	const [editing, setEditing] = useState(false);
	const [selected, setSelected] = useState<number[]>([]);
	const [limitHit, setLimitHit] = useState(false);

	const [min, max] = selectionLimits(run.config, run.options.length);
	const answered = Array.isArray(latest?.option_ids) && latest.option_ids.length > 0 ? latest.option_ids : null;
	const locked = disabled || review;
	const title = run.title;

	if (review || (answered && !editing)) {
		const chosen = run.options.map((option, index) => ({ option, index })).filter(({ option }) => answered?.includes(option.id));
		return (
			<ParticipantLayout theme={theme} title={title} fallbackTitle="Multiple select">
				{!answered ? (
					<ParticipantNotice>You didn&apos;t vote on this slide.</ParticipantNotice>
				) : (
					<SubmittedState
						message={review ? null : "Waiting for the host to continue."}
						onEdit={
							locked
								? undefined
								: () => {
										reset();
										setSelected(answered);
										setLimitHit(false);
										setEditing(true);
									}
						}
						editLabel="Change answer"
						className="px-0 py-6"
					>
						<div className="flex flex-col gap-4">
							<AnswerSummary label={answered.length === 1 ? "Your pick" : `Your ${answered.length} picks`}>
								<ul className="m-0 flex list-disc flex-col gap-1 pl-5">
									{chosen.map(({ option, index }) => (
										<li key={option.id} className="break-words font-semibold">
											{optionLabel(option, index)}
										</li>
									))}
								</ul>
							</AnswerSummary>
							{aggregate ? <ParticipantPollResults rows={pollRows(run.options, aggregate.options)} highlight={answered} /> : null}
						</div>
					</SubmittedState>
				)}
			</ParticipantLayout>
		);
	}

	const toggle = (optionId: number) => {
		if (selected.includes(optionId)) {
			setSelected(selected.filter((id) => id !== optionId));
			setLimitHit(false);
		} else if (selected.length < max) {
			setSelected([...selected, optionId]);
			setLimitHit(false);
		} else if (max === 1) {
			setSelected([optionId]);
		} else {
			haptic([10, 40, 10]);
			setLimitHit(true);
		}
	};

	const count = selected.length;
	const valid = count >= min && count <= max;
	const lockedMessage = disabled ? notVotingMessage(run.state) : null;
	const hint = limitHit
		? `You can pick up to ${max}. Unselect one to change your mind.`
		: count === 0
			? undefined // the subtitle already says how many to pick
			: count < min
				? `${count} selected, pick ${min - count} more.`
				: `${count} selected`;

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			fallbackTitle="Multiple select"
			subtitle={selectionHint(min, max, run.options.length)}
			footer={
				<SubmitBar
					label={answered ? "Update answer" : "Submit"}
					onClick={() => {
						if (!valid) return;
						// Option order, like the stored answer.
						const ids = run.options.filter((option) => selected.includes(option.id)).map((option) => option.id);
						void submit({ option_ids: ids }).then((ok) => {
							if (ok) {
								record({ option_ids: ids });
								setEditing(false);
							}
						});
					}}
					loading={busy}
					disabled={disabled || !valid}
					hint={hint}
					error={errorMessage}
				/>
			}
		>
			{lockedMessage ? <ParticipantNotice>{lockedMessage}</ParticipantNotice> : null}
			<OptionCardGroup label={title?.trim() || "Options"} mode="multi">
				{run.options.map((option, index) => (
					<OptionCard
						key={option.id}
						mode="multi"
						label={optionLabel(option, index)}
						imageUrl={option.image_url}
						index={index}
						selected={selected.includes(option.id)}
						disabled={disabled || busy}
						onSelect={() => toggle(option.id)}
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
					Keep my answer
				</button>
			) : null}
		</ParticipantLayout>
	);
}
