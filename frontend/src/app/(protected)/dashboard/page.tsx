"use client";

import React, { useEffect } from "react";
import CreateQuiz from "@/features/quiz/components/CreateQuiz";
// Surveys and reports are switched off for now.
// import CreateSurvey from "@/features/survey/components/CreateSurvey";
import CreateQuest from "@/features/quest/components/CreateQuest";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/stores/store";
import { setMultipleSelectedItems } from "@/features/quiz/store/quizItems/quizSlice"
// import ReportDashboard from "@/features/dashboard/views/ReportDashboard";
import StatsOverview from "@/features/dashboard/views/StatsOverview";
// import ReportSlider from "@/features/dashboard/views/ReportSlider";

interface UserInfoState {
	id: number;
	full_name: string;
	email: string;
	profile_picture?: string | null;
}



export default function Dashboard() {
	const user = useSelector(
		(state: RootState) => state.auth.user
	) as UserInfoState | null;
	const dispatch = useDispatch();

	useEffect(() => {
		dispatch(setMultipleSelectedItems([]));
	}, []);



	return (
		<div className="min-h-screen pb-20 font-[family-name:var(--font-geist-sans)] dark:bg-dark flex flex-col gap-6 mx-4">
			<h3 className="text-[2.25rem] font-bold text-[#222] dark:text-white mb-2">
				Welcome, <span className="text-primary">{user?.full_name}</span>
				!
			</h3>

			{/* Section Title */}
			<h4 className="text-xl font-semibold text-[#222] dark:text-white max-w-6xl w-full">
				Quick Actions
			</h4>

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-full">
				<CreateQuiz />
				{/* <CreateSurvey /> */}
				<CreateQuest />
				{/* <ReportDashboard /> */}
				{/* <Reports /> */}
			</div>
			<div>
				<StatsOverview />
			</div>
		</div>
	);
}
