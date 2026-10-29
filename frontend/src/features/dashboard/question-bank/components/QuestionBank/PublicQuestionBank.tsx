/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
	Eye,
	AlertTriangle,
	CheckCircle,
	Search,
	X,
	Folder,
	Bookmark,
	Plus,
	Check,
	ListCollapse,
	Type,
	Zap,
	Clock4,
	BookOpen,
	Link,
	Calendar,
	AlertCircle,
} from "lucide-react";
import Image from "next/image";
import Swal from "sweetalert2";
import Select from "react-select";
import GlobalPagination from "@/components/GlobalPagination";
import { Modal } from "@/components/ui";
import axiosInstance from "@/utils/axiosInstance";

// Define interfaces for the new data structure (same as in MyQuestionBank)
interface OptionData {
	choices: string[];
	correct_answer: number[] | string;
}

interface SelectOption {
	value: number;
	label: string;
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

// Helper function for relative date formatting (same as in QuestionBankCategories)
const formatDate = (dateString: string): string => {
	const date = new Date(dateString);
	const now = new Date();
	const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

	// Calculate different time units
	const secondsInMinute = 60;
	const secondsInHour = 3600;
	const secondsInDay = 86400;
	const secondsInWeek = 604800;
	const secondsInMonth = 2592000; // Approximate
	const secondsInYear = 31536000;

	if (diffInSeconds < secondsInMinute) {
		return "Just now";
	} else if (diffInSeconds < secondsInHour) {
		const minutes = Math.floor(diffInSeconds / secondsInMinute);
		return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
	} else if (diffInSeconds < secondsInDay) {
		const hours = Math.floor(diffInSeconds / secondsInHour);
		return `${hours} hour${hours > 1 ? "s" : ""} ago`;
	} else if (diffInSeconds < secondsInWeek) {
		const days = Math.floor(diffInSeconds / secondsInDay);
		return `${days} day${days > 1 ? "s" : ""} ago`;
	} else if (diffInSeconds < secondsInMonth) {
		const weeks = Math.floor(diffInSeconds / secondsInWeek);
		return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
	} else if (diffInSeconds < secondsInYear) {
		const months = Math.floor(diffInSeconds / secondsInMonth);
		return `${months} month${months > 1 ? "s" : ""} ago`;
	} else {
		const years = Math.floor(diffInSeconds / secondsInYear);
		return `${years} year${years > 1 ? "s" : ""} ago`;
	}
};

// Helper function to get question type icon
const getQuestionTypeIcon = (type: string) => {
	switch (type.toLowerCase()) {
		case "quiz":
		case "mcq":
		case "multiple_choice":
			return "/images/icons/Icon-01.svg";
		case "truefalse":
		case "true_false":
			return "/images/icons/yes-no.svg";
		case "shortanswer":
		case "short_answer":
			return "/images/icons/Icon-03.svg";
		case "fillintheblanks":
		case "fill_in_the_blanks":
			return "/images/icons/long-answer.svg";
		default:
			return "/images/icons/Icon-01.svg"; // Default icon
	}
};

export default function PublicQuestionBank() {
	const [questions, setQuestions] = useState<Question[]>([]);
	const [loading, setLoading] = useState<boolean>(true);
	const [error, setError] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState<string>("");
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>("");
	const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
	const [categories, setCategories] = useState<Category[]>([]);
	const [currentPage, setCurrentPage] = useState<number>(1);
	const [total, setTotal] = useState<number>(0);
	const [perPage, setPerPage] = useState<number>(12);
	const [isAddToBankModalOpen, setIsAddToBankModalOpen] =
		useState<boolean>(false);
	const [selectedQuestionForBank, setSelectedQuestionForBank] =
		useState<Question | null>(null);
	const [selectedCategoryForAdd, setSelectedCategoryForAdd] =
		useState<SelectOption | null>(null);
	const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);
	const [detailedQuestion, setDetailedQuestion] = useState<any>(null);
	const [detailLoading, setDetailLoading] = useState<boolean>(false);

	// Ref for the search debounce timer
	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Fetch categories for the filter
	const fetchCategories = useCallback(async () => {
		try {
			const response = await axiosInstance.get(
				"/quiz/question-bank-categories",
			);
			if (response.data.status) {
				setCategories(response.data.data.categories.data || []);
			}
		} catch (err) {
			console.error("Error fetching categories:", err);
		}
	}, []);

