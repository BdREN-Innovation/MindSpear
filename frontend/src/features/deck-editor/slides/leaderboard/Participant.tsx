"use client";

import { leaderboardLimit } from "@/features/deck/lib/quiz";
import type { ParticipantProps } from "../types";
import { ParticipantLayout, ParticipantNotice } from "../shared/participantKit";
import { formatPoints, plural, quizDisplayTitle, rankLabel } from "../shared/quizLabels";
import { LeaderboardBoard } from "./Board";

// leaderboard on the phone: the same ranking, my row highlighted as
// "You (#4)" and scrolled to the middle; when I'm outside the top N my own
// place is pinned under the list.

export function LeaderboardParticipant({ run, theme, quiz, standing }: ParticipantProps<"leaderboard">) {
	const limit = leaderboardLimit(run.config);
	const rows = (quiz?.slide_run_id === run.id ? quiz.leaderboard : null)?.slice(0, limit) ?? null;
	const meId = quiz?.participant_id ?? standing?.participant_id ?? null;
	const inList = rows?.some((row) => row.participant_id === meId) ?? false;
	const total = quiz?.participant_count ?? null;
	const myRank = rankLabel(standing?.rank, total);

	return (
		<ParticipantLayout theme={theme} title={quizDisplayTitle(run.title, "leaderboard")} subtitle={total !== null ? plural(total, "player") : undefined}>
			{rows === null ? (
				<ParticipantNotice>Loading the leaderboard…</ParticipantNotice>
			) : rows.length === 0 ? (
				<ParticipantNotice>No scores yet — answer the next question to get on the board.</ParticipantNotice>
			) : (
				<LeaderboardBoard runId={run.id} rows={rows} meId={meId} variant="phone" />
			)}
			{standing && !inList ? (
				<div
					role="status"
					className="flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 px-3 py-2"
					style={{
						borderColor: "var(--deck-primary, #F79945)",
						background: "color-mix(in srgb, var(--deck-primary, #F79945) 18%, var(--deck-surface, #fff))",
						color: "var(--deck-text, #111928)",
					}}
				>
					<span className="font-bold">{myRank ? `You (${myRank})` : "You"}</span>
					<span className="font-extrabold tabular-nums">{formatPoints(standing.total_points)} points</span>
				</div>
			) : null}
		</ParticipantLayout>
	);
}
