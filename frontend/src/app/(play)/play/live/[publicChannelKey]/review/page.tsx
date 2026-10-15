import type { Metadata } from "next";
import { decodeParam } from "@/features/deck-participant/lib/route";
import { ReviewScreen } from "@/features/deck-participant/screens/ReviewScreen";

export const metadata: Metadata = { title: "Your results" };

/** /play/live/[publicChannelKey]/review — post-session review. */
export default async function PlayReviewPage({ params }: { params: Promise<{ publicChannelKey: string }> }) {
	const { publicChannelKey } = await params;
	return <ReviewScreen publicChannelKey={decodeParam(publicChannelKey)} />;
}
