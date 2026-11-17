"use client";

import { useSelector } from "react-redux";
import type { RootState } from "@/stores/store";
import StatsOverview from "@/features/dashboard/views/StatsOverview";
import { NewDeckCard } from "@/features/deck-library/NewDeckCard";

export default function Dashboard() {
	const user = useSelector((state: RootState) => state.auth.user);

	return (
		<div className="mx-4 flex min-h-screen flex-col gap-6 pb-20 font-[family-name:var(--font-geist-sans)] dark:bg-dark">
			<h3 className="mb-2 text-[2.25rem] font-bold text-[#222] dark:text-white">
				Welcome, <span className="text-primary">{user?.full_name}</span>!
			</h3>

			<h4 className="w-full max-w-6xl text-xl font-semibold text-[#222] dark:text-white">Quick Actions</h4>

			<div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				<NewDeckCard product="quiz" />
				<NewDeckCard product="quest" />
			</div>

			<StatsOverview />
		</div>
	);
}
