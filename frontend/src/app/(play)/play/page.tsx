import type { Metadata } from "next";
import { JoinCodeScreen } from "@/features/deck-participant/screens/JoinCodeScreen";

export const metadata: Metadata = { title: "Join" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/** /play — enter a session code (?code= prefills and looks up; ?reason= explains a redirect). */
export default async function PlayJoinPage({ searchParams }: { searchParams: SearchParams }) {
	const params = await searchParams;
	return <JoinCodeScreen initialCode={first(params.code)} reason={first(params.reason)} />;
}
