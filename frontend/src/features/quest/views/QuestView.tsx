"use client";
import React, { useEffect, useState } from "react";
import { ApiQuestion, Quiz } from "@/types/types";
import Image from "next/image";
import { FaEye } from "react-icons/fa6";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AxiosError } from "axios";

import ConfirmDialog from "@/utils/showConfirmDialog";
import {
	setMultipleSelectedItems,
	setSelectedItem,
} from "@/features/quiz/store/quizItems/quizSlice";
import { useDispatch } from "react-redux";
import { Calendar, Pencil, Trash2 } from "lucide-react";
import { MdLockOutline, MdOutlinePublic, MdQuiz } from "react-icons/md";
import Questions from "@/features/quest/components/QuestReports/Questions";
import HostLive from "@/features/quest/components/Quest/HostLive";
import { convertTaskData } from "@/utils/questDataTransformer";
import moment from "@/lib/dayjs";
import QuestionsResultView from "@/components/ResultComponent/QuestionsResultView";
import GlobalPagination from "@/components/GlobalPagination";
import { clearQuestData } from "@/features/quest/store/questQuestionTimeSlice";
import QuestDuplicate from "./QuestDuplicate";
import { setScope } from "@/features/live/store/leaderboardSlice";
import { toast } from "react-toastify";
import { deleteQuestById, getQuestById } from "@/features/quest/services/questService";

interface QuizCreatorPreviewProps {
	quizInformation: ApiQuestion[];
}

interface QuizState {
	quest: Quiz;
}

