"use client";

import { RadioTower, Users } from "lucide-react";
import { ParticipantStage } from "./ParticipantStage";
import { useServerCountdown } from "../../hooks/useServerCountdown";
import { describeTimer, formatCountdown } from "../../lib/format";
import type { SessionState } from "../../types";

function StartsIn({ startsAt }: { startsAt: string }) {
	const remaining = useServerCountdown(startsAt);
	if (remaining == null) return null;
	return remaining > 0 ? (
		<p className="mt-2 text-sm font-semibold text-slate-600">
			Starts in{" "}
			<span className="font-mono text-2xl font-semibold tabular-nums text-slate-950" role="timer">
				{formatCountdown(remaining)}
			</span>
		</p>
	) : (
		<p className="mt-2 text-sm font-semibold text-slate-600">Starting…</p>
	);
}

type LobbyStageProps = {
	state: SessionState;
	name: string;
	onLeave: () => void;
};

export function LobbyStage({ state, name, onLeave }: LobbyStageProps) {
	const { quiz } = state;
	return (
		<ParticipantStage size="narrow" className="items-center justify-center px-5 py-8 text-center">
			<div className="mx-auto w-full max-w-md">
				<div className="mx-auto flex h-20 w-20 items-center justify-center rounded-lg border border-secondary/20 bg-secondary/10">
					<RadioTower className="h-9 w-9 text-secondary" aria-hidden />
				</div>
				<p className="mt-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary-dark">
					<span className="h-2 w-2 rounded-full border-2 border-primary" aria-hidden />
					Lobby open
				</p>
				<h1 className="mt-3 text-2xl font-black text-slate-950 sm:text-3xl">You&apos;re in, {name}!</h1>
				{state.startsAt ? (
					<StartsIn startsAt={state.startsAt} />
				) : (
					<p className="mt-2 text-base font-medium text-slate-600">Waiting for the host to start the game.</p>
				)}

				<dl className="mt-6 grid grid-cols-2 gap-2 text-left text-sm">
					<div className="rounded-lg border border-slate-200 bg-white p-3">
						<dt className="text-xs font-bold uppercase text-slate-500">Timer</dt>
						<dd className="mt-1 font-semibold text-slate-950">{describeTimer(quiz.timer)}</dd>
					</div>
					<div className="rounded-lg border border-slate-200 bg-white p-3">
						<dt className="flex items-center gap-1 text-xs font-bold uppercase text-slate-500">
							<Users className="h-3.5 w-3.5" aria-hidden />
							Players
						</dt>
						<dd className="mt-1 font-mono font-semibold tabular-nums text-slate-950" aria-live="polite">
							{state.participantCount}
						</dd>
					</div>
				</dl>

				{quiz.instructions ? (
					<div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
						<h2 className="text-xs font-bold uppercase text-slate-500">Instructions</h2>
						<p className="mt-1 whitespace-pre-line text-sm text-slate-800">{quiz.instructions}</p>
					</div>
				) : null}

				<p className="mt-4 text-left text-sm text-slate-600">
					{quiz.timer.mode === "perQuestion"
						? "Questions come one at a time, in your own order. Each has its own timer — submit to go straight to the next one; when the timer runs out the question is skipped. Answers are final."
						: "One timer for the whole quiz. Questions come one at a time, in your own order — submit to go straight to the next one. Answers are final."}
					{state.quiz.scoringMode === "speed" ? " Faster correct answers score more points." : ""}
				</p>

				<button
					type="button"
					onClick={onLeave}
					className="mt-6 text-sm font-semibold text-slate-500 underline underline-offset-4 hover:text-slate-800"
				>
					Not {name}? Join as someone else
				</button>
			</div>
		</ParticipantStage>
	);
}
