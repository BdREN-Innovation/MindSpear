import { Pilcrow } from "lucide-react";
import { defineSlideType } from "../types";
import { LazyParagraphEditor } from "./LazyParagraphEditor";
import { ParagraphParticipant, ParagraphPresenter } from "./ParagraphSlide";

export const entry = defineSlideType({
	key: "paragraph",
	products: ["quest", "quiz"],
	category: "content",
	label: "Paragraph",
	description: "Rich text with formatting, lists and links.",
	icon: Pilcrow,
	Editor: LazyParagraphEditor,
	Presenter: ParagraphPresenter,
	Participant: ParagraphParticipant,
});
