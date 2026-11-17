import { Heading } from "lucide-react";
import { defineSlideType } from "../types";
import { HeadingEditor, HeadingParticipant, HeadingPresenter } from "./HeadingSlide";

export const entry = defineSlideType({
	key: "heading",
	products: ["quest", "quiz"],
	category: "content",
	label: "Heading",
	description: "A title with an optional subtitle.",
	icon: Heading,
	Editor: HeadingEditor,
	Presenter: HeadingPresenter,
	Participant: HeadingParticipant,
});
