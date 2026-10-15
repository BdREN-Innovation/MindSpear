"use client";

import { useParams } from "next/navigation";
import { PresenterShell } from "@/features/deck-presenter";

// Quest v2 presenter (plan Phase 6). Rendered full-screen by
// app/(protected)/layout.tsx (no header / sidebar).
export default function QuestPresentPage() {
	const { id } = useParams<{ id: string }>();
	return <PresenterShell deckId={Number(id)} />;
}
