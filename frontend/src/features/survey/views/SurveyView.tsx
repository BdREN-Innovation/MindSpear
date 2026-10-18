/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useEffect, useState } from "react";
import Image from "next/image";
import { FaEye } from "react-icons/fa6";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useParams } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import ConfirmDialog from "@/utils/showConfirmDialog";
import { Calendar, Clock, Pencil, Trash2 } from "lucide-react";
import {
	MdOutlineDataThresholding,
	MdLockOutline,
	MdOutlinePublic,
	MdQuiz,
} from "react-icons/md";
import HostLive from "@/features/quest/components/Quest/HostLive";
import moment from "@/lib/dayjs";
import QuestionsResultView from "@/components/ResultComponent/QuestionsResultView";
import GlobalPagination from "@/components/GlobalPagination";
import { toast } from "react-toastify";
import Questions from "@/features/survey/components/SurveyReports/Questions";
import { getSurveyDetailsById } from "@/features/survey/services/surveyService";

interface SurveyData {
	id: number;
	title: string;
	description: string | null;
	creator_id: number;
	open_datetime: string | null;
	close_datetime: string | null;
	is_published: boolean;
	join_link: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	visibility: string;
	creator: {
		id: number;
		first_name: string;
		last_name: string;
		email: string;
		phone: string;
		email_verified_at: string;
		email_verification_token: string | null;
		is_verified: boolean;
		profile_picture: string;
		account_type: string;
		institution_id: number | null;
		institution_name: string;
		designation: string;
		department: string;
		provider: string | null;
		provider_id: string | null;
		created_at: string;
		updated_at: string;
		full_name: string;
	};
	pages: Array<{
		id: number;
		survey_id: number;
		page_number: number;
		title: string;
		description: string | null;
		created_at: string;
		updated_at: string;
		deleted_at: string | null;
		conditional_value: string | null;
		conditional_operator: string | null;
		has_conditional_logic: boolean;
		conditional_parent_type: string | null;
		conditional_question_id: number | null;
		conditional_page_id: number | null;
		questions: Array<any>;
	}>;
}

