"use client";

import { useParams } from "next/navigation";
import { FunGamePlay } from "@/features/fun-games/components/participant/FunGamePlay";

export default function FunGameJoinPage() {
	const { joinCode } = useParams<{ joinCode: string }>();
	return <FunGamePlay joinCode={decodeURIComponent(joinCode)} />;
}
