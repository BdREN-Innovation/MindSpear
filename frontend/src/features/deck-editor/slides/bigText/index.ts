import { Type } from "lucide-react";
import { defineSlideType } from "../types";
import { BigTextEditor, BigTextParticipant, BigTextPresenter } from "./BigTextSlide";

export const entry = defineSlideType({
	key: "big_text",
	products: ["quest", "quiz"],
	category: "content",
	label: "Big text",
	description: "One big phrase, for section breaks.",
	icon: Type,
	Editor: BigTextEditor,
	Presenter: BigTextPresenter,
	Participant: BigTextParticipant,
});
