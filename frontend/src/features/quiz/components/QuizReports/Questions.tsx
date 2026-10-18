"use client";
import React, { useEffect, useState } from "react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/Table";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { PiWarningCircle } from "react-icons/pi";
import { useParams } from "next/navigation";
import { transformQuestionData } from "@/utils/quizUtils";
import { RiDeleteBin7Fill } from "react-icons/ri";
import Image from "next/image";
import ConfirmDialog from "@/utils/showConfirmDialog";
import { removeSelectedItem } from "@/features/quiz/store/quizItems/quizSlice";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";

type TransformedQuestionData = {
	key: string;
	id: string;
	title: string;
	options: {
		id: string;
		text: string;
		placeholder: string;
		color: string;
		isSelected: boolean;
	}[];
	maxOptions: number;
	minOptions: number;
	position: number;
	allowDuplicates: boolean;
	isMultipleSelection: boolean;
	timeLimit: string;
	quiz_id: string;
	source_content_url: string;
};

function Questions() {
	const [questionsData, setQuestionsData] = useState<
		TransformedQuestionData[]
	>([]);
	const dispatch = useDispatch();
	const params = useParams();

	const datafetch = async () => {
		try {
			const responselist = await axiosInstance.get(
				`/quizes/show/${params.id}`
			);
			const datalist = transformQuestionData(
				responselist?.data?.data?.quiz?.questions
			) as unknown as TransformedQuestionData[];
			setQuestionsData(datalist);
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
	useEffect(() => {
		if (params?.id) {
			datafetch();
		}
	}, [params?.id]);

	// console.log(questionsData, "questionsData questionsData");

	const questionsRemove = async (item: TransformedQuestionData) => {
		await ConfirmDialog.show(
			{
				title: "Are you sure you want to delete this questions?",
				text: "This action cannot be undone.",
				confirmButtonText: "Yes, delete it!",
			},
			async () => {
				try {
					const response = await axiosInstance.delete(
						`/quiz/questions/delete/${item?.id}`
					);
					datafetch();
					if (item) {
						dispatch(removeSelectedItem(item));
					}
					console.log(response, "transformedData");
				} catch (error) {
					const axiosError = error as AxiosError<{
						message?: string;
					}>;
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
						console.error("Unexpected error:", axiosError.message);
						toast.error(
							"Unexpected error occurred. Please try again."
						);
					}
				} finally {
				}
			}
		);
	};
	// console.log(questionsData, "questionsDataquestionsDataquestionsDataquestionsDataquestionsData");

	return (
		<div>
			{questionsData.length > 0 ? (
				<Table>
					<TableHeader>
						<TableRow className="border-none uppercase ">
							<TableHead className="min-w-[120px] !text-left">
								Images
							</TableHead>
							<TableHead className="min-w-[120px] !text-left">
								Questions
							</TableHead>
							<TableHead>Type</TableHead>
							<TableHead className="!text-right">
								Action
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{questionsData?.map((channel, i) => (
							<TableRow
								className=" text-base font-medium text-dark dark:text-white"
								key={i}
							>
								<TableCell>
									<Image
										// src="/images/placeholder.jpg"
										src={
											channel?.source_content_url !== ""
												? channel?.source_content_url
												: "/images/placeholder.jpg"
										}
										alt="quest"
										width={50}
										height={50}
										// Question images live on the API host (My Files), which next.config doesn't list.
										unoptimized
										className="text-[#f79a46] border border-[#2222] rounded-[10px] transition-colors duration-500 ease-in-out group-hover:text-white"
									/>
								</TableCell>
								<TableCell>{channel.title}</TableCell>
								<TableCell>
									{channel.key === "quiz" &&
									channel.isMultipleSelection === false
										? "Single Choice"
										: channel.key === "quiz" &&
										  channel.isMultipleSelection === true
										? "Multiple Choice"
										: channel.key === "truefalse"
										? "True False"
										: channel.key === "sortanswer"
										? "Short Answer"
										: channel.key === "fillintheblanks"
										? "Fill In The Blanks"
										: ""}
								</TableCell>

								<TableCell className="flex justify-end ">
									{" "}
									<div className="flex gap-3 cursor-pointer">
										{" "}
										<span
											className="w-[30px] h-[30px] bg-primary hover:bg-[#bc5eb3] flex justify-center items-center rounded-full"
											onClick={() =>
												questionsRemove(channel)
											}
										>
											{" "}
											<RiDeleteBin7Fill className="text-[#fff]" />{" "}
										</span>{" "}
									</div>{" "}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			) : (
				<div className="flex flex-col justify-center items-center py-[20px] ">
					<PiWarningCircle className="text-[40px] text-[#fda14d]" />
					<h3 className="font-bold text-[#333] pt-[5px]">
						{" "}
						No Data Available{" "}
					</h3>
				</div>
			)}
		</div>
	);
}

export default Questions;
