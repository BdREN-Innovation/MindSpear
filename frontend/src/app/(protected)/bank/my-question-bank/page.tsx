/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import MyQuestionBank from "@/features/dashboard/question-bank/components/QuestionBank/MyQuestionBank";

const TABS = [
	"My Question Bank",
	"Public Question Bank",
	"Categories",
] as const;
type TabType = (typeof TABS)[number];

export default function QuestionBankPage() {
	return (
		<div>
			<MyQuestionBank />
		</div>
	);
}

// <div className="min-h-screen p-4">
// 	<div className="w-full mx-auto">
// 		{/* Tabs */}
// 		<div className="flex gap-3 mb-6">
// 			{TABS.map((tab) => (
// 				<button
// 					key={tab}
// 					onClick={() => setActiveTab(tab)}
// 					className={`px-5 py-3 rounded-[10px] text-sm font-semibold border
// 						${activeTab === tab
// 							? "bg-primary text-white border-primary"
// 							: "bg-white dark:bg-dark-3 border-primary"
// 						}`}
// 				>
// 					{tab}
// 				</button>
// 			))}
// 		</div>

// 		{/* Tab Content */}
// 		{activeTab === "My Question Bank" && (
// 			<MyQuestionBank
// 			/>
// 		)}

// 		{activeTab === "Public Question Bank" && (
// 			<PublicQuestionBank />
// 		)}

// 		{activeTab === "Categories" && (
// 			<QuestionBankCategories
// 				categories={categories}
// 				loading={loading}
// 				onRefresh={fetchCategories}
// 			/>
// 		)}

// 	</div>
// </div>
