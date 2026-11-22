"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History, PencilLine } from "lucide-react";
import { Skeleton } from "@/components/ui";
import { deckEditUrl, formatDate, legacyResultsApi, type LegacyItem } from "../api";

/** /past-results: the owner's quizzes and quests from the previous version that people took part in. */
export function PastResultsListView() {
	const [items, setItems] = useState<LegacyItem[] | null>(null);
	const [error, setError] = useState(false);

	useEffect(() => {
		legacyResultsApi
			.list()
			.then(setItems)
			.catch(() => setError(true));
	}, []);

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
			<header>
				<h1 className="flex items-center gap-2 text-2xl font-bold text-dark dark:text-white">
					<History className="h-7 w-7 text-primary" aria-hidden />
					Past results
				</h1>
				<p className="mt-1 text-sm text-dark-5">
					Sessions, participants and answers from quizzes and quests you ran in the previous version of Mindspear. The quizzes and
					quests themselves are in your library.
				</p>
			</header>

			{error && <p className="rounded-lg bg-red-light-6 p-4 text-sm text-red">Past results could not be loaded. Please try again.</p>}

			{!error && items === null && (
				<div className="space-y-3">
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} className="h-16 w-full" />
					))}
				</div>
			)}

			{items !== null && items.length === 0 && (
				<p className="rounded-lg border border-dashed border-stroke p-8 text-center text-sm text-dark-5 dark:border-dark-3">
					You have no results from the previous version.
				</p>
			)}

			{items !== null && items.length > 0 && (
				<ul className="divide-y divide-stroke overflow-hidden rounded-xl border border-stroke bg-white dark:divide-dark-3 dark:border-dark-3 dark:bg-gray-dark">
					{items.map((item) => (
						<li key={`${item.source}-${item.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
							<span
								className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
									item.source === "quiz" ? "bg-primary/15 text-dark dark:text-white" : "bg-secondary/15 text-secondary"
								}`}
							>
								{item.source === "quiz" ? "Quiz" : "Quest"}
							</span>
							<Link
								href={`/past-results/${item.source}/${item.id}`}
								className="min-w-0 flex-1 truncate font-semibold text-dark hover:text-primary dark:text-white"
							>
								{item.title || "Untitled"}
							</Link>
							<span className="text-sm text-dark-5">
								{item.sessions} {item.sessions === 1 ? "session" : "sessions"} · {item.participants}{" "}
								{item.participants === 1 ? "participant" : "participants"}
							</span>
							<span className="text-sm text-dark-5">Last played {formatDate(item.last_played_at)}</span>
							{item.deck_id !== null && (
								<Link
									href={deckEditUrl(item.source, item.deck_id)}
									className="flex items-center gap-1 text-sm text-dark-5 hover:text-primary"
									title="Open the converted copy in the editor"
								>
									<PencilLine className="h-4 w-4" aria-hidden /> Open in editor
								</Link>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
