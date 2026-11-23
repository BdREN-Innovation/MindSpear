"use client";

import { notFound, useParams } from "next/navigation";
import { DeckSessionsView } from "@/features/session-results/views/DeckSessionsView";

/** My Library > a quest: its details and past sessions. */
export default function QuestSessionsPage() {
	const id = Number(useParams<{ id: string }>().id);
	if (!Number.isInteger(id) || id <= 0) notFound();

	return <DeckSessionsView product="quest" deckId={id} />;
}
