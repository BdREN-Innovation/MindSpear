"use client";

import { useId, useState } from "react";
import { QUIZ_LIMITS } from "@/features/deck/types";
import { runScoring } from "@/features/deck/lib/quiz";
import type { ParticipantProps } from "../types";
import { SubmitBar } from "../shared";
import { AnswerSummary, ParticipantLayout, ParticipantNotice } from "../shared/participantKit";
import { codePointLength, quizDisplayTitle, resolveStanding } from "../shared/quizLabels";
import {
	FirstAnswerLockedIn,
	LockedIn,
	OptionsHiddenView,
	PointsBar,
	QuizResultBanner,
	ResultHeading,
	optionsHidden,
	quizPhase,
	useQuizAnswer,
} from "../shared/quizParticipant";
import { SentenceText, SentenceWithAnswers } from "../shared/sentence";
import { cleanWord } from "../shared/text";

// fill_blanks on the phone: the sentence with a text box or a dropdown in
// each blank. Submit sends {answers} (one per blank, null = left empty; at
// least one filled). Typed answers are cleaned like the server does. Final
// once sent; after the reveal each blank shows right / wrong and the answer.

const FIELD_CLASS =
	"mx-1 inline-block min-h-11 rounded-lg border-2 px-2 align-middle text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] disabled:opacity-60";

export function FillBlanksParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode, scoring, reveal, standing, quiz }: ParticipantProps<"fill_blanks">) {
	const answer = useQuizAnswer(run.id, mySubmission, onSubmit);
	const formId = useId();
	const parts = run.config.parts ?? [];
	const blanks = run.config.blanks ?? [];
	const caseSensitive = run.config.case_sensitive ?? false;
	const [values, setValues] = useState<string[]>([]);

	const sent = Array.isArray(answer.latest?.answers) ? answer.latest.answers : null;
	const answered = (sent?.some((value) => !!value) ?? false) || answer.alreadyAnswered;
	const phase = quizPhase(run.state, mode, answered);
	const title = quizDisplayTitle(run.title, "fill_blanks");

	if (phase === "not_open" && optionsHidden(run)) {
		return <OptionsHiddenView theme={theme} title={title} state={run.state} hint="The sentence to complete appears on your phone when the question starts." />;
	}

	if (phase === "result") {
		const correct = reveal?.correct_answer?.blanks ?? aggregate?.correct?.blanks;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<QuizResultBanner runId={run.id} result={reveal} answered={answered} standing={resolveStanding(reveal, standing)} participantCount={quiz?.participant_count} />
				<section className="flex flex-col gap-2" aria-label={sent ? "Your answers" : "Answers"}>
					<ResultHeading>{sent ? "Your answers" : "Answers"}</ResultHeading>
					<SentenceWithAnswers parts={parts} mine={sent ?? correct?.map((blank) => blank.answers[0] ?? null) ?? []} correct={sent ? correct : undefined} caseSensitive={caseSensitive} />
				</section>
			</ParticipantLayout>
		);
	}

	if (phase === "locked_in") {
		if (!sent) return <FirstAnswerLockedIn theme={theme} title={title} />;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<LockedIn>
					<AnswerSummary label="Your answers">
						<SentenceWithAnswers parts={parts} mine={sent} caseSensitive={caseSensitive} />
					</AnswerSummary>
				</LockedIn>
			</ParticipantLayout>
		);
	}

	const answering = phase === "answering";
	const locked = !answering || disabled || answer.busy;
	const cleaned = blanks.map((_, index) => cleanWord(values[index] ?? ""));
	const filled = cleaned.filter((value) => value !== "").length;
	const tooLong = cleaned.some((value) => codePointLength(value) > QUIZ_LIMITS.maxTypedBlank);
	const canSend = answering && !disabled && filled > 0 && !tooLong;
	const set = (index: number, value: string) =>
		setValues((previous) => {
			const next = blanks.map((_, i) => previous[i] ?? "");
			next[index] = value;
			return next;
		});

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle="Fill in the blanks, then tap Submit."
			footer={
				<SubmitBar
					label="Submit"
					type="submit"
					form={formId}
					loading={answer.busy}
					disabled={!canSend}
					hint={`${filled} of ${blanks.length} filled${filled > 0 && filled < blanks.length ? " · empty blanks score nothing" : ""}`}
					error={answer.fieldError}
				/>
			}
		>
			<PointsBar scoring={scoring ?? runScoring(run)} votingStartedAt={run.voting_started_at} active={answering} />
			{!answering ? <ParticipantNotice>The question opens when the host starts it.</ParticipantNotice> : null}
			<form
				id={formId}
				onSubmit={(event) => {
					event.preventDefault();
					if (!canSend) return;
					const answers = cleaned.map((value) => (value === "" ? null : value));
					void answer.submit({ answers }, { answers });
				}}
			>
				<SentenceText
					parts={parts}
					className="m-0 text-lg leading-[3]"
					renderBlank={(index) => {
						const blank = blanks[index];
						const style = { borderColor: "var(--deck-border, #E5E7EB)", background: "var(--deck-surface, #fff)", color: "var(--deck-text, #111928)" };
						if (blank?.mode === "dropdown") {
							return (
								<select
									aria-label={`Blank ${index + 1}`}
									value={values[index] ?? ""}
									onChange={(event) => set(index, event.target.value)}
									disabled={locked}
									className={FIELD_CLASS}
									style={style}
								>
									<option value="">Choose…</option>
									{blank.choices.map((choice) => (
										<option key={choice} value={choice}>
											{choice}
										</option>
									))}
								</select>
							);
						}
						return (
							<input
								aria-label={`Blank ${index + 1}`}
								value={values[index] ?? ""}
								onChange={(event) => set(index, event.target.value)}
								disabled={locked}
								maxLength={QUIZ_LIMITS.maxTypedBlank * 2}
								autoComplete="off"
								autoCapitalize="off"
								spellCheck={false}
								enterKeyHint={index === blanks.length - 1 ? "send" : "next"}
								placeholder={`${index + 1}`}
								className={`${FIELD_CLASS} w-36 max-w-full`}
								style={style}
							/>
						);
					}}
				/>
			</form>
			{tooLong ? (
				<p role="alert" className="m-0 text-sm font-medium" style={{ color: "var(--deck-danger, #B91C1C)" }}>
					Keep each answer to {QUIZ_LIMITS.maxTypedBlank} characters.
				</p>
			) : null}
		</ParticipantLayout>
	);
}
