"use client";

import { useState } from "react";
import type { ParticipantProps } from "../types";
import { OptionCard, OptionCardGroup, SubmitBar, SubmittedState, haptic } from "../shared";
import { useAnswer } from "../shared/answer";
import { displayTitle, optionLabel } from "../shared/labels";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, countLabel, isReadOnlyView, notVotingMessage, resultsTitle } from "../shared/participantKit";
import { ParticipantPollResults, pollRows } from "../shared/PollResults";
import { selectionHint, selectionLimits } from "./limits";

// poll_multi on the phone (plan §7.3): checkbox cards and a sticky Submit
// bar. The min / max limits match the backend check (capped at the option
// count); a tap past the maximum is refused with a hint instead of silently
// dropping another choice (except max 1, where a tap swaps the choice).
// Public results (aggregate passed) show in every view.

export function PollMultiParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode }: ParticipantProps<"poll_multi">) {
	const review = mode === "review";
	const readOnly = isReadOnlyView(mode, run.state);
	const answer = useAnswer(run.id, mySubmission, onSubmit);
	const [selected, setSelected] = useState<number[]>([]);
	const [limitHit, setLimitHit] = useState(false);

	const [min, max] = selectionLimits(run.config, run.options.length);
	const answered = Array.isArray(answer.latest?.option_ids) && answer.latest.option_ids.length > 0 ? answer.latest.option_ids : null;
	const title = displayTitle(run.title, "poll_multi");

	const results = aggregate ? (
		<ParticipantPollResults
			rows={pollRows(run.options, aggregate.options)}
			highlight={answered ?? []}
			title={resultsTitle(mode, run.state)}
			summary={countLabel(aggregate.total_responses, "response", "responses")}
		/>
	) : null;

	const summary = (ids: number[]) => {
		const chosen = run.options.map((option, index) => ({ option, index })).filter(({ option }) => ids.includes(option.id));
		return (
			<AnswerSummary label={ids.length === 1 ? "Your pick" : `Your ${ids.length} picks`}>
				<ul className="m-0 flex list-disc flex-col gap-1 pl-5">
					{chosen.map(({ option, index }) => (
						<li key={option.id} className="break-words font-semibold">
							{optionLabel(option, index)}
						</li>
					))}
				</ul>
			</AnswerSummary>
		);
	};

	if (readOnly) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				{answered ? summary(answered) : review ? <ParticipantNotice>You didn&apos;t vote on this slide.</ParticipantNotice> : null}
				{results}
			</ParticipantLayout>
		);
	}

	if (answered && !answer.editing) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				<SubmittedState
					onEdit={
						disabled
							? undefined
							: () => {
									setSelected(answered);
									setLimitHit(false);
									answer.edit();
								}
					}
					editLabel="Change answer"
					className="px-0 py-6"
				>
					<div className="flex flex-col gap-4">
						{summary(answered)}
						{results}
					</div>
				</SubmittedState>
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
			haptic("error");
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
			subtitle={selectionHint(min, max, run.options.length)}
			footer={
				<SubmitBar
					label={answered ? "Update answer" : "Submit"}
					onClick={() => {
						if (!valid) return;
						// Option order, like the stored answer.
						const ids = run.options.filter((option) => selected.includes(option.id)).map((option) => option.id);
						void answer.submit({ option_ids: ids }, { option_ids: ids });
					}}
					loading={answer.busy}
					disabled={disabled || !valid}
					hint={hint}
					error={answer.fieldError}
				/>
			}
		>
			{lockedMessage ? <ParticipantNotice>{lockedMessage}</ParticipantNotice> : null}
			<OptionCardGroup label={title} mode="multi">
				{run.options.map((option, index) => (
					<OptionCard
						key={option.id}
						mode="multi"
						label={optionLabel(option, index)}
						imageUrl={option.image_url}
						index={index}
						selected={selected.includes(option.id)}
						disabled={disabled || answer.busy}
						onSelect={() => toggle(option.id)}
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
					Keep my answer
				</button>
			) : null}
			{results}
		</ParticipantLayout>
	);
}
