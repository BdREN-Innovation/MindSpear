"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Download, FilePlus2, Library, Loader2, Pencil, Radio, Trash2, Users } from "lucide-react";
import { getHostApi, toFunGamesError } from "../../api";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { describeTimer } from "../../lib/format";
import type { AdminSessionSummary, HostGameSummary } from "../../types";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { btnPrimary, btnSecondary, card } from "../shared/hostStyles";
import { StatusTag } from "../shared/StatusTag";
import { HostLiveDialog } from "./HostLiveDialog";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const formatDate = (iso: string | null | undefined) => (iso ? dateFormat.format(new Date(iso)) : "—");

function OpenSessions({ sessions }: { sessions: AdminSessionSummary[] }) {
	if (!sessions.length) return null;
	return (
		<section aria-labelledby="fg-open-sessions">
			<h2 id="fg-open-sessions" className="mb-2 text-sm font-bold uppercase tracking-wide text-dark-5">
				Happening now
			</h2>
			<ul className="grid gap-3 md:grid-cols-2">
				{sessions.map((s) => (
					<li key={s.id} className={cn(card, "flex flex-col gap-3")}>
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0">
								<StatusTag status={s.status} />
								<h3 className="mt-2 truncate font-bold text-dark dark:text-white">{s.quizTitle}</h3>
								<p className="text-xs text-dark-5">
									{describeTimer(s.timer)}
									{s.status === "waiting" && s.startsAt ? ` · starts ${formatDate(s.startsAt)}` : ""}
								</p>
							</div>
							<div className="text-right">
								<p className="font-mono text-lg font-semibold tracking-widest text-dark dark:text-white">{s.joinCode}</p>
								<p className="flex items-center justify-end gap-1 text-xs text-dark-5">
									<Users className="h-3.5 w-3.5" aria-hidden />
									<span className="font-mono tabular-nums">{s.participantCount}</span> joined
								</p>
							</div>
						</div>
						<Link href={`/fun-games/sessions/${s.id}`} className={btnPrimary}>
							<Radio className="h-4 w-4" aria-hidden />
							Open live control
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}

export function GamesHome() {
	const router = useRouter();
	const games = useAsyncResource(async (signal) => (await getHostApi()).listGames({ signal }), []);
	const sessions = useAsyncResource(
		async (signal) => (await getHostApi()).listSessions({ status: ["waiting", "live", "finishing"] }, { signal }),
		[],
	);
	const [hosting, setHosting] = useState<HostGameSummary | null>(null);
	const [deleting, setDeleting] = useState<HostGameSummary | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const createBlank = async () => {
		setBusyId("new");
		setActionError(null);
		try {
			const game = await (await getHostApi()).createGame({ title: "Untitled game" });
			router.push(`/fun-games/${game.id}/edit`);
		} catch (reason) {
			setActionError(toFunGamesError(reason).message);
			setBusyId(null);
		}
	};

	const duplicate = async (game: HostGameSummary) => {
		setBusyId(game.id);
		setActionError(null);
		try {
			const copy = await (await getHostApi()).duplicateGame(game.id);
			router.push(`/fun-games/${copy.id}/edit`);
		} catch (reason) {
			setActionError(toFunGamesError(reason).message);
			setBusyId(null);
		}
	};

	const [deleteBusy, setDeleteBusy] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const confirmDelete = async () => {
		if (!deleting) return;
		setDeleteBusy(true);
		setDeleteError(null);
		try {
			await (await getHostApi()).deleteGame(deleting.id);
			games.setData((prev) => prev?.filter((g) => g.id !== deleting.id));
			setDeleting(null);
		} catch (reason) {
			setDeleteError(toFunGamesError(reason).message);
		} finally {
			setDeleteBusy(false);
		}
	};

	const openSessionFor = (game: HostGameSummary) =>
		game.latestSessionId && game.latestSessionStatus && game.latestSessionStatus !== "finished"
			? game.latestSessionId
			: null;

	return (
		<div className="relative mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="text-heading-6 font-bold text-dark dark:text-white">Fun Games</h1>
					<p className="mt-1 max-w-2xl text-sm text-dark-5">
						Turn a quiz from your library into a live game. Players scan a QR code and join with their name and email.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Link href="/fun-games/import" className={btnPrimary}>
						<Library className="h-4 w-4" aria-hidden />
						Import from My Library
					</Link>
					<button type="button" onClick={createBlank} disabled={busyId === "new"} className={btnSecondary}>
						{busyId === "new" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FilePlus2 className="h-4 w-4" aria-hidden />}
						New blank game
					</button>
				</div>
			</header>

			{actionError ? (
				<p role="alert" className="rounded-lg border border-red-light-3 bg-red-light-5 px-3 py-2 text-sm text-red-dark">
					{actionError}
				</p>
			) : null}

			{sessions.data ? <OpenSessions sessions={sessions.data} /> : null}

			<section aria-labelledby="fg-my-games">
				<h2 id="fg-my-games" className="mb-2 text-sm font-bold uppercase tracking-wide text-dark-5">
					My games
				</h2>

				{games.loading ? (
					<div className={card} role="status">
						<div className="space-y-3">
							{[0, 1, 2].map((i) => (
								<div key={i} className="h-12 animate-pulse rounded-lg bg-gray-2 dark:bg-dark-2" />
							))}
						</div>
						<span className="sr-only">Loading games…</span>
					</div>
				) : games.error ? (
					<div className={card} role="alert">
						<p className="text-sm text-red-dark">{games.error.message}</p>
						<button type="button" onClick={games.reload} className={cn(btnSecondary, "mt-3")}>
							Try again
						</button>
					</div>
				) : !games.data?.length ? (
					<div className={cn(card, "flex flex-col items-center gap-3 py-12 text-center")}>
						<Download className="h-10 w-10 text-dark-6" aria-hidden />
						<h3 className="text-lg font-bold text-dark dark:text-white">No games yet</h3>
						<p className="max-w-md text-sm text-dark-5">
							Import a quiz you&apos;ve built in My Library, pick a timer, and host it live in a few clicks.
						</p>
						<Link href="/fun-games/import" className={btnPrimary}>
							<Library className="h-4 w-4" aria-hidden />
							Import from My Library
						</Link>
					</div>
				) : (
					<div className="overflow-x-auto rounded-xl border border-stroke bg-white dark:border-stroke-dark dark:bg-gray-dark">
						<table className="w-full min-w-[46rem] text-left text-sm">
							<caption className="sr-only">My games</caption>
							<thead className="border-b border-stroke text-xs font-semibold uppercase text-dark-5 dark:border-stroke-dark">
								<tr>
									<th scope="col" className="px-4 py-3">Game</th>
									<th scope="col" className="px-4 py-3">Status</th>
									<th scope="col" className="px-4 py-3">Timer</th>
									<th scope="col" className="px-4 py-3 text-right">Questions</th>
									<th scope="col" className="px-4 py-3">Updated</th>
									<th scope="col" className="px-4 py-3 text-right">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-2 dark:divide-dark-3">
								{games.data.map((game) => {
									const openSession = openSessionFor(game);
									return (
										<tr key={game.id} className="align-middle">
											<td className="max-w-xs px-4 py-3">
												<Link
													href={`/fun-games/${game.id}/edit`}
													className="block truncate font-semibold text-dark hover:underline dark:text-white"
												>
													{game.title}
												</Link>
												{game.sourceDeckId ? (
													<span className="text-xs text-dark-5">From My Library</span>
												) : null}
											</td>
											<td className="px-4 py-3">
												<StatusTag status={game.status} />
											</td>
											<td className="px-4 py-3 text-dark-4 dark:text-dark-6">{describeTimer(game.timer)}</td>
											<td className="px-4 py-3 text-right font-mono tabular-nums">
												{game.questionsPerPlayer && game.questionsPerPlayer < game.questionCount ? (
													<span title={`Each player answers ${game.questionsPerPlayer} of ${game.questionCount}`}>
														{game.questionsPerPlayer} of {game.questionCount}
													</span>
												) : (
													game.questionCount
												)}
											</td>
											<td className="px-4 py-3 text-dark-5">{formatDate(game.updatedAt)}</td>
											<td className="whitespace-nowrap px-4 py-3">
												<div className="flex items-center justify-end gap-1.5">
													{openSession ? (
														<Link href={`/fun-games/sessions/${openSession}`} className={cn(btnPrimary, "h-9 shrink-0 whitespace-nowrap px-3")}>
															<Radio className="h-4 w-4 shrink-0" aria-hidden />
															Live control
														</Link>
													) : (
														<button
															type="button"
															onClick={() => setHosting(game)}
															disabled={game.questionCount === 0}
															title={game.questionCount === 0 ? "Add questions first" : undefined}
															className={cn(btnPrimary, "h-9 shrink-0 whitespace-nowrap px-3")}
														>
															<Radio className="h-4 w-4 shrink-0" aria-hidden />
															Host live
														</button>
													)}
													<Link
														href={`/fun-games/${game.id}/edit`}
														className={cn(btnSecondary, "h-9 w-9 shrink-0 px-0")}
														aria-label={`Edit ${game.title}`}
														title="Edit"
													>
														<Pencil className="h-4 w-4 shrink-0" aria-hidden />
													</Link>
													<button
														type="button"
														onClick={() => duplicate(game)}
														disabled={busyId === game.id}
														className={cn(btnSecondary, "h-9 w-9 shrink-0 px-0")}
														aria-label={`Duplicate ${game.title}`}
														title="Duplicate"
													>
														{busyId === game.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : <Copy className="h-4 w-4 shrink-0" aria-hidden />}
													</button>
													<button
														type="button"
														onClick={() => {
															setDeleteError(null);
															setDeleting(game);
														}}
														className={cn(btnSecondary, "h-9 w-9 shrink-0 px-0 text-red-dark hover:bg-red-light-5")}
														aria-label={`Delete ${game.title}`}
														title="Delete"
													>
														<Trash2 className="h-4 w-4 shrink-0" aria-hidden />
													</button>
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<HostLiveDialog game={hosting} onClose={() => setHosting(null)} />
			<ConfirmDialog
				open={!!deleting}
				title={`Delete “${deleting?.title ?? ""}”?`}
				confirmLabel="Delete game"
				tone="danger"
				busy={deleteBusy}
				error={deleteError}
				onConfirm={confirmDelete}
				onClose={() => setDeleting(null)}
			>
				<p>The game and its questions are removed. Your My Library quiz isn&apos;t affected.</p>
			</ConfirmDialog>
		</div>
	);
}
