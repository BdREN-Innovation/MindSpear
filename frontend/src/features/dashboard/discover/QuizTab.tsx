"use client";

import { useState, useEffect, useCallback } from "react";
import DiscoverCard, { CardItem } from "@/features/dashboard/discover/DiscoverCard";
import axiosInstance from "@/utils/axiosInstance";
import GlobalPagination from "@/components/GlobalPagination";
import Image from "next/image";
import { toast } from "react-toastify";

interface User {
	id: number;
	first_name: string;
	last_name: string;
	full_name: string;
	email: string;
	profile_picture?: string;
	designation?: string;
	institution_name?: string;
}

interface Quiz {
	id: number;
	title: string;
	description: string | null;
	is_published: boolean;
	is_live: boolean;
	participants_count?: number;
	duration?: number | null;
	category_id?: number | null;
	created_at: string;
	user?: User;
	open_datetime: string | null;
	close_datetime: string | null;
	quiztime_mode: boolean;
}

interface QuizApiResponse {
	status: boolean;
	message: string;
	data: {
		quizes: {
			current_page: number;
			data: Quiz[];
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
		};
	};
}

/**
 * Public v1 quizzes. `legacy`: shown under the v2 Discover list, so it renders
 * nothing while loading or when there are none, under a "Classic" heading.
 */
export default function QuizTab({ legacy = false }: { legacy?: boolean }) {
	const [quizzes, setQuizzes] = useState<CardItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [currentPage, setCurrentPage] = useState(1);
	const [totalItems, setTotalItems] = useState(0);
	const [itemsPerPage, setItemsPerPage] = useState(12);

	const fetchQuizzes = useCallback(async () => {
		try {
			setLoading(true);
			const response = await axiosInstance.get<QuizApiResponse>(
				`/quizes-public?page=${currentPage}&per_page=${itemsPerPage}`,
			);

			if (response.data.status) {
				const quizData = response.data.data.quizes;
				const quizzesList = quizData.data || [];

				const transformedQuizzes: CardItem[] = quizzesList.map(
					(quiz: Quiz) => {
						const createdDate = new Date(quiz.created_at);
						const now = new Date();
						const diffTime = Math.abs(
							now.getTime() - createdDate.getTime(),
						);
						const diffDays = Math.ceil(
							diffTime / (1000 * 60 * 60 * 24),
						);

						let lastUpdated = "";
						if (diffDays === 1) {
							lastUpdated = "1 day ago";
						} else if (diffDays < 7) {
							lastUpdated = `${diffDays} days ago`;
						} else if (diffDays < 30) {
							const weeks = Math.floor(diffDays / 7);
							lastUpdated = `${weeks} week${weeks > 1 ? "s" : ""} ago`;
						} else {
							lastUpdated = createdDate.toLocaleDateString();
						}

						const isFeatured = Math.random() > 0.7;

						return {
							id: quiz.id.toString(),
							title: quiz.title,
							description:
								quiz.description ||
								"Test your knowledge with this engaging quiz",
							participants:
								quiz.participants_count ||
								Math.floor(Math.random() * 1000) + 100,
							difficulty: ["Easy", "Medium", "Hard"][
								Math.floor(Math.random() * 3)
							] as "Easy" | "Medium" | "Hard",
							duration: quiz.duration
								? `${quiz.duration} min`
								: `${Math.floor(Math.random() * 30) + 10} min`,
							category: [
								"Science",
								"Technology",
								"History",
								"Geography",
								"Mathematics",
							][Math.floor(Math.random() * 5)],
							rating:
								Math.round((Math.random() * 2 + 3) * 10) / 10,
							featured: isFeatured,
							downloads: Math.floor(Math.random() * 5000) + 100,
							views: Math.floor(Math.random() * 10000) + 500,
							author: quiz.user?.full_name || "Quiz Creator",
							lastUpdated: lastUpdated,
							type: "Quiz" as const,
						};
					},
				);

				setQuizzes(transformedQuizzes);
				setTotalItems(quizData.total || 0);
			}
		} catch (error) {
			console.error("Error fetching quizzes:", error);
			setQuizzes([]);
			setTotalItems(0);
		} finally {
			setLoading(false);
		}
	}, [currentPage, itemsPerPage]);

	useEffect(() => {
		fetchQuizzes();
	}, []);

	const handlePageChange = (page: number, pageSize?: number) => {
		const newSize = Number(pageSize);

		if (newSize && newSize !== itemsPerPage) {
			setItemsPerPage(newSize);
			setCurrentPage(1);
			window.scrollTo({ top: 0, behavior: "smooth" });
		} else {
			setCurrentPage(page);
			window.scrollTo({ top: 0, behavior: "smooth" });
		}
	};

	const handleCardClick = (item: CardItem) => {
		console.log("Quiz clicked:", item);
	};

	const handleImportTemplate = (item: CardItem) => {
		toast.error(`Importing "${item.title}" to your library...`);
	};

	const handlePreviewTemplate = (item: CardItem) => {
		toast.error(`Opening preview for "${item.title}"...`);
	};

	if (loading && legacy) return null;

	if (loading) {
		return (
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8 auto-rows-fr">
				{Array.from({ length: 8 }).map((_, i) => (
					<div
						key={i}
						className="bg-white rounded-2xl border border-gray-200 animate-pulse h-full"
					>
						<div className="h-32 bg-gray-200 rounded-t-2xl"></div>
						<div className="p-5 space-y-3">
							<div className="h-4 bg-gray-200 rounded"></div>
							<div className="h-4 bg-gray-200 rounded w-2/3"></div>
							<div className="h-10 bg-gray-200 rounded"></div>
						</div>
					</div>
				))}
			</div>
		);
	}

	if (legacy && totalItems === 0) return null;

	return (
		<>
			{legacy ? (
				<div className="mb-4 border-t border-gray-200 pt-8">
					<h3 className="text-lg font-semibold text-gray-900">Classic quizzes</h3>
					<p className="text-sm text-gray-600">Shared from the previous quiz editor.</p>
				</div>
			) : null}
			{totalItems > 0 && (
				<div className="mb-6 text-sm text-gray-600">
					Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
					{Math.min(currentPage * itemsPerPage, totalItems)} of{" "}
					{totalItems} quizzes
				</div>
			)}

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8 auto-rows-fr">
				{quizzes.map((item) => (
					<DiscoverCard
						key={item.id}
						item={item}
						onClick={() => handleCardClick(item)}
						onImport={handleImportTemplate}
						onPreview={handlePreviewTemplate}
					/>
				))}
			</div>

			{totalItems > 0 && (
				<div className="mt-6">
					<GlobalPagination
						current={currentPage}
						total={totalItems}
						pageSize={itemsPerPage}
						onChange={handlePageChange}
					/>
				</div>
			)}

			{quizzes.length === 0 && !loading && (
				<div className="text-center py-20 bg-white rounded-3xl border border-gray-100">
					<div className="w-24 h-24 mx-auto mb-6 bg-gray-100 rounded-full flex items-center justify-center">
						<Image
							src="/images/icons/quiz.svg"
							alt="No Quizzes"
							width={48}
							height={48}
							className="text-gray-400"
						/>
					</div>
					<h3 className="text-2xl font-bold text-gray-900 mb-3">
						No quizzes available
					</h3>
					<p className="text-gray-600 max-w-md mx-auto">
						{`We're working on bringing you amazing quiz content. Check back soon!`}
					</p>
				</div>
			)}
		</>
	);
}
