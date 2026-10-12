"use client";

import Link from "next/link";
import { ArrowLeft, Radio } from "lucide-react";
import { getHostApi } from "../../../api";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import { describeTimer } from "../../../lib/format";
import type { AdminSessionSummary } from "../../../types";
import { btnSecondary, card } from "../../shared/hostStyles";
import { StatusTag } from "../../shared/StatusTag";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const when = (s: AdminSessionSummary) => {
	const at = s.finishedAt ?? s.startedAt ?? s.startsAt;
	return at ? dateFormat.format(new Date(at)) : "Not started";
};

/** /fun-games/sessions: every session of the host's games, open ones first. */
export function SessionsList() {
	const sessions = useAsyncResource(async (signal) => (await getHostApi()).listSessions({}, { signal }), []);
	const list = sessions.data ?? [];
	const open = list.filter((s) => s.status !== "finished");
	const past = list.filter((s) => s.status === "finished");

	const table = (rows: AdminSessionSummary[], caption: string) => (
		<div className="overflow-x-auto rounded-xl border border-stroke bg-white dark:border-stroke-dark dark:bg-gray-dark">
			<table className="w-full min-w-[40rem] text-left text-sm">
				<caption className="sr-only">{caption}</caption>
				<thead className="border-b border-stroke text-xs font-semibold uppercase text-dark-5 dark:border-stroke-dark">
					<tr>
						<th scope="col" className="px-4 py-3">Game</th>
						<th scope="col" className="px-4 py-3">Status</th>
						<th scope="col" className="px-4 py-3">Code</th>
						<th scope="col" className="px-4 py-3 text-right">Players</th>
						<th scope="col" className="px-4 py-3">When</th>
						<th scope="col" className="px-4 py-3 text-right"><span className="sr-only">Open</span></th>
					</tr>
				</thead>
				<tbody className="divide-y divide-gray-2 dark:divide-dark-3">
					{rows.map((s) => (
						<tr key={s.id}>
							<td className="max-w-xs px-4 py-3">
								<span className="block truncate font-semibold text-dark dark:text-white">{s.quizTitle}</span>
								<span className="text-xs text-dark-5">{describeTimer(s.timer)}</span>
							</td>
							<td className="px-4 py-3"><StatusTag status={s.status} /></td>
							<td className="px-4 py-3 font-mono tracking-widest">{s.joinCode}</td>
							<td className="px-4 py-3 text-right font-mono tabular-nums">{s.participantCount}</td>
							<td className="px-4 py-3 text-dark-5">{when(s)}</td>
							<td className="px-4 py-3 text-right">
								<Link href={`/fun-games/sessions/${s.id}`} className={`${btnSecondary} h-9 px-3`}>
									{s.status === "finished" ? "Results" : (
										<>
											<Radio className="h-4 w-4" aria-hidden />
											Control
										</>
									)}
								</Link>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);

	return (
		<div className="relative mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
			<Link href="/fun-games" className="inline-flex items-center gap-1 text-sm font-semibold text-dark-5 hover:text-dark dark:hover:text-white">
				<ArrowLeft className="h-4 w-4" aria-hidden />
				Fun Games
			</Link>
			<h1 className="text-heading-6 font-bold text-dark dark:text-white">Live sessions</h1>
			{sessions.loading ? (
				<div className={card} role="status">Loading sessions…</div>
			) : sessions.error ? (
				<div className={card} role="alert">
					<p className="text-sm text-red-dark">{sessions.error.message}</p>
					<button type="button" onClick={sessions.reload} className={`${btnSecondary} mt-3`}>Try again</button>
				</div>
			) : list.length === 0 ? (
				<div className={`${card} text-center text-sm text-dark-5`}>
					No sessions yet. Host a game from <Link href="/fun-games" className="font-semibold underline">Fun Games</Link>.
				</div>
			) : (
				<>
					{open.length ? (
						<section className="space-y-2">
							<h2 className="text-sm font-bold uppercase tracking-wide text-dark-5">Open</h2>
							{table(open, "Open sessions")}
						</section>
					) : null}
					{past.length ? (
						<section className="space-y-2">
							<h2 className="text-sm font-bold uppercase tracking-wide text-dark-5">Finished</h2>
							{table(past, "Finished sessions")}
						</section>
					) : null}
				</>
			)}
		</div>
	);
}
