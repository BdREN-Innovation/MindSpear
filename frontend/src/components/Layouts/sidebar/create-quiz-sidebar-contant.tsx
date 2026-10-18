/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { IoIosClose } from "react-icons/io";
import { Tooltip } from "antd";
import { AiOutlineQuestion } from "react-icons/ai";
import { Search, BookOpen, AlertTriangle } from "lucide-react";
import { toast } from "react-toastify";
import { Modal } from "@/components/ui";
import SelectedQuizList from "./selected-quiz-list";
import { useParams } from "next/navigation";
import {
	Dropdown,
	DropdownContent,
	DropdownTrigger,
} from "@/components/ui/Dropdown";
import { useDispatch } from "react-redux";
import {
	setHoveredItem,
	clearHoveredItem,
	addNewItem,
} from "@/features/quiz/store/quizItems/quizSlice";
import { setDropdownOpen } from "@/features/dashboard/store/dropdownSlice";
// import { RootState } from '@/services/redux/store';
import axiosInstance from "@/utils/axiosInstance";
import { transformQuestionData } from "@/utils/quizUtils";
import Image from "next/image";
import PdfModal from "@/features/quiz/components/PdfQuiz/PdfModal";
import { type QuizQuestionKey, useAddQuizQuestion } from "@/features/quiz/hooks/useAddQuizQuestion";

interface MenuItem {
	key: string;
	id: string;
	label: string;
	icon: React.ReactNode;
}

// Define interfaces for question bank data
interface OptionData {
	choices: string[];
	correct_answer: number[] | string;
}

interface Category {
	id: number;
	name: string;
	description: string | null;
	is_parent: boolean;
	parent_category_id: number | null;
	created_by: number;
	created_at: string;
	updated_at: string;
}

interface Question {
	id: number;
	q_bank_category_id: number;
	owner_id: number;
	question_text: string;
	question_type: string;
	time_limit_seconds: number | null;
	points: number | null;
	is_ai_generated: boolean;
	source_content_url: string | null;
	visibility: string;
	options: OptionData;
	deleted_at: string | null;
	created_at: string;
	updated_at: string;
	category: Category | null;
}

interface QuestionResponse {
	current_page: number;
	data: Question[];
	first_page_url: string;
	from: number;
	last_page: number;
	last_page_url: string;
	links: Array<{
		url: string | null;
		label: string;
		page: number | null;
		active: boolean;
	}>;
	next_page_url: string | null;
	path: string;
	per_page: number;
	prev_page_url: string | null;
	to: number;
	total: number;
}

interface ApiResponse {
	status: boolean;
	message: string;
	data: {
		questions: QuestionResponse;
	};
}

interface QuestionBankModalProps {
	isOpen: boolean;
	onClose: () => void;
	quizId: string;
	dispatch: (action: any) => void; // Dispatch function from parent
}

