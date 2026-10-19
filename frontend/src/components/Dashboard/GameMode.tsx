/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useState } from "react";
import "./Leaderboard.css";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { useSearchParams } from "next/navigation";
import { useSelector } from "react-redux";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeaderboardProps {
	scope: "entire" | "slide";
}

const nameOf = (item: any) => item?.user?.name || item?.anonymous_details?.name || "Unknown player";
const pts = (n: unknown) => `${Number(n) || 0} ${Number(n) === 1 ? "pt" : "pts"}`;

/**
 * The game-mode leaderboard between questions: how everyone did on the question that just
 * ended, and the standings so far (ties go to the faster player, as the server sorts them).
 * It was two unlabelled tables of the same players, ranked from mismatched fields, so one
 * player could show as "First" with 0 points and "Third" with 4.
 */
const GameMode: React.FC<LeaderboardProps> = () => {
	const currentQsentId = useSelector((state: any) => state?.leaderboard?.currentQsentId);
	const searchParams = useSearchParams();
	const sessionId = searchParams.get("sid");
	const [scores, setScores] = useState<any[]>([]);

	useEffect(() => {
		if (!sessionId) return;
		const load = async () => {
			try {
				const response = await axiosInstance.get(`/quiz-leaderboard/session-answered-questions/${sessionId}`);
				setScores(response?.data?.data?.participantScores ?? []);
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;
				console.error("Could not load the leaderboard:", axiosError.response?.data ?? axiosError.message);
			}
		};
		load();
	}, [sessionId, currentQsentId]);

	// Everyone's answer to the question that just ended: right answers first, fastest first.
	const thisQuestion = useMemo(() => {
		if (!currentQsentId) return [];
		return scores
			.map((item: any) => {
				const answer = (item?.answered_questions ?? []).find(
					(a: any) => String(a?.question_id) === String(currentQsentId)
				);
				return answer ? { item, answer } : null;
			})
			.filter(Boolean)
			.sort(
				(a: any, b: any) =>
					Number(b.answer.is_correct) - Number(a.answer.is_correct) ||
					Number(a.answer.time_taken_seconds ?? 0) - Number(b.answer.time_taken_seconds ?? 0)
			) as { item: any; answer: any }[];
	}, [scores, currentQsentId]);

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-4 sm:px-6 lg:px-8">
			<div className="text-center">
				<h2 className="text-3xl font-black text-slate-950">Leaderboard</h2>
				<p className="mt-1 text-sm font-medium text-slate-500">Game mode · ties go to the faster player</p>
			</div>

			<div className="mt-6 grid gap-4 md:grid-cols-2">
				<section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
					<h3 className="mb-3 text-sm font-black uppercase tracking-wide text-primary">This question</h3>
					{thisQuestion.length === 0 ? (
						<p className="py-6 text-center text-sm font-medium text-slate-500">Nobody answered this question.</p>
					) : (
						<ul className="divide-y divide-gray-100">
							{thisQuestion.map(({ item, answer }) => (
								<li key={item.participant_id} className="flex items-center justify-between gap-3 py-3">
									<span className="flex min-w-0 items-center gap-2">
										<span
											className={cn(
												"grid h-6 w-6 shrink-0 place-items-center rounded-full text-white",
												answer.is_correct ? "bg-emerald-500" : "bg-rose-500"
											)}
										>
											{answer.is_correct ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
										</span>
										<span className="truncate font-semibold text-gray-900">{nameOf(item)}</span>
									</span>
									<span className="shrink-0 text-sm font-bold text-slate-500">
										{answer.is_correct ? `+${pts(answer.points_earned)}` : "0 pts"} · {Number(answer.time_taken_seconds) || 0}s
									</span>
								</li>
							))}
						</ul>
					)}
				</section>

				<section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
					<h3 className="mb-3 text-sm font-black uppercase tracking-wide text-secondary">Overall</h3>
					{scores.length === 0 ? (
						<p className="py-6 text-center text-sm font-medium text-slate-500">No answers yet.</p>
					) : (
						<ol className="divide-y divide-gray-100">
							{scores.slice(0, 10).map((item: any, index: number) => (
								<li key={item.participant_id ?? index} className="flex items-center justify-between gap-3 py-3">
									<span className="flex min-w-0 items-center gap-3">
										<span className={cn("w-7 shrink-0 font-black", index < 3 ? "text-[#e0a800]" : "text-slate-400")}>
											#{index + 1}
										</span>
										<span className="truncate font-semibold text-gray-900">{nameOf(item)}</span>
									</span>
									<span className="shrink-0 text-sm font-bold text-slate-700">{pts(item.total_score)}</span>
								</li>
							))}
						</ol>
					)}
				</section>
			</div>
		</div>
	);
};

export default GameMode;
