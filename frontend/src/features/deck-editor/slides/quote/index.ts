import { Quote } from "lucide-react";
import { defineSlideType } from "../types";
import { QuoteEditor, QuoteParticipant, QuotePresenter } from "./QuoteSlide";

export const entry = defineSlideType({
	key: "quote",
	products: ["quest", "quiz"],
	category: "content",
	label: "Quote",
	description: "A large quote with an optional attribution.",
	icon: Quote,
	Editor: QuoteEditor,
	Presenter: QuotePresenter,
	Participant: QuoteParticipant,
});
