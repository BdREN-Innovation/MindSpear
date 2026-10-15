import { ListOrdered } from "lucide-react";
import { defineSlideType } from "../types";
import { createListEditor, createListParticipant, createListPresenter } from "../bullets/ListSlide";

// Same components as bullets (NumberedSlideType extends BulletsSlideType); only the markers differ.
export const entry = defineSlideType({
	key: "numbered",
	products: ["quest", "quiz"],
	category: "content",
	label: "Numbered list",
	description: "A numbered list of up to 20 steps.",
	icon: ListOrdered,
	Editor: createListEditor(true),
	Presenter: createListPresenter(true),
	Participant: createListParticipant(true),
});
