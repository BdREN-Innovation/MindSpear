import type { Metadata } from "next";
import { decodeParam } from "@/features/deck-participant/lib/route";
import { AvatarScreen } from "@/features/deck-participant/screens/AvatarScreen";

export const metadata: Metadata = { title: "Pick an avatar" };

/** /play/[code]/avatar — pick an emoji, then join. */
export default async function PlayAvatarPage({ params }: { params: Promise<{ code: string }> }) {
	const { code } = await params;
	return <AvatarScreen code={decodeParam(code)} />;
}
