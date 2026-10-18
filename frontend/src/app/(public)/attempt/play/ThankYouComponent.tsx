"use client";
import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Check, Clock, Download, Eye, Trophy, X } from "lucide-react";

interface AnswerData {
	start_time?: string;
	selected_option: string | number | (string | number)[] | null;
}

interface QuestionOptions {
	color?: string[];
	choices?: (string | null)[];
	correct_answer?: number | number[] | null;
}

interface Question {
	id: number;
	serial_number: number | null;
	question_text: string;
	question_type: string;
	points: number | null;
	options: QuestionOptions | null;
}

interface UserQuizAnswer {
	id: number;
	question_id: number;
	answer_data: AnswerData | null;
	time_taken_seconds: number | null;
	question: Question | null;
}

export type ResultStatus = "loading" | "ready" | "error" | "preview";

interface ThankYouComponentProps {
	userQuizAnswersData: UserQuizAnswer[];
	userScore: string;
	total_score: string;
	totalQuestions?: number;
	quizTitle?: string;
	status?: ResultStatus;
}

// Mirrors the server's scoring (QuizAttemptController::completeAttempt).
const MULTIPLE = new Set(["quiz_multiple_choice", "fill_in_the_blanks_multiple_choice"]);
const TYPED = new Set(["sort_answer_choice", "sort_answer", "short_answer_choice", "short_answer"]);

function toIndexes(value: unknown): number[] {
	const parts = Array.isArray(value) ? value : `${value ?? ""}`.split(",");
	return [...new Set(parts.map((part) => `${part}`.trim()).filter((part) => /^\d+$/.test(part)).map(Number))].sort(
		(a, b) => a - b
	);
}

interface Review {
	question: Question;
	number: number;
	choices: (string | null)[];
	picked: number[];
	correct: number[];
	typed: string;
	accepted: string[];
	isTyped: boolean;
	isMultiple: boolean;
	isCorrect: boolean;
	points: number;
	seconds: number | null;
}

function review(answer: UserQuizAnswer, number: number): Review | null {
	const question = answer.question;
	if (!question) return null;
	const choices = question.options?.choices ?? [];
	const correct = toIndexes(question.options?.correct_answer);
	const selected = answer.answer_data?.selected_option ?? null;
	const isTyped = TYPED.has(question.question_type);
	const accepted = correct.map((index) => choices[index]).filter((choice): choice is string => !!choice?.trim());
	const typed = isTyped ? `${selected ?? ""}`.trim() : "";
	const picked = isTyped ? [] : toIndexes(selected);

	let isCorrect: boolean;
	if (isTyped) {
		const parts = typed.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
		const ok = accepted.map((choice) => choice.trim().toLowerCase());
		isCorrect = parts.length > 0 && parts.every((part) => ok.includes(part));
	} else if (MULTIPLE.has(question.question_type)) {
		isCorrect = picked.length > 0 && picked.join(",") === correct.join(",");
	} else {
		isCorrect = picked.length === 1 && correct.length > 0 && picked[0] === correct[0];
	}

	return {
		question,
		number,
		choices,
		picked,
		correct,
		typed,
		accepted,
		isTyped,
		isMultiple: MULTIPLE.has(question.question_type),
		isCorrect,
		points: isCorrect ? question.points ?? 0 : 0,
		seconds: answer.time_taken_seconds ?? null,
	};
}

function headline(percent: number): { title: string; subtitle: string } {
	if (percent >= 80) return { title: "Excellent work!", subtitle: "You really know your stuff." };
	if (percent >= 50) return { title: "Nice job!", subtitle: "A solid result. Review your answers below." };
	return { title: "Thanks for playing!", subtitle: "Check the answers below and try again next time." };
}

