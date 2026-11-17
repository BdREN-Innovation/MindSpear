"use client";

import { useParams } from "next/navigation";
import { SessionControl } from "@/features/fun-games/components/host/session/SessionControl";

export default function FunGameSessionPage() {
	const { sessionId } = useParams<{ sessionId: string }>();
	return <SessionControl sessionId={sessionId} />;
}
