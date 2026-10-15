import { Star } from "lucide-react";
import { defineSlideType } from "../types";
import { RatingEditor } from "./Editor";
import { RatingParticipant } from "./Participant";
import { RatingPresenter } from "./Presenter";
import { sampleRatingAggregate } from "./sample";

export const entry = defineSlideType({
	key: "rating",
	products: ["quest"],
	category: "poll",
	label: "Rating",
	description: "Give each item 3 to 10 stars.",
	icon: Star,
	Editor: RatingEditor,
	Presenter: RatingPresenter,
	Participant: RatingParticipant,
	sampleAggregate: sampleRatingAggregate,
});
