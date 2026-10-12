"use client";

import { useParams } from "next/navigation";
import { QuestionImport } from "@/features/fun-games/components/host/import/QuestionImport";

export default function FunGameImportPage() {
	const { id } = useParams<{ id: string }>();
	return <QuestionImport gameId={id} />;
}