const SurveyView = () => {
	const router = useRouter();
	const params = useParams<{ id: string }>();
	const surveyId = params?.id;

	const [surveyData, setSurveyData] = useState<SurveyData | null>(null);
	const [surveyResultList, setSurveyResultList] = useState([]);

	const [currentPage, setCurrentPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [pageSize, setPageSize] = useState(12);

	useEffect(() => {
		const surveyFetch = async () => {
			try {
				const response = await getSurveyDetailsById(surveyId);

				setSurveyData(response?.data?.data?.survey);
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;

				if (axiosError.response) {
					console.error(
						"Error fetching survey:",
						axiosError.response.data,
					);
					toast.error(
						`Error: ${
							axiosError.response.data?.message ||
							"Failed to fetch survey."
						}`,
					);
				} else {
					console.error("Unexpected error:", axiosError);
					console.error("Unexpected error:", axiosError.message);
					// toast.error("Unexpected error occurred. Please try again.");
				}
			} finally {
			}
		};
		surveyFetch();
	}, []);

	useEffect(() => {
		const resultFetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/survey-responses/survey/${params?.id}?page=${currentPage}&per_page=${pageSize}`,
				);
				setSurveyResultList(
					response?.data?.data?.responses?.data || [],
				);
				setTotal(response?.data?.data?.responses?.total || 0);
				console.log(response?.data?.data, "response?.data?.data");
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;

				if (axiosError.response) {
					console.error(
						"Error fetching survey results:",
						axiosError.response.data,
					);
					toast.error(
						`Error: ${
							axiosError.response.data?.message ||
							"Failed to fetch survey results."
						}`,
					);
				} else {
					console.error("Unexpected error:", axiosError);
					console.error("Unexpected error:", axiosError.message);
					// toast.error("Unexpected error occurred. Please try again.");
				}
			} finally {
			}
		};
		resultFetch();
	}, [pageSize, currentPage]);

	// Calculate total questions from all pages
	const calculateTotalQuestions = () => {
		if (!surveyData?.pages) return 0;
		return surveyData.pages.reduce((total, page) => {
			return total + (page.questions?.length || 0);
		}, 0);
	};

	const totalQuestions = calculateTotalQuestions();

	const surveyEdit = async () => {
		try {
			router.push(`/survey/create/${params?.id}`);
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error("Error:", axiosError.response.data);
				toast.error(
					`Error: ${axiosError.response.data?.message || "Failed."}`,
				);
			} else {
				console.error("Unexpected error:", axiosError);
				console.error("Unexpected error:", axiosError.message);
				// toast.error("Unexpected error occurred. Please try again.");
			}
		} finally {
		}
	};

	// Survey Remove
	const surveyRemove = async () => {
		await ConfirmDialog.show(
			{
				title: "Are you sure you want to delete this Survey?",
				text: "This action cannot be undone.",
				confirmButtonText: "Yes, delete it!",
			},
			async () => {
				try {
					const response = await axiosInstance.delete(
						`/surveys/delete/${params?.id}`,
					);
					router.push(`/my-library/survey-page`);
					console.log(response, "response");
				} catch (error) {
					const axiosError = error as AxiosError<{
						message?: string;
					}>;

					if (axiosError.response) {
						console.error(
							"Error deleting survey:",
							axiosError.response.data,
						);
						toast.error(
							`Error: ${
								axiosError.response.data?.message ||
								"Failed to delete survey."
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

	return (
		<div className="h-min-screen overflow-auto scrollbar-hidden">
			<div className="grid grid-cols-1 md:grid-cols-12 gap-5 mt-[20px]">
				<div className="md:col-span-8 bg-white rounded-xl border border-gray-200 p-6">
					<div className="flex flex-col lg:flex-row gap-6">
						{/* Left Content */}
						<div className="flex-1">
							{/* Header */}
							<div className="flex items-start gap-4 mb-6">
								<div className="w-10 h-10 border rounded-xl flex items-center justify-center ">
									<Image
										src="/images/icons/survey.svg"
										alt="survey"
										width={40}
										height={40}
										className="rounded-lg"
									/>
								</div>
								<div className="flex-1">
									<h1 className="text-2xl font-bold text-gray-900 mb-2">
										{surveyData?.title || "Untitled Survey"}
									</h1>
									<div className="space-y-1 text-sm text-gray-600">
										<div className="flex items-center gap-2">
											<Calendar className="w-4 h-4" />
											<span>
												Created:{" "}
												{moment(
													surveyData?.created_at,
												).format("MMM D, YYYY h:mm A")}
											</span>
										</div>
										{surveyData?.open_datetime && (
											<div className="flex items-center gap-2">
												<Clock className="w-4 h-4" />
												<span>
													Opens:{" "}
													{moment(
														surveyData?.open_datetime,
													).format(
														"MMM D, YYYY h:mm A",
													)}
												</span>
											</div>
										)}
										{surveyData?.close_datetime && (
											<div className="flex items-center gap-2">
												<Clock className="w-4 h-4" />
												<span>
													Closes:{" "}
													{moment(
														surveyData?.close_datetime,
													).format(
														"MMM D, YYYY h:mm A",
													)}
												</span>
											</div>
										)}
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
											{totalQuestions}
										</div>
										<div className="text-sm text-gray-600">
											Total Questions
										</div>
									</div>
								</div>

								<div className="flex items-center gap-3">
									<div className="w-12 h-12 bg-blue-500 text-white rounded-lg flex items-center justify-center">
										{(surveyData?.visibility || "private") === "private" ? (
											<MdLockOutline className="text-xl" />
										) : (
											<MdOutlinePublic className="text-xl" />
										)}
									</div>
									<div>
										<div className="text-2xl font-bold text-gray-900 capitalize">
											{surveyData?.visibility ||
												"private"}
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
								alt="survey illustration"
								width={200}
								height={120}
								className="opacity-90"
							/>
						</div>
					</div>
				</div>
				<div className="md:col-span-4  bg-[#fff] rounded-md ">
					<div className="">
						<div className="flex items-center gap-3 mb-[20px] p-4 ">
							<button
								className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white text-sm font-medium py-4 w-full transition"
								onClick={() => surveyEdit()}
							>
								<Pencil className="w-4 h-4" />
								Edit
							</button>

							<button
								className="inline-flex items-center justify-center gap-2 rounded-md bg-red text-white hover:bg-primary-dark text-sm font-medium py-4 w-full transition"
								onClick={surveyRemove}
							>
								<Trash2 className="w-4 h-4" />
								Delete
							</button>
						</div>

						<Link href="#">
							<div className="hidden cursor-pointer items-center gap-4 bg-[#f2f1f0] shadow-1 p-3 rounded-md mb-[15px]">
								<FaEye className="text-[30px]" />
								<div className=" flex flex-col ">
									<h5 className="text-[17px] font-bold">
										Preview
									</h5>
									<p className="text-[#858585]">
										Launch a trial session for this survey
									</p>
								</div>
							</div>
						</Link>

						<div className="mb-[15px] p-4">
							<HostLive titleData={surveyData?.title} />
						</div>

						<Link href={`/survey/${surveyData?.id}/responses`}>
							<div className="hidden cursor-pointer items-center gap-4 bg-[#f2f1f0] shadow-1 p-3 rounded-md mb-[15px]">
								<FaEye className="text-[30px]" />
								<div className=" flex flex-col ">
									<h5 className="text-[17px] font-bold">
										Result
									</h5>
									<p className="text-[#858585]">
										Launch a trial session for this survey
									</p>
								</div>
							</div>
						</Link>

						<div className="mt-4 hidden">
							<Link href={`/survey/${surveyData?.id}/responses`}>
								<div className="flex cursor-pointer items-center gap-4 bg-[#f2f1f0] shadow-1 p-3 rounded-md mb-[15px]">
									<MdOutlineDataThresholding className="text-[30px]" />
									<div className=" flex flex-col ">
										<h5 className="text-[17px] font-bold">
											Responses
										</h5>
										<p className="text-[#858585]">
											user responses for this survey
										</p>
									</div>
								</div>
							</Link>
						</div>
					</div>
				</div>
			</div>

			<div className=" border border-gray-200  rounded-xl mt-[20px]">
				<QuestionsResultView list={surveyResultList} />
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
			<div className=" border border-[#2222] rounded-[10px] mt-[20px]">
				<Questions />
			</div>
		</div>
	);
};

export default SurveyView;
