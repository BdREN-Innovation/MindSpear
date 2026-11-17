import { MapPin } from "lucide-react";
import { defineSlideType } from "../types";
import { PinOnImageEditor } from "./Editor";
import { PinOnImageParticipant } from "./Participant";
import { PinOnImagePresenter } from "./Presenter";
import { samplePinAggregate } from "./sample";

export const entry = defineSlideType({
	key: "pin_on_image",
	products: ["quest"],
	category: "poll",
	label: "Pin on image",
	description: "Tap an image to drop pins and see a heatmap.",
	icon: MapPin,
	Editor: PinOnImageEditor,
	Presenter: PinOnImagePresenter,
	Participant: PinOnImageParticipant,
	sampleAggregate: samplePinAggregate,
});
