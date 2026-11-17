import { FerrisWheel } from "lucide-react";
import { defineSlideType } from "../types";
import { SpinnerWheelEditor } from "./Editor";
import { SpinnerWheelParticipant } from "./Participant";
import { SpinnerWheelPresenter } from "./Presenter";

// No sampleAggregate: the editor canvas shows the wheel at rest (it only spins live).
export const entry = defineSlideType({
	key: "spinner_wheel",
	products: ["quiz"],
	category: "interactive",
	label: "Spinner wheel",
	description: "Spin a wheel to pick an entry at random (no points).",
	icon: FerrisWheel,
	Editor: SpinnerWheelEditor,
	Presenter: SpinnerWheelPresenter,
	Participant: SpinnerWheelParticipant,
});
