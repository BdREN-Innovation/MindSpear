"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import {
	ArrowLeft,
	CalendarClock,
	ChevronRight,
	Clock,
	Globe,
	History,
	LayoutGrid,
	Layers,
	List,
	Lock,
	MessageSquare,
	MonitorPlay,
	Pencil,
	Search,
	Trash2,
	Users,
} from "lucide-react";
import { Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import { authoringApiFor } from "@/features/deck/api/authoringApi";
import { isDeckApiError, toDeckApiError } from "@/features/deck/api/errors";
import { productCopy, type DeckProductCopy } from "@/features/deck/productCopy";
import { getDeckTheme } from "@/features/deck/theme";
import type { DeckProduct, DeckSummary } from "@/features/deck/types";
import { ThemeSwatch } from "@/features/deck-editor/components/inspector/DesignTab";
import type { LegacySessionSummary } from "@/features/legacy-results/api";
import { sessionResultsApiFor, type DeckSessions, type DeckSessionSummary, type LegacySessionGroup } from "../api";
import { SessionStatusPill } from "../components/SessionStatusPill";
import { STATUS_LABEL, formatDateTime, plural, sessionDuration } from "../format";

// My Library > a quiz / quest: the deck (edit, present, delete) and every
// session hosted from it, each opening its results. Sessions of the previous
// version's quiz this deck was converted from follow, opening /past-results.

type View = "table" | "grid";

const VIEW_KEY = "mindspear.deck-sessions.view";

const focusRing = "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-dark";

const actionClass = cn(
	"inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
	focusRing
);

function sessionDate(session: DeckSessionSummary): string {
	return formatDateTime(session.started_at ?? session.created_at);
}

function matches(session: DeckSessionSummary, query: string): boolean {
	if (!query) return true;
	const haystack = [sessionDate(session), session.join_code, STATUS_LABEL[session.status], String(session.id)].join(" ").toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.every((word) => haystack.includes(word));
}

function readView(): View {
	try {
		return window.localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "table";
	} catch {
		return "table";
	}
}

/* ------------------------------------------------------------------ */
/* Deck header                                                         */
/* ------------------------------------------------------------------ */

function DeckHeader({ deck, copy, onDelete, deleting }: { deck: DeckSummary; copy: DeckProductCopy; onDelete(): void; deleting: boolean }) {
	const theme = getDeckTheme(deck.settings?.theme);
	return (
		<header className="flex flex-col gap-4 rounded-xl border border-stroke bg-white p-4 dark:border-stroke-dark dark:bg-gray-dark sm:flex-row sm:p-5">
			<div className="w-full shrink-0 sm:w-56">
				{deck.cover?.url ? (
					// Covers come from My Files (any host), so a plain img keeps next/image config out of it.
					// eslint-disable-next-line @next/next/no-img-element
					<img src={deck.cover.url} alt="" className="aspect-video w-full rounded-md object-cover" />
				) : (
					<ThemeSwatch theme={theme} />
				)}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-3">
				<div>
					<p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">{copy.Noun}</p>
					<h1 className="mt-1 break-words text-2xl font-bold text-dark dark:text-white">{deck.title}</h1>
				</div>
				<ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-dark-5 dark:text-dark-6">
					<li className="flex items-center gap-1.5">
						<Layers className="h-4 w-4" aria-hidden />
						{plural(deck.slideCount, "slide")}
					</li>
					<li className="flex items-center gap-1.5">
						{deck.visibility === "public" ? (
							<>
								<Globe className="h-4 w-4 text-green-dark" aria-hidden />
								Public: listed in Discover
							</>
						) : (
							<>
								<Lock className="h-4 w-4" aria-hidden />
								Private
							</>
						)}
					</li>
					<li className="flex items-center gap-1.5">
						<CalendarClock className="h-4 w-4" aria-hidden />
						Updated {formatDateTime(deck.updatedAt)}
					</li>
				</ul>
				<div className="mt-auto flex flex-wrap gap-2">
					<Link
						href={copy.editHref(deck.id)}
						className={cn(actionClass, "border border-stroke bg-white text-dark shadow-sm hover:bg-gray-1 dark:border-stroke-dark dark:bg-gray-dark dark:text-white dark:hover:bg-dark-2")}
					>
						<Pencil className="h-4 w-4" aria-hidden />
						Edit
					</Link>
					{deck.slideCount > 0 ? (
						<Link
							href={copy.presentHref(deck.id)}
							className={cn(actionClass, "border border-stroke text-dark hover:bg-gray-1 dark:border-stroke-dark dark:text-white dark:hover:bg-dark-2")}
						>
							<MonitorPlay className="h-4 w-4" aria-hidden />
							Present
						</Link>
					) : (
						<button type="button" disabled title="Add a slide first" className={cn(actionClass, "border border-stroke text-dark dark:border-stroke-dark dark:text-white")}>
							<MonitorPlay className="h-4 w-4" aria-hidden />
							Present
						</button>
					)}
					<button
						type="button"
						onClick={onDelete}
						disabled={deleting}
						aria-haspopup="dialog"
						className={cn(actionClass, "text-[#B42318] hover:bg-red-light-5 dark:text-red-light dark:hover:bg-dark-3")}
					>
						<Trash2 className="h-4 w-4" aria-hidden />
						Delete
					</button>
				</div>
			</div>
		</header>
	);
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

function SessionsTable({ sessions, href }: { sessions: DeckSessionSummary[]; href(session: DeckSessionSummary): string }) {
	return (
		<div className="overflow-x-auto rounded-xl border border-stroke bg-white dark:border-stroke-dark dark:bg-gray-dark">
			<table className="w-full text-left text-sm">
				<thead className="border-b border-stroke text-dark-5 dark:border-stroke-dark dark:text-dark-6">
					<tr>
						<th scope="col" className="p-3 font-medium">
							Started
						</th>
						<th scope="col" className="p-3 font-medium">
							Status
						</th>
						<th scope="col" className="hidden p-3 font-medium sm:table-cell">
							Duration
						</th>
						<th scope="col" className="p-3 text-right font-medium">
							<span className="sm:hidden">People</span>
							<span className="hidden sm:inline">Participants</span>
						</th>
						<th scope="col" className="hidden p-3 text-right font-medium md:table-cell">
							Answers
						</th>
						<th scope="col" className="w-10 p-3">
							<span className="sr-only">Open</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{sessions.map((session) => (
						<tr key={session.id} className="border-b border-stroke last:border-0 hover:bg-gray-1 dark:border-stroke-dark dark:hover:bg-dark-2">
							<td className="p-0">
								<Link
									href={href(session)}
									className={cn("flex min-h-11 flex-col justify-center rounded-md px-3 py-2 font-medium text-dark dark:text-white", focusRing)}
								>
									{sessionDate(session)}
									<span className="text-xs font-normal text-dark-5 dark:text-dark-6">Code {session.join_code}</span>
								</Link>
							</td>
							<td className="p-3">
								<SessionStatusPill status={session.status} />
							</td>
							<td className="hidden p-3 text-dark-5 dark:text-dark-6 sm:table-cell">{sessionDuration(session)}</td>
							<td className="p-3 text-right tabular-nums text-dark dark:text-white">{session.participant_count}</td>
							<td className="hidden p-3 text-right tabular-nums text-dark dark:text-white md:table-cell">{session.answer_count}</td>
							<td className="p-0 text-right">
								{/* The date link is the keyboard stop; this one is a bigger pointer target. */}
								<Link href={href(session)} tabIndex={-1} aria-hidden className="inline-flex h-11 w-11 items-center justify-center text-dark-5 hover:text-primary-700">
									<ChevronRight className="h-4 w-4" />
								</Link>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function SessionsGrid({ sessions, href }: { sessions: DeckSessionSummary[]; href(session: DeckSessionSummary): string }) {
	return (
		<ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{sessions.map((session) => (
				<li
					key={session.id}
					className="relative flex flex-col gap-3 rounded-xl border border-stroke bg-white p-4 transition hover:border-primary-300 hover:shadow-sm dark:border-stroke-dark dark:bg-gray-dark"
				>
					<div className="flex items-start justify-between gap-2">
						<h3 className="min-w-0 font-semibold text-dark dark:text-white">
							<Link
								href={href(session)}
								className="after:absolute after:inset-0 after:rounded-xl after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary-600"
							>
								{sessionDate(session)}
							</Link>
						</h3>
						<SessionStatusPill status={session.status} />
					</div>
					<dl className="grid grid-cols-3 gap-2 text-sm">
						<div>
							<dt className="flex items-center gap-1 text-xs text-dark-5 dark:text-dark-6">
								<Users className="h-3.5 w-3.5" aria-hidden /> People
							</dt>
							<dd className="font-semibold tabular-nums text-dark dark:text-white">{session.participant_count}</dd>
						</div>
						<div>
							<dt className="flex items-center gap-1 text-xs text-dark-5 dark:text-dark-6">
								<MessageSquare className="h-3.5 w-3.5" aria-hidden /> Answers
							</dt>
							<dd className="font-semibold tabular-nums text-dark dark:text-white">{session.answer_count}</dd>
						</div>
						<div>
							<dt className="flex items-center gap-1 text-xs text-dark-5 dark:text-dark-6">
								<Clock className="h-3.5 w-3.5" aria-hidden /> Duration
							</dt>
							<dd className="font-semibold text-dark dark:text-white">{sessionDuration(session)}</dd>
						</div>
					</dl>
					<p className="text-xs text-dark-5 dark:text-dark-6">Join code {session.join_code}</p>
				</li>
			))}
		</ul>
	);
}

function legacySessionLabel(session: LegacySessionSummary): string {
	return session.id === "none" ? "Without a session" : formatDateTime(session.started_at);
}

function LegacySessions({ groups }: { groups: LegacySessionGroup[] }) {
	return (
		<section aria-labelledby="legacy-sessions-heading" className="space-y-3">
			<div>
				<h2 id="legacy-sessions-heading" className="flex items-center gap-2 text-lg font-bold text-dark dark:text-white">
					<History className="h-5 w-5 text-dark-5" aria-hidden />
					From the previous version
				</h2>
				<p className="text-sm text-dark-5 dark:text-dark-6">Sessions run before this was moved to the new editor. Their results open read-only.</p>
			</div>
			{groups.map((group) => (
				<div key={`${group.source}-${group.id}`} className="rounded-xl border border-stroke bg-white dark:border-stroke-dark dark:bg-gray-dark">
					{groups.length > 1 && (
						<h3 className="border-b border-stroke px-4 py-2 text-sm font-semibold text-dark dark:border-stroke-dark dark:text-white">
							{group.title || "Untitled"}
						</h3>
					)}
					<ul className="divide-y divide-stroke dark:divide-stroke-dark">
						{group.sessions.map((session) => (
							<li key={session.id}>
								<Link
									href={`/past-results/${group.source}/${group.id}?session=${encodeURIComponent(session.id)}`}
									className={cn(
										"flex min-h-11 items-center gap-3 rounded-md px-4 py-2 text-sm hover:bg-gray-1 dark:hover:bg-dark-2",
										focusRing
									)}
								>
									<span className="min-w-0 flex-1">
										<span className="block font-medium text-dark dark:text-white">{legacySessionLabel(session)}</span>
										{session.join_code && <span className="block text-xs text-dark-5 dark:text-dark-6">Code {session.join_code}</span>}
									</span>
									<span className="shrink-0 tabular-nums text-dark-5 dark:text-dark-6">{plural(session.participants, "participant")}</span>
									<ChevronRight className="h-4 w-4 shrink-0 text-dark-5" aria-hidden />
								</Link>
							</li>
						))}
					</ul>
				</div>
			))}
		</section>
	);
}

function ViewToggle({ view, onChange }: { view: View; onChange(view: View): void }) {
	const options: { value: View; label: string; Icon: typeof List }[] = [
		{ value: "table", label: "Table", Icon: List },
		{ value: "grid", label: "Grid", Icon: LayoutGrid },
	];
	return (
		<div role="group" aria-label="Layout" className="inline-flex shrink-0 rounded-lg bg-gray-2 p-0.5 dark:bg-dark-2">
			{options.map(({ value, label, Icon }) => (
				<button
					key={value}
					type="button"
					aria-pressed={view === value}
					onClick={() => onChange(value)}
					className={cn(
						"inline-flex min-h-10 min-w-11 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition",
						focusRing,
						view === value
							? "bg-white text-dark shadow-sm dark:bg-dark-3 dark:text-white"
							: "text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white"
					)}
				>
					<Icon className="h-4 w-4" aria-hidden />
					<span className="hidden sm:inline">{label}</span>
					<span className="sr-only sm:hidden">{label}</span>
				</button>
			))}
		</div>
	);
}

/* ------------------------------------------------------------------ */

export function DeckSessionsView({ product, deckId }: { product: DeckProduct; deckId: number }) {
	const copy = productCopy(product);
	const router = useRouter();
	const [data, setData] = useState<DeckSessions | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
	const [query, setQuery] = useState("");
	const [view, setView] = useState<View>("table");
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);

	useEffect(() => setView(readView()), []);

	const changeView = (next: View) => {
		setView(next);
		try {
			window.localStorage.setItem(VIEW_KEY, next);
		} catch {
			// The choice just isn't remembered.
		}
	};

	const load = useCallback(
		async (signal?: AbortSignal) => {
			setLoading(true);
			setError(null);
			try {
				setData(await sessionResultsApiFor(product).listSessions(deckId, signal));
			} catch (reason) {
				const err = toDeckApiError(reason);
				if (err.code === "cancelled") return;
				setError({ message: err.message, notFound: err.code === "not_found" });
			} finally {
				if (!signal?.aborted) setLoading(false);
			}
		},
		[product, deckId]
	);

	useEffect(() => {
		const controller = new AbortController();
		void load(controller.signal);
		return () => controller.abort();
	}, [load]);

	const sessions = useMemo(() => (data?.sessions ?? []).filter((session) => matches(session, query.trim())), [data, query]);
	const href = useCallback((session: DeckSessionSummary) => copy.sessionResultsHref(deckId, session.id), [copy, deckId]);

	const deleteDeck = async () => {
		const deck = data?.deck;
		setConfirmDelete(false);
		if (!deck) return;
		setDeleting(true);
		try {
			await authoringApiFor(product).deleteDeck(deck.id);
			toast.success(`“${deck.title}” deleted.`);
			router.push(copy.libraryHref);
		} catch (reason) {
			if (isDeckApiError(reason) && reason.code === "not_found") router.push(copy.libraryHref);
			else toast.error((reason as Error)?.message || `The ${copy.noun} could not be deleted.`);
			setDeleting(false);
		}
	};

	const backLink = (
		<Link
			href={copy.libraryHref}
			className={cn("inline-flex min-h-11 items-center gap-1 rounded-md text-sm text-dark-5 hover:text-primary-700 dark:text-dark-6", focusRing)}
		>
			<ArrowLeft className="h-4 w-4" aria-hidden /> My Library
		</Link>
	);

	if (error && !data) {
		return (
			<div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
				{backLink}
				<div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-light-3 bg-red-light-5 px-4 py-3 text-sm text-[#B42318]">
					{error.notFound ? `This ${copy.noun} could not be found. It may have been deleted.` : error.message}
					{!error.notFound && (
						<button type="button" onClick={() => void load()} className={cn("min-h-11 rounded px-2 font-semibold underline", focusRing)}>
							Try again
						</button>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
			{backLink}

			{data ? (
				<DeckHeader deck={data.deck} copy={copy} deleting={deleting} onDelete={() => setConfirmDelete(true)} />
			) : (
				<div className="flex flex-col gap-4 rounded-xl border border-stroke p-4 dark:border-stroke-dark sm:flex-row sm:p-5" aria-busy="true" aria-label={`Loading ${copy.noun}`}>
					<div className="aspect-video w-full animate-pulse rounded-md bg-gray-2 dark:bg-dark-2 sm:w-56" />
					<div className="flex-1 space-y-3">
						<div className="h-4 w-16 animate-pulse rounded bg-gray-2 dark:bg-dark-2" />
						<div className="h-8 w-2/3 animate-pulse rounded bg-gray-2 dark:bg-dark-2" />
						<div className="h-4 w-1/2 animate-pulse rounded bg-gray-2 dark:bg-dark-2" />
					</div>
				</div>
			)}

			<section aria-labelledby="sessions-heading" className="space-y-3">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2 id="sessions-heading" className="text-lg font-bold text-dark dark:text-white">
							Sessions
						</h2>
						<p className="text-sm text-dark-5 dark:text-dark-6">
							{data ? `${plural(data.sessions.length, "session")}, newest first.` : `Every time you presented this ${copy.noun}.`}
						</p>
					</div>
					{data && data.sessions.length > 0 && (
						<div className="flex w-full items-center gap-2 sm:w-auto">
							<label className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
								<span className="sr-only">Search sessions</span>
								<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-5" aria-hidden />
								<input
									type="search"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder="Search by date or code"
									className="h-11 w-full rounded-lg border border-stroke bg-white pl-9 pr-3 text-sm text-dark outline-none focus:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-600/30 dark:border-stroke-dark dark:bg-dark-2 dark:text-white"
								/>
							</label>
							<ViewToggle view={view} onChange={changeView} />
						</div>
					)}
				</div>

				{error && (
					<div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-light-3 bg-red-light-5 px-4 py-3 text-sm text-[#B42318]">
						{error.message}
						<button type="button" onClick={() => void load()} className={cn("min-h-11 rounded px-2 font-semibold underline", focusRing)}>
							Try again
						</button>
					</div>
				)}

				{!data && loading ? (
					<ul className="space-y-2" aria-busy="true" aria-label="Loading sessions">
						{[0, 1, 2].map((index) => (
							<li key={index} className="h-14 animate-pulse rounded-lg bg-gray-2 dark:bg-dark-2" />
						))}
					</ul>
				) : data && data.sessions.length === 0 ? (
					<div className="rounded-xl border border-dashed border-stroke px-4 py-10 text-center text-sm text-dark-5 dark:border-stroke-dark dark:text-dark-6">
						<p>No sessions yet — Present this {copy.noun} to run one.</p>
						{data.deck.slideCount > 0 && (
							<Link
								href={copy.presentHref(data.deck.id)}
								className={cn("mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-4 font-semibold text-primary-700 hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-dark-2", focusRing)}
							>
								<MonitorPlay className="h-4 w-4" aria-hidden />
								Present now
							</Link>
						)}
					</div>
				) : data && sessions.length === 0 ? (
					<p className="rounded-xl border border-dashed border-stroke px-4 py-8 text-center text-sm text-dark-5 dark:border-stroke-dark dark:text-dark-6" role="status">
						No sessions match “{query.trim()}”.
					</p>
				) : data ? (
					view === "grid" ? (
						<SessionsGrid sessions={sessions} href={href} />
					) : (
						<SessionsTable sessions={sessions} href={href} />
					)
				) : null}
			</section>

			{data && data.legacy.length > 0 && <LegacySessions groups={data.legacy} />}

			<Modal
				title={`Delete this ${copy.noun}?`}
				open={confirmDelete}
				onClose={() => setConfirmDelete(false)}
				size="sm"
				footer={
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => setConfirmDelete(false)}
							className="min-h-11 rounded-lg border border-stroke px-4 text-sm font-medium text-dark hover:bg-gray-2 dark:border-stroke-dark dark:text-white"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={deleteDeck}
							className="min-h-12 rounded-lg bg-[#B42318] px-5 text-sm font-semibold text-white hover:bg-red-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318] focus-visible:ring-offset-2"
						>
							Delete {copy.noun}
						</button>
					</div>
				}
			>
				<p className="text-sm text-dark-4 dark:text-dark-6">
					“{data?.deck.title}” and its {plural(data?.deck.slideCount ?? 0, "slide")} will be removed from your library.
				</p>
			</Modal>
		</div>
	);
}
