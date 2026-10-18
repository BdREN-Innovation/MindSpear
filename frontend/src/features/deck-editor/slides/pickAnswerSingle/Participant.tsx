"use client";

import type { ParticipantProps } from "../types";
import { ChoiceParticipant } from "../shared/quizChoice";

// One tap sends {option_id} (instant submit); the answer is final.
export function PickAnswerSingleParticipant(props: ParticipantProps<"pick_answer_single">) {
	return <ChoiceParticipant mode="single" props={props} />;
}