	// Fetch categories on component mount
	useEffect(() => {
		fetchCategories();
	}, [fetchCategories]);

	// Handle search term changes with debounce
	useEffect(() => {
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current);
		}

		searchTimeoutRef.current = setTimeout(() => {
			setDebouncedSearchTerm(searchTerm);
			// Reset to first page when search term changes
			setCurrentPage(1);
		}, 500); // 500ms delay

		return () => {
			if (searchTimeoutRef.current) {
				clearTimeout(searchTimeoutRef.current);
			}
		};
	}, [searchTerm]);

	// Handle category filter changes
	const handleCategoryChange = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => {
			const value = e.target.value;
			setCategoryFilter(value ? parseInt(value) : null);
			// Reset to first page when category filter changes
			setCurrentPage(1);
		},
		[],
	);

	// Handle pagination change
	const handlePageChange = useCallback((page: number, pageSize?: number) => {
		setCurrentPage(page);
		if (pageSize) {
			setPerPage(pageSize);
		}
	}, []);

	// Fetch public questions on mount and when the debounced search term, category filter, or page changes
	useEffect(() => {
		fetchPublicQuestions();
	}, [debouncedSearchTerm, categoryFilter, currentPage, perPage]);

	// Function to add question to user's bank
	const addQuestionToMyBank = useCallback((question: Question) => {
		setSelectedQuestionForBank(question);
		setSelectedCategoryForAdd(null); // Reset the selected category
		setIsAddToBankModalOpen(true);
	}, []);

	// Function to handle adding question to bank with selected category
	const handleAddToBank = useCallback(async () => {
		if (!selectedQuestionForBank || !selectedCategoryForAdd) return;

		try {
			setLoading(true);

			// Prepare options data
			const optionsData = {
				choices: selectedQuestionForBank.options.choices,
				correct_answer: selectedQuestionForBank.options.correct_answer,
			};

			// Prepare the question data for the API
			const questionDataForAPI = {
				q_bank_category_id: selectedCategoryForAdd.value,
				question_text: selectedQuestionForBank.question_text,
				question_type: selectedQuestionForBank.question_type,
				visibility: "public", // Default visibility
				time_limit_seconds: selectedQuestionForBank.time_limit_seconds,
				points: selectedQuestionForBank.points,
				is_ai_generated: selectedQuestionForBank.is_ai_generated,
				source_content_url: selectedQuestionForBank.source_content_url,
				options: optionsData,
			};

			// Call the API to add the question to the user's bank
			const response = await axiosInstance.post(
				"/quiz/question-bank/store",
				questionDataForAPI,
			);

			if (
				response.data.status === true ||
				response.status === 200 ||
				response.status === 201
			) {
				// Close the modal and show success message
				setIsAddToBankModalOpen(false);
				setSelectedQuestionForBank(null);
				setSelectedCategoryForAdd(null);

				Swal.fire({
					title: "Success!",
					text: "Question successfully added to your question bank!",
					icon: "success",
					timer: 2000,
					showConfirmButton: false,
				});
			} else {
				Swal.fire({
					title: "Error!",
					text:
						response.data.message ||
						"Failed to add question to the question bank. Please try again.",
					icon: "error",
				});
			}
		} catch (err: any) {
			console.error("Error adding question to bank:", err);
			Swal.fire({
				title: "Error!",
				text:
					err.response?.data?.message ||
					"An error occurred while adding the question to your bank.",
				icon: "error",
			});
		} finally {
			setLoading(false);
		}
	}, [selectedQuestionForBank, selectedCategoryForAdd]);

	// View question details function
	const viewQuestionDetails = useCallback(
		async (questionId: number) => {
			try {
				setDetailLoading(true);

				const response = await axiosInstance.get(
					`/quiz/question-bank/show/${questionId}`,
				);

				if (response.data.status) {
					setDetailedQuestion(response.data.data.question);
					setIsDetailModalOpen(true);
				} else {
					Swal.fire({
						title: "Error!",
						text:
							response.data.message ||
							"Failed to fetch question details",
						icon: "error",
					});
				}
			} catch (err) {
				console.error("Error fetching question details:", err);
				Swal.fire({
					title: "Error!",
					text: "An error occurred while fetching question details",
					icon: "error",
				});
			} finally {
				setDetailLoading(false);
			}
		},
		[],
	);

	const fetchPublicQuestions = async () => {
		try {
			setLoading(true);

			// Build query parameters for search, filter, and pagination
			const params = new URLSearchParams();
			if (debouncedSearchTerm) {
				params.append("search", debouncedSearchTerm);
			}
			if (categoryFilter) {
				params.append("q_bank_category_id", categoryFilter.toString());
			}
			params.append("page", currentPage.toString());
			params.append("per_page", perPage.toString());

			const queryString = params.toString();
			const endpoint = `/quiz/question-bank/public${queryString ? "?" + queryString : ""}`;

			const response = await axiosInstance.get<ApiResponse>(endpoint);
			if (response.data.status) {
				const questionsData = response.data.data.questions.data;
				const paginationData = response.data.data.questions;

				setQuestions(questionsData);
				setTotal(paginationData.total || 0);
				setCurrentPage(paginationData.current_page || 1);
			} else {
				setError(
					response.data.message || "Failed to fetch public questions",
				);
			}
		} catch (err: any) {
			setError("An error occurred while fetching public questions");
			console.error("Public questions fetch error:", err);
		} finally {
			setLoading(false);
		}
	};

	if (loading) {
		return (
			<section className=" mx-auto">
				<div className="flex justify-between items-center mb-6">
					<h2 className="text-2xl font-bold">Public Questions</h2>
					<div className="h-10 w-48 bg-gray-200 dark:bg-dark-3 rounded-md animate-pulse"></div>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{[...Array(6)].map((_, index) => (
						<div
							key={index}
							className="bg-white dark:bg-dark-2 rounded-lg border p-5 animate-pulse"
						>
							<div className="flex justify-between mb-2">
								<div className="h-6 w-20 bg-gray-200 dark:bg-dark-3 rounded"></div>
								<div className="h-4 w-16 bg-gray-200 dark:bg-dark-3 rounded"></div>
							</div>

							<div className="h-5 w-3/4 bg-gray-200 dark:bg-dark-3 rounded mb-3"></div>

							<div className="flex flex-wrap gap-2 mb-4">
								<div className="h-5 w-12 bg-gray-200 dark:bg-dark-3 rounded"></div>
								<div className="h-5 w-16 bg-gray-200 dark:bg-dark-3 rounded"></div>
							</div>

							<div className="flex gap-2 mb-2">
								<div className="flex-1 h-10 bg-gray-200 dark:bg-dark-3 rounded"></div>
							</div>

							<div className="h-5 w-full bg-gray-200 dark:bg-dark-3 rounded"></div>
						</div>
					))}
				</div>
			</section>
		);
	}

	if (error) {
		return (
			<div className="text-center py-12">
				<div className="bg-red-50 dark:bg-red-900/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
					<AlertTriangle className="w-8 h-8 text-red-500" />
				</div>
				<h3 className="text-xl font-semibold text-red-500 mb-2">
					Something went wrong
				</h3>
				<p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
					{error}
				</p>
				<button
					onClick={fetchPublicQuestions}
					className="mt-6 flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-md transition-colors mx-auto"
				>
					<CheckCircle className="w-4 h-4" />
					Retry
				</button>
			</div>
		);
	}

	return (
		<section className=" mx-auto">
			<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
				<div>
					<h2 className="text-2xl font-bold">Public Questions</h2>
					<div className="flex flex-wrap gap-4 mt-4">
						{/* Search Input */}
						<div className="relative">
							<input
								type="text"
								placeholder="Search questions..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								onKeyDown={(e) => {
									// Prevent form submission if the input is accidentally inside a form
									if (e.key === "Enter") {
										e.preventDefault();
									}
								}}
								className="px-4 py-2 pl-10 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-dark-3 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all w-full sm:w-64"
							/>
							<div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
								<Search size={18} />
							</div>
							{searchTerm && (
								<button
									type="button"
									onClick={(e) => {
										e.preventDefault();
										setSearchTerm("");
										setDebouncedSearchTerm("");
									}}
									className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
								>
									<X size={18} />
								</button>
							)}
						</div>

						{/* Category Filter */}
						<div className="relative">
							<select
								value={categoryFilter || ""}
								onChange={handleCategoryChange}
								className="px-4 py-2 pl-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-dark-3 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all w-full sm:w-48 appearance-none"
							>
								<option value="">All Categories</option>
								{categories.map((category) => (
									<option
										key={category.id}
										value={category.id}
									>
										{category.name}
									</option>
								))}
							</select>
							<div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
								<Folder size={18} />
							</div>
						</div>

						{/* Clear Filters Button */}
						{(searchTerm || categoryFilter) && (
							<button
								onClick={() => {
									setSearchTerm("");
									setDebouncedSearchTerm("");
									setCategoryFilter(null);
									setCurrentPage(1);
								}}
								className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-3 transition-colors"
							>
								Clear Filters
							</button>
						)}
					</div>
				</div>
			</div>

			{/* ================= EMPTY STATE ================= */}
			{!questions.length ? (
				<div className="text-center py-12">
					<div className="mx-auto max-w-md">
						<div className="bg-gray-100 dark:bg-dark-3 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
							<Eye className="w-8 h-8 text-gray-400" />
						</div>

						<h3 className="text-xl font-semibold mb-2">
							No questions found
						</h3>

						{searchTerm || categoryFilter ? (
							<>
								<p className="text-gray-600 dark:text-gray-400 mb-6">
									{searchTerm && categoryFilter
										? `No questions match "${searchTerm}" in the selected category`
										: searchTerm
											? `No questions match "${searchTerm}"`
											: `No questions found in the selected category`}
								</p>
								<button
									type="button"
									onClick={(e) => {
										e.preventDefault();
										setSearchTerm("");
										setDebouncedSearchTerm("");
										setCategoryFilter(null);
										setCurrentPage(1);
									}}
									className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-lg transition-colors mx-auto"
								>
									<X className="w-4 h-4" />
									Clear Filters
								</button>
							</>
						) : (
							<>
								<p className="text-gray-600 dark:text-gray-400 mb-6">
									{`No public questions available.`}
								</p>
							</>
						)}
					</div>
				</div>
			) : (
				/* ================= LIST ================= */
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{questions.map((question) => (
						<div
							key={question.id}
							className="bg-white dark:bg-dark-2 rounded-xl border border-gray-200 dark:border-gray-700 transition-shadow duration-200 overflow-hidden flex flex-col h-full"
						>
							<div className="p-5 flex-grow">
								<div className="flex justify-between items-start mb-3">
									{question.category ? (
										<span className="inline-flex items-center text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary">
											<Eye className="w-3 h-3 mr-1" />
											{question.category.name}
										</span>
									) : (
										<span className="inline-flex items-center text-xs px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
											<Eye className="w-3 h-3 mr-1" />
											Uncategorized
										</span>
									)}
									<span className="text-xs text-gray-400">
										{formatDate(question.created_at)}
									</span>
								</div>

								<div className="flex items-start gap-3 mb-3">
									<div className="flex-shrink-0 w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
										<Image
											src={getQuestionTypeIcon(
												question.question_type,
											)}
											alt={question.question_type}
											width={28}
											height={28}
											className="object-contain"
										/>
									</div>
									<h3 className="font-semibold flex-grow text-gray-800 dark:text-white mb-3 line-clamp-2 min-h-[2.5rem]">
										{question.question_text}
									</h3>
								</div>

								<div className="flex flex-wrap gap-2 mb-3">
									<span className="text-xs px-3 py-1.5 bg-primary/10 text-primary rounded-full font-medium flex items-center gap-1">
										<Type size={10} />
										{question.question_type
											.replace(/_/g, " ")
											.toUpperCase()}
									</span>
									{question.points && (
										<span className="text-xs px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 rounded-full font-medium flex items-center gap-1">
											<Zap size={10} />
											{question.points} Points
										</span>
									)}
									{question.time_limit_seconds && (
										<span className="text-xs px-3 py-1.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full font-medium flex items-center gap-1">
											<Clock4 size={10} />
											{question.time_limit_seconds}s
										</span>
									)}
								</div>

								<div className="text-sm text-gray-600 dark:text-gray-400 mb-3 flex items-center justify-between">
									<span className="flex items-center gap-1">
										<ListCollapse className="w-4 h-4" />
										Options:{" "}
										{question.options.choices.length}
									</span>
									<button
										onClick={() =>
											viewQuestionDetails(question.id)
										}
										title="View Details"
										className="text-xs px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary dark:text-primary-light rounded-full transition-colors flex items-center gap-1"
									>
										<Eye size={12} />
										View Details
									</button>
									{question.is_ai_generated && (
										<span className="text-xs px-2.5 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-full ml-2">
											AI Generated
										</span>
									)}
								</div>

								<div className="flex gap-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
									<button
										onClick={() =>
											addQuestionToMyBank(question)
										}
										title="Add to My Bank"
										className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors duration-200 text-sm font-medium"
									>
										<Bookmark className="w-4 h-4" />
										Add to My Bank
									</button>
								</div>
							</div>
						</div>
					))}
				</div>
			)}
			{total > 0 && (
				<GlobalPagination
					current={currentPage}
					total={total}
					pageSize={perPage}
					onChange={handlePageChange}
				/>
			)}

			{/* Add to My Bank Modal */}
			{isAddToBankModalOpen && selectedQuestionForBank && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
					<div className="bg-white dark:bg-dark-2 rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-md">
						<div className="p-6">
							<h3 className="text-xl font-bold mb-4">
								Add Question to My Bank
							</h3>

							<div className="mb-4">
								<p className="font-medium mb-2">Question:</p>
								<p className="text-gray-700 dark:text-gray-300 line-clamp-2">
									{selectedQuestionForBank.question_text}
								</p>
							</div>

							<div className="mb-6">
								<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
									Select Category
								</label>
								<Select
									value={selectedCategoryForAdd}
									onChange={(selectedOption) =>
										setSelectedCategoryForAdd(
											selectedOption as SelectOption,
										)
									}
									options={categories.map((category) => ({
										value: category.id,
										label: category.name,
									}))}
									placeholder="Select a category..."
									className="basic-single"
									classNamePrefix="select"
									isClearable
									styles={{
										control: (provided, state) => ({
											...provided,
											borderColor: state.isFocused
												? "#3b82f6"
												: "#d1d5db",
											borderWidth: "2px",
											borderRadius: "0.5rem",
											background: "white",
											"&:hover": {
												borderColor: "#3b82f6",
											},
											...(state.isFocused && {
												boxShadow:
													"0 0 0 3px rgba(59, 130, 246, 0.15)",
												borderColor: "#3b82f6",
											}),
											"@apply dark:bg-dark-3 dark:border-gray-600":
												{},
										}),
										option: (provided, state) => ({
											...provided,
											backgroundColor: state.isSelected
												? "#3b82f6" // primary color
												: state.isFocused
													? "#dbeafe" // lighter primary
													: "white",
											color: state.isSelected
												? "white"
												: "black",
											"@apply dark:bg-dark-3 dark:hover:bg-dark-4 dark:text-white":
												{},
											"&:hover": {
												backgroundColor: "#dbeafe",
											},
										}),
									}}
								/>
							</div>

							<div className="flex gap-3">
								<button
									onClick={() => {
										setIsAddToBankModalOpen(false);
										setSelectedQuestionForBank(null);
										setSelectedCategoryForAdd(null);
									}}
									className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-dark-3 transition-colors flex items-center justify-center gap-2"
								>
									<X className="w-4 h-4" />
									Cancel
								</button>
								<button
									onClick={handleAddToBank}
									disabled={!selectedCategoryForAdd}
									className={`flex-1 px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 ${
										selectedCategoryForAdd
											? "bg-primary text-white hover:bg-primary/90"
											: "bg-gray-300 text-gray-500 cursor-not-allowed"
									}`}
								>
									<Plus className="w-4 h-4" />
									Add to Bank
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Question Detail Modal */}
			<Modal
				title="Question Details"
				open={isDetailModalOpen}
				onClose={() => setIsDetailModalOpen(false)}
			>
				{detailLoading ? (
					<div className="flex justify-center items-center h-32">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
					</div>
				) : detailedQuestion ? (
					<div className="space-y-3">
						<div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
							<div className="flex items-start gap-2">
								<div className="flex-shrink-0 mt-0.5">
									<BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
								</div>
								<div>
									<h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-1 text-sm">
										Question Text
									</h4>
									<p className="text-gray-900 dark:text-white text-sm whitespace-pre-wrap">
										{detailedQuestion.question_text}
									</p>
								</div>
							</div>
						</div>

						<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
							<div className="bg-gray-50 dark:bg-dark-3 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
								<div className="flex items-center gap-1 mb-0.5">
									<Folder className="w-3 h-3 text-gray-500 dark:text-gray-400" />
									<h4 className="font-medium text-gray-700 dark:text-gray-300 text-[0.6rem]">
										Category
									</h4>
								</div>
								<p className="text-gray-900 dark:text-white text-xs">
									{detailedQuestion.category?.name ||
										"Uncategorized"}
								</p>
							</div>
							<div className="bg-gray-50 dark:bg-dark-3 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
								<div className="flex items-center gap-1 mb-0.5">
									<Type className="w-3 h-3 text-gray-500 dark:text-gray-400" />
									<h4 className="font-medium text-gray-700 dark:text-gray-300 text-[0.6rem]">
										Type
									</h4>
								</div>
								<p className="text-gray-900 dark:text-white text-xs">
									{detailedQuestion.question_type
										.replace(/_/g, " ")
										.toUpperCase()}
								</p>
							</div>
							<div className="bg-gray-50 dark:bg-dark-3 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
								<div className="flex items-center gap-1 mb-0.5">
									<Zap className="w-3 h-3 text-yellow-500" />
									<h4 className="font-medium text-gray-700 dark:text-gray-300 text-[0.6rem]">
										Points
									</h4>
								</div>
								<p className="text-gray-900 dark:text-white text-xs">
									{detailedQuestion.points || 0}
								</p>
							</div>
							<div className="bg-gray-50 dark:bg-dark-3 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
								<div className="flex items-center gap-1 mb-0.5">
									<Clock4 className="w-3 h-3 text-purple-500" />
									<h4 className="font-medium text-gray-700 dark:text-gray-300 text-[0.6rem]">
										Time Limit
									</h4>
								</div>
								<p className="text-gray-900 dark:text-white text-xs">
									{detailedQuestion.time_limit_seconds || 0}s
								</p>
							</div>
						</div>

						<div className="bg-gray-50 dark:bg-dark-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
							<div className="flex items-center gap-1.5 mb-2">
								<ListCollapse className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
								<h4 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">
									Options
								</h4>
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
								{detailedQuestion.options?.choices?.map(
									(choice: string, index: number) => (
										<div
											key={index}
											className={`p-2 rounded-lg border ${
												detailedQuestion.options?.correct_answer?.includes(
													index,
												)
													? "bg-green-50 dark:bg-green-900/20 border-green-500"
													: "bg-white dark:bg-dark-2 border-gray-200 dark:border-gray-700"
											}`}
										>
											<div className="flex items-start gap-1.5">
												<span
													className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[0.6rem] font-bold ${
														detailedQuestion.options?.correct_answer?.includes(
															index,
														)
															? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
															: "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
													}`}
												>
													{String.fromCharCode(
														65 + index,
													)}
												</span>
												<div className="flex-1">
													<span className="block text-gray-900 dark:text-white text-xs">
														{choice}
													</span>
													{detailedQuestion.options?.correct_answer?.includes(
														index,
													) && (
														<span className="inline-flex items-center gap-0.5 text-[0.5rem] px-1 py-0.5 mt-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full">
															<Check size={6} />
															Correct
														</span>
													)}
												</div>
											</div>
										</div>
									),
								)}
							</div>
						</div>

						{detailedQuestion.source_content_url && (
							<div className="bg-gray-50 dark:bg-dark-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
								<div className="flex items-center gap-1.5 mb-1">
									<Link className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
									<h4 className="font-medium text-gray-700 dark:text-gray-300 text-xs">
										Source URL
									</h4>
								</div>
								<a
									href={detailedQuestion.source_content_url}
									target="_blank"
									rel="noopener noreferrer"
									className="text-primary hover:underline break-all block text-xs"
								>
									{detailedQuestion.source_content_url}
								</a>
							</div>
						)}

						<div className="flex flex-wrap items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
							<div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
								<Calendar className="w-3.5 h-3.5" />
								Created:{" "}
								{formatDate(detailedQuestion.created_at)}
							</div>
							{detailedQuestion.is_ai_generated && (
								<span className="inline-flex items-center gap-1 text-[0.6rem] px-2 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-full font-medium">
									<AlertCircle size={8} />
									AI Gen
								</span>
							)}
						</div>
					</div>
				) : null}
			</Modal>
		</section>
	);
}
