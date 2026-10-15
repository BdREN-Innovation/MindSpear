import type { Metadata } from "next";
import { decodeParam } from "@/features/deck-participant/lib/route";
import { PlayScreen } from "@/features/deck-participant/screens/PlayScreen";

export const metadata: Metadata = { title: "Live" };

/** /play/live/[publicChannelKey] — the live play screen (token from sessionStorage). */
export default async function PlayLivePage({ params }: { params: Promise<{ publicChannelKey: string }> }) {
	const { publicChannelKey } = await params;
	return <PlayScreen publicChannelKey={decodeParam(publicChannelKey)} />;
}
