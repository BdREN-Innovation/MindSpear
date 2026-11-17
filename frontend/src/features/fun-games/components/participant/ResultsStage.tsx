"use client";

import { Crown, Medal, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { getParticipantApi, type ParticipantAuth } from "../../api";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { formatDuration, formatMarks, formatPercent, scoreUnit } from "../../lib/format";
import type { AnswerSheetItem, LeaderboardEntry, ScoringMode, SessionState } from "../../types";
import { StageMessage } from "./StageMessage";

/** Show this many rows, plus the player's own row if it falls below. */
const TOP_ROWS = 50;

function AnswerSheetStrip({ items }: { items: AnswerSheetItem[] }) {
	const label = { correct: "correct", incorrect: "wrong", unanswered: "not answered" } as const;
	return (
		<div>
			<h2 className="text-sm font-black text-slate-900">Your answers</h2>
			<ol className="mt-2 flex flex-wrap gap-1.5">
				{items.map((item) => (
					<li
						key={item.questionId}
						aria-label={`Question ${item.index + 1}: ${label[item.outcome]}`}
						className={cn(
							"flex h-9 w-9 items-center justify-center rounded-md border font-mono text-xs font-semibold tabular-nums",
							item.outcome === "correct" && "border-green-dark bg-green-light-7 text-green-dark",
							item.outcome === "incorrect" && "border-red-dark bg-red-light-5 text-red-dark line-through",
							item.outcome === "unanswered" &&
								"border-dashed border-slate-400 bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_3px,#fff_3px,#fff_6px)] text-slate-500",
						)}
					>
						{item.index + 1}
					</li>
				))}
			</ol>
			<p className="mt-2 text-xs text-slate-500">
				Green: correct · Red, struck through: wrong · Hatched: not answered
			</p>
		</div>
	);
}

function Podium({ entries, unit }: { entries: LeaderboardEntry[]; unit: string }) {
	const top = entries.filter((e) => e.rank <= 3).slice(0, 3);
	if (top.length === 0) return null;
	const order = [top[1], top[0], top[2]].filter(Boolean) as LeaderboardEntry[];
	const height = { 1: "h-28", 2: "h-20", 3: "h-14" } as Record<number, string>;
	const Icon = { 1: Crown, 2: Medal, 3: Medal } as Record<number, typeof Crown>;
	return (
		<ol className="flex items-end justify-center gap-2 sm:gap-4" aria-label="Top three">
			{order.map((entry) => {
				const RankIcon = Icon[entry.rank] ?? Medal;
				return (
					<li key={entry.participantId} className="flex w-24 flex-col items-center text-center sm:w-32">
						<RankIcon
							className={cn("h-6 w-6", entry.rank === 1 ? "text-primary" : "text-slate-400")}
							aria-hidden
						/>
						<p className={cn("mt-1 w-full truncate text-sm font-black", entry.isMe && "text-primary-dark")}>
							{entry.name}
							{entry.isMe ? " (you)" : ""}
						</p>
						<p className="font-mono text-xs tabular-nums text-slate-600">{formatMarks(entry.score)} {unit}</p>
						<div
							className={cn(
								"mt-2 flex w-full items-start justify-center rounded-t-lg pt-2 font-mono text-lg font-semibold text-white",
								height[entry.rank] ?? "h-12",
								entry.rank === 1 ? "bg-gradient-to-b from-primary to-primary-dark" : "bg-slate-800",
							)}
						>
							<span className="sr-only">Rank </span>
							{entry.rank}
						</div>
					</li>
				);
			})}
		</ol>
	);
}

function LeaderboardTable({ entries, total, unit }: { entries: LeaderboardEntry[]; total: number; unit: string }) {
	const me = entries.find((e) => e.isMe);
	const rows = entries.slice(0, TOP_ROWS);
	const meBelow = me && !rows.includes(me);
	return (
		<div className="overflow-x-auto rounded-lg border border-slate-200">
			<table className="w-full min-w-[22rem] text-left text-sm">
				<caption className="sr-only">Leaderboard, {total} players</caption>
				<thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500">
					<tr>
						<th scope="col" className="px-3 py-2">#</th>
						<th scope="col" className="px-3 py-2">Player</th>
						<th scope="col" className="px-3 py-2 text-right capitalize">{unit}</th>
						<th scope="col" className="px-3 py-2 text-right">Correct</th>
						<th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">Time</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-slate-100">
					{[...rows, ...(meBelow ? [me] : [])].map((entry) => (
						<tr
							key={entry.participantId}
							className={cn(entry.isMe ? "bg-primary/10 font-bold" : "bg-white")}
							aria-current={entry.isMe ? "true" : undefined}
						>
							<td className="px-3 py-2 font-mono tabular-nums">{entry.rank}</td>
							<td className="max-w-[12rem] truncate px-3 py-2">
								{entry.name}
								{entry.isMe ? <span className="ml-1 text-xs text-primary-dark">(you)</span> : null}
							</td>
							<td className="px-3 py-2 text-right font-mono tabular-nums">{formatMarks(entry.score)}</td>
							<td className="px-3 py-2 text-right font-mono tabular-nums">{entry.correct}</td>
							<td className="hidden px-3 py-2 text-right font-mono tabular-nums sm:table-cell">
								{formatDuration(entry.timeMs)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

type ResultsStageProps = {
	auth: ParticipantAuth;
	state: SessionState;
};

/** Only rendered once the server has marked the session finished. */
export function ResultsStage({ auth, state }: ResultsStageProps) {
	const result = useAsyncResource(
		async (signal) => (await getParticipantApi()).getMyResult(auth, { signal }),
		[auth, state.finishedAt],
	);
	const board = useAsyncResource(
		async (signal) => (await getParticipantApi()).getLeaderboard(auth, { signal }),
		[auth, state.finishedAt],
	);

	if (result.loading) return <StageMessage busy title="Loading your results…" />;
	if (result.error || !result.data) {
		return (
			<StageMessage
				tone="error"
				title="Couldn't load your results"
				body={result.error?.message}
				action={{ label: "Try again", onClick: result.reload }}
			/>
		);
	}
	const r = result.data;
	const unit = scoreUnit(r.scoringMode as ScoringMode);
	if (r.status !== "final") {
		return <StageMessage busy title="Scoring answers…" body="Your score appears here in a moment." />;
	}

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
			<section
				aria-labelledby="fg-result-title"
				className="rounded-lg border border-white/20 bg-white/95 p-5 shadow-2xl shadow-black/10 sm:p-6"
			>
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
							<Trophy className="h-4 w-4 text-primary" aria-hidden />
							Final result
						</p>
						<h1 id="fg-result-title" className="mt-1 text-3xl font-black text-slate-950">
							<span className="font-mono tabular-nums">{formatMarks(r.marks)}</span>
							<span className="text-lg font-bold text-slate-500">
								{" "}
								/ <span className="font-mono tabular-nums">{formatMarks(r.maxMarks)}</span> {unit}
							</span>
						</h1>
					</div>
					{r.rank != null ? (
						<div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-right">
							<p className="text-xs font-bold uppercase text-primary-dark">Rank</p>
							<p className="font-mono text-2xl font-semibold tabular-nums text-slate-950">
								{r.rank}
								<span className="text-sm text-slate-600"> of {r.totalParticipants}</span>
							</p>
						</div>
					) : null}
				</div>

				<dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
					{[
						["Correct", String(r.correct)],
						["Wrong", String(r.incorrect)],
						["Not answered", String(r.unanswered)],
						["Accuracy", formatPercent(r.accuracy)],
						["Total time", formatDuration(r.timeMs)],
						["Average answer", formatDuration(r.averageAnswerMs)],
					].map(([label, value]) => (
						<div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
							<dt className="text-xs font-bold uppercase text-slate-500">{label}</dt>
							<dd className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-950">{value}</dd>
						</div>
					))}
				</dl>

				{r.answerSheet?.length ? (
					<div className="mt-5">
						<AnswerSheetStrip items={r.answerSheet} />
					</div>
				) : null}
			</section>

			<section
				aria-labelledby="fg-board-title"
				className="rounded-lg border border-white/20 bg-white/95 p-5 shadow-2xl shadow-black/10 sm:p-6"
			>
				<h2 id="fg-board-title" className="text-xl font-black text-slate-950">
					Leaderboard
				</h2>
				{board.loading ? (
					<p className="mt-3 text-sm text-slate-600" role="status">
						Loading the leaderboard…
					</p>
				) : board.error || !board.data ? (
					<p className="mt-3 text-sm text-red-dark" role="alert">
						{board.error?.message ?? "Couldn't load the leaderboard."}{" "}
						<button type="button" onClick={board.reload} className="font-semibold underline">
							Try again
						</button>
					</p>
				) : board.data.status !== "published" ? (
					<p className="mt-3 text-sm text-slate-600">The leaderboard opens when the game ends.</p>
				) : (
					<div className="mt-4 space-y-5">
						<Podium entries={board.data.entries} unit={scoreUnit(board.data.scoringMode)} />
						<LeaderboardTable
							entries={board.data.entries}
							total={board.data.totalParticipants}
							unit={scoreUnit(board.data.scoringMode)}
						/>
					</div>
				)}
			</section>
		</div>
	);
}
