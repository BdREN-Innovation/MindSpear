/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { Quiz } from "@/types/types";
import React, { useEffect, useRef, useState } from "react";

import Summary from "@/features/quiz/components/QuizReports/Summary";
import Participants from "@/features/quiz/components/QuizReports/Participants";
import Questions from "@/features/quiz/components/QuizReports/Questions";
import moment from "@/lib/dayjs";
import { useParams } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { setQuiz } from "@/features/quiz/store/quizInformationSlice";
import { useDispatch, useSelector } from "react-redux";
import { AxiosError } from "axios";
import { useDebounce } from "@/hooks/useDebounce";
import QuizQuestionsResultView from "@/components/ResultComponent/QuizQuestionsResultView";
import { clearQuestData } from "@/features/quest/store/questQuestionTimeSlice";
import GlobalPagination from "@/components/GlobalPagination";
import { toast } from "react-toastify";

const TABS = ["Summary", "Participants", "Questions"] as const;
type TabType = (typeof TABS)[number];

interface QuizResponse {
	quiz: Quiz;
}

function QuizReport() {
	const params = useParams();
	const dispatch = useDispatch();
	const [response, setresponse] = useState<QuizResponse | null>(null);
	const [activeTab, setActiveTab] = useState<TabType>("Summary");
	const [participantsData, setParticipantsData] = useState([]);

	const [titleInput, setTitleInput] = useState("");
	const [questResultList, setQuestResultList] = useState([]);

	const start = moment.utc(response?.quiz?.open_datetime).startOf("day");
	const end = moment.utc(response?.quiz?.close_datetime).startOf("day");
	const daysLeft = end.diff(start, "days");

	const [currentPage, setCurrentPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [pageSize, setPageSize] = useState(12);

	const questSession = useSelector(
		(state: any) => state.questSession.questSession
	);
	const debouncedTitle = useDebounce(titleInput, 2000);

	useEffect(() => {
		const dataFetch = async () => {
			const responseData = await axiosInstance.get(
				`/quizes/show/${params?.id}`
			);
			setresponse(responseData?.data?.data);
			dispatch(setQuiz(responseData?.data?.data));
		};
		dataFetch();
	}, [params?.id]);

	useEffect(() => {
		clearQuestData();
		const quizFetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quiz-leaderboard/session-list/${params?.id}?page=${currentPage}&per_page=${pageSize}`
				);
				console.log(
					response?.data?.data,
					"response?.data?.dataresponse?.data?.data"
				);

				setQuestResultList(response?.data?.data?.quizSessions?.data);
				setTotal(response?.data?.data?.quizSessions?.total || 0);
				// console.log(response?.data?.data, "response?.data?.data");
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;

				if (axiosError.response) {
					console.error(
						"Error verifying token:",
						axiosError.response.data
					);
					toast.error(
						`Error: ${
							axiosError.response.data?.message ||
							"Verification failed."
						}`
					);
				} else {
					console.error("Unexpected error:", axiosError);
					console.error("Unexpected error:", axiosError.message);
					toast.error("Unexpected error occurred. Please try again.");
				}
			} finally {
			}
		};
		quizFetch();
	}, [pageSize, currentPage]);

	useEffect(() => {
		if (questSession?.title) {
			setTitleInput(questSession.title);
		}
	}, [questSession?.title]);

	useEffect(() => {
		const datafetch = async () => {
			try {
				// This quiz's participants (the unfiltered list mixed in other quizzes').
				const response = await axiosInstance.get(`/quiz-participants?quiz_id=${params?.id}`);
				setParticipantsData(
					response?.data?.data?.quiz_participants?.data
				);
				console.log(
					response?.data?.data?.quiz_participants?.data,
					"responseresponseresponse"
				);
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;
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
	}, [params?.id]);

	const renderTabContent = () => {
		switch (activeTab) {
			case "Summary":
				return <Summary participantsNumber={participantsData.length} />;
			case "Participants":
				return <Participants dataList={participantsData} />;
			case "Questions":
				return <Questions />;
			default:
				return null;
		}
	};

	// const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
	// 		setTitleInput(e.target.value);
	// 		updateHostLiveSession()
	// 	};

	// Saved only after the host edits the name (loading the page used to save it back unchanged).
	const titleEdited = useRef(false);
	useEffect(() => {
		if (!titleEdited.current || debouncedTitle?.trim() === "") return;
		updateTitleApi(debouncedTitle);
	}, [debouncedTitle]);

	const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		titleEdited.current = true;
		setTitleInput(e.target.value);
	};

	const updateTitleApi = async (title: string) => {
		try {
			const payload = { title };
			const response = await axiosInstance.post(
				`/quizes/update-host-later/${questSession?.id}`,
				payload
			);
			//console.log("Update successful:", response.data);
		} catch (error) {
			console.error("Update failed:", error);
		}
	};

	const handlePaginationChange = (page: number, newPageSize?: number) => {
		setCurrentPage(page);
		if (newPageSize) {
			setPageSize(newPageSize);
		}
		// Fetch data with new page and pageSize
	};

	// const updateTitleApi = async (
	// 	e: React.ChangeEvent<HTMLInputElement>
	// ) => {
	// 	try {
	// 		const payload = {
	// 			title: titleInput,
	// 		};
	// 		setTitleInput(e.target.value);
	// 		const response = await axiosInstance.post(
	// 			`/quizes/update-host-later/${questSession?.id}`,
	// 			payload
	// 		);
	// 		//console.log("Update successful:", response.data);
	// 		return response.data;
	// 	} catch (error) {
	// 		console.error("Update failed:", error);
	// 		throw error;
	// 	}
	// };

	return (
		<div className="h-screen overflow-auto scrollbar-hidden">
			<div className="grid grid-cols-1 md:grid-cols-12 gap-5 ">
				<div className="md:col-span-8 p-4 bg-[#fff] rounded-[8px] border h-[200px]">
					<h3 className="text-[2rem] text-[#222] font-bold">
						{" "}
						{response?.quiz.title}{" "}
					</h3>

					<div className="space-y-4 mt-[10px]">
						<input
							type="text"
							value={titleInput}
							onChange={handleTitleChange}
							placeholder="Session title..."
							className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-primary disabled:bg-gray-100"
						/>
					</div>
				</div>
				<div className="md:col-span-4 p-4 bg-[#fff] rounded-[8px] border h-auto ">
					<h4 className="text-[#333333] border-[#2222] border-b-2 pb-[20px] text-[0.875rem]">
						Assigned MindSpear{" "}
						<span className="border border-[#fa9b47] p-2 rounded-[10px] font-bold text-[#fa9b47] ml-[5px]">
							{" "}
							Ends in {daysLeft} {Number(daysLeft) === 1 ? "day" : "days"}{" "}
						</span>
					</h4>
					<h4 className="text-[#333333] border-[#2222] border-b-2 pt-[10px] pb-[10px] text-[0.875rem]">
						Start date: {start.format("YYYY-MM-DD")}
					</h4>
					<h4 className="text-[#333333] border-[#2222] border-b-2 pt-[10px] pb-[10px] text-[0.875rem]">
						End date: {end.format("YYYY-MM-DD")}
					</h4>
					<h4 className="text-[#333333] pt-[6px] pb-[10px] text-[0.875rem]">
						Hosted by {response?.quiz.user.full_name}
					</h4>
				</div>

				<div className="md:col-span-12 p-4 bg-[#fff] rounded-[8px] border shadow-3">
					<div className=" ">
						<div className="flex gap-3 mb-12 mt-[-92px]">
							{TABS.map((tab) => (
								<button
									key={tab}
									className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors
                                    ${
										activeTab === tab
											? "bg-primary text-white border-primary"
											: "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
									}`}
									onClick={() => setActiveTab(tab)}
								>
									{tab}
								</button>
							))}
						</div>

						<div className="bg-white w-full">
							{renderTabContent()}
						</div>
					</div>
				</div>
			</div>

			<div className=" rounded-xl mt-[20px]">
				<QuizQuestionsResultView list={questResultList} />
				{total > pageSize ? (
					<div className="pb-4">
						<GlobalPagination
							current={currentPage}
							total={total}
							pageSize={pageSize}
							onChange={handlePaginationChange}
						/>
					</div>
				) : (
					""
				)}
			</div>
		</div>
	);
}

export default QuizReport;
