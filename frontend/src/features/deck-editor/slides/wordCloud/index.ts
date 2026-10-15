import { Cloud } from "lucide-react";
import type { WordCloudAggregate } from "@/features/deck/types";
import { defineSlideType } from "../types";
import { sampleTime } from "../pollSingle/common";
import { WordCloudEditor } from "./Editor";
import { WordCloudParticipant } from "./Participant";
import { WordCloudPresenter } from "./Presenter";

const SAMPLE_WORDS: [string, number][] = [
	["teamwork", 18],
	["curious", 12],
	["focus", 11],
	["energy", 9],
	["ideas", 8],
	["growth", 7],
	["fun", 6],
	["clarity", 5],
	["trust", 5],
	["momentum", 4],
	["learning", 4],
	["kindness", 3],
	["bold", 3],
	["coffee", 2],
	["balance", 2],
	["flow", 1],
	["courage", 1],
	["community", 1],
];

/** Editor canvas preview: a fixed sample cloud (sorted count desc like the backend). */
function sampleAggregate(): WordCloudAggregate {
	const words = SAMPLE_WORDS.map(([word, count], index) => ({ word, count, first_seen_at: sampleTime(60 - index) }));
	return {
		total_responses: 24,
		total_entries: words.reduce((sum, word) => sum + word.count, 0),
		distinct_words: words.length,
		truncated: false,
		words,
	};
}

export const entry = defineSlideType({
	key: "word_cloud",
	products: ["quest"],
	category: "poll",
	label: "Word cloud",
	description: "Short words or phrases that grow with every mention.",
	icon: Cloud,
	Editor: WordCloudEditor,
	Presenter: WordCloudPresenter,
	Participant: WordCloudParticipant,
	sampleAggregate,
});
