"use client";

import { notFound, useParams } from "next/navigation";
import { SessionResultsView } from "@/features/session-results/views/SessionResultsView";

/** My Library > a quest > the results of one session. */
export default function QuestSessionResultsPage() {
	const params = useParams<{ id: string; sessionId: string }>();
	const id = Number(params.id);
	const sessionId = Number(params.sessionId);
	if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(sessionId) || sessionId <= 0) notFound();

	return <SessionResultsView key={sessionId} product="quest" deckId={id} sessionId={sessionId} />;
}
