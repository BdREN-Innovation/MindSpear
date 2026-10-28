"use client";

import type { PresenterProps } from "../types";
import { ChoicePresenter } from "../shared/quizChoice";

export function TrueFalsePresenter({ run, aggregate, state, theme }: PresenterProps<"true_false">) {
	return <ChoicePresenter type="true_false" mode="single" title={run.title} options={run.options} aggregate={aggregate} state={state} theme={theme} />;
}
