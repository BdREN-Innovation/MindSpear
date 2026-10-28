/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import { useState, useEffect } from 'react';
import DiscoverCard, { CardItem } from '@/features/dashboard/discover/DiscoverCard';
import axiosInstance from '@/utils/axiosInstance';
import GlobalPagination from '@/components/GlobalPagination';
import Image from 'next/image';
import { toast } from 'react-toastify';

interface Creator {
	id: number;
	first_name: string;
	last_name: string;
	full_name: string;
	email: string;
	profile_picture?: string;
	designation?: string;
	institution_name?: string;
}

interface Quest {
	id: number;
	title: string;
	description: string | null;
	is_published: boolean;
	start_datetime: string;
	end_datetime: string;
	participants_count?: number;
	duration?: string;
	category?: string;
	rating?: number;
	created_at: string;
	creator?: Creator;
}

interface QuestApiResponse {
	status: boolean;
	message: string;
	data: {
		quests: {
			data: Quest[];
			current_page: number;
			last_page: number;
			per_page: number;
			total: number;
		};
	};
}

/**
 * Public v1 quests. `legacy`: shown under the v2 Discover list, so it renders
 * nothing while loading or when there are none, under a "Classic" heading.
 */
export default function QuestTab({ legacy = false }: { legacy?: boolean }) {
	const [quests, setQuests] = useState<CardItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [currentPage, setCurrentPage] = useState(1);
	const [totalItems, setTotalItems] = useState(0);
	const [itemsPerPage, setItemsPerPage] = useState(8);

	const fetchQuests = async () => {
		try {
			setLoading(true);
			const response = await axiosInstance.get<QuestApiResponse>(
				`/quests-public?page=${currentPage}&per_page=${itemsPerPage}`
			);

			if (response.data.status) {
				const questData = response.data.data.quests;
				const questsList = questData.data || [];

				const transformedQuests: CardItem[] = questsList.map((quest: Quest) => {
					let duration = quest.duration || '';

					if (quest.start_datetime && quest.end_datetime) {
						try {
							const start = new Date(quest.start_datetime);
							const end = new Date(quest.end_datetime);
							const durationMs = end.getTime() - start.getTime();

							if (durationMs > 0) {
								const durationMinutes = Math.floor(durationMs / (1000 * 60));
								const durationHours = Math.floor(durationMinutes / 60);
								const durationDays = Math.floor(durationHours / 24);

								if (durationDays > 0) {
									duration = `${durationDays} day${durationDays > 1 ? 's' : ''}`;
								} else if (durationHours > 0) {
									duration = `${durationHours} hr${durationHours > 1 ? 's' : ''} ${durationMinutes % 60} min`;
								} else {
									duration = `${durationMinutes} min`;
								}
							}
						} catch (error) {
							console.error('Error calculating duration:', error);
						}
					}

					const createdDate = new Date(quest.created_at);
					const now = new Date();
					const diffTime = Math.abs(now.getTime() - createdDate.getTime());
					const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

					let lastUpdated = '';
					if (diffDays === 1) {
						lastUpdated = '1 day ago';
					} else if (diffDays < 7) {
						lastUpdated = `${diffDays} days ago`;
					} else if (diffDays < 30) {
						const weeks = Math.floor(diffDays / 7);
						lastUpdated = `${weeks} week${weeks > 1 ? 's' : ''} ago`;
					} else {
						lastUpdated = createdDate.toLocaleDateString();
					}

					return {
						id: quest.id.toString(),
						title: quest.title,
						description: quest.description || 'Embark on an exciting interactive journey filled with challenges and discoveries',
						participants: quest.participants_count || Math.floor(Math.random() * 2000) + 200,
						difficulty: ['Easy', 'Medium', 'Hard'][Math.floor(Math.random() * 3)] as 'Easy' | 'Medium' | 'Hard',
						duration: duration || `${Math.floor(Math.random() * 60) + 30} min`,
						category: quest.category || ['Adventure', 'Mystery', 'Fantasy', 'Historical'][Math.floor(Math.random() * 4)],
						rating: quest.rating || Math.round((Math.random() * 2 + 3) * 10) / 10,
						featured: Math.random() > 0.6,
						downloads: Math.floor(Math.random() * 5000) + 100,
						views: Math.floor(Math.random() * 10000) + 500,
						author: quest.creator?.full_name || 'Adventure Creator',
						lastUpdated: lastUpdated,
						type: 'Quest' as const
					};
				});

				setQuests(transformedQuests);
				setTotalItems(questData.total || 0);
			}
		} catch (error) {
			console.error('Error fetching quests:', error);
			setQuests([]);
			setTotalItems(0);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchQuests();
	}, [currentPage, itemsPerPage]);

	const handlePageChange = (page: number, pageSize?: number) => {
		const newSize = Number(pageSize);

		if (newSize && newSize !== itemsPerPage) {
			setItemsPerPage(newSize);
			setCurrentPage(1);
			window.scrollTo({ top: 0, behavior: 'smooth' });
		} else {
			setCurrentPage(page);
			window.scrollTo({ top: 0, behavior: 'smooth' });
		}
	};

	const handleCardClick = (item: CardItem) => {
		console.log('Quest clicked:', item);
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
					<div key={i} className="bg-white rounded-2xl border border-gray-200 animate-pulse h-full">
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
					<h3 className="text-lg font-semibold text-gray-900">Classic quests</h3>
					<p className="text-sm text-gray-600">Shared from the previous quest editor.</p>
				</div>
			) : null}
			{totalItems > 0 && (
				<div className="mb-6 text-sm text-gray-600">
					Showing {(currentPage - 1) * itemsPerPage + 1} to{' '}
					{Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} quests
				</div>
			)}

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8 auto-rows-fr">
				{quests.map((item) => (
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

			{quests.length === 0 && !loading && (
				<div className="text-center py-20 bg-white rounded-3xl border border-gray-100">
					<div className="w-24 h-24 mx-auto mb-6 bg-gray-100 rounded-full flex items-center justify-center">
						<Image
							src="/images/icons/quest.svg"
							alt="No Quests"
							width={48}
							height={48}
							className="text-gray-400"
						/>
					</div>
					<h3 className="text-2xl font-bold text-gray-900 mb-3">No quests available</h3>
					<p className="text-gray-600 max-w-md mx-auto">
						{`We're working on bringing you amazing quest content. Check back soon!`}
					</p>
				</div>
			)}
		</>
	);
}