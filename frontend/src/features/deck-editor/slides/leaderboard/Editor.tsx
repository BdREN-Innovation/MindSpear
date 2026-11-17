"use client";

import { QUIZ_LIMITS } from "@/features/deck/types";
import type { EditorProps } from "../types";
import { NumberField, ToggleField } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";

// Content tab: the title and how many players the board shows (config
// {top_n 1–50, show_all_participants}). Put it anywhere in the deck; it shows
// the ranking so far and the points each player won on the last question.

export function LeaderboardEditor({ slide, onChange, errors, disabled }: EditorProps<"leaderboard">) {
	const config = slide.config;
	const showAll = config.show_all_participants ?? false;
	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"leaderboard"> title={slide.title} onChange={onChange} errors={errors} disabled={disabled} label="Title" placeholder="Leaderboard" />
			<EditorGroup title="Players shown">
				<ToggleField
					label="Show everyone"
					description={`Lists every player, up to ${QUIZ_LIMITS.leaderboardMaxTopN}.`}
					checked={showAll}
					onChange={(show_all_participants) => onChange({ config: { show_all_participants } })}
					error={errors?.["config.show_all_participants"]}
					disabled={disabled}
				/>
				<NumberField
					label="Top players"
					hint={showAll ? "Not used while “Show everyone” is on." : "The board shows this many players, best first."}
					value={config.top_n ?? QUIZ_LIMITS.leaderboardDefaultTopN}
					min={1}
					max={QUIZ_LIMITS.leaderboardMaxTopN}
					suffix="players"
					debounceMs={500}
					onChange={(value) => onChange({ config: { top_n: value ?? QUIZ_LIMITS.leaderboardDefaultTopN } })}
					error={errors?.["config.top_n"]}
					disabled={disabled || showAll}
				/>
			</EditorGroup>
		</div>
	);
}
