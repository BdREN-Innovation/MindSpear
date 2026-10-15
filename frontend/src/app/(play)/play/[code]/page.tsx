import type { Metadata } from "next";
import { decodeParam } from "@/features/deck-participant/lib/route";
import { NameScreen } from "@/features/deck-participant/screens/NameScreen";

export const metadata: Metadata = { title: "Your name" };

/** /play/[code] — pick a display name. */
export default async function PlayNamePage({ params }: { params: Promise<{ code: string }> }) {
	const { code } = await params;
	return <NameScreen code={decodeParam(code)} />;
}
