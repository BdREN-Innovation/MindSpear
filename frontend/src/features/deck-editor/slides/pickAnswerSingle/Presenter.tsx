"use client";

import type { PresenterProps } from "../types";
import { ChoicePresenter, choiceModeOf } from "../shared/quizChoice";

export function PickAnswerSinglePresenter({ run, aggregate, state, theme }: PresenterProps<"pick_answer_single">) {
	return <ChoicePresenter type="pick_answer_single" mode={choiceModeOf(run)} title={run.title} options={run.options} aggregate={aggregate} state={state} theme={theme} />;
}
