import { List } from "lucide-react";
import { defineSlideType } from "../types";
import { BulletsEditor, BulletsParticipant, BulletsPresenter } from "./ListSlide";

export const entry = defineSlideType({
	key: "bullets",
	products: ["quest", "quiz"],
	category: "content",
	label: "Bullets",
	description: "A bulleted list of up to 20 points.",
	icon: List,
	Editor: BulletsEditor,
	Presenter: BulletsPresenter,
	Participant: BulletsParticipant,
});
