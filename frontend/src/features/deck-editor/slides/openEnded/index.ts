import { MessageSquareText } from "lucide-react";
import type { OpenEndedAggregate } from "@/features/deck/types";
import { defineSlideType } from "../types";
import { sampleTime } from "../shared/samples";
import { OpenEndedEditor } from "./Editor";
import { OpenEndedParticipant } from "./Participant";
import { OpenEndedPresenter } from "./Presenter";

const SAMPLE_CARDS: [string, string][] = [
	["More hands-on workshops, fewer slides.", "🦊"],
	["Clearer goals for each sprint so we know what done looks like.", "🐼"],
	["Keep the Friday demos, they are the best part of the week!", "🐙"],
	["A shared glossary for new joiners.", "🦉"],
	["Shorter meetings with an agenda sent the day before.", "🐢"],
	["Pair programming sessions across teams.", "🦄"],
];

/** Editor canvas preview: a few sample cards, newest first. */
function sampleAggregate(): OpenEndedAggregate {
	return {
		total_responses: SAMPLE_CARDS.length,
		total_entries: SAMPLE_CARDS.length,
		page: 1,
		per_page: 10,
		last_page: 1,
		truncated: false,
		items: SAMPLE_CARDS.map(([body, emoji], index) => ({
			id: `sample:${index}`,
			body,
			body_truncated: false,
			participant_emoji: emoji,
			submitted_at: sampleTime(index * 2),
		})),
	};
}

export const entry = defineSlideType({
	key: "open_ended",
	products: ["quest"],
	category: "poll",
	label: "Open ended",
	description: "Free-text answers shown as a wall of cards.",
	icon: MessageSquareText,
	Editor: OpenEndedEditor,
	Presenter: OpenEndedPresenter,
	Participant: OpenEndedParticipant,
	sampleAggregate,
});
