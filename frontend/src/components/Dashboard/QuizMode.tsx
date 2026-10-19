/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useState } from "react";
import { GiPodiumWinner } from "react-icons/gi";
import "./Leaderboard.css";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { useSearchParams, useParams } from "next/navigation";
import { cn } from "@/lib/utils";

interface LeaderboardProps {
	scope: "entire" | "slide";
	sessionData: any;
	/** The viewing player's attempt: their entry is marked "You" and summarised on top. */
	highlightParticipantId?: number | string | null;
}

const PLACES = ["First", "Second", "Third"];
const ordinal = (n: number) => {
	if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
	return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};
const points = (n: unknown) => `${Number(n) || 0} ${Number(n) === 1 ? "point" : "points"}`;
const shortPoints = (n: unknown) => `${Number(n) || 0} ${Number(n) === 1 ? "pt" : "pts"}`;
const nameOf = (item: any) => item?.user?.name || item?.anonymous_details?.name || "Unknown player";

const QuizMode: React.FC<LeaderboardProps> = ({ sessionData, highlightParticipantId }) => {
	const searchParams = useSearchParams();
	const params = useParams();
	const quiz_id = searchParams.get("qid");
	const sessionId = searchParams.get("sid");
	// The session id: the "sid" in the URL when there is one. A player's page has the join code
	// as its route id, which the leaderboard API can't use (it answered 500).
	const sectionId = sessionData || sessionId || (params.id === "quize" ? null : params.id);

	const [leaderboardData, setLeaderboardData] = useState<any[]>([]);
	const [sortingMode, setSortingMode] = useState<string>("quiz");
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!sectionId) return;

		const datafetch = async () => {
			setLoading(true);
			try {
				const response = await axiosInstance.get(
					`/quiz-leaderboard/session-answered-questions/${sectionId}`
				);
				setLeaderboardData(response?.data?.data?.participantScores ?? []);
				setSortingMode(response?.data?.data?.sorting_mode ?? "quiz");
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;
				console.error("Could not load the leaderboard:", axiosError.response?.data ?? axiosError.message);
			} finally {
				setLoading(false);
			}
		};
		datafetch();
	}, [quiz_id, sectionId]);

	// Quiz mode: players on the same points share a place (Bob and Cat on 1 point were "Second"
	// and "Third"). Game mode: ties go to the faster player, in the order the server sorted them.
	const ranked = useMemo(
		() =>
			leaderboardData.map((item: any, index: number) => ({
				...item,
				rank:
					sortingMode === "game"
						? index + 1
						: 1 + leaderboardData.filter((other: any) => Number(other?.total_score) > Number(item?.total_score)).length,
			})),
		[leaderboardData, sortingMode]
	);
	const isMe = (item: any) =>
		highlightParticipantId != null && String(item?.participant_id) === String(highlightParticipantId);
	const me = ranked.find(isMe);
	const topThree = ranked.slice(0, 3);

	if (!loading && ranked.length === 0) {
		return (
			<div className="mx-auto mt-8 max-w-xl rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-medium text-slate-500">
				No answers were recorded in this session.
			</div>
		);
	}

	const podium = (item: any, big = false) =>
		item && (
			<div
				className={cn(
					"b_ground w-full rounded-xl shadow-lg transition hover:scale-[1.02]",
					big ? "max-w-[220px] p-6 shadow-xl" : "max-w-[150px] p-5",
					isMe(item) && "ring-4 ring-[#faef70]"
				)}
			>
				<div className="flex flex-col items-center">
					<GiPodiumWinner className={cn("mb-2 text-white", big ? "text-[60px]" : "text-[48px]")} />
					<h6 className="text-sm font-bold text-[#faef70]">{PLACES[item.rank - 1] ?? ordinal(item.rank)}</h6>
					<p className="max-w-full truncate font-semibold text-white">
						{nameOf(item)}
						{isMe(item) && " (you)"}
					</p>
					<span className="text-sm text-[#d0d0e6]">{points(item?.total_score)}</span>
				</div>
			</div>
		);

	return (
		<div className="">
			{me && (
				<div className="mx-auto mt-6 max-w-6xl rounded-xl border border-primary/30 bg-primary/10 p-5 text-center">
					<p className="text-xs font-black uppercase tracking-wide text-primary">Your result</p>
					<p className="mt-1 text-2xl font-black text-slate-950">
						You placed {ordinal(me.rank)} of {ranked.length}
					</p>
					<p className="mt-1 text-sm font-semibold text-slate-600">
						{points(me.total_score)} · {me.correct_answers ?? 0} of {me.total_questions_answered ?? 0} answered correctly
					</p>
				</div>
			)}

			<div className="mx-auto mt-14 grid w-full max-w-6xl grid-cols-1 gap-6">
				{/* Podium: 3rd - 1st - 2nd */}
				<div className="grid w-full grid-cols-3 gap-4">
					<div className="flex justify-start">{podium(topThree[2])}</div>
					<div className="mt-[-35px] flex justify-center">{podium(topThree[0], true)}</div>
					<div className="flex justify-end">{podium(topThree[1])}</div>
				</div>

				<div className="scrollbar-hide max-h-[430px] w-full overflow-y-auto rounded-xl bg-white p-4 shadow-md sm:p-6">
					<ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
						{ranked.map((item: any, index: number) => {
							const displayEmail = item?.user?.email || item?.anonymous_details?.email;
							return (
								<li
									key={item?.participant_id ?? index}
									className={cn(
										"flex flex-col gap-3 rounded-xl border bg-white p-5 shadow-lg transition-all hover:shadow-xl",
										isMe(item) ? "border-primary ring-2 ring-primary/30" : "border-gray-100"
									)}
								>
									<div className="flex items-center justify-between gap-3">
										<h3 className="min-w-0 truncate text-lg font-semibold text-gray-800">
											<span className="mr-2 text-slate-400">#{item.rank}</span>
											{nameOf(item)}
											{isMe(item) && <span className="ml-1 text-sm text-primary">(you)</span>}
										</h3>
										<span className="flex-shrink-0 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-900 sm:text-sm">
											{shortPoints(item?.total_score)} · {item?.correct_answers}/{item?.total_questions_answered} correct
										</span>
									</div>
									{displayEmail && <p className="text-sm text-gray-500">{displayEmail}</p>}
								</li>
							);
						})}
					</ul>
				</div>
			</div>
		</div>
	);
};

export default QuizMode;
