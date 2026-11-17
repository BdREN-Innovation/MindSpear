import { Coins } from "lucide-react";
import { defineSlideType } from "../types";
import { PointsAllocationEditor } from "./Editor";
import { PointsAllocationParticipant } from "./Participant";
import { PointsAllocationPresenter } from "./Presenter";
import { samplePointsAggregate } from "./sample";

export const entry = defineSlideType({
	key: "points_allocation",
	products: ["quest"],
	category: "poll",
	label: "100 points",
	description: "Distribute a budget of points across the options.",
	icon: Coins,
	Editor: PointsAllocationEditor,
	Presenter: PointsAllocationPresenter,
	Participant: PointsAllocationParticipant,
	sampleAggregate: samplePointsAggregate,
});
