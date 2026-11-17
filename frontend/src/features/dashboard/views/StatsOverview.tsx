"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { FaRegListAlt, FaTasks } from "react-icons/fa";
import axiosInstance from "@/utils/axiosInstance";
import { productCopy } from "@/features/deck/productCopy";
import type { DeckProduct } from "@/features/deck/types";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

/** One product's decks by how far they got (backend DeckStatistics). */
interface DeckCounts {
	total: number;
	live: number;
	hosted: number;
	never_hosted: number;
}

/** GET /dashboard-statistics/dashboard */
interface DashboardStatistics {
	quizzes: DeckCounts;
	quests: DeckCounts;
	question_bank_count: number;
}

const PRODUCTS: { product: DeckProduct; key: "quizzes" | "quests"; accent: string; icon: ReactNode }[] = [
	{ product: "quiz", key: "quizzes", accent: "#ed3a76", icon: <FaRegListAlt size={32} /> },
	{ product: "quest", key: "quests", accent: "#BC5EB3", icon: <FaTasks size={32} /> },
];

const STATUS_LABELS = ["Live now", "Hosted", "Not hosted yet"];
const STATUS_COLORS = ["#ed3a76", "#fda148", "#BC5EB3"];

const CHART_OPTIONS = {
	chart: { toolbar: { show: false }, background: "transparent" },
	xaxis: { categories: STATUS_LABELS, labels: { style: { colors: STATUS_COLORS } } },
	colors: STATUS_COLORS,
	plotOptions: { bar: { borderRadius: 8, columnWidth: "40%", distributed: true } },
	dataLabels: { enabled: false },
	grid: { show: false, borderColor: "#f3f3fe" },
	tooltip: { theme: "dark" },
};

const panelClass =
	"bg-gradient-to-br from-white/80 via-white/90 to-white/80 backdrop-blur-sm dark:from-gray-900 dark:via-gray-800 dark:to-gray-900";

function Heading() {
	return <h4 className="mb-3 w-full text-xl font-semibold text-[#222] dark:text-white">Dashboard Overview</h4>;
}

function Skeleton() {
	return (
		<div aria-busy="true">
			<Heading />
			<div className="mb-3 grid w-full grid-cols-1 gap-6 sm:grid-cols-2">
				{PRODUCTS.map(({ product }) => (
					<div key={product} className={`flex items-center gap-4 rounded-2xl border border-[#ed3a76]/20 p-6 ${panelClass}`}>
						<div className="h-14 w-14 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
						<div>
							<div className="mb-2 h-6 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
							<div className="h-8 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
						</div>
					</div>
				))}
			</div>
			<div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
				{PRODUCTS.map(({ product }) => (
					<div key={product} className={`h-80 animate-pulse rounded-2xl border border-[#ed3a76]/10 p-6 ${panelClass}`} />
				))}
			</div>
		</div>
	);
}

/** Dashboard: how many quizzes and quests the user has, and how many were hosted. */
export default function StatsOverview() {
	const [stats, setStats] = useState<DashboardStatistics | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		axiosInstance
			.get<{ status: boolean; message: string; data: DashboardStatistics }>("/dashboard-statistics/dashboard")
			.then(({ data }) => (data.status ? setStats(data.data) : setError(data.message || "Failed to fetch statistics")))
			.catch(() => setError("Error fetching dashboard statistics"))
			.finally(() => setLoading(false));
	}, []);

	if (loading) return <Skeleton />;

	if (error || !stats) {
		return (
			<div className="rounded-lg bg-white p-6 dark:bg-[#020d1a]">
				<Heading />
				<p className="text-red-500">{error || "No data available"}</p>
			</div>
		);
	}

	return (
		<div>
			<Heading />
			<div className="mb-3 grid w-full grid-cols-1 gap-6 sm:grid-cols-2">
				{PRODUCTS.map(({ product, key, accent, icon }) => {
					const copy = productCopy(product);
					const label = `Total ${copy.plural}`;
					return (
						<Link
							key={product}
							href={copy.libraryHref}
							aria-label={`${label}: ${stats[key].total}. Open the list`}
							className={`group flex items-center gap-4 rounded-2xl border p-6 transition duration-200 hover:scale-[1.03] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${panelClass}`}
							style={{ borderColor: `${accent}33`, color: accent }}
						>
							<div className="flex items-center justify-center rounded-full border-2 border-gray-100 bg-white p-3 transition-transform duration-200 group-hover:scale-110 dark:border-gray-700 dark:bg-gray-800">
								<span className="transition-transform duration-200 group-hover:scale-125">{icon}</span>
							</div>
							<div>
								<div className="text-3xl font-extrabold group-hover:opacity-90">{stats[key].total}</div>
								<div className="text-base font-medium capitalize text-gray-700 dark:text-gray-200">{label}</div>
							</div>
							<ChevronRight className="ml-auto h-5 w-5 opacity-40 transition group-hover:translate-x-1 group-hover:opacity-100" aria-hidden />
						</Link>
					);
				})}
			</div>

			<div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
				{PRODUCTS.map(({ product, key, accent }) => {
					const counts = stats[key];
					return (
						<div key={product} className={`relative w-full overflow-hidden rounded-2xl border p-6 ${panelClass}`} style={{ borderColor: `${accent}1a` }}>
							<div className="absolute left-0 top-0 h-2 w-full rounded-t-2xl" style={{ background: accent }} />
							<h4 className="relative z-10 mb-4 text-lg font-semibold capitalize text-gray-800 dark:text-white">{productCopy(product).plural} status</h4>
							<div className="relative z-10 h-64 w-full">
								<Chart
									options={CHART_OPTIONS}
									series={[{ name: productCopy(product).plural, data: [counts.live, counts.hosted, counts.never_hosted] }]}
									type="bar"
									height={250}
								/>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
