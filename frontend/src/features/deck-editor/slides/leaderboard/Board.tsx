"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { animate, LayoutGroup, motion } from "framer-motion";
import type { LeaderboardEntry } from "@/features/deck/types";
import { usePrefersReducedMotion } from "../shared";
import { formatPoints } from "../shared/quizLabels";

// Leaderboard rows shared by the big screen and phones. On arrival the rows
// first stand in their previous order (total − points_delta), then glide to
// the new ranking while the totals count up and the "+94" chips fade in
// (plan §3.3 rank-change animation). Reduced motion: the final board at once.

export type BoardRow = LeaderboardEntry;

const MEDALS = ["#F5B700", "#A7B1BC", "#C77B30"];

/** Before / after orders for the rank-change animation. */
function previousOrder(rows: BoardRow[]): { order: number[]; rank: Map<number, number>; total: Map<number, number> } {
	const total = new Map(rows.map((row) => [row.participant_id, Math.max(0, row.total_points - (row.points_delta ?? 0))]));
	const order = [...rows].sort((a, b) => total.get(b.participant_id)! - total.get(a.participant_id)! || a.rank - b.rank).map((row) => row.participant_id);
	const rank = new Map<number, number>();
	order.forEach((id, index) => {
		const previous = index > 0 ? order[index - 1] : null;
		rank.set(id, previous !== null && total.get(previous) === total.get(id) ? rank.get(previous)! : index + 1);
	});
	return { order, rank, total };
}

/**
 * "before" until `delayMs` after the rows first arrive with any delta, then
 * "after". Re-arms when the run changes (a new leaderboard slide).
 */
export function useBoardPhase(runId: number, rows: BoardRow[], delayMs = 900): "before" | "after" {
	const reduced = usePrefersReducedMotion();
	const moving = !reduced && rows.some((row) => (row.points_delta ?? 0) > 0);
	const [doneFor, setDoneFor] = useState<number | null>(null);
	useEffect(() => {
		if (!moving || doneFor === runId) return;
		const timer = window.setTimeout(() => setDoneFor(runId), delayMs);
		return () => window.clearTimeout(timer);
	}, [moving, doneFor, runId, delayMs]);
	return moving && doneFor !== runId ? "before" : "after";
}

function CountUp({ from, to, run }: { from: number; to: number; run: boolean }) {
	const [value, setValue] = useState(run ? from : to);
	useEffect(() => {
		if (!run) return;
		const controls = animate(from, to, { duration: 0.9, ease: "easeOut", onUpdate: (latest) => setValue(Math.round(latest)) });
		return () => controls.stop();
	}, [from, to, run]);
	return <>{formatPoints(run ? value : to)}</>;
}

export interface BoardProps {
	runId: number;
	rows: BoardRow[];
	/** Highlight this participant ("You"). */
	meId?: number | null;
	variant: "stage" | "phone";
	/** Stage only: 1–3 columns. */
	columns?: number;
}

