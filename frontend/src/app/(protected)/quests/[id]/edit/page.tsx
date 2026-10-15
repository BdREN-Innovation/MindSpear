"use client";

import { useParams } from "next/navigation";
import { EditorShell } from "@/features/deck-editor/components/EditorShell";

// Quest v2 editor. Rendered full-screen by app/(protected)/layout.tsx (no header / sidebar).
export default function QuestEditPage() {
	const { id } = useParams<{ id: string }>();
	return <EditorShell key={id} deckId={id} product="quest" />;
}
