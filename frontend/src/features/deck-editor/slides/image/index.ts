import { ImageIcon } from "lucide-react";
import { defineSlideType } from "../types";
import { ImageEditor, ImageParticipant, ImagePresenter } from "./ImageSlide";

export const entry = defineSlideType({
	key: "image",
	products: ["quest", "quiz"],
	category: "content",
	label: "Image",
	description: "An image from My Files with an optional caption.",
	icon: ImageIcon,
	Editor: ImageEditor,
	Presenter: ImagePresenter,
	Participant: ImageParticipant,
});
