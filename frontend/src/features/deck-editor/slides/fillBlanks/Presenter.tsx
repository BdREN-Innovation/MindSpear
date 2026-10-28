"use client";

import type { PresenterProps } from "../types";
import { BlanksPresenter } from "../shared/sentence";

export function FillBlanksPresenter({ run, aggregate, state, theme, mode }: PresenterProps<"fill_blanks">) {
	return <BlanksPresenter type="fill_blanks" title={run.title} parts={run.config.parts ?? []} aggregate={aggregate} state={state} theme={theme} mode={mode} />;
}
