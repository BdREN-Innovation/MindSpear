"use client";

import { useParams } from "next/navigation";
import { PresenterShell } from "@/features/deck-presenter";

// Quiz v2 presenter (/api/v1/quiz-sessions/v2, channels session.quiz.* and
// host.quiz.v2.*). Rendered full-screen by app/(protected)/layout.tsx.
export default function QuizPresentPage() {
	const { id } = useParams<{ id: string }>();
	return <PresenterShell deckId={Number(id)} product="quiz" />;
}
