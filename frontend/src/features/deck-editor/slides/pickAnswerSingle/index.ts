import { CircleCheckBig } from "lucide-react";
import type { PickAnswerSingleAggregate, SlideOf } from "@/features/deck/types";
import { defineSlideType } from "../types";
import { PickAnswerSingleEditor } from "./Editor";
import { PickAnswerSingleParticipant } from "./Participant";
import { PickAnswerSinglePresenter } from "./Presenter";
import { sampleChoiceAggregate } from "./sample";

export const entry = defineSlideType({
	key: "pick_answer_single",
	products: ["quiz"],
	category: "poll",
	label: "Pick answer",
	description: "Players pick the correct answer — or every correct one when there are several.",
	icon: CircleCheckBig,
	Editor: PickAnswerSingleEditor,
	Presenter: PickAnswerSinglePresenter,
	Participant: PickAnswerSingleParticipant,
	sampleAggregate: (slide: SlideOf<"pick_answer_single">): PickAnswerSingleAggregate => sampleChoiceAggregate(slide),
});
