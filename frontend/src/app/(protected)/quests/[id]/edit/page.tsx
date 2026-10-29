"use client";

import { useParams, useSearchParams } from "next/navigation";
import { EditorShell } from "@/features/deck-editor/components/EditorShell";

/** ?slide=<id> opens the editor on that slide (e.g. "Fix this slide" from Present); bad values are ignored. */
function slideParam(value: string | null): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const id = Number(value);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Quest editor. Rendered full-screen by app/(protected)/layout.tsx (no header / sidebar).
export default function QuestEditPage() {
	const { id } = useParams<{ id: string }>();
	const initialSlideId = slideParam(useSearchParams().get("slide"));
	return <EditorShell key={id} deckId={id} product="quest" initialSlideId={initialSlideId} />;
}
