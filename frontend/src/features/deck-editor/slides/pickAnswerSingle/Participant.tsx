"use client";

import type { ParticipantProps } from "../types";
import { ChoiceParticipant, choiceModeOf } from "../shared/quizChoice";

// One correct answer: one tap sends {option_id} (instant submit). Several:
// select options, then Submit sends {option_ids} (all or nothing). Final once sent.
export function PickAnswerSingleParticipant(props: ParticipantProps<"pick_answer_single">) {
	return <ChoiceParticipant type="pick_answer_single" mode={choiceModeOf(props.run)} props={props} />;
}
