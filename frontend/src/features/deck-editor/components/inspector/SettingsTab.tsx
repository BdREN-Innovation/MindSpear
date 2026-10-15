"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import type { Deck, Slide, SlidePatch } from "@/features/deck/types";
import { SelectField, ToggleField, type ChoiceOption } from "../../slides/shared";

// Per-slide settings (plan §5.6). Keys come from the backend types:
//   timers: slides.time_limit_seconds (5..3600 | null), get_ready_seconds (0..30); answer types only
//   PollSettings: config.show_results_to_participants (every live poll type)
//   word_cloud: config.allow_multiple_submissions
//   open_ended: config.max_submissions_per_participant (1..20; > 1 = multiple)

export const TIME_LIMIT_CHOICES: (number | null)[] = [null, 10, 20, 30, 45, 60, 90, 120, 180];

/** Select choices for a time limit, with the current value added when it is not a preset. */
export function timeLimitOptions(current: number | null): ChoiceOption<number>[] {
	const values = TIME_LIMIT_CHOICES.map((v) => v ?? 0);
	if (current && !values.includes(current)) values.push(current);
	return values
		.sort((a, b) => a - b)
		.map((value) => ({ value, label: value === 0 ? "No time limit" : formatSeconds(value) }));
}

export function formatSeconds(seconds: number): string {
	if (seconds < 60) return `${seconds} seconds`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return rest ? `${minutes} min ${rest} s` : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export const GET_READY_CHOICES: ChoiceOption<number>[] = [3, 5, 10, 15, 20, 30].map((value) => ({
	value,
	label: `${value} seconds`,
}));

const OPEN_ENDED_CHOICES: ChoiceOption<number>[] = [2, 3, 5, 10, 20].map((value) => ({ value, label: `Up to ${value} responses` }));

export interface SettingsTabProps {
	slide: Slide;
	deck: Deck;
	errors?: Record<string, string[]>;
	onPatch(slideId: number, patch: SlidePatch, options?: { immediate?: boolean }): void;
}

function Note({ children }: { children: ReactNode }) {
	return (
		<p className="flex items-start gap-2 rounded-lg bg-gray-2 px-3 py-2 text-sm text-dark-4 dark:bg-dark-2 dark:text-dark-6">
			<Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
			<span>{children}</span>
		</p>
	);
}

export function SettingsTab({ slide, deck, errors, onPatch }: SettingsTabProps) {
	const save = (patch: SlidePatch) => onPatch(slide.id, patch, { immediate: true });
	const config = slide.config as unknown as Record<string, unknown>;
	const hasShowResults = typeof config.show_results_to_participants === "boolean";

	if (slide.type === "qa_audience") {
		return (
			<div className="flex flex-col gap-4">
				<Note>Q&amp;A stays open until you close it, so it has no timer. Sorting and showing questions to participants are on the Content tab.</Note>
			</div>
		);
	}

	if (!slide.acceptsAnswers) {
		return <Note>Content slides have no timer or voting settings.</Note>;
	}

	const timeLimit = slide.timeLimitSeconds ?? 0;
	const getReady = slide.getReadySeconds ?? 0;
	const deckGetReady = deck.settings.get_ready_seconds;

	return (
		<div className="flex flex-col gap-5">
			<SelectField<number>
				label="Time limit"
				hint="Voting closes by itself when time runs out."
				value={timeLimit}
				options={timeLimitOptions(slide.timeLimitSeconds)}
				error={errors?.time_limit_seconds}
				onChange={(value) => save({ time_limit_seconds: value === 0 ? null : value })}
			/>

			<div className="flex flex-col gap-3">
				<ToggleField
					label="Get-ready countdown"
					description="Show a short countdown before voting opens."
					checked={getReady > 0}
					error={errors?.get_ready_seconds}
					onChange={(on) => save({ get_ready_seconds: on ? (deckGetReady > 0 ? deckGetReady : 5) : 0 })}
				/>
				{getReady > 0 ? (
					<SelectField<number>
						label="Countdown length"
						value={getReady}
						options={GET_READY_CHOICES.some((c) => c.value === getReady) ? GET_READY_CHOICES : [...GET_READY_CHOICES, { value: getReady, label: `${getReady} seconds` }].sort((a, b) => a.value - b.value)}
						onChange={(value) => save({ get_ready_seconds: value })}
					/>
				) : null}
			</div>

			{hasShowResults ? (
				<ToggleField
					label="Show votes to participants"
					description="Participants see the live results on their phones. Off: only your presenter screen shows them."
					checked={config.show_results_to_participants === true}
					error={errors?.["config.show_results_to_participants"]}
					onChange={(on) => save({ config: { show_results_to_participants: on } } as SlidePatch)}
				/>
			) : null}

			{slide.type === "word_cloud" ? (
				<ToggleField
					label="Allow multiple submissions"
					description={`Participants can come back and add more words, up to ${String(config.max_entries_per_participant ?? 3)} in total.`}
					checked={config.allow_multiple_submissions === true}
					error={errors?.["config.allow_multiple_submissions"]}
					onChange={(on) => save({ config: { allow_multiple_submissions: on } } as SlidePatch)}
				/>
			) : null}

			{slide.type === "open_ended" ? (
				<div className="flex flex-col gap-3">
					<ToggleField
						label="Allow multiple submissions"
						description="Participants can send more than one response."
						checked={Number(config.max_submissions_per_participant ?? 1) > 1}
						error={errors?.["config.max_submissions_per_participant"]}
						onChange={(on) => save({ config: { max_submissions_per_participant: on ? 5 : 1 } } as SlidePatch)}
					/>
					{Number(config.max_submissions_per_participant ?? 1) > 1 ? (
						<SelectField<number>
							label="Responses per participant"
							value={Number(config.max_submissions_per_participant)}
							options={
								OPEN_ENDED_CHOICES.some((c) => c.value === Number(config.max_submissions_per_participant))
									? OPEN_ENDED_CHOICES
									: [...OPEN_ENDED_CHOICES, { value: Number(config.max_submissions_per_participant), label: `Up to ${String(config.max_submissions_per_participant)} responses` }].sort((a, b) => a.value - b.value)
							}
							onChange={(value) => save({ config: { max_submissions_per_participant: value } } as SlidePatch)}
						/>
					) : null}
				</div>
			) : null}
		</div>
	);
}