const QuestView: React.FC<QuizCreatorPreviewProps> = ({}) => {
	const { id } = useParams<{ id: string }>();
	const router = useRouter();
	const dispatch = useDispatch();

	const [quinInformationData, setQuizInformationData] =
		useState<QuizState | null>(null);
	const [questResultList, setQuestResultList] = useState([]);
	const [loading, setLoading] = useState(true);
	const [resultsLoading, setResultsLoading] = useState(true);

	const [currentPage, setCurrentPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [pageSize, setPageSize] = useState(12);

	// console.log(quinInformationData, "hello");

	useEffect(() => {
		dispatch(clearQuestData());
		dispatch(setScope("entire"));
		const quizFetch = async () => {
			try {
				setLoading(true);
				setResultsLoading(true);
				const response = await getQuestById(id);
				setQuizInformationData(response?.data?.data);

				setQuestResultList(
					response?.data?.data?.questSessions?.data || [],
				);
				setTotal(response?.data?.data?.questSessions?.total || 0);
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;

				if (axiosError.response) {
					console.error(
						"Error verifying token:",
						axiosError.response.data,
					);

					// Check if it's a 403 Forbidden error
					if (axiosError.response.status === 403) {
						toast.error(
							axiosError.response.data?.message ||
								"You are not allowed to access this quest.",
						);
						router.push("/my-library/quest-page");
						return;
					}

					toast.error(
						`Error: ${
							axiosError.response.data?.message ||
							"Verification failed."
						}`,
					);
				} else {
					console.error("Unexpected error:", axiosError);
				}
			} finally {
				setLoading(false);
				setResultsLoading(false);
			}
		};
		quizFetch();
	}, [dispatch, id, router]);

	const handleEditQuest = async () => {
		try {
			const response = await getQuestById(id);
			const transformedData = convertTaskData(
				response?.data?.data.quest?.tasks,
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
			router.push(`/quest/edit/${id}`);
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data,
				);

				// Check if it's a 403 Forbidden error
				if (axiosError.response.status === 403) {
					toast.error(
						axiosError.response.data?.message ||
							"You are not allowed to access this quest.",
					);
					router.push("/my-library/quest-page");
					return;
				}

				toast.error(
					`Error: ${
						axiosError.response.data?.message ||
						"Verification failed."
					}`,
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
			}
		} finally {
		}
	};

	// Quest Remove
	const handleDeleteQuest = async () => {
		await ConfirmDialog.show(
			{
				title: "Are you sure you want to delete this Quest?",
				text: "This action cannot be undone.",
				confirmButtonText: "Yes, delete it!",
			},
			async () => {
				try {
					const response = await deleteQuestById(id);
					toast.success("Quest deleted successfully.");
					router.push(`/my-library/quest-page`);
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

						// Check if it's a 403 Forbidden error
						if (axiosError.response.status === 403) {
							toast.error(
								axiosError.response.data?.message ||
									"You are not allowed to access this quest.",
							);
							router.push("/my-library/quest-page");
							return;
						}

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
	};

	// Skeleton loading components
	const QuestInfoSkeleton = () => (
		<div className="animate-pulse">
			<div className="flex items-start gap-4 mb-6">
				<div className="w-10 h-10 bg-gray-200 rounded-xl"></div>
				<div className="flex-1">
					<div className="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
					<div className="space-y-2">
						<div className="h-4 bg-gray-200 rounded w-full"></div>
						<div className="h-4 bg-gray-200 rounded w-5/6"></div>
					</div>
				</div>
			</div>

			<div className="flex gap-6">
				<div className="flex items-center gap-3">
					<div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
					<div>
						<div className="h-6 bg-gray-200 rounded w-16 mb-1"></div>
						<div className="h-4 bg-gray-200 rounded w-24"></div>
					</div>
				</div>

				<div className="flex items-center gap-3">
					<div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
					<div>
						<div className="h-6 bg-gray-200 rounded w-16 mb-1"></div>
						<div className="h-4 bg-gray-200 rounded w-24"></div>
					</div>
				</div>
			</div>
		</div>
	);

	const ActionButtonsSkeleton = () => (
		<div className="animate-pulse">
			<div className="flex items-center gap-3 mb-[20px]">
				<div className="bg-gray-200 rounded-md w-full h-12"></div>
				<div className="bg-gray-200 rounded-md w-full h-12"></div>
			</div>

			<div className="mb-[15px]">
				<div className="bg-gray-200 rounded-md w-full h-12"></div>
			</div>

			<div className="hidden cursor-pointer items-center gap-4 bg-gray-200 p-3 rounded-md mb-[15px]">
				<div className="w-8 h-8 bg-gray-300 rounded-full"></div>
				<div className="flex flex-col flex-1">
					<div className="h-4 bg-gray-300 rounded w-1/4 mb-2"></div>
					<div className="h-3 bg-gray-300 rounded w-3/4"></div>
				</div>
			</div>
		</div>
	);

	const ResultsSkeleton = () => (
		<div className="animate-pulse">
			<div className="p-4 border border-gray-200 rounded-xl">
				<div className="flex justify-between items-center mb-4">
					<div className="h-6 bg-gray-200 rounded w-1/4"></div>
					<div className="h-6 bg-gray-200 rounded w-1/6"></div>
				</div>

				{[...Array(5)].map((_, i) => (
					<div
						key={i}
						className="flex items-center gap-4 py-3 border-b border-gray-100"
					>
						<div className="w-10 h-10 bg-gray-200 rounded-full"></div>
						<div className="flex-1">
							<div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
							<div className="h-3 bg-gray-200 rounded w-1/3"></div>
						</div>
						<div className="h-8 bg-gray-200 rounded w-20"></div>
					</div>
				))}
			</div>
		</div>
	);

	return (
		<div className="h-min-screen overflow-auto scrollbar-hidden">
			<div className="grid grid-cols-1 md:grid-cols-12 gap-5 mt-2">
				<div className="md:col-span-8 bg-white rounded-xl border border-gray-200 p-6">
					{loading ? (
						<QuestInfoSkeleton />
					) : (
						<div className="flex flex-col lg:flex-row gap-6">
							{/* Left Content */}
							<div className="flex-1">
								{/* Header */}
								<div className="flex items-start gap-4 mb-6">
									<div className="w-10 h-10 border rounded-xl flex items-center justify-center ">
										<Image
											src="/images/icons/quest.svg"
											alt="quest"
											width={40}
											height={40}
											className="rounded-lg"
										/>
									</div>
									<div className="flex-1">
										<h1 className="text-2xl font-bold text-gray-900 mb-2">
											{quinInformationData?.quest?.title}
										</h1>
										<div className="space-y-1 text-sm text-gray-600">
											<div className="flex items-center gap-2">
												<Calendar className="w-4 h-4" />
												<span>
													Start:{" "}
													{moment(
														quinInformationData
															?.quest
															?.start_datetime,
													).format(
														"MMM D, YYYY h:mm A",
													)}
												</span>
											</div>
											{/* <div className="flex items-center gap-2">
												<Clock className="w-4 h-4" />
												<span>Ends: {moment(quinInformationData?.quest?.end_datetime).format("MMM D, YYYY h:mm A")}</span>
											</div> */}
										</div>
									</div>
								</div>

								{/* Stats */}
								<div className="flex gap-6">
									<div className="flex items-center gap-3">
										<div className="w-12 h-12 bg-orange-500 text-white rounded-lg flex items-center justify-center">
											<MdQuiz className="text-xl" />
										</div>
										<div>
											<div className="text-2xl font-bold text-gray-900">
												{quinInformationData?.quest
													?.tasks?.length || 0}
											</div>
											<div className="text-sm text-gray-600">
												Total Questions
											</div>
										</div>
									</div>

									<div className="flex items-center gap-3">
										<div className="w-12 h-12 bg-blue-500 text-white rounded-lg flex items-center justify-center">
											{quinInformationData?.quest?.visibility === "private" ? (
												<MdLockOutline className="text-xl" />
											) : (
												<MdOutlinePublic className="text-xl" />
											)}
										</div>
										<div>
											<div className="text-2xl font-bold text-gray-900 capitalize">
												{
													quinInformationData?.quest
														?.visibility
												}
											</div>
											<div className="text-sm text-gray-600">
												Visibility
											</div>
										</div>
									</div>
								</div>
							</div>

							{/* Right Graphic */}
							<div className="lg:w-48 flex-shrink-0 flex items-end justify-center">
								<Image
									src="/images/welcome-bg.svg"
									alt="quest illustration"
									width={200}
									height={120}
									className="opacity-90"
								/>
							</div>
						</div>
					)}
				</div>
				<div className="md:col-span-4 bg-[#fff] rounded-md">
					<div className="">
						{loading ? (
							<ActionButtonsSkeleton />
						) : (
							<>
								<div className="flex items-center gap-3 mb-[20px] ">
									{questResultList.length > 0 ? (
										<div className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white text-sm font-medium py-4 w-full transition">
											<QuestDuplicate
												data={
													quinInformationData?.quest
												}
											/>
										</div>
									) : (
										<button
											className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white text-sm font-medium py-4 w-full transition"
											onClick={() => handleEditQuest()}
										>
											<Pencil className="w-4 h-4" />
											Edit{" "}
										</button>
									)}

									<button
										className="inline-flex items-center justify-center gap-2 rounded-md bg-red text-white hover:bg-primary-dark text-sm font-medium py-4 w-full transition"
										onClick={handleDeleteQuest}
									>
										<Trash2 className="w-4 h-4" />
										Delete
									</button>
								</div>

								{/* <Link
									href={`/attempt/play/${quinInformationData?.quest.join_code}?jid=${quinInformationData?.quest.join_link}&id=${quinInformationData?.quest?.id}&preview=true`}
								> */}

								<Link href="#">
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

								{/* <HostLater /> */}
								<div className="mb-[15px]">
									<HostLive
										titleData={
											quinInformationData?.quest?.title
										}
										status={
											quinInformationData?.quest?.status
										}
										questData={
											quinInformationData?.quest
												?.join_link
										}
									/>
								</div>
							</>
						)}
					</div>
				</div>
			</div>

			<div className=" border border-gray-200  rounded-xl mt-[20px]">
				{resultsLoading ? (
					<ResultsSkeleton />
				) : (
					<>
						<QuestionsResultView list={questResultList} />
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
					</>
				)}
			</div>
			<div className=" border border-[#2222] rounded-[10px] mt-[20px]">
				<Questions />
			</div>
		</div>
	);
};

export default QuestView;
