"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeCanvas } from "qrcode.react";
import {
	ArrowLeft,
	Check,
	CheckCircle2,
	Circle,
	Copy,
	Loader2,
	Maximize2,
	Play,
	Square,
	Users,
	WifiOff,
	X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getHostApi, toFunGamesError } from "../../../api";
import { joinUrl } from "../../../config";
import { useHostSession } from "../../../hooks/useHostSession";
import { useServerCountdown } from "../../../hooks/useServerCountdown";
import { serverClock } from "../../../lib/serverClock";
import { describeTimer, formatCountdown, formatDuration, formatMarks, scoreUnit } from "../../../lib/format";
import type { HostParticipant, HostSessionDetail, Leaderboard, LeaderboardEntry } from "../../../types";
import { ConfirmDialog } from "../../shared/ConfirmDialog";
import { btnDanger, btnPrimary, btnSecondary, card } from "../../shared/hostStyles";
import { StatusTag } from "../../shared/StatusTag";

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

function CopyButton({ value, label }: { value: string; label: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch {
					// Clipboard blocked; the value stays visible to copy by hand.
				}
			}}
			className={`${btnSecondary} h-9 px-3`}
		>
			{copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
			{copied ? "Copied" : label}
		</button>
	);
}

/** Full-screen join card for a projector: big QR, code and player count. */
function PresentJoin({ session, onClose }: { session: HostSessionDetail; onClose: () => void }) {
	const url = joinUrl(session.joinCode);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	return (
		<div role="dialog" aria-modal="true" aria-label="Join screen" className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-white p-6 text-dark">
			<button type="button" onClick={onClose} className={`${btnSecondary} absolute right-4 top-4`} autoFocus>
				<X className="h-4 w-4" aria-hidden />
				Close
			</button>
			<h2 className="text-center text-3xl font-bold sm:text-5xl">{session.quiz.title}</h2>
			<div className="rounded-2xl border border-stroke bg-white p-4">
				<QRCodeCanvas value={url} size={Math.min(440, typeof window !== "undefined" ? window.innerHeight * 0.45 : 440)} />
			</div>
			<p className="text-xl text-dark-4">Scan, or go to <span className="font-semibold text-dark">{url.replace(/^https?:\/\//, "").replace(/\/[^/]+$/, "/")}</span> and enter</p>
			<p className="font-mono text-6xl font-semibold tracking-[0.2em] sm:text-8xl">{session.joinCode}</p>
			<p className="flex items-center gap-2 text-2xl text-dark-4">
				<Users className="h-6 w-6" aria-hidden />
				<span className="font-mono tabular-nums">{session.participantCount}</span> joined
			</p>
		</div>
	);
}

function JoinPanel({ session, onPresent }: { session: HostSessionDetail; onPresent: () => void }) {
	const url = joinUrl(session.joinCode);
	return (
		<section aria-labelledby="fg-join" className={`${card} flex flex-col items-center gap-4 text-center`}>
			<h2 id="fg-join" className="text-sm font-bold uppercase tracking-wide text-dark-5">
				Players join here
			</h2>
			<div className="rounded-xl border border-stroke bg-white p-3">
				<QRCodeCanvas value={url} size={220} aria-label={`QR code for ${url}`} />
			</div>
			<p className="font-mono text-4xl font-semibold tracking-[0.18em] text-dark dark:text-white">{session.joinCode}</p>
			<p className="break-all font-mono text-xs text-dark-5">{url}</p>
			<div className="flex flex-wrap justify-center gap-2">
				<CopyButton value={url} label="Copy link" />
				<button type="button" onClick={onPresent} className={`${btnSecondary} h-9 px-3`}>
					<Maximize2 className="h-4 w-4" aria-hidden />
					Show full screen
				</button>
			</div>
		</section>
	);
}

function PlayersPanel({ players, loading }: { players: HostParticipant[] | undefined; loading: boolean }) {
	return (
		<section aria-labelledby="fg-players" className={card}>
			<div className="flex items-baseline justify-between">
				<h2 id="fg-players" className="font-bold text-dark dark:text-white">
					Players
				</h2>
				<p className="font-mono text-sm tabular-nums text-dark-5" aria-live="polite">
					{players?.length ?? 0} joined
				</p>
			</div>
			{loading && !players ? (
				<Loader2 className="mt-4 h-5 w-5 animate-spin text-dark-5" aria-hidden />
			) : !players?.length ? (
				<p className="mt-4 text-sm text-dark-5">Nobody yet. Show the QR code — players appear here as they join.</p>
			) : (
				<ul className="mt-3 grid max-h-[26rem] gap-1.5 overflow-y-auto sm:grid-cols-2">
					{players.map((p) => (
						<li key={p.id} className="flex items-center gap-2 rounded-lg border border-stroke px-3 py-2 dark:border-stroke-dark" title={p.email}>
							<span
								className={cn("h-2 w-2 shrink-0 rounded-full", p.online ? "bg-green" : "border border-dark-5")}
								aria-label={p.online ? "online" : "offline"}
							/>
							<span className="min-w-0">
								<span className="block truncate text-sm font-semibold text-dark dark:text-white">{p.name}</span>
								<span className="block truncate text-xs text-dark-5">{p.email}</span>
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

/** Live mm:ss to a server timestamp. */
function Countdown({ at }: { at: string }) {
	const remaining = useServerCountdown(at, 1000);
	return <span className="font-mono tabular-nums">{formatCountdown(Math.max(0, remaining ?? 0))}</span>;
}

function StartsIn({ at }: { at: string }) {
	const remaining = useServerCountdown(at);
	return remaining != null && remaining > 0 ? (
		<span className="font-mono tabular-nums">{formatCountdown(remaining)}</span>
	) : (
		<>now</>
	);
}

function Metric({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
	return (
		<div className={card}>
			<p className="text-xs font-semibold uppercase tracking-wide text-dark-5">{label}</p>
			<p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-dark dark:text-white">{value}</p>
			{note ? <p className="mt-0.5 text-xs text-dark-5">{note}</p> : null}
		</div>
	);
}

function PlayerStatus({ status }: { status: LeaderboardEntry["currentQuestionStatus"] }) {
	switch (status) {
		case "finished":
			return (
				<span className="inline-flex items-center gap-1 text-green-dark">
					<Check className="h-3 w-3" aria-hidden />
					Finished
				</span>
			);
		case "offline":
			return (
				<span className="inline-flex items-center gap-1 text-dark-5">
					<WifiOff className="h-3 w-3" aria-hidden />
					Offline
				</span>
			);
		case "answering":
			return (
				<span className="inline-flex items-center gap-1 text-dark dark:text-white">
					<Circle className="h-3 w-3 fill-current" aria-hidden />
					Playing
				</span>
			);
		case "waiting":
			return (
				<span className="inline-flex items-center gap-1 text-dark-5">
					<Circle className="h-3 w-3" aria-hidden />
					Not started
				</span>
			);
		default:
			return <>—</>;
	}
}

/** Live: every player's progress and score (host only). Finished: the final leaderboard. */
function Ranking({
	board,
	stale,
	updatedAt,
	final,
}: {
	board: Leaderboard | undefined;
	stale: boolean;
	updatedAt: number | null;
	final: boolean;
}) {
	const rows = board?.entries ?? [];
	const unit = scoreUnit(board?.scoringMode);
	return (
		<section aria-labelledby="fg-ranking" className={cn(card, stale && "opacity-60")}>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 id="fg-ranking" className="font-bold text-dark dark:text-white">
					{final ? "Final leaderboard" : "Players"}
				</h2>
				<p className="flex items-center gap-2 text-xs text-dark-5">
					{stale ? (
						<span className="rounded border border-urgent/40 bg-urgent-bg px-1.5 py-0.5 font-bold text-urgent-text">STALE</span>
					) : null}
					{updatedAt ? `Updated ${timeFormat.format(updatedAt)}` : null}
				</p>
			</div>
			{!final ? <p className="text-xs text-dark-5">Only you see these scores. Players see their results when the game ends.</p> : null}
			{rows.length === 0 ? (
				<p className="mt-3 text-sm text-dark-5">No players yet.</p>
			) : (
				<div className="mt-3 max-h-[32rem] overflow-auto">
					<table className="w-full min-w-[34rem] text-left text-sm">
						<caption className="sr-only">{final ? "Final leaderboard" : "Players and their progress"}</caption>
						<thead className="sticky top-0 bg-white text-xs font-semibold uppercase text-dark-5 dark:bg-gray-dark">
							<tr>
								<th scope="col" className="py-2 pr-2">#</th>
								<th scope="col" className="py-2 pr-2">Player</th>
								{!final ? <th scope="col" className="py-2 pr-2">Progress</th> : null}
								<th scope="col" className="py-2 pr-2 text-right capitalize">{unit}</th>
								<th scope="col" className="py-2 pr-2 text-right">Correct</th>
								<th scope="col" className="py-2 text-right">{final ? "Time" : "Status"}</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-2 dark:divide-dark-3">
							{rows.map((e) => (
								<tr key={e.participantId}>
									<td className="py-2 pr-2 font-mono tabular-nums">{e.rank}</td>
									<td className="max-w-[12rem] py-2 pr-2">
										<span className="block truncate font-semibold text-dark dark:text-white">{e.name}</span>
										{e.email ? <span className="block truncate text-xs text-dark-5">{e.email}</span> : null}
									</td>
									{!final ? (
										<td className="py-2 pr-2">
											{e.progress ? (
												<span className="flex items-center gap-2">
													<span className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-2 dark:bg-dark-2" aria-hidden>
														<span
															className="block h-full rounded-full bg-dark dark:bg-white"
															style={{ width: `${(e.progress.done / Math.max(1, e.progress.total)) * 100}%` }}
														/>
													</span>
													<span className="font-mono text-xs tabular-nums">
														{e.progress.done}/{e.progress.total}
													</span>
												</span>
											) : (
												"—"
											)}
										</td>
									) : null}
									<td className="py-2 pr-2 text-right font-mono tabular-nums">{formatMarks(e.score)}</td>
									<td className="py-2 pr-2 text-right font-mono tabular-nums">{e.correct}</td>
									<td className="py-2 text-right text-xs">
										{final ? (
											<span className="font-mono tabular-nums">{formatDuration(e.timeMs)}</span>
										) : (
											<PlayerStatus status={e.currentQuestionStatus} />
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

function Finalisation({ session }: { session: HostSessionDetail }) {
	return (
		<section aria-labelledby="fg-final" className={card}>
			<h2 id="fg-final" className="font-bold text-dark dark:text-white">
				Finishing up
			</h2>
			<ol className="mt-3 space-y-2">
				{session.finalisation.map((step) => (
					<li key={step.key} className="flex items-center gap-2 text-sm">
						{step.status === "done" ? (
							<CheckCircle2 className="h-4 w-4 text-green-dark" aria-hidden />
						) : step.status === "running" ? (
							<Loader2 className="h-4 w-4 animate-spin text-dark-5" aria-hidden />
						) : (
							<Circle className="h-4 w-4 text-dark-6" aria-hidden />
						)}
						<span className={step.status === "pending" ? "text-dark-5" : "text-dark dark:text-white"}>{step.label}</span>
						<span className="sr-only">({step.status})</span>
					</li>
				))}
			</ol>
		</section>
	);
}

/** /fun-games/sessions/[sessionId]: lobby, live control and results for one session. */
export function SessionControl({ sessionId }: { sessionId: string }) {
	const router = useRouter();
	const live = useHostSession(sessionId);
	const s = live.data;
	const [presenting, setPresenting] = useState(false);
	const [ending, setEnding] = useState(false);
	const [busy, setBusy] = useState<null | "start" | "end" | "again">(null);
	const [error, setError] = useState<string | null>(null);

	const act = async (kind: "start" | "end") => {
		setBusy(kind);
		setError(null);
		try {
			const api = await getHostApi();
			const next = kind === "start" ? await api.startSession(sessionId) : await api.endSession(sessionId);
			live.setData(next);
			if (kind === "end") setEnding(false);
			live.leaderboard.reload();
		} catch (reason) {
			setError(toFunGamesError(reason).message);
		} finally {
			setBusy(null);
		}
	};

	const hostAgain = async () => {
		if (!s) return;
		setBusy("again");
		setError(null);
		try {
			const next = await (await getHostApi()).createSession(s.quizId, {});
			router.push(`/fun-games/sessions/${next.id}`);
		} catch (reason) {
			setError(toFunGamesError(reason).message);
			setBusy(null);
		}
	};

	if (!s) {
		return (
			<div className="relative mx-auto max-w-6xl p-6">
				{live.error ? (
					<div className={card} role="alert">
						<p className="font-semibold text-dark dark:text-white">
							{live.error.code === "notFound" ? "This session doesn't exist or isn't yours." : "Couldn't load the session."}
						</p>
						<p className="mt-1 text-sm text-dark-5">{live.error.message}</p>
						<div className="mt-4 flex gap-2">
							{live.error.code !== "notFound" ? (
								<button type="button" onClick={live.reload} className={btnPrimary}>
									Try again
								</button>
							) : null}
							<Link href="/fun-games" className={btnSecondary}>
								Back to Fun Games
							</Link>
						</div>
					</div>
				) : (
					<div role="status">
						<Loader2 className="h-6 w-6 animate-spin text-dark-5" aria-hidden />
						<span className="sr-only">Loading the session…</span>
					</div>
				)}
			</div>
		);
	}

	const disconnected = live.failure === null && live.connection !== "connected" && live.connection !== "idle";
	const open = s.status === "waiting" || s.status === "live";
	const unfinished = s.stats.participantCount - s.stats.finishedCount;
	const joinOpen = s.status === "live" && !!s.joinClosesAt && (serverClock.remainingMs(s.joinClosesAt) ?? 0) > 0;

	return (
		<div className="relative mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
			<Link href="/fun-games" className="inline-flex items-center gap-1 text-sm font-semibold text-dark-5 hover:text-dark dark:hover:text-white">
				<ArrowLeft className="h-4 w-4" aria-hidden />
				Fun Games
			</Link>

			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<StatusTag status={s.status} />
						<span className="text-xs font-semibold uppercase tracking-wide text-dark-5">{describeTimer(s.quiz.timer)}</span>
					</div>
					<h1 className="mt-1 truncate text-heading-6 font-bold text-dark dark:text-white">{s.quiz.title}</h1>
					<p className="text-sm text-dark-5">
						Join code <span className="font-mono font-semibold tracking-widest text-dark dark:text-white">{s.joinCode}</span>
						{s.status === "waiting" && s.startsAt ? (
							<>
								{" "}· starts in <StartsIn at={s.startsAt} />
							</>
						) : null}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{s.status === "waiting" ? (
						<button type="button" onClick={() => act("start")} disabled={!!busy} className={btnPrimary}>
							{busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
							Start now
						</button>
					) : null}
					{open ? (
						<button type="button" onClick={() => setEnding(true)} disabled={!!busy} className={btnDanger}>
							<Square className="h-4 w-4" aria-hidden />
							End session…
						</button>
					) : null}
					{s.status === "finished" ? (
						<button type="button" onClick={hostAgain} disabled={!!busy} className={btnPrimary}>
							{busy === "again" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
							Host again
						</button>
					) : null}
				</div>
			</header>

			{disconnected ? (
				<p role="status" className="flex items-center gap-2 rounded-lg border border-urgent/30 bg-urgent-bg px-3 py-2 text-sm text-urgent-text">
					<WifiOff className="h-4 w-4" aria-hidden />
					Live updates are reconnecting. The game keeps running on the server; this page refreshes every few seconds.
				</p>
			) : null}
			{error ? (
				<p role="alert" className="rounded-lg border border-red-light-3 bg-red-light-5 px-3 py-2 text-sm text-red-dark">
					{error}
				</p>
			) : null}

			{s.status === "waiting" ? (
				<div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
					<JoinPanel session={s} onPresent={() => setPresenting(true)} />
					<PlayersPanel players={live.participants.data} loading={live.participants.loading} />
				</div>
			) : null}

			{s.status === "live" ? (
				<>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<Metric
							label="Players"
							value={s.stats.participantCount}
							note={s.stats.offlineCount ? `${s.stats.offlineCount} offline` : "All connected"}
						/>
						<Metric
							label="Finished"
							value={
								<>
									{s.stats.finishedCount}
									<span className="text-base text-dark-5"> / {s.stats.participantCount}</span>
								</>
							}
							note={`${s.quiz.questionCount} questions each, own order`}
						/>
						<Metric
							label={joinOpen ? "Joining closes in" : "Joining"}
							value={joinOpen && s.joinClosesAt ? <Countdown at={s.joinClosesAt} /> : "Closed"}
							note={joinOpen ? "Late players can still join" : "Players who joined can still come back"}
						/>
						<Metric
							label="Ends at the latest in"
							value={s.endsAt ? <Countdown at={s.endsAt} /> : "—"}
							note="Earlier if everyone finishes"
						/>
					</div>
					<div className={cn("grid gap-4", joinOpen && "lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]")}>
						{joinOpen ? <JoinPanel session={s} onPresent={() => setPresenting(true)} /> : null}
						<Ranking board={live.leaderboard.data} stale={disconnected} updatedAt={live.rankingUpdatedAt} final={false} />
					</div>
				</>
			) : null}

			{s.status === "finishing" ? <Finalisation session={s} /> : null}

			{s.status === "finished" ? (
				<div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
					<div className="space-y-3">
						<Metric label="Players" value={s.participantCount} />
						<Metric label="Questions" value={s.quiz.questionCount} note={s.endedByHost ? "Ended early by you" : "Ran to the end"} />
					</div>
					<Ranking board={live.leaderboard.data} stale={false} updatedAt={live.rankingUpdatedAt} final />
				</div>
			) : null}

			{presenting ? <PresentJoin session={s} onClose={() => setPresenting(false)} /> : null}

			<ConfirmDialog
				open={ending}
				title="End this session now?"
				confirmLabel="End session"
				cancelLabel="Keep running"
				tone="danger"
				busy={busy === "end"}
				onConfirm={() => act("end")}
				onClose={() => setEnding(false)}
			>
				{s.status === "waiting" ? (
					<p>The game hasn&apos;t started. Players in the lobby will see that it ended.</p>
				) : (
					<>
						<p>The game stops immediately for all {s.stats.participantCount} players. This can&apos;t be undone.</p>
						<ul className="list-disc pl-5">
							{unfinished > 0 ? (
								<li>
									{unfinished} player{unfinished === 1 ? " hasn't" : "s haven't"} finished; their remaining questions score 0.
								</li>
							) : null}
							<li>Scores and the leaderboard are published once scoring finishes.</li>
						</ul>
					</>
				)}
			</ConfirmDialog>
		</div>
	);
}
