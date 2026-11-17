"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { productCopy } from "@/features/deck/productCopy";
import type { DeckProduct } from "@/features/deck/types";
import { DeckLibrarySection } from "@/features/deck-library/DeckLibrarySection";

const TABS: DeckProduct[] = ["quiz", "quest"];

/** My Library: the user's quizzes and quests, one tab each (?tab=quiz|quest). */
export default function MyLibraryPage() {
	const tab = useSearchParams().get("tab");
	const active: DeckProduct = tab === "quest" ? "quest" : "quiz";

	return (
		<div className="min-h-screen w-full overflow-auto p-4 scrollbar-hidden">
			<nav aria-label="Library" className="mb-6 flex gap-3">
				{TABS.map((product) => (
					<Link
						key={product}
						href={`/my-library?tab=${product}`}
						aria-current={product === active ? "page" : undefined}
						className={`rounded-[10px] border px-5 py-3 text-sm font-semibold transition-colors ${
							product === active
								? "border-primary bg-primary text-white"
								: "border-primary bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-7 dark:bg-dark-3 dark:text-white"
						}`}
					>
						{productCopy(product).Noun}
					</Link>
				))}
			</nav>

			<div className="w-full bg-white dark:bg-transparent">
				<DeckLibrarySection key={active} product={active} />
			</div>
		</div>
	);
}