function ScoreRing({ percent }: { percent: number }) {
	const radius = 52;
	const circumference = 2 * Math.PI * radius;
	return (
		<div className="relative h-[140px] w-[140px]">
			<svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
				<circle cx="60" cy="60" r={radius} fill="none" stroke="#f1f1f1" strokeWidth="12" />
				<circle
					cx="60"
					cy="60"
					r={radius}
					fill="none"
					stroke="#F79945"
					strokeWidth="12"
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={circumference * (1 - percent / 100)}
					style={{ transition: "stroke-dashoffset 1s ease-out" }}
				/>
			</svg>
			<div className="absolute inset-0 flex flex-col items-center justify-center">
				<span className="text-3xl font-bold text-[#222]">{percent}%</span>
				<span className="text-xs text-[#888]">score</span>
			</div>
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-xl bg-[#f8f8f8] px-4 py-3 text-center">
			<div className="text-lg font-bold text-[#222]">{value}</div>
			<div className="text-xs text-[#777]">{label}</div>
		</div>
	);
}

function QuestionReview({ item }: { item: Review }) {
	const { question } = item;
	return (
		<li className="rounded-xl border border-[#eee] bg-white p-4 text-left sm:p-5">
			<div className="flex items-start gap-3">
				<span
					className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white ${
						item.isCorrect ? "bg-green-600" : "bg-red-500"
					}`}
					aria-label={item.isCorrect ? "Correct" : "Incorrect"}
				>
					{item.isCorrect ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<span className="text-xs font-semibold uppercase tracking-wide text-[#999]">Question {item.number}</span>
						<span className={`text-sm font-semibold ${item.isCorrect ? "text-green-700" : "text-[#999]"}`}>
							{item.isCorrect ? `+${item.points} ${item.points === 1 ? "point" : "points"}` : "0 points"}
						</span>
					</div>
					<h3
						className="mt-1 break-words font-semibold text-[#222]"
						dangerouslySetInnerHTML={{ __html: question.question_text }}
					/>

					{item.isTyped ? (
						<div className="mt-3 space-y-2 text-sm">
							<div className={`rounded-lg px-3 py-2 ${item.isCorrect ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
								<span className="font-medium">Your answer: </span>
								{item.typed || <em>no answer</em>}
							</div>
							{!item.isCorrect && item.accepted.length > 0 && (
								<div className="rounded-lg bg-[#f8f8f8] px-3 py-2 text-[#333]">
									<span className="font-medium">Correct answer{item.accepted.length > 1 ? "s" : ""}: </span>
									{item.accepted.join(", ")}
								</div>
							)}
						</div>
					) : (
						<ul className="mt-3 space-y-2">
							{item.choices.map((choice, index) => {
								if (!choice) return null;
								const picked = item.picked.includes(index);
								const correct = item.correct.includes(index);
								return (
									<li
										key={index}
										className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
											correct
												? "border-green-300 bg-green-50 text-green-900"
												: picked
													? "border-red-300 bg-red-50 text-red-900"
													: "border-[#eee] text-[#444]"
										}`}
									>
										<span className="flex-1 break-words">{choice}</span>
										{picked && (
											<span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-[#555] shadow-sm">
												Your answer
											</span>
										)}
										{correct ? (
											<Check className="h-4 w-4 flex-shrink-0 text-green-600" aria-label="Correct answer" />
										) : picked ? (
											<X className="h-4 w-4 flex-shrink-0 text-red-500" aria-label="Wrong answer" />
										) : null}
									</li>
								);
							})}
						</ul>
					)}

					{item.isMultiple && !item.isCorrect && item.picked.length > 0 && (
						<p className="mt-2 text-xs text-[#888]">
							To score, pick every correct answer and nothing else.
						</p>
					)}

					{item.seconds !== null && item.seconds > 0 && (
						<p className="mt-2 flex items-center gap-1 text-xs text-[#999]">
							<Clock className="h-3 w-3" aria-hidden /> Answered in {item.seconds}s
						</p>
					)}
				</div>
			</div>
		</li>
	);
}

const ThankYouComponent: React.FC<ThankYouComponentProps> = ({
	userQuizAnswersData,
	userScore,
	total_score,
	totalQuestions,
	quizTitle,
	status = "ready",
}) => {
	const pdfRef = useRef<HTMLDivElement>(null);
	const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

	const reviews = useMemo(
		() =>
			[...(userQuizAnswersData ?? [])]
				.sort((a, b) => (a.question?.serial_number ?? 0) - (b.question?.serial_number ?? 0))
				.map((answer, index) => review(answer, index + 1))
				.filter((item): item is Review => item !== null),
		[userQuizAnswersData]
	);

	const score = Number(userScore) || 0;
	const total = Number(total_score) || 0;
	const percent = total > 0 ? Math.round((score / total) * 100) : 0;
	const questionCount = Math.max(totalQuestions ?? 0, reviews.length);
	const correctCount = reviews.filter((item) => item.isCorrect).length;
	const { title, subtitle } = headline(percent);

	const downloadPDF = async () => {
		if (!pdfRef.current) return;
		setIsGeneratingPDF(true);
		try {
			const canvas = await html2canvas(pdfRef.current, { scale: 2, useCORS: true, scrollY: -window.scrollY });
			const imgData = canvas.toDataURL("image/png");
			const pdf = new jsPDF("p", "mm", "a4");
			const pdfWidth = pdf.internal.pageSize.getWidth();
			const pdfHeight = pdf.internal.pageSize.getHeight();
			const imgHeight = (canvas.height * pdfWidth) / canvas.width;
			let heightLeft = imgHeight;
			let position = 0;
			pdf.addImage(imgData, "PNG", 0, position, pdfWidth, imgHeight);
			heightLeft -= pdfHeight;
			while (heightLeft > 0) {
				position -= pdfHeight;
				pdf.addPage();
				pdf.addImage(imgData, "PNG", 0, position, pdfWidth, imgHeight);
				heightLeft -= pdfHeight;
			}
			pdf.save(`${(quizTitle || "quiz").replace(/[^\w-]+/g, "_").slice(0, 60)}_result.pdf`);
		} catch (error) {
			console.error("PDF generation failed:", error);
		} finally {
			setIsGeneratingPDF(false);
		}
	};

	const shell = (children: React.ReactNode) => (
		<div className="flex min-h-screen w-full items-start justify-center px-4 py-8 sm:py-12">
			<div className="w-full max-w-[760px]">
				<div className="mb-6 flex justify-center">
					<Image src="/images/logo/logo.svg" alt="MindSpear" width={180} height={32} priority />
				</div>
				{children}
			</div>
		</div>
	);

	if (status === "preview") {
		return shell(
			<div className="rounded-2xl bg-white p-8 text-center shadow-xl">
				<div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#fff3e8]">
					<Eye className="h-8 w-8 text-primary" aria-hidden />
				</div>
				<h1 className="mt-4 text-2xl font-bold text-[#222]">End of the preview</h1>
				<p className="mx-auto mt-2 max-w-[420px] text-sm text-[#666]">
					This is where your players see their score and the correct answers. Answers given in a
					preview aren&apos;t saved.
				</p>
				<button
					type="button"
					onClick={() => (window.history.length > 1 ? window.history.back() : window.close())}
					className="mt-6 rounded-lg bg-primary px-5 py-2.5 font-semibold text-white transition hover:opacity-90"
				>
					Back to the editor
				</button>
			</div>
		);
	}

	if (status === "loading") {
		return shell(
			<div className="rounded-2xl bg-white p-10 text-center shadow-xl" aria-busy="true">
				<span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
				<h1 className="mt-5 text-xl font-bold text-[#222]">Calculating your score…</h1>
				<p className="mt-1 text-sm text-[#666]">Your answers have been submitted.</p>
			</div>
		);
	}

	if (status === "error") {
		return shell(
			<div className="rounded-2xl bg-white p-8 text-center shadow-xl">
				<h1 className="text-2xl font-bold text-[#222]">Thanks for taking the quiz!</h1>
				<p className="mx-auto mt-2 max-w-[440px] text-sm text-[#666]">
					Your answers were submitted, but we couldn&apos;t load your result right now. The quiz host
					can still see your score.
				</p>
			</div>
		);
	}

	return shell(
		<>
			<div ref={pdfRef} className="space-y-6 rounded-2xl bg-white p-5 shadow-xl sm:p-8">
				<div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
					<ScoreRing percent={percent} />
					<div className="flex-1">
						<p className="flex items-center justify-center gap-1 text-xs font-semibold uppercase tracking-wide text-primary sm:justify-start">
							<Trophy className="h-4 w-4" aria-hidden /> Quiz complete
						</p>
						<h1 className="mt-1 text-2xl font-bold text-[#222] sm:text-3xl">{title}</h1>
						{quizTitle && <p className="mt-1 text-sm font-medium text-[#555]">{quizTitle}</p>}
						<p className="mt-1 text-sm text-[#777]">{subtitle}</p>
					</div>
				</div>

				<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<Stat label="Points" value={`${score} / ${total}`} />
					<Stat label="Correct answers" value={`${correctCount} of ${questionCount}`} />
					<Stat label="Answered" value={`${reviews.length} of ${questionCount}`} />
				</div>

				{reviews.length > 0 ? (
					<section>
						<h2 className="mb-3 text-lg font-bold text-[#222]">Your answers</h2>
						<ul className="space-y-3">
							{reviews.map((item) => (
								<QuestionReview key={item.question.id} item={item} />
							))}
						</ul>
						{questionCount > reviews.length && (
							<p className="mt-3 text-center text-sm text-[#888]">
								{questionCount - reviews.length} question{questionCount - reviews.length === 1 ? " was" : "s were"} not
								answered before the time ran out.
							</p>
						)}
					</section>
				) : (
					<p className="rounded-xl bg-[#f8f8f8] p-4 text-center text-sm text-[#666]">
						No answers were recorded for this attempt.
					</p>
				)}
			</div>

			<div className="mt-5 flex justify-center">
				<button
					type="button"
					onClick={downloadPDF}
					disabled={isGeneratingPDF}
					className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 font-semibold text-[#333] shadow-md transition hover:bg-[#fafafa] disabled:cursor-wait disabled:opacity-60"
				>
					<Download className="h-4 w-4" aria-hidden />
					{isGeneratingPDF ? "Preparing PDF…" : "Download result as PDF"}
				</button>
			</div>
		</>
	);
};

export default ThankYouComponent;
