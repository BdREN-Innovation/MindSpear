import { Video } from "lucide-react";
import { defineSlideType } from "../types";
import { VideoEditor, VideoParticipant, VideoPresenter } from "./VideoSlide";

export const entry = defineSlideType({
	key: "video",
	products: ["quest", "quiz"],
	category: "content",
	label: "Video",
	description: "A YouTube or Vimeo link, or an mp4 from My Files.",
	icon: Video,
	Editor: VideoEditor,
	Presenter: VideoPresenter,
	Participant: VideoParticipant,
});
