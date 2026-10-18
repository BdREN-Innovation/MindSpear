"use client";

import React from "react";
import Image from "next/image";
import { ListPlus } from "lucide-react";
import { QUEST_QUESTION_TYPES, useAddQuestQuestion } from "@/features/quest/hooks/useAddQuestQuestion";

/** What the quest editor shows with no questions: pick a type to start. */
export default function QuestEmptyState({ questId }: { questId: string }) {
	const { addQuestion, adding } = useAddQuestQuestion(questId);

	return (
		<div className="flex h-[calc(90vh-80px)] items-center justify-center overflow-y-auto rounded-[10px] bg-white px-4 py-8">
			<div className="w-full max-w-[860px] text-center">
				<div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#fff3e8]">
					<ListPlus className="h-8 w-8 text-primary" aria-hidden />
				</div>
				<h2 className="mt-4 text-2xl font-bold text-[#222]">Add your first question</h2>
				<p className="mx-auto mt-2 max-w-[480px] text-sm text-[#666]">
					Pick a question type to get started. You can also use &ldquo;Add Question&rdquo; on the left at any
					time, including to generate questions from a document.
				</p>

				<div className="mt-8 grid grid-cols-1 gap-3 text-left sm:grid-cols-2 lg:grid-cols-3">
					{QUEST_QUESTION_TYPES.map((type) => (
						<button
							key={type.key}
							type="button"
							onClick={() => addQuestion(type.key)}
							disabled={adding !== null}
							className="group flex items-center gap-3 rounded-xl border border-[#e5e5e5] bg-white p-3 transition hover:border-primary hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70"
						>
							<span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-[#f7f7f7] group-hover:bg-[#fff3e8]">
								{adding === type.key ? (
									<span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
								) : (
									<Image src={type.icon} alt="" width={28} height={28} />
								)}
							</span>
							<span>
								<span className="flex items-center gap-2 text-sm font-semibold text-[#222]">
									{type.label}
									{type.key === "qsenchoice" && (
										<span className="rounded-full bg-[#fff3e8] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
											Most used
										</span>
									)}
								</span>
								<span className="block text-xs text-[#777]">{type.description}</span>
							</span>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