export function LeaderboardBoard({ runId, rows, meId = null, variant, columns = 1 }: BoardProps) {
	const reduced = usePrefersReducedMotion();
	const phase = useBoardPhase(runId, rows);
	const before = useMemo(() => previousOrder(rows), [rows]);
	const byId = useMemo(() => new Map(rows.map((row) => [row.participant_id, row])), [rows]);
	const order = phase === "before" ? before.order : rows.map((row) => row.participant_id);
	const max = Math.max(1, ...rows.map((row) => row.total_points));
	const stage = variant === "stage";
	const meRef = useRef<HTMLLIElement | null>(null);

	// Phones: bring my row to the middle of the screen once it is in place.
	useEffect(() => {
		if (stage || phase !== "after" || !meRef.current) return;
		meRef.current.scrollIntoView?.({ block: "center", behavior: reduced ? "auto" : "smooth" });
	}, [stage, phase, reduced]);

	return (
		<LayoutGroup>
			<ol
				aria-label="Leaderboard"
				className="m-0 grid min-h-0 list-none p-0"
				style={{
					gridTemplateColumns: `repeat(${stage ? columns : 1}, minmax(0, 1fr))`,
					gridAutoFlow: stage && columns > 1 ? "column" : "row",
					gridTemplateRows: stage && columns > 1 ? `repeat(${Math.ceil(rows.length / columns)}, minmax(0, auto))` : undefined,
					gap: stage ? "0.8cqw 2cqw" : "0.5rem",
				}}
			>
				{order.map((id) => {
					const row = byId.get(id)!;
					const rank = phase === "before" ? before.rank.get(id)! : row.rank;
					const previousTotal = before.total.get(id)!;
					const me = meId !== null && id === meId;
					const medal = rank <= 3 ? MEDALS[rank - 1] : null;
					const delta = row.points_delta ?? 0;
					const shownTotal = phase === "before" ? previousTotal : row.total_points;
					const dense = stage && (columns > 1 || rows.length > 8);
					return (
						<motion.li
							key={id}
							ref={me ? meRef : undefined}
							layout={reduced ? false : "position"}
							transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 26 }}
							className="relative flex items-center overflow-hidden"
							style={{
								gap: stage ? "1.2cqw" : "0.75rem",
								padding: stage ? (dense ? "0.5cqw 1cqw" : "0.9cqw 1.4cqw") : "0.5rem 0.75rem",
								borderRadius: stage ? "1cqw" : "0.75rem",
								minHeight: stage ? undefined : "3.25rem",
								background: me ? "color-mix(in srgb, var(--deck-primary, #F79945) 18%, var(--deck-surface, #fff))" : "var(--deck-surface, #fff)",
								border: `2px solid ${me ? "var(--deck-primary, #F79945)" : "var(--deck-border, #E5E7EB)"}`,
								color: "var(--deck-text, #111928)",
							}}
							aria-current={me ? "true" : undefined}
						>
							{/* Score bar behind the row. */}
							<motion.span
								aria-hidden
								className="absolute inset-y-0 left-0"
								style={{ background: "color-mix(in srgb, var(--deck-primary, #F79945) 10%, transparent)", transformOrigin: "left" }}
								initial={false}
								animate={{ width: `${(shownTotal / max) * 100}%` }}
								transition={reduced ? { duration: 0 } : { duration: 0.9, ease: "easeOut" }}
							/>
							<span
								className="relative flex shrink-0 items-center justify-center rounded-full font-extrabold tabular-nums"
								style={{
									width: stage ? (dense ? "2.6cqw" : "3.4cqw") : "2rem",
									height: stage ? (dense ? "2.6cqw" : "3.4cqw") : "2rem",
									fontSize: stage ? (dense ? "clamp(0.75rem, 1.3cqw, 1.1rem)" : "clamp(0.9rem, 1.7cqw, 1.5rem)") : "0.875rem",
									background: medal ?? "var(--deck-surface-muted, #F3F4F6)",
									color: medal ? "#111928" : "var(--deck-text-muted, #4B5563)",
								}}
							>
								{rank}
							</span>
							<span aria-hidden className="relative shrink-0 leading-none" style={{ fontSize: stage ? (dense ? "2.2cqw" : "3cqw") : "1.6rem" }}>
								{row.emoji_avatar || "🙂"}
							</span>
							<span
								className="relative min-w-0 flex-1 truncate font-bold"
								style={{ fontSize: stage ? (dense ? "clamp(0.8rem, 1.5cqw, 1.3rem)" : "clamp(1rem, 2.1cqw, 1.9rem)") : "1rem" }}
							>
								{me ? `You (#${rank})` : row.display_name || "Player"}
								{me && row.display_name ? <span className="sr-only">, {row.display_name}</span> : null}
							</span>
							{delta > 0 ? (
								<motion.span
									className="relative shrink-0 rounded-full font-bold tabular-nums"
									style={{
										padding: stage ? "0.2cqw 0.9cqw" : "0.125rem 0.5rem",
										fontSize: stage ? "clamp(0.75rem, 1.4cqw, 1.2rem)" : "0.8rem",
										background: "color-mix(in srgb, var(--deck-success, #15803D) 16%, var(--deck-surface, #fff))",
										color: "var(--deck-success, #15803D)",
									}}
									initial={reduced ? false : { opacity: 0, y: 6 }}
									animate={{ opacity: phase === "after" ? 1 : 0, y: phase === "after" ? 0 : 6 }}
									transition={reduced ? { duration: 0 } : { duration: 0.35, delay: phase === "after" ? 0.4 : 0 }}
								>
									+{formatPoints(delta)}
									<span className="sr-only"> points this round</span>
								</motion.span>
							) : null}
							<span
								className="relative shrink-0 text-right font-extrabold tabular-nums"
								style={{ minWidth: stage ? "7cqw" : "3.5rem", fontSize: stage ? (dense ? "clamp(0.8rem, 1.5cqw, 1.3rem)" : "clamp(1rem, 2.1cqw, 1.9rem)") : "1rem" }}
							>
								{phase === "before" ? formatPoints(previousTotal) : <CountUp from={previousTotal} to={row.total_points} run={!reduced && delta > 0} />}
								<span className="sr-only"> points</span>
							</span>
						</motion.li>
					);
				})}
			</ol>
		</LayoutGroup>
	);
}

/** Made-up rows for the editor canvas preview (stable, no Math.random). */
export function sampleBoardRows(count: number): BoardRow[] {
	const names = ["Ava", "Noah", "Mia", "Leo", "Zara", "Omar", "Ivy", "Kai", "Nora", "Eli", "Maya", "Sam"];
	const emojis = ["🦊", "🐼", "🐯", "🦄", "🐙", "🐸", "🐨", "🦁", "🐵", "🐧", "🐢", "🐝"];
	const totals = [960, 905, 880, 820, 760, 715, 640, 590, 520, 470, 410, 350];
	const deltas = [90, 100, 0, 95, 60, 100, 0, 85, 70, 0, 55, 40];
	return Array.from({ length: Math.min(count, names.length) }, (_, index) => ({
		rank: index + 1,
		participant_id: -(index + 1),
		display_name: names[index],
		emoji_avatar: emojis[index],
		total_points: totals[index],
		points_delta: deltas[index],
	}));
}
