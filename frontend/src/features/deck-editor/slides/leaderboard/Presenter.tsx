"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { leaderboardLimit } from "@/features/deck/lib/quiz";
import type { LeaderboardEntry } from "@/features/deck/types";
import type { PresenterProps } from "../types";
import { PresenterStage } from "../shared";
import { plural, quizFallbackTitle } from "../shared/quizLabels";
import { QuizHeader, StageMessage } from "../shared/quizPresenter";
import { LeaderboardBoard, sampleBoardRows } from "./Board";

// leaderboard on the big screen (plan §3.2): title, player count and the top
// N with emoji avatars, points and the "+94" of the last question; rows move
// from the previous ranking to the new one. Rows come from the live quiz
// block (leaderboard.updated / state); if they are missing, GET leaderboard.

export function LeaderboardPresenter({ run, theme, mode, quiz, host }: PresenterProps<"leaderboard">) {
	const limit = leaderboardLimit(run.config);
	const live = quiz?.slide_run_id === run.id ? quiz.leaderboard : null;
	const [loaded, setLoaded] = useState<{ runId: number; rows: LeaderboardEntry[]; count: number } | null>(null);
	const load = host?.loadLeaderboard;

	useEffect(() => {
		if (mode !== "live" || live || !load) return;
		let cancelled = false;
		load(limit)
			.then((response) => {
				if (!cancelled) setLoaded({ runId: run.id, rows: response.leaderboard, count: response.participant_count });
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [mode, live, load, limit, run.id]);

	const fetched = loaded?.runId === run.id ? loaded : null;
	const rows = (mode === "preview" ? sampleBoardRows(Math.min(limit, 8)) : (live ?? fetched?.rows ?? null))?.slice(0, limit) ?? null;
	const players = mode === "preview" ? 24 : (quiz?.participant_count ?? fetched?.count ?? null);
	const columns = rows && rows.length > 20 ? 3 : rows && rows.length > 10 ? 2 : 1;

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<QuizHeader
				title={run.title}
				fallback={quizFallbackTitle("leaderboard")}
				aside={
					players !== null ? (
						<span className="font-semibold tabular-nums" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.875rem, 1.6cqw, 1.4rem)" }}>
							{plural(players, "player")}
						</span>
					) : null
				}
			/>
			{rows === null ? (
				<StageMessage>Loading the leaderboard…</StageMessage>
			) : rows.length === 0 ? (
				<StageMessage>No scores yet — the leaderboard fills up after the first question.</StageMessage>
			) : (
				<div className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden px-[4%]">
					<LeaderboardBoard runId={run.id} rows={rows} variant="stage" columns={columns} />
				</div>
			)}
		</PresenterStage>
	);
}
