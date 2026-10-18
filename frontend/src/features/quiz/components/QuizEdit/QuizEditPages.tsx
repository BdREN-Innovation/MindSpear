"use client";
import React, { useEffect, useState } from "react";
import { ApiQuestion, Quiz } from "@/types/types";
import Image from "next/image";
import { FaEye } from "react-icons/fa6";
import HostLater from "../QuizPublic/HostLater";
import HostLive from "../QuizPublic/HostLive";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useParams } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
// import { useSelector } from "react-redux";

import ConfirmDialog from "@/utils/showConfirmDialog";
import { transformQuestionData } from "@/utils/quizUtils";
import {
	setMultipleSelectedItems,
	setSelectedItem,
} from "@/features/quiz/store/quizItems/quizSlice";
import { useDispatch } from "react-redux";
import { Pencil, Trash2 } from "lucide-react";
import { MdOutlinePublic, MdQuiz } from "react-icons/md";
import Questions from "@/features/quiz/components/QuizReports/Questions";
import { clearQuestData } from "@/features/quest/store/questQuestionTimeSlice";
import QuizQuestionsResultView from "@/components/ResultComponent/QuizQuestionsResultView";
import GlobalPagination from "@/components/GlobalPagination";
import { toast } from "react-toastify";
// import { connectSocket } from "@/features/live/services/realtimeBridge";
// import { connectSocket, disconnectSocket, getSocket } from "@/features/live/services/realtimeBridge";

interface QuizCreatorPreviewProps {
	quizInformation: ApiQuestion[];
}

interface QuizState {
	quiz: Quiz;
}
// interface RootState {
// 	quizInformation: {
// 		quizInformation: QuizState;
// 	};
// }

