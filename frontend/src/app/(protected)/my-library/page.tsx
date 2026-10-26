"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import NewQuiz from "@/features/dashboard/components/Library/NewQuiz";
// Surveys are switched off for now.
// import NewSurvey from "@/features/dashboard/components/Library/NewSurvey";
import NewQuest from "@/features/dashboard/components/Library/NewQuest";

const TABS = ["Quiz", /* "Survey", */ "Quest"] as const;
type TabType = (typeof TABS)[number];

const TAB_MAPPING: Record<string, TabType> = {
	quiz: "Quiz",
	// survey: "Survey",
	quest: "Quest",
};

export default function MyLibraryPage() {
	const searchParams = useSearchParams();
	const [activeTab, setActiveTab] = useState<TabType>("Quiz");

	useEffect(() => {
		const tabParam = searchParams.get("tab");

		if (tabParam && TAB_MAPPING[tabParam]) {
			setActiveTab(TAB_MAPPING[tabParam]);
		} else {
			setActiveTab("Quiz");
		}
	}, [searchParams]);

	const renderTabContent = () => {
		switch (activeTab) {
			case "Quiz":
				return <NewQuiz />;
			// case "Survey":
			// 	return <NewSurvey />;
			case "Quest":
				return <NewQuest />;
			default:
				return null;
		}
	};

	return (
		<div className=" ms:mx-auto  p-4 min-h-screen w-full overflow-auto scrollbar-hidden">
			<div className="flex gap-3 mb-6">
				{TABS.map((tab) => (
					<button
						key={tab}
						className={`px-5 py-3 rounded-[10px] text-sm font-semibold border transition-colors
              ${activeTab === tab
								? "bg-primary text-white border-primary"
								: "bg-white dark:bg-dark-3 dark:text-white dark:border-gray-7 text-gray-700 border-primary hover:bg-gray-100"
							}`}
						onClick={() => setActiveTab(tab)}
					>
						{tab}
					</button>
				))}
			</div>

			<div className="bg-white dark:bg-transparent w-full">
				{renderTabContent()}
			</div>
		</div>
	);
}
