import { defineSlideType } from "../types";
import { Podium } from "./PodiumIcon";
import { LeaderboardEditor } from "./Editor";
import { LeaderboardParticipant } from "./Participant";
import { LeaderboardPresenter } from "./Presenter";

// No sampleAggregate (the aggregate is empty): the Presenter draws made-up rows in preview mode.
export const entry = defineSlideType({
	key: "leaderboard",
	products: ["quiz"],
	category: "interactive",
	label: "Leaderboard",
	description: "Show the top players and their points so far.",
	icon: Podium,
	Editor: LeaderboardEditor,
	Presenter: LeaderboardPresenter,
	Participant: LeaderboardParticipant,
});
