/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useEffect, useState } from "react";

import Summary from "@/features/quest/components/QuestReports/Summary";
import Participants from "@/features/quest/components/QuestReports/Participants";
// import Questions from "@/features/quest/components/QuestReports/Questions";
import moment from "@/lib/dayjs";
import { useParams } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { useDispatch } from "react-redux";
import { AxiosError } from "axios";
import { setQuest } from "@/features/quest/store/questInformationSlice";

const TABS = ["Summary", "Participants", "Questions"] as const;
type TabType = (typeof TABS)[number];


function QuizReport() {
	const params = useParams();
	const dispatch = useDispatch();
	const [response, setresponse] = useState<any | null>(null);
	const [activeTab, setActiveTab] = useState<TabType>("Summary");
	const [participantsData, setParticipantsData] = useState([]);

	const start = moment.utc(response?.open_datetime).startOf("day");
	const end = moment.utc(response?.close_datetime).startOf("day");
	const daysLeft = end.diff(start, "days");

	useEffect(() => {
		const dataFetch = async () => {
			const responseData = await axiosInstance.get(
				`/quests/show/${params?.id}`
			);
			setresponse(responseData?.data?.data?.quest);
			dispatch(setQuest(responseData?.data?.data?.quest));
		};
		dataFetch();
	}, [params?.id]);

	console.log(response, "responseresponseresponseresponseresponse");


	useEffect(() => {
		const datafetch = async () => {
			try {
				const response = await axiosInstance.get(`/quiz-participants`);
				setParticipantsData(
					response?.data?.data?.quiz_participants?.data
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
	}, []);

	const renderTabContent = () => {
		switch (activeTab) {
			case "Summary":
				return <Summary participantsNumber={participantsData.length} />;
			case "Participants":
				return <Participants dataList={participantsData} />;
			// case "Questions":
			// 	return <Questions />;
			default:
				return null;
		}
	};

	return (
		<div className="h-screen overflow-auto scrollbar-hidden">
			<div className="grid grid-cols-1 md:grid-cols-12 gap-5 ">
				<div className="md:col-span-8 p-4 bg-[#fff] rounded-[8px] border h-[200px]">
					<h3 className="text-[2rem] text-[#222] font-bold">
						{" "}
						{response?.title}{" "}
					</h3>
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
						Hosted by {response?.user?.full_name}
					</h4>
				</div>

				<div className="md:col-span-12 p-4 bg-[#fff] rounded-[8px] border shadow-3">
					<div className=" ">
						<div className="flex gap-3 mb-12 mt-[-92px]">
							{TABS.map((tab) => (
								<button
									key={tab}
									className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors
                                    ${activeTab === tab
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
		</div>
	);
}

export default QuizReport;