export const QuestionBankModal: React.FC<QuestionBankModalProps> = ({
	isOpen,
	onClose,
	quizId,
	dispatch,
}) => {
	const [questions, setQuestions] = useState<Question[]>([]);
	const [loading, setLoading] = useState<boolean>(true);
	const [error, setError] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState<string>("");
	const [currentPage, setCurrentPage] = useState<number>(1);
	const [total, setTotal] = useState<number>(0);
	const [perPage] = useState<number>(12); // Set to 12, not changing dynamically
	const [addingToQuiz, setAddingToQuiz] = useState<boolean>(false);

	// Fetch questions from question bank
	const fetchQuestions = useCallback(async () => {
		try {
			setLoading(true);
			const params = new URLSearchParams();
			if (searchTerm) {
				params.append("search", searchTerm);
			}
			params.append("page", currentPage.toString());
			params.append("per_page", perPage.toString());

			const queryString = params.toString();
			const endpoint = `/quiz/question-bank/public${queryString ? "?" + queryString : ""
				}`;

			const response = await axiosInstance.get<ApiResponse>(endpoint);
			if (response.data.status) {
				const questionsData = response.data.data.questions.data;
				const paginationData = response.data.data.questions;

				setQuestions(questionsData);
				setTotal(paginationData.total || 0);
				setCurrentPage(paginationData.current_page || 1);
				setError(null);
			} else {
				setError(response.data.message || "Failed to fetch questions");
			}
		} catch (err) {
			setError("An error occurred while fetching questions");
			console.error(err);
		} finally {
			setLoading(false);
		}
	}, [searchTerm, currentPage, perPage]);

	// Fetch questions when modal opens or search/page changes
	useEffect(() => {
		if (isOpen) {
			fetchQuestions();
		}
	}, [isOpen, searchTerm, currentPage, perPage, fetchQuestions]);

	// Handle search
	const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
		setSearchTerm(e.target.value);
		setCurrentPage(1); // Reset to first page when searching
	};

	// Handle pagination
	const handlePageChange = (page: number) => {
		setCurrentPage(page);
	};

	// Add a single question to quiz
	const addQuestionToQuiz = async (questionId: number) => {
		try {
			setAddingToQuiz(true);
			const response = await axiosInstance.post(
				`/quiz/question-bank/use-in-quiz/${questionId}`,
				{
					quiz_id: quizId,
					serial_number: 0, // The API will handle serial numbers
				}
			);

			if (
				response.data.status === true ||
				response.status === 200 ||
				response.status === 201
			) {
				const q = response.data.data.question;
				// Map it like questions loaded from the API ("quiz_single_choice" -> "quiz", options,
				// correct answers); the raw question_type matched no editor and the text/options were dropped.
				const [item] = transformQuestionData([q]);
				if (!item?.key) {
					toast.error("This question type can't be used in a quiz.");
					return;
				}

				// Dispatch the new item to Redux to update the state immediately
				dispatch(addNewItem(item));

				toast.success("Successfully added question to quiz!");
				onClose(); // Close the modal after successful addition
			} else {
				toast.error("Failed to add question to the quiz");
			}
		} catch (err) {
			console.error("Error adding question to quiz:", err);
			toast.error("Failed to add question to the quiz");
		} finally {
			setAddingToQuiz(false);
		}
	};

	// Close modal and reset state
	const handleClose = () => {
		setSearchTerm("");
		setCurrentPage(1);
		onClose();
	};

	return (
		<Modal
			title="Import Questions from Bank"
			open={isOpen}
			onClose={handleClose}
		>
			<div className="flex flex-col h-[60vh]">
				{/* Search */}
				<div className="p-4 border-b">
					<div className="relative flex-1">
						<input
							type="text"
							placeholder="Search questions..."
							value={searchTerm}
							onChange={handleSearch}
							className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
						/>
						<Search
							className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
							size={18}
						/>
					</div>
				</div>

				{/* Loading State */}
				{loading && (
					<div className="flex justify-center items-center flex-1">
						<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
					</div>
				)}

				{/* Error State */}
				{error && !loading && (
					<div className="flex-1 flex flex-col items-center justify-center p-6">
						<AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
						<p className="text-red-500 mb-4">{error}</p>
						<button
							onClick={fetchQuestions}
							className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
						>
							Retry
						</button>
					</div>
				)}

				{/* Questions List */}
				{!loading && !error && (
					<div className="overflow-y-auto flex-1">
						{questions.length === 0 ? (
							<div className="flex-1 flex flex-col items-center justify-center p-6">
								<BookOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
								<h3 className="text-lg font-medium mb-2">
									No questions found
								</h3>
								<p className="text-gray-600">{`Try adjusting your search to find what you're looking for`}</p>
							</div>
						) : (
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
								{questions.map((question) => (
									<div
										key={question.id}
										className="border rounded-lg p-4 cursor-pointer transition-all border-gray-200 hover:border-primary/50"
									>
										<div className="flex items-start gap-3">
											<div className="flex-1">
												<div className="flex justify-between items-start mb-2">
													<span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
														{question.category
															?.name ||
															"Uncategorized"}
													</span>
													<span className="text-xs text-gray-500">
														{question.question_type
															.replace(/_/g, " ")
															.toUpperCase()}
													</span>
												</div>

												<p className="text-gray-800 font-medium mb-2 line-clamp-2">
													{question.question_text}
												</p>

												<div className="flex flex-wrap gap-2 text-xs">
													{question.points && (
														<span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full">
															{question.points}{" "}
															pts
														</span>
													)}
													{question.time_limit_seconds && (
														<span className="px-2 py-1 bg-purple-100 text-purple-800 rounded-full">
															{
																question.time_limit_seconds
															}
															s
														</span>
													)}
													<span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full">
														{
															question.options
																.choices.length
														}{" "}
														options
													</span>
												</div>
											</div>

											<button
												onClick={(e) => {
													e.stopPropagation();
													addQuestionToQuiz(
														question.id
													);
												}}
												disabled={addingToQuiz}
												className={`px-3 py-1 rounded text-sm ${addingToQuiz
													? "bg-gray-300 text-gray-500 cursor-not-allowed"
													: "bg-primary text-white hover:bg-primary/90"
													}`}
											>
												Add
											</button>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				)}

				{/* Pagination */}
				{!loading && !error && questions.length > 0 && (
					<div className="p-4 border-t flex justify-between items-center">
						<div className="text-sm text-gray-600">
							Showing {(currentPage - 1) * perPage + 1} -{" "}
							{Math.min(currentPage * perPage, total)} of {total}{" "}
							questions
						</div>
						<div className="flex gap-2">
							<button
								onClick={() =>
									handlePageChange(currentPage - 1)
								}
								disabled={currentPage === 1}
								className={`px-3 py-1 rounded ${currentPage === 1
									? "bg-gray-100 text-gray-400 cursor-not-allowed"
									: "bg-gray-200 hover:bg-gray-300"
									}`}
							>
								Previous
							</button>
							<button
								onClick={() =>
									handlePageChange(currentPage + 1)
								}
								disabled={
									currentPage === Math.ceil(total / perPage)
								}
								className={`px-3 py-1 rounded ${currentPage === Math.ceil(total / perPage)
									? "bg-gray-100 text-gray-400 cursor-not-allowed"
									: "bg-gray-200 hover:bg-gray-300"
									}`}
							>
								Next
							</button>
						</div>
					</div>
				)}
			</div>
		</Modal>
	);
};

const CreateQuizSidebarContant: React.FC = () => {
	const [isDropDownOpen, setIsDropDownOpen] = useState(false);
	const [showPdfModal, setShowPdfModal] = useState(false);
	const [showQuestionBankModal, setShowQuestionBankModal] = useState(false);

	const dispatch = useDispatch();
	const params = useParams();
	const qId = params?.quizId as string;
	const { addQuestion } = useAddQuizQuestion(qId);
	const items = [
		{
			key: "quiz",
			id: "1",
			label: "Multiple Choice",
			icon: (
				<Image
					src="/images/icons/Icon-01.svg"
					alt="Multiple Choice"
					width={20}
					height={20}
					className="mr-2"
				/>
			),
		},
		{
			key: "truefalse",
			id: "2",
			label: "True / False",
			icon: (
				<Image
					src="/images/icons/Icon-02.svg"
					alt="True / False"
					width={20}
					height={20}
					className="mr-2"
				/>
			),
		},
		{
			key: "sortanswer",
			id: "3",
			label: "Short Answer",
			icon: (
				<Image
					src="/images/icons/Icon-03.svg"
					alt="Short Answer"
					width={20}
					height={20}
					className="mr-2"
				/>
			),
		},
		{
			key: "fillintheblanks",
			id: "4",
			label: "Fill in the blanks",
			icon: (
				<Image
					src="/images/icons/Icon-04.svg"
					alt="Fill in the blanks"
					width={20}
					height={20}
					className="mr-2"
				/>
			),
		},
		{
			key: "generate_using_file",
			id: "5",
			label: "Generate using File",
			icon: (
				<Image
					src="/images/icons/file.png"
					alt="Generate using File"
					width={20}
					height={20}
					className="mr-2"
				/>
			),
		},
		{
			key: "import_from_bank",
			id: "6",
			label: "Import From Bank",
			icon: (
				<Image
					src="/images/icons/url.png"
					alt="Import From Bank"
					width={20}
					height={20}
					className="mr-2"
				/>
			),
		},
	];

	const handleDropdownToggle = (
		value: boolean | ((prev: boolean) => boolean)
	) => {
		if (typeof value === "function") {
			setIsDropDownOpen((prev) => {
				const next = value(prev);
				dispatch(setDropdownOpen(next));
				if (!next) dispatch(clearHoveredItem());
				return next;
			});
		} else {
			setIsDropDownOpen(value);
			dispatch(setDropdownOpen(value));
			if (!value) dispatch(clearHoveredItem());
		}
	};

	/** Closes the menu. The hovered item unmounts without a mouseleave, so its hover preview is cleared here. */
	const closeMenu = () => {
		setIsDropDownOpen(false);
		dispatch(setDropdownOpen(false));
		dispatch(clearHoveredItem());
	};

	useEffect(() => {
		const handleScroll = () => {
			dispatch(setDropdownOpen(false));
			setIsDropDownOpen(false);
		};

		window.addEventListener("scroll", handleScroll);
		return () => window.removeEventListener("scroll", handleScroll);
	}, [dispatch]);

	const handleMouseEnter = (item: MenuItem) => {
		dispatch(
			setHoveredItem({
				key: item.key,
				id: item.id,
				title: "",
				options: [],
				maxOptions: 0,
				minOptions: 0,
				allowDuplicates: false,
				isMultipleSelection: false,
				timeLimit: "",
				position: 1,
			})
		);
	};

	const handleItemClick = async (item: MenuItem) => {
		closeMenu();

		// These two open a dialog; they used to also create an empty "." question on the server
		// (and "Generate using File" added a blank, unusable card).
		if (item.key === "import_from_bank") {
			setShowQuestionBankModal(true);
			return;
		}
		if (item.key === "generate_using_file") {
			setShowPdfModal(true);
			return;
		}

		await addQuestion(item.key as QuizQuestionKey);
	};

	const handleMouseLeave = () => {
		dispatch(clearHoveredItem());
	};

	return (
		<div
			className={`py-[13px] pl-[15px] w-[220px] pr-[15px] mt-4 xl:mt-[20px] 2xl:mt-[20px] bg-white rounded-[15px] h-screen ${isDropDownOpen ? "" : "overflow-auto scrollbar-hidden "
				}`}
		>
			<Dropdown isOpen={isDropDownOpen} setIsOpen={handleDropdownToggle}>
				<DropdownTrigger className="w-full">
					<div className="flex justify-center items-center w-full">
						<div className="flex  text-[.875rem] w-full mb-[20px] shadow-5 px-10 mt-[10px] cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-primary p-2 font-medium text-white transition hover:bg-opacity-90">
							Add question
						</div>
					</div>
				</DropdownTrigger>

				<DropdownContent className="w-[365px] absolute z-9999 left-[190px] ">
					<div className=" bg-[#fff] shadow-default p-[15px] rounded-[10px] ">
						<p className="flex items-center justify-between">
							<span className="flex items-center">
								{" "}
								Interactive questions
								<Tooltip
									placement="top"
									title="Get real-time input from your audience with these question formats.Get real-time input from your audience with these question formats."
								>
									<AiOutlineQuestion className="ml-2 cursor-pointer" />
								</Tooltip>
							</span>
							<IoIosClose
								onClick={closeMenu}
								className="cursor-pointer"
								size={30}
							/>{" "}
						</p>
						<div className="grid grid-cols-2 gap-2 mt-[10px] ">
							{items.map((item) => (
								<div
									key={item.id}
									onMouseEnter={() => handleMouseEnter(item)}
									onMouseLeave={handleMouseLeave}
									onClick={() => handleItemClick(item)}
									className="group flex flex-col cursor-pointer items-center px-4 py-3 rounded-lg hover:bg-gray-100 transition border"
								>
									<span> {item.icon} </span>
									{ }
									<span className="text-sm font-medium text-gray-800">
										{item.label}
									</span>
								</div>
							))}
						</div>
						{/* <div className="my-2">
							<span className="flex items-center">
								{" "}
								Generate from AI
								<Tooltip
									placement="top"
									title="Get real-time input from your audience with these question formats.Get real-time input from your audience with these question formats."
								>
									<AiOutlineQuestion className="ml-2 cursor-pointer" />
								</Tooltip>
							</span>
						</div> */}

						{/* <div className="flex items-center justify-between">
							<div
								className="group flex items-center flex-col gap-2 cursor-pointer px-4.5 py-2 rounded-lg hover:bg-gray-100 transition border"
								onClick={() => setShowPdfModal(true)}
							>
								<Image
									src="/images/icons/file.png"
									alt="File Upload"
									width={20}
									height={20}
								/>
								<span className="text-sm font-medium text-gray-800">
									Generate using File
								</span>
							</div>
							<div
								className="group flex flex-col items-center gap-2 cursor-pointer px-4.5 py-2 rounded-lg hover:bg-gray-100 transition border"
								onClick={() => setShowQuestionBankModal(true)}
							>
								<Image
									src="/images/icons/url.png"
									alt="URL"
									width={20}
									height={20}
								/>
								<span className="text-sm font-medium text-gray-800">
									Import From Bank
								</span>
							</div>
						</div> */}
					</div>
				</DropdownContent>
			</Dropdown>

			<SelectedQuizList />
			{/* Show PDF Modal */}
			{showPdfModal && (
				<PdfModal initialOpen appendToQuiz onClose={() => setShowPdfModal(false)} />
			)}
			{/* Show Question Bank Modal */}
			{showQuestionBankModal && (
				<QuestionBankModal
					isOpen={showQuestionBankModal}
					onClose={() => setShowQuestionBankModal(false)}
					quizId={qId}
					dispatch={dispatch}
				/>
			)}
		</div>
	);
};

export default CreateQuizSidebarContant;
