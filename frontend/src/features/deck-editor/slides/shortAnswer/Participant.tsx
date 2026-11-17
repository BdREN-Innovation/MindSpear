"use client";

import { useId, useState } from "react";
import { QUIZ_LIMITS } from "@/features/deck/types";
import { runScoring } from "@/features/deck/lib/quiz";
import type { ParticipantProps } from "../types";
import { CharCount, SubmitBar } from "../shared";
import { AnswerSummary, ParticipantLayout, ParticipantNotice } from "../shared/participantKit";
import { codePointLength, quizDisplayTitle, resolveStanding } from "../shared/quizLabels";
import {
	FirstAnswerLockedIn,
	LockedIn,
	OptionsHiddenView,
	PointsBar,
	QuizResultBanner,
	ResultHeading,
	ResultRow,
	optionsHidden,
	quizPhase,
	useQuizAnswer,
} from "../shared/quizParticipant";
import { cleanWord } from "../shared/text";

// short_answer on the phone: one text field + Submit, counter against
// config.max_length. The text is cleaned like the server does (invisible
// characters dropped, spaces collapsed, trimmed) before the length check, and
// sent as {text}. Length counts code points like the server's mb_strlen (an
// emoji is one character). The answer is final once sent.

export function ShortAnswerParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode, scoring, reveal, standing, quiz }: ParticipantProps<"short_answer">) {
	const answer = useQuizAnswer(run.id, mySubmission, onSubmit);
	const [text, setText] = useState("");
	const inputId = useId();
	const maxLength = Math.max(1, Math.min(run.config.max_length ?? QUIZ_LIMITS.shortAnswerDefaultMaxLength, QUIZ_LIMITS.shortAnswerMaxLength));
	const sent = typeof answer.latest?.text === "string" && answer.latest.text !== "" ? answer.latest.text : null;
	const answered = sent !== null || answer.alreadyAnswered;
	const phase = quizPhase(run.state, mode, answered);
	const title = quizDisplayTitle(run.title, "short_answer");

	// No options to hide here, but the answer box waits for voting like the other types' options.
	if (phase === "not_open" && optionsHidden(run)) {
		return <OptionsHiddenView theme={theme} title={title} state={run.state} hint="The answer box opens on your phone when the question starts." />;
	}

	if (phase === "result") {
		const accepted = reveal?.correct_answer?.accepted_answers ?? aggregate?.correct?.accepted_answers ?? [];
		const correct = reveal?.is_correct === true;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<QuizResultBanner runId={run.id} result={reveal} answered={answered} standing={resolveStanding(reveal, standing)} participantCount={quiz?.participant_count} />
				{sent !== null ? (
					<section className="flex flex-col gap-2" aria-label="Your answer">
						<ResultHeading>Your answer</ResultHeading>
						<ul className="m-0 flex list-none flex-col gap-2 p-0">
							<ResultRow tone={reveal ? (correct ? "correct" : "wrong") : "neutral"} label={sent} />
						</ul>
					</section>
				) : null}
				{accepted.length > 0 ? (
					<section className="flex flex-col gap-2" aria-label="Accepted answers">
						<ResultHeading>{accepted.length === 1 ? "Correct answer" : "Accepted answers"}</ResultHeading>
						<ul className="m-0 flex list-none flex-col gap-2 p-0">
							{accepted.map((value, index) => (
								<ResultRow key={`${value}-${index}`} tone="correct" label={value} />
							))}
						</ul>
					</section>
				) : null}
			</ParticipantLayout>
		);
	}

	if (phase === "locked_in" && sent === null) return <FirstAnswerLockedIn theme={theme} title={title} />;
	if (phase === "locked_in" && sent !== null) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				<LockedIn>
					<AnswerSummary>
						<p className="m-0 break-words text-lg font-semibold">{sent}</p>
					</AnswerSummary>
				</LockedIn>
			</ParticipantLayout>
		);
	}

	const answering = phase === "answering";
	const cleaned = cleanWord(text);
	const length = codePointLength(cleaned);
	const tooLong = length > maxLength;
	const canSend = answering && !disabled && cleaned !== "" && !tooLong;
	const formId = `${inputId}-form`;

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle="Type your answer, then tap Submit."
			footer={<SubmitBar label="Submit" type="submit" form={formId} loading={answer.busy} disabled={!canSend} error={answer.fieldError} />}
		>
			<PointsBar scoring={scoring ?? runScoring(run)} votingStartedAt={run.voting_started_at} active={answering} />
			{!answering ? <ParticipantNotice>The question opens when the host starts it.</ParticipantNotice> : null}
			<form
				id={formId}
				onSubmit={(event) => {
					event.preventDefault();
					if (!canSend) return;
					void answer.submit({ text: cleaned }, { text: cleaned });
				}}
				className="flex flex-col gap-2"
			>
				<div className="flex items-baseline justify-between gap-2">
					<label htmlFor={inputId} className="text-sm font-semibold">
						Your answer
					</label>
					<CharCount length={length} max={maxLength} />
				</div>
				<input
					id={inputId}
					value={text}
					onChange={(event) => setText(event.target.value)}
					// The browser counts UTF-16 units (an emoji is 2): room for maxLength emoji plus slack; the counter is the real limit.
					maxLength={maxLength * 2 + 20}
					disabled={!answering || disabled || answer.busy}
					autoComplete="off"
					enterKeyHint="send"
					placeholder="Type here…"
					aria-invalid={tooLong || !!answer.fieldError || undefined}
					className="min-h-14 w-full rounded-xl border-2 px-4 text-lg outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] disabled:opacity-60"
					style={{ borderColor: "var(--deck-border, #E5E7EB)", background: "var(--deck-surface, #fff)", color: "var(--deck-text, #111928)" }}
				/>
				{tooLong ? (
					<p role="alert" className="m-0 text-sm font-medium" style={{ color: "var(--deck-danger, #B91C1C)" }}>
						Keep it to {maxLength} characters.
					</p>
				) : null}
			</form>
		</ParticipantLayout>
	);
}
