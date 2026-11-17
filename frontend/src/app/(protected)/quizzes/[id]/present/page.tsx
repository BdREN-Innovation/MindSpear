"use client";

import { useParams } from "next/navigation";
import { PresenterShell } from "@/features/deck-presenter";

// Quiz presenter (/api/v1/quiz-sessions, channels session.quiz.* and
// host.quiz.*). Rendered full-screen by app/(protected)/layout.tsx.
export default function QuizPresentPage() {
	const { id } = useParams<{ id: string }>();
	return <PresenterShell deckId={Number(id)} product="quiz" />;
}
