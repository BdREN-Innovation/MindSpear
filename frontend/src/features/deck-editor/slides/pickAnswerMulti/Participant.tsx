"use client";

import type { ParticipantProps } from "../types";
import { ChoiceParticipant } from "../shared/quizChoice";

// Retired type (past runs): select options, then Submit sends {option_ids} (option order); all or nothing.
export function PickAnswerMultiParticipant(props: ParticipantProps<"pick_answer_multi">) {
	return <ChoiceParticipant type="pick_answer_multi" mode="multi" props={props} />;
}
