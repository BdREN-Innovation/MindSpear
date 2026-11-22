"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, Download, PencilLine, X } from "lucide-react";
import { toast } from "react-toastify";
import { Button, Select, Skeleton } from "@/components/ui";
import {
	deckEditUrl,
	formatDate,
	legacyResultsApi,
	type LegacyDetail,
	type LegacySession,
	type LegacySource,
} from "../api";
import { QuestionSummary } from "../components/QuestionSummary";

type Tab = "summary" | "participants";

function sessionLabel(s: LegacyDetail["sessions"][number]): string {
	const when = s.id === "none" ? "Without a session" : formatDate(s.started_at);
	return `${when} · ${s.participants} ${s.participants === 1 ? "participant" : "participants"}`;
}

/** /past-results/[source]/[id]: one old quiz or quest, session by session. */
export function PastResultView({ source, id }: { source: LegacySource; id: number }) {
	const [detail, setDetail] = useState<LegacyDetail | null>(null);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [session, setSession] = useState<LegacySession | null>(null);
	const [loadingSession, setLoadingSession] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>("summary");
	const [open, setOpen] = useState<number | null>(null);
	const [downloading, setDownloading] = useState(false);

	useEffect(() => {
		legacyResultsApi
			.show(source, id)
			.then((d) => {
				setDetail(d);
				// The busiest session first: usually the real class, not a test run.
				const busiest = [...d.sessions].sort((a, b) => b.participants - a.participants)[0];
				setSessionId(busiest?.id ?? null);
			})
			.catch(() => setError("This quiz or quest could not be found."));
	}, [source, id]);

	useEffect(() => {
		if (sessionId === null) return;
		let active = true;
		setLoadingSession(true);
		setOpen(null);
		legacyResultsApi
			.session(source, id, sessionId)
			.then((s) => active && setSession(s))
			.catch(() => active && toast.error("This session could not be loaded."))
			.finally(() => active && setLoadingSession(false));
		return () => {
			active = false;
		};
	}, [source, id, sessionId]);

	const options = useMemo(() => (detail?.sessions ?? []).map((s) => ({ value: s.id, label: sessionLabel(s) })), [detail]);

	const download = async () => {
		if (!detail || !sessionId) return;
		setDownloading(true);
		try {
			const name = `${(detail.title || source).replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-results.csv`;
			await legacyResultsApi.downloadCsv(source, id, sessionId, name);
		} catch {
			toast.error("The download failed. Please try again.");
		} finally {
			setDownloading(false);
		}
	};

	if (error) {
		return (
			<div className="mx-auto max-w-6xl p-4 sm:p-6">
				<p className="rounded-lg bg-red-light-6 p-4 text-sm text-red">{error}</p>
				<Link href="/past-results" className="mt-4 inline-flex items-center gap-1 text-sm text-primary">
					<ArrowLeft className="h-4 w-4" aria-hidden /> Past results
				</Link>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
			<Link href="/past-results" className="inline-flex items-center gap-1 text-sm text-dark-5 hover:text-primary">
				<ArrowLeft className="h-4 w-4" aria-hidden /> Past results
			</Link>

			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-xs font-semibold uppercase tracking-wide text-dark-5">
						{source === "quiz" ? "Quiz" : "Quest"} · previous version
					</p>
					<h1 className="mt-1 text-2xl font-bold text-dark dark:text-white">{detail ? detail.title || "Untitled" : <Skeleton className="h-8 w-72" />}</h1>
				</div>
				{detail?.deck_id != null && (
					<Link
						href={deckEditUrl(source, detail.deck_id)}
						className="inline-flex items-center gap-1.5 rounded-lg border border-stroke px-3 py-2 text-sm text-dark hover:bg-gray-1 dark:border-dark-3 dark:text-white"
					>
						<PencilLine className="h-4 w-4" aria-hidden /> Open in editor
					</Link>
				)}
			</header>

			{detail && detail.sessions.length > 0 && (
				<div className="flex flex-wrap items-center gap-3">
					<Select
						aria-label="Session"
						className="min-w-[280px] flex-1 sm:max-w-md"
						value={sessionId}
						options={options}
						onChange={(value) => setSessionId(value)}
					/>
					<Button variant="outline" onClick={download} loading={downloading} disabled={!session}>
						<Download className="h-4 w-4" aria-hidden /> Download CSV
					</Button>
				</div>
			)}

			{(loadingSession || (!session && detail)) && (
				<div className="space-y-3">
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} className="h-28 w-full" />
					))}
				</div>
			)}

			{session && !loadingSession && (
				<>
					<p className="text-sm text-dark-5">
						{session.participants.length} {session.participants.length === 1 ? "participant" : "participants"} ·{" "}
						{session.questions.length} questions
						{session.session.started_at && ` · ${formatDate(session.session.started_at)}`}
						{session.scored && " · Scores count right answers; the previous version did not save points or answer times."}
					</p>

					<div role="tablist" className="flex gap-1 border-b border-stroke dark:border-dark-3">
						{(["summary", "participants"] as const).map((t) => (
							<button
								key={t}
								role="tab"
								aria-selected={tab === t}
								onClick={() => setTab(t)}
								className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
									tab === t ? "border-primary text-dark dark:text-white" : "border-transparent text-dark-5 hover:text-dark dark:hover:text-white"
								}`}
							>
								{t === "summary" ? "Summary" : `Participants (${session.participants.length})`}
							</button>
						))}
					</div>

					{tab === "summary" && (
						<ol className="space-y-4">
							{session.questions.map((q) => (
								<li key={q.id} className="rounded-xl border border-stroke bg-white p-5 dark:border-dark-3 dark:bg-gray-dark">
									<div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
										<h2 className="font-semibold text-dark dark:text-white">
											<span className="mr-2 text-primary">Q{q.number}</span>
											{q.text || "Untitled question"}
											{q.deleted && <span className="ml-2 text-xs font-normal text-dark-5">(later deleted)</span>}
										</h2>
										<span className="text-sm text-dark-5">
											{q.answered} answered
											{q.correct !== null && q.answered > 0 && ` · ${q.correct} right (${Math.round((q.correct / q.answered) * 100)}%)`}
										</span>
									</div>
									<QuestionSummary question={q} />
									{q.correct_answer && q.summary.kind !== "choices" && (
										<p className="mt-3 text-sm text-dark-5">Right answer: {q.correct_answer}</p>
									)}
								</li>
							))}
						</ol>
					)}

					{tab === "participants" && (
						<div className="overflow-x-auto rounded-xl border border-stroke bg-white dark:border-dark-3 dark:bg-gray-dark">
							<table className="w-full text-left text-sm">
								<thead className="border-b border-stroke text-dark-5 dark:border-dark-3">
									<tr>
										<th className="p-3 font-medium">Participant</th>
										<th className="p-3 font-medium">Joined</th>
										<th className="p-3 font-medium">Answered</th>
										{session.scored && <th className="p-3 font-medium">Right</th>}
										<th className="p-3" />
									</tr>
								</thead>
								<tbody>
									{[...session.participants]
										.sort((a, b) => (b.correct ?? 0) - (a.correct ?? 0) || b.answered - a.answered)
										.map((p) => (
											<Fragment key={p.id}>
												<tr className="border-b border-stroke last:border-0 dark:border-dark-3">
													<td className="p-3 font-medium text-dark dark:text-white">{p.name}</td>
													<td className="p-3 text-dark-5">{formatDate(p.joined_at)}</td>
													<td className="p-3 tabular-nums">
														{p.answered} / {session.questions.length}
													</td>
													{session.scored && <td className="p-3 tabular-nums">{p.correct}</td>}
													<td className="p-3 text-right">
														<button
															className="inline-flex items-center gap-1 text-primary"
															aria-expanded={open === p.id}
															onClick={() => setOpen(open === p.id ? null : p.id)}
														>
															Answers <ChevronDown className={`h-4 w-4 transition-transform ${open === p.id ? "rotate-180" : ""}`} aria-hidden />
														</button>
													</td>
												</tr>
												{open === p.id && (
													<tr className="border-b border-stroke bg-gray-1 dark:border-dark-3 dark:bg-dark-2">
														<td colSpan={session.scored ? 5 : 4} className="p-3">
															<ol className="space-y-1.5">
																{session.questions.map((q) => {
																	const a = p.answers[String(q.id)];
																	return (
																		<li key={q.id} className="flex gap-2">
																			<span className="w-10 shrink-0 font-semibold text-primary">Q{q.number}</span>
																			<span className="min-w-0 flex-1 text-dark dark:text-white">
																				{a ? a.text || "—" : <span className="text-dark-5">no answer</span>}
																			</span>
																			{a?.correct === true && <Check className="h-4 w-4 shrink-0 text-green" aria-label="right" />}
																			{a?.correct === false && <X className="h-4 w-4 shrink-0 text-red" aria-label="wrong" />}
																		</li>
																	);
																})}
															</ol>
														</td>
													</tr>
												)}
											</Fragment>
										))}
								</tbody>
							</table>
						</div>
					)}
				</>
			)}
		</div>
	);
}
