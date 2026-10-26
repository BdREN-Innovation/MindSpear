import { FaRegListAlt, /* FaPoll, */ FaTasks } from "react-icons/fa";
import { ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import axiosInstance from "@/utils/axiosInstance";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

// Define the response type
interface DashboardStatisticsResponse {
	status: boolean;
	message: string;
	data: {
		total_quiz_count: number;
		total_survey_count: number;
		total_quest_count: number;
		total_question_bank_count: number;
		quizzes_count: {
			live: number;
			completed: number;
			upcoming: number;
		};
		surveys_count: {
			live: number;
			completed: number;
			upcoming: number;
		};
		quests_count: {
			live: number;
			completed: number;
			upcoming: number;
		};
	};
}

const StatsOverview = () => {
	const [stats, setStats] = useState<DashboardStatisticsResponse['data'] | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const fetchStats = async () => {
			try {
				const response = await axiosInstance.get<DashboardStatisticsResponse>('/dashboard-statistics/dashboard');
				if (response.data.status) {
					setStats(response.data.data);
				} else {
					setError(response.data.message || 'Failed to fetch statistics');
				}
			} catch (err) {
				setError('Error fetching dashboard statistics');
				console.error('Error fetching dashboard statistics:', err);
			} finally {
				setLoading(false);
			}
		};

		fetchStats();
	}, []);

	if (loading) {
		return (
			<div>
				{/* Stats Cards Skeleton */}
				<h4 className="text-xl font-semibold text-[#222] dark:text-white w-full mb-3">
					Dashboard Overview
				</h4>
				<div className="grid grid-cols-1 mb-3 sm:grid-cols-2 gap-6 w-full">
					{[1, 2].map((item) => (
						<div
							key={item}
							className={`
								flex items-center gap-4
								bg-gradient-to-br from-white/80 via-white/90 to-white/80 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900
								rounded-2xl border border-[#ed3a76]/20
								p-6 transition-transform duration-200
								hover:scale-[1.03] hover:shadow-lg
								backdrop-blur-sm
							`}
						>
							<div className="bg-gray-200 dark:bg-gray-700 p-3 rounded-full animate-pulse">
								<div className="w-8 h-8 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
							</div>
							<div>
								<div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-2 animate-pulse"></div>
								<div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-16 animate-pulse"></div>
							</div>
						</div>
					))}
				</div>

				{/* Charts Skeleton */}
				<div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
					{[1, 2].map((item) => (
						<div
							key={item}
							className={`
								relative
								bg-gradient-to-br from-white/80 via-white/90 to-white/80 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900
								rounded-2xl border border-[#ed3a76]/10
								p-6 w-full overflow-hidden
								backdrop-blur-sm
							`}
						>
							<div className="absolute top-0 left-0 w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-t-2xl animate-pulse" />
							<div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4 animate-pulse"></div>
							<div className="w-full h-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
						</div>
					))}
				</div>

				{/* Additional Stats Section Skeleton */}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
					{[1, 2, 3].map((item) => (
						<div key={item} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
							<div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-4 animate-pulse"></div>
							<div className="space-y-2">
								<div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
								<div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
								<div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
							</div>
						</div>
					))}
				</div>

				{/* Question Banks Skeleton */}
				<div className="mt-6 bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
					<div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4 animate-pulse"></div>
					<div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4 animate-pulse"></div>
				</div>
			</div>
		);
	}

	if (error || !stats) {
		return (
			<div className="p-6 bg-white dark:bg-[#020d1a] rounded-lg">
				<h4 className="text-xl font-semibold text-[#222] dark:text-white w-full mb-3">
					Dashboard Overview
				</h4>
				<p className="text-red-500">{error || 'No data available'}</p>
			</div>
		);
	}
	// Chart data for Quiz items
	const quizChartOptions = {
		chart: {
			toolbar: { show: false },
			background: "transparent"
		},
		xaxis: {
			categories: ["Live", "Completed", "Upcoming"],
			labels: {
				style: {
					colors: ['#ed3a76', '#fda148', '#BC5EB3']
				}
			}
		},
		colors: ["#ed3a76", "#fda148", "#BC5EB3"],
		plotOptions: {
			bar: {
				borderRadius: 8,
				columnWidth: "40%",
				distributed: true
			}
		},
		dataLabels: { enabled: false },
		grid: {
			show: false,
			borderColor: "#f3f3fe",
		},
		tooltip: {
			theme: 'dark'
		}
	};

	const quizChartSeries = [
		{
			name: "Quizzes",
			data: [
				stats.quizzes_count.live,
				stats.quizzes_count.completed,
				stats.quizzes_count.upcoming
			]
		},
	];

	// Chart data for Survey items
	/* Surveys are switched off for now.
	const surveyChartOptions = {
		chart: {
			toolbar: { show: false },
			background: "transparent"
		},
		xaxis: {
			categories: ["Live", "Completed", "Upcoming"],
			labels: {
				style: {
					colors: ['#ed3a76', '#fda148', '#BC5EB3']
				}
			}
		},
		colors: ["#ed3a76", "#fda148", "#BC5EB3"],
		plotOptions: {
			bar: {
				borderRadius: 8,
				columnWidth: "40%",
				distributed: true
			}
		},
		dataLabels: { enabled: false },
		grid: {
			show: false,
			borderColor: "#f3f3fe",
		},
		tooltip: {
			theme: 'dark'
		}
	};

	const surveyChartSeries = [
		{
			name: "Surveys",
			data: [
				stats.surveys_count.live,
				stats.surveys_count.completed,
				stats.surveys_count.upcoming
			]
		},
	];
	*/

	// Chart data for Quest items
	const questChartOptions = {
		chart: {
			toolbar: { show: false },
			background: "transparent"
		},
		xaxis: {
			categories: ["Live", "Completed", "Upcoming"],
			labels: {
				style: {
					colors: ['#ed3a76', '#fda148', '#BC5EB3']
				}
			}
		},
		colors: ["#ed3a76", "#fda148", "#BC5EB3"],
		plotOptions: {
			bar: {
				borderRadius: 8,
				columnWidth: "40%",
				distributed: true
			}
		},
		dataLabels: { enabled: false },
		grid: {
			show: false,
			borderColor: "#f3f3fe",
		},
		tooltip: {
			theme: 'dark'
		}
	};

	const questChartSeries = [
		{
			name: "Quests",
			data: [
				stats.quests_count.live,
				stats.quests_count.completed,
				stats.quests_count.upcoming
			]
		},
	];

	// Stats data for the cards
	const statsData = [
		{
			label: "Total Quizzes",
			value: stats.total_quiz_count,
			href: "/my-library/quiz-page",
			icon: <FaRegListAlt size={32} />,
			gradient: "#ed3a76",
			color: "text-[#ed3a76]",
			border: "border-[#ed3a76]/20",
		},
		// Surveys are switched off for now.
		// {
		// 	label: "Total Surveys",
		// 	value: stats.total_survey_count,
		// 	href: "/my-library/survey-page",
		// 	icon: <FaPoll size={32} />,
		// 	gradient: "#fda148",
		// 	color: "text-[#fda148]",
		// 	border: "border-[#fda148]/20",
		// },
		{
			label: "Total Quests",
			value: stats.total_quest_count,
			href: "/my-library/quest-page",
			icon: <FaTasks size={32} />,
			gradient: "#BC5EB3",
			color: "text-[#BC5EB3]",
			border: "border-[#BC5EB3]/20",
		}
	];

	return (
		<div>
			{/* Stats Cards */}
			{/* Section Title */}
			<h4 className="text-xl font-semibold text-[#222] dark:text-white w-full mb-3">
				Dashboard Overview
			</h4>
			<div className="grid grid-cols-1 mb-3 sm:grid-cols-2 gap-6 w-full ">
				{/* Each card opens its list in My Library. */}
				{statsData.map((item) => (
					<Link
						key={item.label}
						href={item.href}
						aria-label={`${item.label}: ${item.value}. Open the list`}
						className={`
              group flex items-center gap-4
              bg-gradient-to-br from-white/80 via-white/90 to-white/80 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900
              rounded-2xl border ${item.border}
              p-6 transition duration-200
              hover:scale-[1.03] hover:shadow-md
              focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
              backdrop-blur-sm
            `}
					>
						<div
							className={`
                bg-white dark:bg-gray-800
                p-3 rounded-full border-2 border-gray-100 dark:border-gray-700
                
                transition-transform duration-200 group-hover:scale-110
                flex items-center justify-center
              `}
						>
							<span
								className={`
                  ${item.color}
                  transition-transform duration-200 group-hover:scale-125
                `}
							>
								{item.icon}
							</span>
						</div>
						<div>
							<div
								className={`text-3xl font-extrabold ${item.color} group-hover:opacity-90`}
							>
								{item.value}
							</div>
							<div className="text-gray-700 dark:text-gray-200 text-base font-medium">
								{item.label}
							</div>
						</div>
						<ChevronRight
							className={`ml-auto h-5 w-5 opacity-40 transition group-hover:translate-x-1 group-hover:opacity-100 ${item.color}`}
							aria-hidden
						/>
					</Link>
				))}
			</div>

			{/* Charts Section - Total Overview with three charts for each type */}
			<div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
				{/* Quiz Charts */}
				<div
					className={`
            relative
            bg-gradient-to-br from-white/80 via-white/90 to-white/80 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900
            rounded-2xl border border-[#ed3a76]/10
            p-6 w-full overflow-hidden
            backdrop-blur-sm
          `}
				>
					<div className="absolute top-0 left-0 w-full h-2 bg-[#ed3a76] rounded-t-2xl" />
					<h4 className="text-lg font-semibold mb-4 text-gray-800 dark:text-white z-10 relative">
						Quizzes Status
					</h4>
					<div className="w-full h-64 z-10 relative">
						<Chart
							options={quizChartOptions}
							series={quizChartSeries}
							type="bar"
							height={250}
						/>
					</div>
				</div>

				{/* Survey Charts (surveys are switched off for now)
				<div
					className={`
            relative
            bg-gradient-to-br from-white/80 via-white/90 to-white/80 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900
            rounded-2xl border border-primary/10
            p-6 w-full overflow-hidden
            backdrop-blur-sm
          `}
				>
					<div className="absolute top-0 left-0 w-full h-2 bg-primary rounded-t-2xl" />
					<h4 className="text-lg font-semibold mb-4 text-gray-800 dark:text-white z-10 relative">
						Surveys Status
					</h4>
					<div className="w-full h-64 z-10 relative">
						<Chart
							options={surveyChartOptions}
							series={surveyChartSeries}
							type="bar"
							height={250}
						/>
					</div>
				</div>
				*/}

				{/* Quest Charts */}
				<div
					className={`
            relative
            bg-gradient-to-br from-white/80 via-white/90 to-white/80 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900
            rounded-2xl border border-secondary/10
            p-6 w-full overflow-hidden
            backdrop-blur-sm
          `}
				>
					<div className="absolute top-0 left-0 w-full h-2 bg-secondary rounded-t-2xl" />
					<h4 className="text-lg font-semibold mb-4 text-gray-800 dark:text-white z-10 relative">
						Quests Status
					</h4>
					<div className="w-full h-64 z-10 relative">
						<Chart
							options={questChartOptions}
							series={questChartSeries}
							type="bar"
							height={250}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

export default StatsOverview