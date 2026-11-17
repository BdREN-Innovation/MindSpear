/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { DeckTheme } from "@/features/deck/theme";
import type { PickAnswerSingleAggregate, RunOption, RunState, Slide } from "@/features/deck/types";
import { runScoring } from "@/features/deck/lib/quiz";
import type { OptionsApi, ParticipantProps } from "../types";
import { OptionListEditor } from "./OptionListEditor";
import { OptionCard, OptionCardGroup, SubmitBar } from "./participant";
import { PresenterStage } from "./presenter";
import { optionLabel, formatPercent } from "./labels";
import { AnswerSummary, ParticipantLayout, ParticipantNotice } from "./participantKit";
import { CorrectMarker, EditorError, EditorWarning, useCorrectMarking } from "./quizEditor";
import { ChoiceTiles, CorrectSummary, QuizHeader, RevealBars, StageHint, StageMessage } from "./quizPresenter";
import {
	FirstAnswerLockedIn,
	LockedIn,
	OptionsHiddenView,
	PointsBar,
	QuizResultBanner,
	ResultHeading,
	ResultRow,
	optionsHidden,
	quizPhase,
	useQuizAnswer,
	type ResultTone,
} from "./quizParticipant";
import { quizDisplayTitle, quizFallbackTitle, resolveStanding } from "./quizLabels";

// Pick answer (pick_answer_single), true_false and the retired
// pick_answer_multi, one implementation with a `mode`: single = an instant
// submit on the phone; multi = checkboxes and a Submit button, scored ALL OR
// NOTHING (the selected set must equal the correct set exactly). Pick answer
// runs say which in config.multiple_answers (several options marked correct).

export type ChoiceMode = "single" | "multi";
export type ChoiceType = "pick_answer_single" | "pick_answer_multi" | "true_false";

/** How players answer a choice run: several correct → select them all; else pick one. */
export function choiceModeOf(run: { type: string; config: unknown }): ChoiceMode {
	if (run.type === "pick_answer_multi") return "multi";
	return (run.config as { multiple_answers?: unknown } | null)?.multiple_answers === true ? "multi" : "single";
}

