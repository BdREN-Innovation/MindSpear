"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, SkipForward } from "lucide-react";
import { getParticipantApi, toFunGamesError, type ParticipantAuth } from "../../api";
import type { PlayerProgress, TimerMode } from "../../types";
import { CountdownTimer } from "../shared/CountdownTimer";
import { OptionList, type OptionState } from "./OptionList";
import { QuestionCard } from "./QuestionCard";
import { StageMessage } from "./StageMessage";

const REJECTED: Record<string, string> = {
	late: "Time ran out on that one before your answer arrived. Here's your next question.",
	locked: "That question had already moved on. Here's your current one.",
	invalid: "That answer couldn't be saved. Try again.",
};

type SequentialPlayerProps = {
	auth: ParticipantAuth;
	timerMode: TimerMode;
	/** Called once the server says this player has no questions left. */
	onFinished: () => void;
};

/**
 * One question at a time, in this player's own order. Submitting (or skipping)
 * brings the next question straight away; every answer is final. The player
 * isn't told whether an answer was right until the game ends.
 */
export function SequentialPlayer({ auth, timerMode, onFinished }: SequentialPlayerProps) {
	const [progress, setProgress] = useState<PlayerProgress | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [draft, setDraft] = useState<string | null>(null);
	const [sending, setSending] = useState<null | "answer" | "skip">(null);
	const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const finishedReported = useRef(false);

	const apply = useCallback((next: PlayerProgress) => {
		setProgress(next);
		setDraft(null);
		if (next.question && next.index != null) {
			setAnnouncement(`Question ${next.index + 1} of ${next.total}.`);
		}
	}, []);

	const load = useCallback(async () => {
		setLoadError(null);
		try {
			apply(await (await getParticipantApi()).getCurrent(auth));
		} catch (reason) {
			setLoadError(toFunGamesError(reason).message);
		}
	}, [auth, apply]);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		if (progress?.finished && !finishedReported.current) {
			finishedReported.current = true;
			onFinished();
		}
	}, [progress, onFinished]);

	const send = async (optionId: string | null) => {
		const question = progress?.question;
		if (!question || sending) return;
		setSending(optionId ? "answer" : "skip");
		setNotice(null);
		try {
			const result = await (await getParticipantApi()).submitAnswer(auth, {
				questionId: question.id,
				optionId,
				clientSubmittedAt: new Date().toISOString(),
			});
			if (!result.ack.accepted && result.ack.reason !== "finished") {
				setNotice({ tone: "error", text: REJECTED[result.ack.reason ?? "invalid"] ?? REJECTED.invalid });
			}
			// Keep the picked option if the same question comes back (e.g. "invalid").
			if (result.progress.question?.id === question.id) {
				setProgress(result.progress);
			} else {
				apply(result.progress);
			}
		} catch (reason) {
			setNotice({ tone: "error", text: `${toFunGamesError(reason).message} Your answer wasn't sent — try again.` });
		} finally {
			setSending(null);
		}
	};

	// The server moves on at the deadline; ask it for the next question.
	const onExpire = useCallback(() => {
		setNotice({ tone: "info", text: "Time's up for that one." });
		load();
	}, [load]);

	if (!progress) {
		return loadError ? (
			<StageMessage tone="error" title="Couldn't load your question" body={loadError} action={{ label: "Try again", onClick: load }} />
		) : (
			<StageMessage busy title="Getting your first question…" />
		);
	}
	if (progress.finished) {
		return <StageMessage busy title="Saving your answers…" />;
	}
	const question = progress.question;
	if (!question || progress.index == null) {
		return <StageMessage busy title="Getting your next question…" />;
	}

	const headingId = `fg-q-${question.id}`;
	const windowStartedAt =
		progress.deadline != null
			? new Date(Date.parse(progress.deadline) - progress.windowSeconds * 1000).toISOString()
			: null;
	const stateOf = (optionId: string): OptionState =>
		sending && optionId !== draft ? "dimmed" : optionId === draft ? "selected" : "default";

	return (
		<section
			aria-label="Question"
			className="mx-auto flex w-full max-w-4xl flex-1 flex-col rounded-lg border border-white/20 bg-white/95 p-4 shadow-2xl shadow-black/10 sm:p-6"
		>
			<CountdownTimer
				key={progress.deadline ?? "none"}
				deadline={progress.deadline}
				windowStartedAt={windowStartedAt}
				label={timerMode === "perQuestion" ? "Time for this question" : "Time left for the quiz"}
				criticalMs={timerMode === "perQuestion" ? 5_000 : 60_000}
				onExpire={onExpire}
			/>

			{/* Progress through this player's own questions. */}
			<div className="mt-3" aria-hidden>
				<div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
					{Array.from({ length: progress.total }, (_, i) => (
						<span
							key={i}
							className={i < progress.index! ? "flex-1 bg-slate-900" : i === progress.index ? "flex-1 bg-primary" : "flex-1 bg-slate-200"}
						/>
					))}
				</div>
			</div>

			<div className="mt-4">
				<QuestionCard question={question} index={progress.index} total={progress.total} headingId={headingId} />
			</div>
			<div className="mt-5">
				<OptionList
					options={question.options}
					checkedId={draft}
					stateOf={stateOf}
					readOnly={!!sending}
					onSelect={setDraft}
					labelledBy={headingId}
				/>
			</div>

			<p
				role={notice?.tone === "error" ? "alert" : "status"}
				className={notice?.tone === "error" ? "mt-3 min-h-5 text-sm font-semibold text-red-dark" : "mt-3 min-h-5 text-sm text-slate-600"}
			>
				{notice?.text ?? (draft ? "Answers are final once submitted." : "")}
			</p>
			<span className="sr-only" aria-live="polite">
				{announcement}
			</span>

			<div className="mt-auto flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
				<button
					type="button"
					onClick={() => send(null)}
					disabled={!!sending}
					className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
				>
					{sending === "skip" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <SkipForward className="h-4 w-4" aria-hidden />}
					Skip
				</button>
				<button
					type="button"
					onClick={() => draft && send(draft)}
					disabled={!draft || !!sending}
					className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary via-secondary to-accent px-6 text-base font-bold text-white shadow-lg shadow-primary/25 transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:translate-y-0 disabled:opacity-50"
				>
					{sending === "answer" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
					{sending === "answer" ? "Submitting…" : progress.index + 1 === progress.total ? "Submit and finish" : "Submit"}
				</button>
			</div>
		</section>
	);
}
