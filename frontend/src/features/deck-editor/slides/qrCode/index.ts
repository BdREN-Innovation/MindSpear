import { QrCode } from "lucide-react";
import { defineSlideType } from "../types";
import { QrCodeEditor, QrCodeParticipant, QrCodePresenter } from "./QrCodeSlide";

export const entry = defineSlideType({
	key: "qr_code",
	products: ["quest", "quiz"],
	category: "content",
	label: "Join QR code",
	description: "Shows the join code and QR code for the audience.",
	icon: QrCode,
	Editor: QrCodeEditor,
	Presenter: QrCodePresenter,
	Participant: QrCodeParticipant,
});
