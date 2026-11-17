"use client";

import type { ParticipantProps } from "../types";
import { ChoiceParticipant } from "../shared/quizChoice";

// Two big answers side by side; one tap sends {option_id} (instant submit), final once sent.
export function TrueFalseParticipant(props: ParticipantProps<"true_false">) {
	return <ChoiceParticipant type="true_false" mode="single" layout="binary" props={props} />;
}
