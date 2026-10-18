"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Layers, PencilLine, Play, Trophy, Users } from "lucide-react";
import type { DeckProduct, HostSessionState, LeaderboardEntry, LeaderboardResponse } from "@/features/deck/types";
import { productCopy } from "@/features/deck-editor/components/productCopy";
import { formatDuration } from "../lib/format";
import { runKindOf } from "../lib/runKind";

// After End (or session.ended from another tab): what happened, and where
// to go next. Presenting again starts a brand-new session (new join code).
// Quiz sessions also show the final top three (GET .../leaderboard?limit=3).

export interface SessionSummaryProps {
	deckId: number;
	/** Default quest. */
	product?: DeckProduct;
	state: HostSessionState | null;
	participantCount: number | null;
	onPresentAgain: () => void;
	/** Quiz: reads the final ranking. */
	loadLeaderboard?: (limit: number) => Promise<LeaderboardResponse>;
}

const PODIUM = ["🥇", "🥈", "🥉"];

export function SessionSummary({
	deckId,
	product = "quest",
	state,
	participantCount,
	onPresentAgain,
	loadLeaderboard,
}: SessionSummaryProps) {
	const copy = productCopy(product);
	const session = state?.session;
	const runs = state?.runs ?? [];
	const quiz = product === "quiz";
	const shown = quiz
		? runs.filter((run) => run.state === "reveal" && runKindOf(run) === "quiz").length
		: runs.filter((run) => run.state === "closed").length;
	const duration = formatDuration(session?.started_at, session?.ended_at);
	const stats = [
		{ icon: Users, label: "Participants", value: `${participantCount ?? state?.participant_count ?? 0}` },
		{ icon: Layers, label: "Slides", value: `${session?.total_slides ?? runs.length}` },
		...(shown ? [{ icon: CheckCircle2, label: quiz ? "Questions played" : "Votes closed", value: `${shown}` }] : []),
		...(duration ? [{ icon: Clock, label: "Duration", value: duration }] : []),
	];

	const [top, setTop] = useState<LeaderboardEntry[] | null>(null);
	useEffect(() => {
		if (!loadLeaderboard) return;
		let active = true;
		loadLeaderboard(3)
			.then((response) => {
				if (active) setTop(response.leaderboard.slice(0, 3));
			})
			.catch(() => {
				// The podium is a nice-to-have: the summary works without it.
			});
		return () => {
			active = false;
		};
	}, [loadLeaderboard]);

	return (
		<main className="flex h-full w-full items-center justify-center overflow-y-auto bg-[var(--deck-bg)] p-6 text-[var(--deck-text)]">
			<div className="w-full max-w-2xl rounded-3xl border border-[var(--deck-border)] bg-[var(--deck-surface)] p-8 text-center shadow-xl">
				<CheckCircle2 className="mx-auto h-14 w-14 text-[var(--deck-success)]" aria-hidden />
				<h1 className="mt-4 text-3xl font-bold" role="status">
					Session ended
				</h1>
				{session?.deck_title && <p className="mt-1 text-lg text-[var(--deck-text-muted)]">{session.deck_title}</p>}
				<p className="mt-3 text-base text-[var(--deck-text-muted)]">
					{quiz
						? "Answering is over and participants were disconnected. They can still review their answers and points."
						: "Voting is closed and participants were disconnected. They can still review their answers."}
				</p>

				{top && top.length > 0 && (
					<section aria-labelledby="ms-summary-podium" className="mt-6">
						<h2
							id="ms-summary-podium"
							className="flex items-center justify-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--deck-text-muted)]"
						>
							<Trophy className="h-4 w-4" aria-hidden /> Top players
						</h2>
						<ol className="mx-auto mt-3 flex max-w-md flex-col gap-2 text-left">
							{top.map((row, index) => (
								<li
									key={row.participant_id}
									className="flex items-center gap-3 rounded-2xl bg-[var(--deck-surface-muted)] px-4 py-3"
								>
									<span className="w-8 text-center text-2xl" aria-hidden>
										{PODIUM[row.rank - 1] ?? PODIUM[index] ?? ""}
									</span>
									<span className="sr-only">Rank {row.rank}:</span>
									<span className="text-2xl leading-none" aria-hidden>
										{row.emoji_avatar}
									</span>
									<span className="min-w-0 flex-1 truncate text-lg font-semibold">{row.display_name ?? "Player"}</span>
									<span className="text-lg font-bold tabular-nums">{row.total_points} pts</span>
								</li>
							))}
						</ol>
					</section>
				)}

				<dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
					{stats.map(({ icon: Icon, label, value }) => (
						<div key={label} className="rounded-2xl bg-[var(--deck-surface-muted)] px-3 py-4">
							<Icon className="mx-auto h-5 w-5 text-[var(--deck-text-muted)]" aria-hidden />
							{/* dt before dd for screen readers; the value reads first on screen. */}
							<div className="mt-1 flex flex-col-reverse">
								<dt className="text-sm text-[var(--deck-text-muted)]">{label}</dt>
								<dd className="text-2xl font-bold tabular-nums">{value}</dd>
							</div>
						</div>
					))}
				</dl>

				<div className="mt-8 flex flex-wrap justify-center gap-3">
					<Link
						href={copy.editHref(deckId)}
						className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--deck-primary)] px-5 font-semibold text-[var(--deck-on-primary)] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--deck-focus)] focus-visible:ring-offset-2"
					>
						<PencilLine className="h-5 w-5" aria-hidden /> Back to the editor
					</Link>
					<Link
						href={copy.libraryHref}
						className="inline-flex min-h-12 items-center rounded-xl border border-[var(--deck-border)] px-5 font-semibold hover:bg-[var(--deck-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--deck-focus)]"
					>
						My Library
					</Link>
					<button
						type="button"
						onClick={onPresentAgain}
						className="inline-flex min-h-12 items-center gap-2 rounded-xl px-5 font-semibold text-[var(--deck-text-muted)] hover:bg-[var(--deck-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--deck-focus)]"
					>
						<Play className="h-5 w-5" aria-hidden /> Present again
					</button>
				</div>
			</div>
		</main>
	);
}
