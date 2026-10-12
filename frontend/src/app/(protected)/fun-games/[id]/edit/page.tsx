"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { GameEditor } from "@/features/fun-games/components/host/editor/GameEditor";

export default function FunGameEditPage() {
	const { id } = useParams<{ id: string }>();
	// GameEditor reads ?imported= with useSearchParams, which needs a Suspense boundary.
	return (
		<Suspense>
			<GameEditor gameId={id} />
		</Suspense>
	);
}