const QuizEditPages: React.FC<QuizCreatorPreviewProps> = () => {
	const params = useParams();
	const router = useRouter();
	const dispatch = useDispatch();

	const [questResultList, setQuestResultList] = useState([]);
	const [currentPage, setCurrentPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [pageSize, setPageSize] = useState(12);
	// const params = useParams();
	// const responseData = useSelector(
	// 	(state: RootState) => state.quizInformation.quizInformation
	// );
	// const [connected, setConnected] = useState(false);
	const [quinInformationData, setQuizInformationData] =
		useState<QuizState | null>(null);

	console.log(setQuestResultList, setTotal);

	useEffect(() => {
		if (typeof window === "undefined") return;
		localStorage.removeItem("quest.session");
		localStorage.removeItem("userTimeSet");
	}, []);

	useEffect(() => {
		clearQuestData();
		const quizFetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quiz-leaderboard/session-list/${params?.id}?page=${currentPage}&per_page=${pageSize}`,
				);
				console.log(
					response?.data?.data,
					"response?.data?.dataresponse?.data?.data",
				);

				setQuestResultList(response?.data?.data?.quizSessions?.data);
				setTotal(response?.data?.data?.quizSessions?.total || 0);
				// console.log(response?.data?.data, "response?.data?.data");
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;

				if (axiosError.response) {
					console.error(
						"Error verifying token:",
						axiosError.response.data,
					);
					toast.error(
						`Error: ${
							axiosError.response.data?.message ||
							"Verification failed."
						}`,
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
		// leaderboardState

		const quizFetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quizes/show/${params?.id}`,
				);
				setQuizInformationData(response?.data?.data);
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;

				if (axiosError.response) {
					console.error(
						"Error verifying token:",
						axiosError.response.data,
					);
					toast.error(
						`Error: ${
							axiosError.response.data?.message ||
							"Verification failed."
						}`,
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
		localStorage.removeItem(`leaderboardState`);
	}, []);

	const quizeDetails = async () => {
		try {
			const response = await axiosInstance.get(
				`/quiz/questions?quiz_id=${params?.id}&&per_page=40`,
			);
			const transformedData = transformQuestionData(
				response.data?.data?.questions.data,
			);

			dispatch(setMultipleSelectedItems(transformedData));
			dispatch(
				setSelectedItem({
					key:
						transformedData.length > 0
							? transformedData[0].key
							: "Untitled question",
					id: transformedData.length > 0 ? transformedData[0].id : "",
					title:
						transformedData.length > 0
							? transformedData[0].title
							: "",
					options: [],
					maxOptions: 0,
					minOptions: 0,
					allowDuplicates: false,
					isMultipleSelection: false,
					timeLimit: "",
					points:
						transformedData.length > 0
							? transformedData[0].points
							: "",
				}),
			);
			router.push(`/quiz-edit/${params?.id}`);
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data,
				);
				toast.error(
					`Error: ${
						axiosError.response.data?.message ||
						"Verification failed."
					}`,
				);
			} else {
				console.error("Unexpected error:", axiosError);
				console.error("Unexpected error:", axiosError.message);
				toast.error("Unexpected error occurred. Please try again.");
			}
		} finally {
		}
	};

	// Quiz Remove
	const quizeRemove = async () => {
		await ConfirmDialog.show(
			{
				title: "Are you sure you want to delete this quiz?",
				text: "This action cannot be undone.",
				confirmButtonText: "Yes, delete it!",
			},
			async () => {
				try {
					const response = await axiosInstance.delete(
						`/quizes/delete/${params?.id}`,
					);
					router.push(`/my-library/quiz-page`);
					console.log(response, "transformedData");
				} catch (error) {
					const axiosError = error as AxiosError<{
						message?: string;
					}>;

					if (axiosError.response) {
						console.error(
							"Error verifying token:",
							axiosError.response.data,
						);
						toast.error(
							`Error: ${
								axiosError.response.data?.message ||
								"Verification failed."
							}`,
						);
					} else {
						console.error("Unexpected error:", axiosError.message);
						toast.error(
							"Unexpected error occurred. Please try again.",
						);
					}
				} finally {
				}
			},
		);
	};

	const handlePaginationChange = (page: number, newPageSize?: number) => {
		setCurrentPage(page);
		if (newPageSize) {
			setPageSize(newPageSize);
		}
		// Fetch data with new page and pageSize
	};

	return (
		<div className="h-screen overflow-auto scrollbar-hidden">
			<div className="grid grid-cols-1 md:grid-cols-12 gap-5 mt-[20px]">
				<div className="md:col-span-8  bg-[#fff] rounded-md border border-[#2222] ">
					<div className="flex flex-col md:flex-row justify-between h-full ">
						<div className=" flex  justify-between w-full">
							<div className="p-4 flex flex-col ">
								<div className="flex gap-3 items-center mb-[50px]">
									<Image
										src="/images/placeholder.jpg"
										alt="quest"
										width={50}
										height={50}
										className="text-[#f79a46] border border-[#2222] rounded-[10px] transition-colors duration-500 ease-in-out group-hover:text-white"
									/>
									<h3 className="text-[20px] flex flex-col font-bold text-[#2a3547]">
										{quinInformationData?.quiz?.title}
										<span className="text-[12px] text-[#858585] ">
											<span>
												{" "}
												Start Date :{" "}
												{
													quinInformationData?.quiz
														?.open_datetime_local
												}{" "}
											</span>
											<span>
												{" "}
												End Date :{" "}
												{
													quinInformationData?.quiz
														?.close_datetime_local
												}{" "}
											</span>
										</span>
									</h3>
								</div>

								<div className="self-start mt-auto ">
									<div className="flex gap-8">
										<div className="flex items-center">
											<div className="w-[40px] h-[40px] bg-[rgb(247,153,69)] text-[#fff] rounded-[5px] flex justify-center items-center mr-[10px] shadow-2">
												<MdQuiz className="text-[18px]" />
											</div>
											<div className="">
												<h3 className="text-[18px] text-[#2a3547] font-bold">
													{quinInformationData?.quiz
														.questions
														? quinInformationData
																?.quiz.questions
																?.length
														: "0"}
												</h3>
												<p className="text-[#2a3547]">
													Total Questions
												</p>
											</div>
										</div>

										<div className="flex items-center">
											<div className="w-[40px] h-[40px] bg-primary text-[#fff] rounded-[5px] flex justify-center items-center mr-[10px] shadow-2">
												<MdOutlinePublic className="text-[18px]" />
											</div>
											<div className="">
												<h3 className="text-[18px] text-[#2a3547] font-bold capitalize">
													{
														quinInformationData
															?.quiz.visibility
													}
												</h3>
												<p className="text-[#2a3547]">
													Quiz Visibility
												</p>
											</div>
										</div>
									</div>
								</div>
							</div>

							<div className="self-end mt-auto ">
								<Image
									src="/images/welcome-bg.svg"
									alt="quest"
									width={400}
									height={80}
									className="text-[#f79a46] transition-colors duration-500 ease-in-out group-hover:text-white"
								/>
							</div>
						</div>
					</div>
				</div>

				<div className="md:col-span-4  bg-[#fff] rounded-md ">
					<div className="">
						<div className="flex items-center gap-3 mb-[20px] ">
							<button
								className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white text-sm font-medium py-4 w-full transition"
								onClick={() => quizeDetails()}
							>
								<Pencil className="w-4 h-4" />
								Edit{" "}
							</button>
							<button
								className="inline-flex items-center justify-center gap-2 rounded-md bg-red text-white hover:bg-primary-dark text-sm font-medium py-4 w-full transition"
								onClick={quizeRemove}
							>
								<Trash2 className="w-4 h-4" />
								Delete
							</button>
						</div>

						<Link
							href={`/attempt/play/${quinInformationData?.quiz?.join_code}?jid=${quinInformationData?.quiz?.join_link}&id=${quinInformationData?.quiz?.id}&preview=true`}
						>
							<div className="hidden cursor-pointer items-center gap-4 bg-[#f2f1f0] shadow-1 p-3 rounded-md mb-[15px]">
								<FaEye className="text-[30px]" />
								<div className=" flex flex-col ">
									<h5 className="text-[17px] font-bold">
										{" "}
										Preview{" "}
									</h5>
									<p className="text-[#858585]">
										{" "}
										Launch a trial session for this
										MindSpear{" "}
									</p>
								</div>
							</div>
						</Link>

						<HostLater />
						<div className="mt-[15px]">
							<HostLive />
						</div>
					</div>
				</div>
			</div>

			<div className=" border border-gray-200  rounded-xl mt-[20px]">
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
			<div className="shadow-3 border border-[#2222] rounded-[10px] mt-[20px]">
				<Questions />
			</div>
		</div>
	);
};

export default QuizEditPages;
