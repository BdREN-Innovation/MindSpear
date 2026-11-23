"use client";

import { notFound, useParams } from "next/navigation";
import { DeckSessionsView } from "@/features/session-results/views/DeckSessionsView";

/** My Library > a quiz: its details and past sessions. */
export default function QuizSessionsPage() {
	const id = Number(useParams<{ id: string }>().id);
	if (!Number.isInteger(id) || id <= 0) notFound();

	return <DeckSessionsView product="quiz" deckId={id} />;
}
