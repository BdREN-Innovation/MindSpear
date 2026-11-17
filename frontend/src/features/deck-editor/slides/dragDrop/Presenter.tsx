"use client";

import type { PresenterProps } from "../types";
import { BlanksPresenter } from "../shared/sentence";

export function DragDropPresenter({ run, aggregate, state, theme, mode }: PresenterProps<"drag_drop">) {
	return (
		<BlanksPresenter
			type="drag_drop"
			title={run.title}
			parts={run.config.parts ?? []}
			words={run.options}
			aggregate={aggregate}
			state={state}
			theme={theme}
			mode={mode}
		/>
	);
}
