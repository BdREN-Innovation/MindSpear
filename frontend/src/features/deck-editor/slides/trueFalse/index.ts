import { ToggleRight } from "lucide-react";
import type { SlideOf, TrueFalseAggregate } from "@/features/deck/types";
import { defineSlideType } from "../types";
import { sampleChoiceAggregate } from "../pickAnswerSingle/sample";
import { TrueFalseEditor } from "./Editor";
import { TrueFalseParticipant } from "./Participant";
import { TrueFalsePresenter } from "./Presenter";

export const entry = defineSlideType({
	key: "true_false",
	products: ["quiz"],
	category: "poll",
	label: "True or false",
	description: "One statement, two answers: True or False, or your own.",
	icon: ToggleRight,
	Editor: TrueFalseEditor,
	Presenter: TrueFalsePresenter,
	Participant: TrueFalseParticipant,
	sampleAggregate: (slide: SlideOf<"true_false">): TrueFalseAggregate => sampleChoiceAggregate(slide, "single"),
});
