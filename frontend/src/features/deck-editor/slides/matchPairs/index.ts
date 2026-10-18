import { Link2 } from "lucide-react";
import { defineSlideType } from "../types";
import { MatchPairsEditor } from "./Editor";
import { MatchPairsParticipant } from "./Participant";
import { MatchPairsPresenter } from "./Presenter";
import { sampleMatchPairsAggregate } from "./pairs";

export const entry = defineSlideType({
	key: "match_pairs",
	products: ["quiz"],
	category: "poll",
	label: "Match pairs",
	description: "Players connect each item to its matching pair.",
	icon: Link2,
	Editor: MatchPairsEditor,
	Presenter: MatchPairsPresenter,
	Participant: MatchPairsParticipant,
	sampleAggregate: sampleMatchPairsAggregate,
});