/** An option's label; an unlabelled true_false option reads True / False. */
export function choiceLabel(type: ChoiceType, option: Pick<RunOption, "label"> | undefined, index: number): string {
	if (type === "true_false" && !option?.label?.trim()) return index === 0 ? "True" : "False";
	return optionLabel(option, index);
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

/**
 * Answer options with correct marks. `any` (Pick answer): tick one or more;
 * with several ticked players must select all of them. `single`: one radio.
 * `multi` (retired pick_answer_multi): ticks, always all or nothing.
 */
export function ChoiceOptionsEditor({
	slide,
	api,
	mode,
	errors,
	disabled,
}: {
	slide: Slide;
	api: OptionsApi;
	mode: ChoiceMode | "any";
	errors?: Record<string, string[]>;
	disabled?: boolean;
}) {
	const marker: ChoiceMode = mode === "single" ? "single" : "multi";
	const marking = useCorrectMarking(slide, api, marker);
	const total = slide.options.length;
	return (
		<div className="flex flex-col gap-2">
			<OptionListEditor
				slide={slide}
				options={api}
				label="Answer options"
				itemNoun="option"
				labelPlaceholder={(index) => `Option ${index + 1}`}
				allowImages
				errors={errors}
				disabled={disabled}
				hint={
					mode === "single"
						? "Select the circle next to the correct answer."
						: mode === "any"
							? "Tick the correct answer. Tick more than one if several are right: players then select every correct answer, all or nothing."
							: "Tick every correct answer. Scoring is all or nothing: players score only when they select exactly the correct answers — no points for some of them."
				}
				renderRowStart={(option, index) => (
					<CorrectMarker
						mode={marker}
						checked={marking.isCorrect(option)}
						onToggle={() => void marking.toggle(option)}
						label={`Option ${index + 1}`}
						disabled={disabled || marking.busy}
					/>
				)}
			/>
			{marking.error ? <EditorError>{marking.error}</EditorError> : null}
			{errors?.is_correct?.[0] ? <EditorError>{errors.is_correct[0]}</EditorError> : null}
			{marking.correctCount === 0 ? (
				<EditorWarning>
					{mode === "multi" ? "Mark at least one correct answer" : "Mark the correct answer"} — without one, nobody can score on this slide.
				</EditorWarning>
			) : mode !== "single" && marking.correctCount === total && total > 1 ? (
				<EditorWarning>Every option is marked correct, so players must select all of them to score.</EditorWarning>
			) : mode === "any" && marking.correctCount > 1 ? (
				<p className="m-0 text-sm text-dark-5 dark:text-dark-6">
					{marking.correctCount} correct answers: players select several options and score only when they pick{" "}
					{marking.correctCount === 2 ? "both" : `all ${marking.correctCount}`}.
				</p>
			) : null}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Presenter                                                           */
/* ------------------------------------------------------------------ */

export function ChoicePresenter({
	type,
	mode,
	title,
	options,
	aggregate,
	state,
	theme,
}: {
	type: ChoiceType;
	mode: ChoiceMode;
	title: string | null;
	options: RunOption[];
	/** Single and multi aggregates share the fields read here. */
	aggregate: PickAnswerSingleAggregate | null;
	state: RunState;
	theme: DeckTheme;
}) {
	const fallback = quizFallbackTitle(type);
	const tiles = options.map((option, index) => ({ id: option.id, label: choiceLabel(type, option, index), imageUrl: option.image_url }));
	const revealed = state === "reveal" || state === "closed";

	let body: ReactNode;
	let aside: ReactNode = null;
	if (!revealed) {
		body = (
			<>
				<StageHint>
					{state === "voting"
						? mode === "single"
							? "Pick one answer on your phone."
							: "Select every correct answer on your phone."
						: "Answer on your phone when the question starts."}
				</StageHint>
				<ChoiceTiles items={tiles} theme={theme} ariaLabel="Answer options" />
			</>
		);
	} else if (!aggregate) {
		body = (
			<>
				<ChoiceTiles items={tiles} theme={theme} ariaLabel="Answer options" />
				<StageMessage>Revealing the answer…</StageMessage>
			</>
		);
	} else {
		const correct = new Set(aggregate.correct?.option_ids ?? []);
		const counts = new Map(aggregate.options.map((row) => [row.option_id, row]));
		aside = <CorrectSummary correct={aggregate.correct_responses} total={aggregate.total_responses} />;
		body = (
			<RevealBars
				key="reveal"
				theme={theme}
				ariaLabel="Answers per option"
				items={options.map((option, index) => {
					const row = counts.get(option.id);
					return {
						id: option.id,
						label: choiceLabel(type, option, index),
						imageUrl: option.image_url,
						value: row?.count ?? 0,
						display: formatPercent(row?.percentage ?? 0),
						detail: `${row?.count ?? 0} ${(row?.count ?? 0) === 1 ? "player" : "players"}`,
						correct: row?.is_correct ?? correct.has(option.id),
					};
				})}
			/>
		);
	}

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<QuizHeader title={title} fallback={fallback} aside={aside} />
			{body}
		</PresenterStage>
	);
}

/* ------------------------------------------------------------------ */
/* Participant                                                         */
/* ------------------------------------------------------------------ */

type ChoiceParticipantProps = ParticipantProps<"pick_answer_single"> | ParticipantProps<"pick_answer_multi"> | ParticipantProps<"true_false">;

/** The ids a stored / local answer picked (single or multi shape). */
function pickedIds(answer: { option_id?: unknown; option_ids?: unknown } | null | undefined): number[] {
	if (!answer) return [];
	if (typeof answer.option_id === "number") return [answer.option_id];
	return Array.isArray(answer.option_ids) ? answer.option_ids.filter((id): id is number => typeof id === "number") : [];
}

export function ChoiceParticipant({
	type,
	mode,
	props,
	layout = "list",
}: {
	type: ChoiceType;
	mode: ChoiceMode;
	props: ChoiceParticipantProps;
	/** "binary": two big side-by-side answers (true_false). */
	layout?: "list" | "binary";
}) {
	const { run, mySubmission, disabled, theme, aggregate, reveal, standing, quiz } = props;
	const onSubmit = props.onSubmit as (payload: { option_id: number } | { option_ids: number[] }) => Promise<void>;
	const answer = useQuizAnswer<{ option_id?: number; option_ids?: number[] }, { option_id: number } | { option_ids: number[] }>(
		run.id,
		mySubmission,
		onSubmit
	);
	const [selected, setSelected] = useState<number[]>([]);
	const [tapped, setTapped] = useState<number | null>(null);

	// Exactly the run view's order (it may be this participant's own order).
	const options = run.options as RunOption[];
	const picked = pickedIds(answer.latest);
	const chosen = picked.filter((id) => options.some((option) => option.id === id));
	const answered = chosen.length > 0 || answer.alreadyAnswered;
	const phase = quizPhase(run.state, props.mode, answered);
	const title = quizDisplayTitle(run.title, type);
	const scoring = props.scoring ?? runScoring(run);

	if (phase !== "result" && optionsHidden(run)) {
		return picked.length > 0 || answer.alreadyAnswered ? <FirstAnswerLockedIn theme={theme} title={title} /> : <OptionsHiddenView theme={theme} title={title} state={run.state} />;
	}

	if (phase === "result") {
		const correct = new Set(reveal?.correct_answer?.option_ids ?? aggregate?.correct?.option_ids ?? []);
		const known = correct.size > 0;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<QuizResultBanner
					runId={run.id}
					result={reveal}
					answered={answered}
					standing={resolveStanding(reveal, standing)}
					participantCount={quiz?.participant_count}
				/>
				<section className="flex flex-col gap-2" aria-label="Answers">
					<ResultHeading>{known ? (correct.size > 1 ? "Correct answers" : "Correct answer") : "Answers"}</ResultHeading>
					<ul className="m-0 flex list-none flex-col gap-2 p-0">
						{options.map((option, index) => {
							const mine = chosen.includes(option.id);
							const right = correct.has(option.id);
							const tone: ResultTone = !known ? "neutral" : right ? (mine || mode === "single" ? "correct" : "missed") : mine ? "wrong" : "neutral";
							return (
								<ResultRow
									key={option.id}
									tone={tone}
									index={index}
									imageUrl={option.image_url}
									label={choiceLabel(type, option, index)}
									note={mine ? "Your answer" : tone === "missed" ? "You didn't select this" : undefined}
								/>
							);
						})}
					</ul>
				</section>
			</ParticipantLayout>
		);
	}

	if (phase === "locked_in") {
		if (chosen.length === 0) return <FirstAnswerLockedIn theme={theme} title={title} />;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<LockedIn>
					<AnswerSummary label={chosen.length > 1 ? "Your answers" : "Your answer"}>
						<ul className="m-0 flex list-none flex-col gap-2 p-0">
							{chosen.map((id) => {
								const index = options.findIndex((option) => option.id === id);
								const option = options[index];
								return (
									<li key={id} className="flex items-center gap-3">
										{option?.image_url ? <img src={option.image_url} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" draggable={false} /> : null}
										<span className="break-words font-semibold">{choiceLabel(type, option, index)}</span>
									</li>
								);
							})}
						</ul>
					</AnswerSummary>
				</LockedIn>
			</ParticipantLayout>
		);
	}

	const answering = phase === "answering";
	const locked = !answering || disabled;
	const submitMulti = () => {
		if (selected.length === 0) return;
		// Option order, like the stored answer.
		const ids = options.map((option) => option.id).filter((id) => selected.includes(id));
		void answer.submit({ option_ids: ids }, { option_ids: ids });
	};

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle={mode === "single" ? "Tap the correct answer." : "Select every correct answer, then tap Submit. All or nothing!"}
			footer={
				mode === "multi" ? (
					<SubmitBar
						label="Submit"
						onClick={submitMulti}
						loading={answer.busy}
						disabled={locked || selected.length === 0}
						hint={selected.length > 0 ? `${selected.length} selected` : undefined}
						error={answer.fieldError}
					/>
				) : null
			}
		>
			<PointsBar scoring={scoring} votingStartedAt={run.voting_started_at} active={answering} />
			{!answering ? <ParticipantNotice>The question opens when the host starts it.</ParticipantNotice> : null}
			{mode === "single" && answer.fieldError ? <ParticipantNotice tone="danger">{answer.fieldError}</ParticipantNotice> : null}
			<OptionCardGroup label={title} mode={mode} className={layout === "binary" ? "grid grid-cols-2" : undefined}>
				{options.map((option, index) => {
					const isSelected = mode === "single" ? tapped === option.id : selected.includes(option.id);
					return (
						<OptionCard
							key={option.id}
							mode={mode}
							index={layout === "binary" ? undefined : index}
							className={layout === "binary" ? "min-h-28 text-lg" : undefined}
							label={choiceLabel(type, option, index)}
							imageUrl={option.image_url}
							selected={isSelected}
							disabled={locked || answer.busy}
							hapticFeedback={mode === "multi"}
							description={mode === "single" && answer.busy && tapped === option.id ? "Sending…" : undefined}
							onSelect={() => {
								if (mode === "single") {
									setTapped(option.id);
									void answer.submit({ option_id: option.id }, { option_id: option.id });
								} else {
									setSelected((previous) => (previous.includes(option.id) ? previous.filter((id) => id !== option.id) : [...previous, option.id]));
								}
							}}
						/>
					);
				})}
			</OptionCardGroup>
		</ParticipantLayout>
	);
}
