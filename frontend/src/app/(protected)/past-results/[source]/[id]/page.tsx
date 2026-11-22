"use client";

import { notFound, useParams } from "next/navigation";
import { PastResultView } from "@/features/legacy-results/views/PastResultView";

export default function PastResultPage() {
	const params = useParams<{ source: string; id: string }>();
	const id = Number(params.id);
	if ((params.source !== "quiz" && params.source !== "quest") || !Number.isInteger(id) || id <= 0) notFound();

	return <PastResultView source={params.source} id={id} />;
}
