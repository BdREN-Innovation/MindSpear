"use client";

import type { QaSlideSort } from "@/features/deck/types";
import type { EditorProps } from "../types";
import { NumberField, SegmentedField, ToggleField } from "../shared";

// qa_audience editor (plan §5.4): starting sort, whether participants see
// each other's questions, the question length cap (10..1000) and the
// profanity filter (QaAudienceSlideType config).

const SORTS: { value: QaSlideSort; label: string }[] = [
	{ value: "top", label: "Most upvoted" },
	{ value: "newest", label: "Newest" },
];

export function QaAudienceEditor({ slide, onChange, errors, disabled }: EditorProps<"qa_audience">) {
	const config = slide.config;

	return (
		<div className="flex flex-col gap-5">
			<p className="m-0 text-sm text-dark-5 dark:text-dark-6">
				Participants ask questions from their phones and upvote the ones they want answered. You star, hide or mark questions as answered
				while presenting.
			</p>

			<SegmentedField<QaSlideSort>
				label="Order questions by"
				value={config.sort === "newest" ? "newest" : "top"}
				options={SORTS}
				onChange={(value) => onChange({ config: { sort: value } })}
				hint="Where the feed starts; participants can switch."
				error={errors?.["config.sort"]}
				disabled={disabled}
			/>

			<ToggleField
				label="Show questions to participants"
				description="Off: each participant only sees their own questions."
				checked={config.show_feed_to_participants ?? true}
				onChange={(checked) => onChange({ config: { show_feed_to_participants: checked } })}
				error={errors?.["config.show_feed_to_participants"]}
				disabled={disabled}
			/>

			<NumberField
				label="Max question length"
				value={config.max_question_length ?? 280}
				min={10}
				max={1000}
				suffix="characters"
				debounceMs={400}
				hint="10 to 1,000."
				error={errors?.["config.max_question_length"]}
				disabled={disabled}
				onChange={(value) => {
					if (value !== null) onChange({ config: { max_question_length: value } });
				}}
			/>

			<ToggleField
				label="Filter profanity"
				description="Masks offensive words before a question is shown."
				checked={config.profanity_filter_enabled ?? true}
				onChange={(checked) => onChange({ config: { profanity_filter_enabled: checked } })}
				error={errors?.["config.profanity_filter_enabled"]}
				disabled={disabled}
			/>
		</div>
	);
}
