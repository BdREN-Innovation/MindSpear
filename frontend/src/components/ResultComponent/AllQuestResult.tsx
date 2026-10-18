/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useState, useEffect } from "react";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import AllResultView from "@/components/ResultComponent/AllResultView";
import { toast } from "react-toastify";
import { useParams } from "next/navigation";

export type Submission = {
	id: number;
	participant_id: number | null;
	task_id: number;
	status: string;
	completed_at: string | null;
	completion_data: CompletionData;
	created_at: string;
	updated_at: string;
	task: Task;
};

type CompletionData = {
	start_time?: string;
	selected_option?: number | number[] | string[];
};

type Task = {
	id: number;
	quest_id: number;
	title: string;
	description: string | null;
	task_type:
		| "single_choice"
		| "multiple_choice"
		| "truefalse"
		| "fill_in_the_blanks_choice"
		| "sorting"
		| "scales"
		| "ranking"
		| "wordcloud"
		| "longanswer"
		| "shortanswer"
		| string;
	serial_number: number;
	task_data: TaskData;
	is_required: boolean;
	created_at: string;
	updated_at: string;
};

type TaskData = {
	questions: Question[];
	time_limit?: number;
	time_limit_seconds?: number;
};

type Question = { id: number; text: string; color?: string };

type AllQuestResultProps = {
	attemId?: number | string;
	className?: string;
};

// API Call Component
export default function AllQuestResult({ attemId, className }: AllQuestResultProps) {
	const params = useParams();
	const resolvedAttemptId = attemId ?? params?.sid;
	const [resultList, setResultList] = useState<any>([]);
	const [loading, setLoading] = useState<boolean>(false);
	const transformResponseData = (apiResponse: any) => {
		const { questSession, questTasks } = apiResponse;
		const transformedData: any = [];

		questTasks.forEach((task: any) => {
			if (task.task_type === "quick_form") {
				return;
			}
			const completion = {
				id: task?.id,
				participant_id: null,
				task_id: task?.id,
				status: "Completed",
				responses: task?.responses_count,
				completion_data: {
					start_time: questSession.start_datetime,
					selected_option: [],
				},
				created_at: task?.created_at,
				updated_at: task?.updated_at,
				task: {
					id: task?.id,
					quest_id: task?.quest_id,
					title: task?.title,
					description: task?.description,
					task_type: task?.task_type,
					serial_number: task?.serial_number,
					task_data: task?.task_data,
					is_required: task?.is_required,
					created_at: task?.created_at,
					updated_at: task?.updated_at,
				},
			};

			// Handle different task types
			switch (task?.task_type) {
				case "scales":
					// The average rating per statement ("count" is a percentage of the top value).
					completion.completion_data.selected_option = (task?.task_data?.questions ?? []).map(
						(_question: any, index: number) => Number(task?.optionsCount?.[index]?.average ?? 0)
					);
					break;

				case "single_choice":
				case "multiple_choice":
				case "truefalse":
				case "ranking":
				case "sorting":
					if (task?.optionsCount && task?.task_data?.questions) {
						const questionCount = task?.task_data.questions?.length;
						const selectedOptions: any =
							Array(questionCount).fill(0);

						Object.keys(task?.optionsCount).forEach((key) => {
							const index = Number(key); // ← no "- 1" so it's index-wise
							if (
								Number.isInteger(index) &&
								index >= 0 &&
								index < selectedOptions.length
							) {
								const count =
									task?.optionsCount[key]?.count ?? 0;
								selectedOptions[index] = count;
							}
						});
						completion.completion_data.selected_option =
							selectedOptions;
					}
					break;

				case "wordcloud":
				case "shortanswer":
				case "longanswer":
					if (task.completions && task.completions.length > 0) {
						const allSelectedOptions: any = [];

						task.completions.forEach((comp: any) => {
							if (comp.selected_option) {
								try {
									const parsed = JSON.parse(
										comp.selected_option
									);
									if (Array.isArray(parsed)) {
										allSelectedOptions.push(...parsed);
									} else {
										allSelectedOptions.push(parsed);
									}
								} catch (e) {
									allSelectedOptions.push(
										comp.selected_option
									);
								}
							}
						});

						completion.completion_data.selected_option =
							allSelectedOptions;
					}
					break;
				default:
					completion.completion_data.selected_option = [];
			}

			transformedData.push(completion);
		});

		return transformedData;
	};

	// Transform the data

	useEffect(() => {
		const dataFetch = async () => {
			setLoading(true);
			try {
				const response = await axiosInstance.get(
					`/quest-leaderboard/session-details-combined-score/${resolvedAttemptId}`
				);
				const transformedData = transformResponseData(
					response?.data?.data
				);
				setResultList(transformedData ?? []);
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;
				if (axiosError.response) {
					console.error("Fetch error:", axiosError.response.data);
					toast.error(
						`Error: ${
							axiosError.response.data?.message ||
							"Failed to fetch."
						}`
					);
				} else {
					console.error("Unexpected error:", axiosError.message);
					toast.error("Unexpected error occurred. Please try again.");
				}
			} finally {
				setLoading(false);
			}
		};

		if (resolvedAttemptId) dataFetch();
	}, [resolvedAttemptId]);

	return <AllResultView resultList={resultList} loading={loading} className={className} />;
}
