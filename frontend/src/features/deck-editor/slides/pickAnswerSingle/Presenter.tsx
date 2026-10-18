"use client";

import type { PresenterProps } from "../types";
import { ChoicePresenter } from "../shared/quizChoice";

export function PickAnswerSinglePresenter({ run, aggregate, state, theme }: PresenterProps<"pick_answer_single">) {
	return <ChoicePresenter mode="single" title={run.title} options={run.options} aggregate={aggregate} state={state} theme={theme} />;
}
