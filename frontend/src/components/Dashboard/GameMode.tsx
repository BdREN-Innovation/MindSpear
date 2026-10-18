/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from "react";
import Image from "next/image";
import HeaderImages from "@/assets/leaderboardHeaderimages.png";
import "./Leaderboard.css";
// import { useSelector } from "react-redux";
// import { RootState } from "@/services/redux/store";
import axiosInstance from "@/utils/axiosInstance";
// import { RootState } from "@/services/redux/store";
// import { selectAllAnswers  } from "@/services/redux/features/ledaerboardAnswersSlice";
import { useSearchParams } from "next/navigation";
import { useSelector } from "react-redux";
import { AxiosError } from "axios";
interface LeaderboardProps {
	scope: "entire" | "slide";
}

const GameMode: React.FC<LeaderboardProps> = () => {
	const currentQsentId = useSelector(
		(state: any) => state?.leaderboard?.currentQsentId
	);

	const searchParams = useSearchParams();
	// const params = useParams();
	// const mode = String((params as any)?.id ?? "").toLowerCase();
	const quiz_id = searchParams.get("qid");
	const session_id = searchParams.get("sid");
	// const answers = useSelector((state: RootState) => state.answers);
	// const whole = useSelector((s:any) => s);

	const [leaderboardData, setLeaderboardData] = useState<any>([]);
	const [leaderboardResultData, setLeaderboardResultData] = useState<any>([]);
	const [chalangeInformation, setChalangeInformation] = useState<any>({});
	console.log(setChalangeInformation);

	// Mock data - replace with your actual leaderboard data

	useEffect(() => {
		if (!currentQsentId) return; // If currentQsentId is not set, do nothing

		// Fetch leaderboard data when currentQsentId changes
		const datafetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quiz-leaderboard/session-question-answers/${session_id}/${currentQsentId}`
				);

				setLeaderboardData(response?.data?.data?.answers);
				// setChalangeInformation(response?.data?.data?.quiz);
				console.log(response);
			} catch (error) {
				console.log(error);
			}
		};

		const resultfetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quiz-leaderboard/session-answered-questions/${session_id}`
				);
				console.log(response?.data?.data, "response?.data?.data?.leaderboardresponse?.data?.data?.leaderboard");
				

				setLeaderboardResultData(response?.data?.data?.participantScores);
				// setChalangeInformation(response?.data?.data?.quiz);
				console.log(response);
			} catch (error) {
				const axiosError = error as AxiosError<{
					message?: string;
				}>;
				if (axiosError.response) {
					console.error(
						"Error verifying token:",
						axiosError.response.data
					);
				} else {
					console.error("Unexpected error:", axiosError.message);
				}
			}
		};

		resultfetch();
		datafetch();

	}, [currentQsentId, quiz_id]);

	const topThree = leaderboardData
		.sort((a: any, b: any) => b?.quiz_participant?.score - a?.quiz_participant?.score)
		.slice(0, 3);
	const resulttopThree = leaderboardResultData.slice(0, 3);


	return (
		<div className="w-full h-full flex flex-col px-4 sm:px-6 lg:px-8 py-4">
			{/* Header */}
			<div className="w-full">
				<div className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-4 md:gap-8 max-w-6xl mx-auto">
					<div className="text-center md:text-left">
						<h5 className="text-xl sm:text-2xl font-bold">
							Game Mode
						</h5>
						<h3 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-tight pt-[10px]">
							{chalangeInformation?.title}
						</h3>
					</div>

					<div className="flex justify-center md:justify-end">
						<Image
							src={HeaderImages}
							alt="Leaderboard header"
							priority
							className="h-auto w-full max-w-[260px] sm:max-w-[320px] md:max-w-[380px] object-contain"
							sizes="(max-width: 768px) 60vw, (max-width: 1024px) 35vw, 380px"
						/>
					</div>
				</div>
			</div>

			{/* Content */}
			<div className="w-full mt-6 max-w-6xl mx-auto">
				{/* Left: Top Ranks */}
				<div className="grid grid-cols-2 gap-4">
					<div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
						<div className="overflow-x-auto">
							<table className="w-full ">
								<thead className="bg-primary/5 border-b border-primary/10">
									<tr>
										<th className="px-6 py-4 text-left">
											<div className="flex items-center gap-2">
												Rank
											</div>
										</th>
										<th className="px-6 py-4 text-left">
											<div className="flex items-center gap-2">
												Name
											</div>
										</th>
										<th className="px-6 py-4 text-center">
											<div className="flex items-center gap-2 justify-center">
												Score
											</div>
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100">
									{topThree.map((user: any, i:any) => {
										// Determine rank based on total_score
										let rank = "Third"; // Default rank
										if (
											user.score ===
											topThree[0].score
										) {
											rank = "First";
										} else if (
											user.total_score ===
											topThree[1].score
										) {
											rank = "Second";
										}

										return (
											<tr
												key={i}
												className="hover:bg-primary/5 transition-colors"
											>
												<td className="px-6 py-4">
													<div className="flex items-center gap-4">
														<span className="text-[#fcd73a] text-sm sm:text-base font-bold">
															{rank}
														</span>
													</div>
												</td>
												<td className="px-6 py-4">
													<div className="min-w-0">
														<p className="font-semibold text-gray-900 truncate">
															{
																user?.quiz_participant?.anonymous_details?.name
															}
														</p>
													</div>
												</td>
												<td className="px-6 py-4 text-center">
													<div className="text-[#d0d0e6] text-sm font-bold">
														{user?.quiz_participant?.total_score &&
															`${user?.quiz_participant?.total_score} points`}
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</div>

					<div className="bg-white rounded-2xl border border-gray-200 ">
						<div className="overflow-x-auto">
							<table className="w-full ">
								<thead className="bg-primary/5 border-b border-primary/10">
									<tr>
										<th className="px-6 py-4 text-left">
											<div className="flex items-center gap-2">
												Rank
											</div>
										</th>
										<th className="px-6 py-4 text-left">
											<div className="flex items-center gap-2">
												Name
											</div>
										</th>
										<th className="px-6 py-4 text-center">
											<div className="flex items-center gap-2 justify-center">
												Score
											</div>
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100">
									{resulttopThree.map((user: any, i:any) => {
										// Determine rank based on total_score
										let rank = "Third"; // Default rank
										if (
											user.total_score ===
											topThree[0]?.total_score
										) {
											rank = "First";
										} else if (
											user.total_score ===
											topThree[1]?.total_score
										) {
											rank = "Second";
										}

										return (
											<tr
												key={i}
												className="hover:bg-primary/5 transition-colors"
											>
												<td className="px-6 py-4">
													<div className="flex items-center gap-4">
														<span className="text-[#fcd73a] text-sm sm:text-base font-bold">
															{rank}
														</span>
													</div>
												</td>
												<td className="px-6 py-4">
													<div className="min-w-0">
														<p className="font-semibold text-gray-900 truncate">
															{
																user
																	?.anonymous_details
																	?.name
															}
														</p>
													</div>
												</td>
												<td className="px-6 py-4 text-center">
													<div className="text-[#d0d0e6] text-sm font-bold">
														{user.total_score &&
															`${user.total_score} points`}
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default GameMode;
