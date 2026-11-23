"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { toast } from "react-toastify";
import { ArrowLeft, Clock, Download, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { toDeckApiError } from "@/features/deck/api/errors";
import { productCopy } from "@/features/deck/productCopy";
import { getDeckTheme } from "@/features/deck/theme";
import type { DeckProduct, PresenterRunView } from "@/features/deck/types";
import { getSlideType } from "@/features/deck-editor/slideRegistry";
import { sessionResultsApiFor, type SessionResults } from "../api";
import { RunResultStage, responsesOf } from "../components/RunResultStage";
import { SessionStatusPill } from "../components/SessionStatusPill";
import { fileSlug, formatDateTime, plural, sessionDuration } from "../format";

// My Library > a quiz / quest > one session: every slide that took answers,
// drawn as the presenter showed its results, and everyone who joined
// (ranked by points for quizzes). Same layout as /past-results.

type Tab = "summary" | "participants";

const TABS: Tab[] = ["summary", "participants"];

const focusRing = "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-dark";

function runTitle(run: PresenterRunView): string {
	return run.title?.trim() || getSlideType(run.type)?.label || "Untitled slide";
}

function RunCard({ run, number, results }: { run: PresenterRunView; number: number; results: SessionResults }) {
	const responses = responsesOf(run);
	const label = getSlideType(run.type)?.label;
	return (
		<li className="space-y-4 rounded-xl border border-stroke bg-white p-4 dark:border-stroke-dark dark:bg-gray-dark sm:p-5">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="min-w-0 font-semibold text-dark dark:text-white">
					<span className="mr-2 text-primary-700 dark:text-primary-300">Q{number}</span>
					{runTitle(run)}
				</h2>
				<span className="text-sm text-dark-5 dark:text-dark-6">
					{label && run.title?.trim() ? `${label} · ` : ""}
					{responses !== null ? plural(responses, "response") : null}
				</span>
			</div>
			<RunResultStage run={run} theme={getDeckTheme(results.session.theme)} totalSlides={results.runs.length} />
		</li>
	);
}

function ParticipantsTable({ results }: { results: SessionResults }) {
	const { participants, scored, runs } = results;
	if (participants.length === 0) {
		return (
			<p className="rounded-xl border border-dashed border-stroke px-4 py-10 text-center text-sm text-dark-5 dark:border-stroke-dark dark:text-dark-6">
				Nobody joined this session.
			</p>
		);
	}
	return (
		<div className="overflow-x-auto rounded-xl border border-stroke bg-white dark:border-stroke-dark dark:bg-gray-dark">
			<table className="w-full text-left text-sm">
				<thead className="border-b border-stroke text-dark-5 dark:border-stroke-dark dark:text-dark-6">
					<tr>
						{scored && (
							<th scope="col" className="w-12 p-3 font-medium">
								#
							</th>
						)}
						<th scope="col" className="p-3 font-medium">
							Participant
						</th>
						{scored && (
							<th scope="col" className="p-3 text-right font-medium">
								Points
							</th>
						)}
						{scored && (
							<th scope="col" className="p-3 text-right font-medium">
								Correct
							</th>
						)}
						<th scope="col" className="p-3 text-right font-medium">
							Answered
						</th>
						<th scope="col" className="hidden p-3 font-medium sm:table-cell">
							Joined
						</th>
					</tr>
				</thead>
				<tbody>
					{participants.map((p) => (
						<tr key={p.participant_id} className="border-b border-stroke last:border-0 dark:border-stroke-dark">
							{scored && <td className="p-3 font-semibold tabular-nums text-dark-5 dark:text-dark-6">{p.rank}</td>}
							<td className="p-3">
								<span className="flex min-w-0 items-center gap-2">
									<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-2 text-base dark:bg-dark-2" aria-hidden>
										{p.emoji_avatar || "🙂"}
									</span>
									<span className="min-w-0">
										<span className="block truncate font-medium text-dark dark:text-white">{p.display_name || "Anonymous"}</span>
										{p.left && <span className="block text-xs text-dark-5 dark:text-dark-6">Left early</span>}
									</span>
								</span>
							</td>
							{scored && <td className="p-3 text-right font-semibold tabular-nums text-dark dark:text-white">{p.total_points}</td>}
							{scored && <td className="p-3 text-right tabular-nums text-dark dark:text-white">{p.correct}</td>}
							<td className="whitespace-nowrap p-3 text-right tabular-nums text-dark dark:text-white">
								{p.answered} / {runs.length}
							</td>
							<td className="hidden whitespace-nowrap p-3 text-dark-5 dark:text-dark-6 sm:table-cell">{formatDateTime(p.joined_at)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function SessionResultsView({ product, deckId, sessionId }: { product: DeckProduct; deckId: number; sessionId: number }) {
	const copy = productCopy(product);
	const [results, setResults] = useState<SessionResults | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
	const [tab, setTab] = useState<Tab>("summary");
	const [downloading, setDownloading] = useState(false);
	const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ summary: null, participants: null });

	const load = useCallback(
		async (signal?: AbortSignal) => {
			setLoading(true);
			setError(null);
			try {
				setResults(await sessionResultsApiFor(product).getResults(sessionId, signal));
			} catch (reason) {
				const err = toDeckApiError(reason);
				if (err.code === "cancelled") return;
				setError({ message: err.message, notFound: err.code === "not_found" });
			} finally {
				if (!signal?.aborted) setLoading(false);
			}
		},
		[product, sessionId]
	);

	useEffect(() => {
		const controller = new AbortController();
		void load(controller.signal);
		return () => controller.abort();
	}, [load]);

	const download = async () => {
		if (!results) return;
		setDownloading(true);
		try {
			await sessionResultsApiFor(product).downloadCsv(sessionId, `${fileSlug(results.session.deck_title || copy.noun)}-session-${sessionId}.csv`);
		} catch {
			toast.error("The download failed. Please try again.");
		} finally {
			setDownloading(false);
		}
	};

	const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
		const index = TABS.indexOf(tab);
		const next =
			event.key === "ArrowRight" ? TABS[(index + 1) % TABS.length] : event.key === "ArrowLeft" ? TABS[(index + TABS.length - 1) % TABS.length] : null;
		if (!next) return;
		event.preventDefault();
		setTab(next);
		tabRefs.current[next]?.focus();
	};

	const backLink = (
		<Link
			href={copy.sessionsHref(deckId)}
			className={cn("inline-flex min-h-11 items-center gap-1 rounded-md text-sm text-dark-5 hover:text-primary-700 dark:text-dark-6", focusRing)}
		>
			<ArrowLeft className="h-4 w-4" aria-hidden /> All sessions
		</Link>
	);

	if (error && !results) {
		return (
			<div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
				{backLink}
				<div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-light-3 bg-red-light-5 px-4 py-3 text-sm text-[#B42318]">
					{error.notFound ? "This session could not be found." : error.message}
					{!error.notFound && (
						<button type="button" onClick={() => void load()} className={cn("min-h-11 rounded px-2 font-semibold underline", focusRing)}>
							Try again
						</button>
					)}
				</div>
			</div>
		);
	}

	if (!results) {
		return (
			<div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6" aria-busy="true" aria-label="Loading results">
				{backLink}
				<div className="space-y-2">
					<div className="h-4 w-24 animate-pulse rounded bg-gray-2 dark:bg-dark-2" />
					<div className="h-8 w-2/3 animate-pulse rounded bg-gray-2 dark:bg-dark-2" />
					<div className="h-4 w-1/2 animate-pulse rounded bg-gray-2 dark:bg-dark-2" />
				</div>
				{[0, 1].map((index) => (
					<div key={index} className="aspect-video w-full max-w-3xl animate-pulse rounded-xl bg-gray-2 dark:bg-dark-2" />
				))}
			</div>
		);
	}

	const { session, runs, participants } = results;
	const live = session.status === "live";

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
			{backLink}

			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">{copy.Noun} session results</p>
					<h1 className="mt-1 break-words text-2xl font-bold text-dark dark:text-white">{session.deck_title || "Untitled"}</h1>
					<ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-dark-5 dark:text-dark-6">
						<li>
							<SessionStatusPill status={session.status} />
						</li>
						<li>{formatDateTime(session.started_at)}</li>
						{session.status === "ended" && (
							<li className="flex items-center gap-1.5">
								<Clock className="h-4 w-4" aria-hidden />
								{sessionDuration(session)}
							</li>
						)}
						<li className="flex items-center gap-1.5">
							<Users className="h-4 w-4" aria-hidden />
							{plural(participants.length, "participant")}
						</li>
						<li>Code {session.join_code}</li>
					</ul>
				</div>
				<div className="flex flex-wrap gap-2">
					{live && (
						<Button variant="outline" size="lg" onClick={() => void load()} loading={loading} className="min-h-11">
							<RefreshCw className="h-4 w-4" aria-hidden /> Refresh
						</Button>
					)}
					<Button variant="outline" size="lg" onClick={download} loading={downloading} className="min-h-11">
						<Download className="h-4 w-4" aria-hidden /> Download CSV
					</Button>
				</div>
			</header>

			{live && (
				<p role="status" className="rounded-lg bg-urgent-bg px-4 py-3 text-sm text-urgent-text dark:bg-urgent/20 dark:text-white">
					This session is still live. Refresh for the latest answers.
				</p>
			)}
			{error && (
				<p role="alert" className="rounded-lg border border-red-light-3 bg-red-light-5 px-4 py-3 text-sm text-[#B42318]">
					{error.message}
				</p>
			)}

			<div role="tablist" aria-label="Results" className="flex gap-1 border-b border-stroke dark:border-stroke-dark">
				{TABS.map((t) => (
					<button
						key={t}
						ref={(element) => {
							tabRefs.current[t] = element;
						}}
						type="button"
						role="tab"
						id={`results-tab-${t}`}
						aria-controls={`results-panel-${t}`}
						aria-selected={tab === t}
						tabIndex={tab === t ? 0 : -1}
						onClick={() => setTab(t)}
						onKeyDown={onTabKey}
						className={cn(
							"-mb-px min-h-11 rounded-t-md border-b-2 px-4 text-sm font-medium",
							focusRing,
							tab === t ? "border-primary text-dark dark:text-white" : "border-transparent text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white"
						)}
					>
						{t === "summary" ? `Summary (${runs.length})` : `Participants (${participants.length})`}
					</button>
				))}
			</div>

			<div role="tabpanel" id={`results-panel-${tab}`} aria-labelledby={`results-tab-${tab}`}>
				{tab === "summary" ? (
					runs.length === 0 ? (
						<p className="rounded-xl border border-dashed border-stroke px-4 py-10 text-center text-sm text-dark-5 dark:border-stroke-dark dark:text-dark-6">
							No question was opened for answers in this session.
						</p>
					) : (
						<ol className="space-y-4">
							{runs.map((run, index) => (
								<RunCard key={run.id} run={run} number={index + 1} results={results} />
							))}
						</ol>
					)
				) : (
					<ParticipantsTable results={results} />
				)}
			</div>
		</div>
	);
}
