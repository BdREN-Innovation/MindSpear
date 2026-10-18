"use client";

import type { PresenterProps } from "../types";
import { ChoicePresenter } from "../shared/quizChoice";

export function PickAnswerMultiPresenter({ run, aggregate, state, theme }: PresenterProps<"pick_answer_multi">) {
	return <ChoicePresenter mode="multi" title={run.title} options={run.options} aggregate={aggregate} state={state} theme={theme} />;
}
