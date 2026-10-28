"use client";

import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import {
	isScoredQuizSlideTypeKey,
	QUIZ_LIMITS,
	type Deck,
	type DeckProduct,
	type Slide,
	type SlidePatch,
} from "@/features/deck/types";
import { NumberField, SelectField, ToggleField, type ChoiceOption } from "../../slides/shared";

// Per-slide settings (plan §5.6). Keys come from the backend types:
//   timers: slides.time_limit_seconds (5..3600 | null), get_ready_seconds (0..30); answer types only
//   PollSettings: config.show_results_to_participants (every live poll type)
//   word_cloud: config.allow_multiple_submissions
//   open_ended: config.max_submissions_per_participant (1..20; > 1 = multiple)
//   quiz scored types (quiz routes only): points_min / points_max (0..1000,
//     min ≤ max), speed_bonus_enabled; null = the default at session start
//     (50 / 100 / on), and a null get_ready_seconds becomes 5 at session start.

export const TIME_LIMIT_CHOICES: (number | null)[] = [null, 10, 20, 30, 45, 60, 90, 120, 180];

/**
 * Select choices for a time limit, with the current value added when it is not a preset.
 * `defaultValue` (the type / deck default a new slide gets) is added too and marked "(default)".
 */
export function timeLimitOptions(current: number | null, defaultValue: number | null = null): ChoiceOption<number>[] {
	const values = TIME_LIMIT_CHOICES.map((v) => v ?? 0);
	if (current && !values.includes(current)) values.push(current);
	if (defaultValue && !values.includes(defaultValue)) values.push(defaultValue);
	return values
		.sort((a, b) => a - b)
		.map((value) => ({
			value,
			label: `${value === 0 ? "No time limit" : formatSeconds(value)}${defaultValue && value === defaultValue ? " (default)" : ""}`,
		}));
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
	/** Quiz decks add the scoring fields to scored slides. Default: the deck's product. */
	product?: DeckProduct;
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

export function SettingsTab({ slide, deck, product = deck.product, errors, onPatch }: SettingsTabProps) {
	const save = (patch: SlidePatch) => onPatch(slide.id, patch, { immediate: true });
	const config = slide.config as unknown as Record<string, unknown>;
	const hasShowResults = typeof config.show_results_to_participants === "boolean";
	const scored = product === "quiz" && isScoredQuizSlideTypeKey(slide.type);

	if (slide.type === "qa_audience") {
		return (
			<div className="flex flex-col gap-4">
				<Note>Q&amp;A stays open until you close it, so it has no timer. Sorting and showing questions to participants are on the Content tab.</Note>
			</div>
		);
	}

	if (slide.type === "spinner_wheel") {
		return <Note>The wheel spins for a few seconds when you start it. It has no timer and awards no points.</Note>;
	}

	if (slide.type === "leaderboard") {
		return (
			<Note>
				The leaderboard shows everyone&apos;s points so far and has no timer. How many players it lists is on the Content
				tab.
			</Note>
		);
	}

	if (!slide.acceptsAnswers) {
		return <Note>Content slides have no timer or voting settings.</Note>;
	}

	const timeLimit = slide.timeLimitSeconds ?? 0;
	const deckGetReady = deck.settings.get_ready_seconds;
	// Quiz answer slides without their own value count down 5 s at session start.
	const getReady = slide.getReadySeconds ?? (scored ? QUIZ_LIMITS.defaultGetReadySeconds : 0);
	// What the backend seeds a new slide with: the deck default, else the type's own.
	const defaultTimeLimit = scored
		? (deck.settings.default_time_limit ??
			(QUIZ_LIMITS.defaultTimeLimitSeconds as Record<string, number | undefined>)[slide.type] ??
			null)
		: null;

	return (
		<div className="flex flex-col gap-5">
			<SelectField<number>
				label="Time limit"
				hint={
					scored
						? "Answering closes and the answer is revealed when time runs out."
						: "Voting closes by itself when time runs out."
				}
				value={timeLimit}
				options={timeLimitOptions(slide.timeLimitSeconds, defaultTimeLimit)}
				error={errors?.time_limit_seconds}
				onChange={(value) => save({ time_limit_seconds: value === 0 ? null : value })}
			/>

			<div className="flex flex-col gap-3">
				<ToggleField
					label="Get-ready countdown"
					description={
						scored ? "Show a short countdown before answering opens." : "Show a short countdown before voting opens."
					}
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

			{scored ? <ScoringFields slide={slide} timed={timeLimit > 0} errors={errors} save={save} /> : null}

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

/* ------------------------------------------------------------------ */
/* Quiz scoring                                                        */
/* ------------------------------------------------------------------ */

const POINTS_DEBOUNCE_MS = 600;

/** How partly right answers score (QUIZ_REDESIGN_PLAN.md "Scoring model"). */
function creditNote(type: Slide["type"]): string | null {
	switch (type) {
		case "pick_answer_single":
			return "With several correct answers, players must pick every one of them and no others to earn points.";
		case "pick_answer_multi":
			return "Players must pick every correct option and no others to earn points.";
		case "match_pairs":
		case "correct_order":
		case "categorise":
		case "fill_blanks":
		case "drag_drop":
			return "Partly right answers earn their share of the points.";
		case "short_answer":
			return "Answers must match one of the accepted answers.";
		default:
			return null;
	}
}

function ScoringFields({
	slide,
	timed,
	errors,
	save,
}: {
	slide: Slide;
	timed: boolean;
	errors?: Record<string, string[]>;
	save: (patch: SlidePatch) => void;
}) {
	const stored = {
		min: slide.pointsMin ?? QUIZ_LIMITS.defaultPointsMin,
		max: slide.pointsMax ?? QUIZ_LIMITS.defaultPointsMax,
	};
	const speedBonus = slide.speedBonusEnabled ?? QUIZ_LIMITS.defaultSpeedBonus;
	// An invalid pair (min > max) stays here, unsent, until the author fixes either field.
	const [draft, setDraft] = useState<{ slideId: number; min: number; max: number } | null>(null);
	const current = draft && draft.slideId === slide.id ? draft : { slideId: slide.id, ...stored };
	const invalid = current.min > current.max;

	const change = (key: "min" | "max", value: number | null) => {
		const next = { ...current, [key]: value ?? stored[key] };
		// Without the speed bonus the minimum is unused (and hidden): keep it valid quietly.
		if (!speedBonus && key === "max" && next.min > next.max) next.min = next.max;
		if (next.min > next.max) {
			setDraft(next);
			return;
		}
		setDraft(null);
		const patch: SlidePatch = {};
		if (next.min !== stored.min) patch.points_min = next.min;
		if (next.max !== stored.max) patch.points_max = next.max;
		if (Object.keys(patch).length > 0) save(patch);
	};

	const rangeError = invalid ? "The minimum can't be more than the maximum." : null;
	const note = creditNote(slide.type);

	return (
		<fieldset className="flex flex-col gap-4 border-t border-stroke pt-5 dark:border-stroke-dark">
			<legend className="sr-only">Points</legend>
			<p aria-hidden className="-mb-1 text-sm font-semibold text-dark dark:text-white">
				Points
			</p>
			<ToggleField
				label="Faster answers get more points"
				description={
					speedBonus
						? "Points fall from the maximum to the minimum as the timer runs down."
						: "Every correct answer gets the same points."
				}
				checked={speedBonus}
				error={errors?.speed_bonus_enabled}
				onChange={(on) => save({ speed_bonus_enabled: on })}
			/>
			<div className="grid grid-cols-2 gap-3">
				<NumberField
					label={speedBonus ? "Maximum" : "Points"}
					value={current.max}
					min={0}
					max={QUIZ_LIMITS.maxPoints}
					debounceMs={POINTS_DEBOUNCE_MS}
					suffix="pts"
					error={errors?.points_max ?? (invalid && draft ? rangeError : null)}
					onChange={(value) => change("max", value)}
				/>
				{speedBonus ? (
					<NumberField
						label="Minimum"
						value={current.min}
						min={0}
						max={QUIZ_LIMITS.maxPoints}
						debounceMs={POINTS_DEBOUNCE_MS}
						suffix="pts"
						error={errors?.points_min ?? (invalid && draft ? rangeError : null)}
						onChange={(value) => change("min", value)}
					/>
				) : null}
			</div>
			<p className="text-xs text-dark-5 dark:text-dark-6">
				{speedBonus && timed
					? `An instant correct answer earns ${current.max} points, a last-second one ${Math.min(current.min, current.max)}. Wrong answers earn 0.`
					: `A correct answer earns ${current.max} points. Wrong answers earn 0.`}
			</p>
			{speedBonus && !timed ? <Note>Without a time limit every correct answer earns the maximum.</Note> : null}
			{note ? <Note>{note}</Note> : null}
		</fieldset>
	);
}
