"use client";

import { toast } from "react-toastify";
import { toDeckApiError } from "@/features/deck/api/errors";
import { spinnerSegments } from "@/features/deck/lib/quiz";
import { QUIZ_LIMITS, type SlideOption, type SpinnerOptionPayload } from "@/features/deck/types";
import type { EditorProps, OptionsApi } from "../types";
import { NumberField, OptionListEditor } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";

// Content tab: 2–12 wheel entries (label and/or image), each with an optional
// weight (payload {weight}: 0.1–100, empty = 1). A segment's size is its share
// of the total weight, so the wheel looks exactly as likely as it is. No points.

function weightOf(option: SlideOption): number | null {
	const weight = (option.payload as SpinnerOptionPayload | null)?.weight;
	return typeof weight === "number" && Number.isFinite(weight) ? weight : null;
}

function WeightField({ option, api, share, disabled }: { option: SlideOption; api: OptionsApi; share: number; disabled?: boolean }) {
	const save = async (weight: number | null) => {
		try {
			await api.update(option.id, { payload: weight === null ? {} : { weight } });
		} catch (reason) {
			const failure = toDeckApiError(reason);
			toast.error(failure.fieldError("payload.weight") ?? failure.message);
		}
	};
	return (
		<div className="flex items-end gap-3">
			<NumberField
				label="Weight"
				value={weightOf(option)}
				onChange={(value) => void save(value)}
				min={QUIZ_LIMITS.minSpinnerWeight}
				max={QUIZ_LIMITS.maxSpinnerWeight}
				step={0.1}
				allowEmpty
				placeholder="1"
				debounceMs={600}
				disabled={disabled}
				className="w-28"
			/>
			<span className="pb-3 text-xs tabular-nums text-dark-5 dark:text-dark-6">{Math.round(share * 10) / 10}% of the wheel</span>
		</div>
	);
}

export function SpinnerWheelEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"spinner_wheel">) {
	const segments = spinnerSegments(slide.options);
	const shareOf = new Map(segments.map((segment) => [segment.option_id, ((segment.end_angle - segment.start_angle) / 360) * 100]));
	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"spinner_wheel">
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
				label="Title"
				placeholder="e.g. Who answers the next question?"
			/>
			<EditorGroup title="Wheel">
				<OptionListEditor
					slide={slide}
					options={onOptionsChange}
					label="Entries"
					itemNoun="entry"
					labelPlaceholder={(index) => `Entry ${index + 1}`}
					hint="The host spins the wheel live; it lands on one entry at random. Give an entry more weight to make its slice (and its chance) bigger. No points are scored."
					allowImages
					errors={errors}
					disabled={disabled}
					renderRowDetails={(option) => <WeightField option={option} api={onOptionsChange} share={shareOf.get(option.id) ?? 0} disabled={disabled} />}
				/>
			</EditorGroup>
		</div>
	);
}
