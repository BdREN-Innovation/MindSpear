import { SquareCheckBig } from "lucide-react";
import type { PickAnswerMultiAggregate, SlideOf } from "@/features/deck/types";
import { defineSlideType } from "../types";
import { sampleChoiceAggregate } from "../pickAnswerSingle/sample";
import { PickAnswerMultiEditor } from "./Editor";
import { PickAnswerMultiParticipant } from "./Participant";
import { PickAnswerMultiPresenter } from "./Presenter";

export const entry = defineSlideType({
	key: "pick_answer_multi",
	products: ["quiz"],
	category: "poll",
	label: "Pick answers",
	description: "Players select every correct answer (all or nothing).",
	icon: SquareCheckBig,
	Editor: PickAnswerMultiEditor,
	Presenter: PickAnswerMultiPresenter,
	Participant: PickAnswerMultiParticipant,
	sampleAggregate: (slide: SlideOf<"pick_answer_multi">): PickAnswerMultiAggregate => sampleChoiceAggregate(slide, "multi"),
});
