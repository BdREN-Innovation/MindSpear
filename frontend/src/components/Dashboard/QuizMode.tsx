/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from "react";
// import Image from "next/image";
import { GiPodiumWinner } from "react-icons/gi";
// import HeaderImages from "@/assets/leaderboardHeaderimages.png";
import "./Leaderboard.css";
// import { useSelector } from "react-redux";
// import { RootState } from "@/services/redux/store";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
// import { RootState } from "@/services/redux/store";
// import { selectAllAnswers  } from "@/services/redux/features/ledaerboardAnswersSlice";
import { useSearchParams, useParams } from "next/navigation";
interface LeaderboardProps {
	scope: "entire" | "slide";
	sessionData: any;
}

const QuizMode: React.FC<LeaderboardProps> = ({scope, sessionData}) => {

	const searchParams = useSearchParams();
	const params = useParams();
	const quiz_id = searchParams.get("qid");
	const sessionId = searchParams.get("sid");
	// The session id: the "sid" in the URL when there is one. A player's page has the join code
	// as its route id, which the leaderboard API can't use (it answered 500).
	const sectionId = sessionData || sessionId || (params.id === "quize" ? null : params.id);

	
	// const answers = useSelector((state: RootState) => state.answers);
	// const whole = useSelector((s:any) => s);

	const [leaderboardData, setLeaderboardData] = useState([]);
	// const [chalangeInformation, setChalangeInformation] = useState<any>({});

	// Mock data - replace with your actual leaderboard data

	useEffect(() => {
		if (!sectionId) return;

		// if (mode === "quize") {
		const datafetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quiz-leaderboard/session-answered-questions/${sectionId}`
				);
				console.log(response?.data?.data, "response?.data?.data?.leaderboardresponse?.data?.data?.leaderboard");
				

				setLeaderboardData(response?.data?.data?.participantScores);
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
		datafetch();
		// }
	}, [quiz_id, sectionId]);

	const topThree: any = leaderboardData.slice(0, 3);

	return (
		<div className="">
			{/* Header */}
			{/* <div className="max-w-6xl mx-auto">
				<div className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-6">
					<div className="text-center mb-9">
						<h3 className="text-4xl font-bold text-black leading-tight pt-2">
							{chalangeInformation?.title}
						</h3>
					</div>
				</div>
			</div> */}

			{/* Rankings */}
			<div className="grid grid-cols-1 md:grid-cols-1 gap-6 w-full mt-8 max-w-6xl mx-auto">
				{/* LEFT: Top Three */}
				<div className=" items-center gap-6">
					{/* Row with 3rd - 1st - 2nd */}
					<div className="grid grid-cols-3 gap-4 w-full">
						{/* THIRD - LEFT */}
						<div className="flex justify-start">
							{topThree[2] && (
								<div className="b_ground p-5 rounded-xl shadow-lg w-full max-w-[150px] hover:scale-[1.02] transition">
									<div className="flex flex-col items-center">
										<GiPodiumWinner className="text-[48px] text-white mb-2" />
										<h6 className="text-[#faef70] font-bold text-sm">
											Third
										</h6>
										<p className="text-white font-semibold truncate">
											{
												topThree[2]?.anonymous_details
													?.name
											}
										</p>
										<span className="text-[#d0d0e6] text-sm">
											{topThree[2]?.total_score} {Number(topThree[2]?.total_score) === 1 ? "point" : "points"}
										</span>
									</div>
								</div>
							)}
						</div>

						{/* FIRST - CENTER */}
						<div className="flex justify-center mt-[-35px]">
							{topThree[0] && (
								<div className="b_ground p-6 rounded-xl shadow-xl w-full max-w-[220px] hover:scale-[1.04] transition">
									<div className="flex flex-col items-center">
										<GiPodiumWinner className="text-[60px] text-white mb-2" />
										<h6 className="text-[#faef70] font-bold text-sm">
											First
										</h6>
										<p className="text-white font-semibold truncate">
											{
												topThree[0]?.anonymous_details
													?.name
											}
										</p>
										<span className="text-[#d0d0e6] text-sm">
											{topThree[0]?.total_score} {Number(topThree[0]?.total_score) === 1 ? "point" : "points"}
										</span>
									</div>
								</div>
							)}
						</div>

						{/* SECOND - RIGHT */}
						<div className="flex justify-end">
							{topThree[1] && (
								<div className="b_ground p-5 rounded-xl shadow-lg w-full max-w-[150px] hover:scale-[1.02] transition">
									<div className="flex flex-col items-center">
										<GiPodiumWinner className="text-[48px] text-white mb-2" />
										<h6 className="text-[#faef70] font-bold text-sm">
											Second
										</h6>
										<p className="text-white font-semibold truncate">
											{
												topThree[1]?.anonymous_details
													?.name
											}
										</p>
										<span className="text-[#d0d0e6] text-sm">
											{topThree[1]?.total_score} {Number(topThree[1]?.total_score) === 1 ? "point" : "points"}
										</span>
									</div>
								</div>
							)}
						</div>
					</div>
				</div>

				{/* RIGHT: Full Leaderboard List */}
				<div className="w-full bg-white rounded-xl shadow-md p-4 sm:p-6 max-h-[430px] overflow-y-auto scrollbar-hide">

					<ul className="grid grid-cols-1 md:grid-cols-3 gap-4">
  {leaderboardData.map((item: any, index) => {
    const displayName = item?.user?.name || item?.anonymous_details?.name;
    const displayEmail = item?.user?.email || item?.anonymous_details?.email;

    return (
      <li
        key={index}
        className="bg-white rounded-xl shadow-lg p-5 flex flex-col gap-3 hover:shadow-xl transition-all border border-gray-100"
      >
        {/* Name + Position */}
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg text-gray-800">
            {displayName || "Unknown User"}
          </h3>

          <span className="bg-blue-100 text-blue-900 px-3 py-1 rounded-full text-xs sm:text-sm font-bold">
											{item?.total_score} pts · {item?.correct_answers}/{item?.total_questions_answered} correct
										</span>
        </div>

        {/* Email */}
        {displayEmail && (
          <p className="text-sm text-gray-500">{displayEmail}</p>
        )}
      </li>
    );
  })}
</ul>


					{/* <ul className="grid grid-cols-1 md:grid-cols-3 gap-4">
						{leaderboardData.map((user: any, index) => (
							<li
								key={index}
								className="flex justify-between items-center py-3 px-[10px] rounded-[10px] shadow"
							>
								<span className="font-medium text-sm sm:text-base">
									{user?.anonymous_details?.name}
								</span>

								<div className="flex gap-2">
									<span className="bg-blue-100 text-blue-900 px-3 py-1 rounded-full text-xs sm:text-sm font-bold">
											{user?.total_score} pts · {user?.correct_answers}/{user?.total_questions_answered} correct
										</span>
								</div>
							</li>
						))}
					</ul> */}
				</div>
			</div>
		</div>
	);
};

export default QuizMode;
