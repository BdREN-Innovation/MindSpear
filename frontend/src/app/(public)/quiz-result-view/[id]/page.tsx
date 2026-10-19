"use client";
import QuizMode from "@/components/Dashboard/QuizMode";
import { ParticipantShell, ParticipantStage } from "@/features/live/components/Liveui/participant-ui";
import { CheckCircle2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import React from "react";

/**
 * Where players land when a live quiz ends. It was a bare podium under the site menu (Home,
 * Login, Registration), with no quiz name and nothing telling a player how they did.
 */
function QuizResultView() {
	const searchParams = useSearchParams();
	const title = searchParams.get("title");
	const name = searchParams.get("uname");
	const attemptId = searchParams.get("aid");

	return (
		<ParticipantShell variant="quiz" title={title} participantName={name} sessionStatus="ended">
			<ParticipantStage size="full" className="bg-white/95 p-4 sm:p-6">
				<div className="text-center">
					<div className="inline-flex items-center gap-2 rounded-full bg-secondary/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-secondary">
						<CheckCircle2 className="h-4 w-4" />
						Quiz complete
					</div>
					<h1 className="mt-3 text-3xl font-black text-slate-950">{title || "Final results"}</h1>
					<p className="mt-1 text-sm font-medium text-slate-500">Thanks for playing! Here is how everyone did.</p>
				</div>
				<QuizMode scope="entire" sessionData="" highlightParticipantId={attemptId} />
			</ParticipantStage>
		</ParticipantShell>
	);
}

export default QuizResultView;
