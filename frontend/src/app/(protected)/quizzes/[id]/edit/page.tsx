"use client";

import { useParams, useSearchParams } from "next/navigation";
import { EditorShell } from "@/features/deck-editor/components/EditorShell";

/** ?slide=<id> opens the editor on that slide (e.g. "Open slide 3 in the editor" from Present); bad values are ignored. */
function slideParam(value: string | null): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const id = Number(value);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Quiz editor (/api/v1/quizzes). Rendered full-screen by app/(protected)/layout.tsx (no header / sidebar).
export default function QuizEditPage() {
	const { id } = useParams<{ id: string }>();
	const initialSlideId = slideParam(useSearchParams().get("slide"));
	return <EditorShell key={id} deckId={id} product="quiz" initialSlideId={initialSlideId} />;
}
