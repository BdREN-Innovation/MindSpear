import { MessagesSquare } from "lucide-react";
import { defineSlideType } from "../types";
import { QaAudienceEditor } from "./Editor";
import { QaAudienceParticipant } from "./Participant";
import { QaAudiencePresenter } from "./Presenter";
import { sampleQaAggregate } from "./sample";

export const entry = defineSlideType({
	key: "qa_audience",
	products: ["quest"],
	category: "interactive",
	label: "Q&A",
	description: "The audience asks and upvotes questions; you moderate.",
	icon: MessagesSquare,
	Editor: QaAudienceEditor,
	Presenter: QaAudiencePresenter,
	Participant: QaAudienceParticipant,
	sampleAggregate: sampleQaAggregate,
});
