import { SquareDashedMousePointer } from "lucide-react";
import type { SlideOf } from "@/features/deck/types";
import { defineSlideType } from "../types";
import { sampleBlanksAggregate } from "../fillBlanks";
import { DragDropEditor } from "./Editor";
import { DragDropParticipant } from "./Participant";
import { DragDropPresenter } from "./Presenter";

export const entry = defineSlideType({
	key: "drag_drop",
	products: ["quiz"],
	category: "poll",
	label: "Drag and drop",
	description: "Players drag words from a word bank into the blanks.",
	icon: SquareDashedMousePointer,
	Editor: DragDropEditor,
	Presenter: DragDropPresenter,
	Participant: DragDropParticipant,
	sampleAggregate: (slide: SlideOf<"drag_drop">) => sampleBlanksAggregate({ text: slide.config.text }),
});
