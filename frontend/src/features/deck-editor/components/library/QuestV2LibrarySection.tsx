"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { CalendarClock, Copy, Globe, Layers, Loader2, Lock, MonitorPlay, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui";
import { questAuthoringApi } from "@/features/deck/api/authoringApi";
import { isDeckApiError, toDeckApiError } from "@/features/deck/api/errors";
import { getDeckTheme } from "@/features/deck/theme";
import type { DeckListMeta, DeckSummary } from "@/features/deck/types";
import { ThemeSwatch } from "../inspector/DesignTab";
import { clearQuestV2EnabledCache, useQuestV2Enabled } from "../useQuestV2Enabled";

// My Library > Quest: the user's Quest v2 decks, shown above the legacy list
// while the rollout flag is on (plan "Entry points").

const PER_PAGE = 12;

const actionClass =
	"inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50";

function formatUpdated(iso: string | null): string {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	const diff = Date.now() - date.getTime();
	const minutes = Math.round(diff / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function DeckCard({
	deck,
	busy,
	onDuplicate,
	onDelete,
}: {
	deck: DeckSummary;
	busy: boolean;
	onDuplicate(deck: DeckSummary): void;
	onDelete(deck: DeckSummary): void;
}) {
	const theme = getDeckTheme(deck.settings?.theme);
	return (
		<li className="flex flex-col overflow-hidden rounded-xl border border-stroke bg-white transition hover:border-primary dark:border-stroke-dark dark:bg-gray-dark">
			<Link
				href={`/quests/${deck.id}/edit`}
				className="block p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
				aria-label={`Edit ${deck.title}`}
			>
				{deck.cover?.url ? (
					// Covers come from My Files (any host), so a plain img keeps next/image config out of it.
					// eslint-disable-next-line @next/next/no-img-element
					<img src={deck.cover.url} alt="" className="aspect-video w-full rounded-md object-cover" />
				) : (
					<ThemeSwatch theme={theme} />
				)}
			</Link>
			<div className="flex flex-1 flex-col gap-1 px-4 pb-3">
				<div className="flex items-center gap-2">
					<h3 className="min-w-0 flex-1 truncate text-base font-semibold text-dark dark:text-white" title={deck.title}>
						{deck.title}
					</h3>
					{deck.visibility === "public" ? (
						<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-light-7 px-2 py-0.5 text-xs font-medium text-green-dark" title="Listed in Discover">
							<Globe className="h-3.5 w-3.5" aria-hidden />
							Public
						</span>
					) : (
						<span className="inline-flex shrink-0 items-center text-dark-5 dark:text-dark-6" title="Private: only you can see it">
							<Lock className="h-3.5 w-3.5" aria-hidden />
							<span className="sr-only">Private</span>
						</span>
					)}
				</div>
				<p className="flex items-center gap-1.5 text-sm text-dark-5 dark:text-dark-6">
					<Layers className="h-4 w-4" aria-hidden />
					{deck.slideCount} {deck.slideCount === 1 ? "slide" : "slides"}
				</p>
				<p className="flex items-center gap-1.5 text-sm text-dark-5 dark:text-dark-6">
					<CalendarClock className="h-4 w-4" aria-hidden />
					Updated {formatUpdated(deck.updatedAt)}
				</p>
			</div>
			<div className="grid grid-cols-2 gap-1 border-t border-stroke p-2 dark:border-stroke-dark">
				<Link href={`/quests/${deck.id}/edit`} className={`${actionClass} bg-primary font-semibold text-dark hover:bg-primary-dark`}>
					<Pencil className="h-4 w-4" aria-hidden />
					Edit
				</Link>
				{deck.slideCount > 0 ? (
					<Link
						href={`/quests/${deck.id}/present`}
						className={`${actionClass} bg-gray-2 text-dark hover:bg-gray-3 dark:bg-dark-2 dark:text-white dark:hover:bg-dark-3`}
					>
						<MonitorPlay className="h-4 w-4" aria-hidden />
						Present
					</Link>
				) : (
					<button type="button" disabled title="Add a slide first" className={`${actionClass} bg-gray-2 text-dark dark:bg-dark-2 dark:text-white`}>
						<MonitorPlay className="h-4 w-4" aria-hidden />
						Present
					</button>
				)}
				<button
					type="button"
					disabled={busy}
					onClick={() => onDuplicate(deck)}
					className={`${actionClass} text-dark hover:bg-gray-2 dark:text-white dark:hover:bg-dark-3`}
					aria-label={`Duplicate ${deck.title}`}
				>
					<Copy className="h-4 w-4" aria-hidden />
					Duplicate
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={() => onDelete(deck)}
					className={`${actionClass} text-[#B42318] hover:bg-red-light-5 dark:text-red-light dark:hover:bg-dark-3`}
					aria-label={`Delete ${deck.title}`}
				>
					<Trash2 className="h-4 w-4" aria-hidden />
					Delete
				</button>
			</div>
		</li>
	);
}

export function QuestV2LibrarySection() {
	const { enabled } = useQuestV2Enabled();
	const router = useRouter();
	const [decks, setDecks] = useState<DeckSummary[]>([]);
	const [meta, setMeta] = useState<DeckListMeta | null>(null);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<number | null>(null);
	const [creating, setCreating] = useState(false);
	const [toDelete, setToDelete] = useState<DeckSummary | null>(null);
	const [hidden, setHidden] = useState(false);
	const headingRef = useRef<HTMLHeadingElement>(null);

	const load = useCallback(async (pageNumber: number, signal?: AbortSignal) => {
		setLoading(true);
		setError(null);
		try {
			const result = await questAuthoringApi.listDecks({ sort: "updated", direction: "desc", perPage: PER_PAGE, page: pageNumber }, signal);
			setDecks(result.items);
			setMeta(result.meta);
		} catch (reason) {
			const err = toDeckApiError(reason);
			if (err.code === "cancelled") return;
			if (err.code === "feature_disabled") {
				clearQuestV2EnabledCache();
				setHidden(true);
				return;
			}
			setError(err.message);
		} finally {
			if (!signal?.aborted) setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		void load(page, controller.signal);
		return () => controller.abort();
	}, [enabled, page, load]);

	if (!enabled || hidden) return null;

	const createDeck = async () => {
		setCreating(true);
		try {
			const deck = await questAuthoringApi.createDeck();
			router.push(`/quests/${deck.id}/edit`);
		} catch (reason) {
			toast.error((reason as Error)?.message || "The quest could not be created.");
			setCreating(false);
		}
	};

	const duplicate = async (deck: DeckSummary) => {
		setBusyId(deck.id);
		try {
			const copy = await questAuthoringApi.duplicateDeck(deck.id);
			toast.success(`“${copy.title}” created.`);
			if (page === 1) await load(1);
			else setPage(1);
		} catch (reason) {
			toast.error((reason as Error)?.message || "The quest could not be duplicated.");
		} finally {
			setBusyId(null);
		}
	};

	const confirmDelete = async () => {
		const deck = toDelete;
		if (!deck) return;
		setToDelete(null);
		setBusyId(deck.id);
		try {
			await questAuthoringApi.deleteDeck(deck.id);
			toast.success(`“${deck.title}” deleted.`);
			const lastOnPage = decks.length === 1 && page > 1;
			if (lastOnPage) setPage(page - 1);
			else await load(page);
			headingRef.current?.focus();
		} catch (reason) {
			if (isDeckApiError(reason) && reason.code === "not_found") await load(page);
			else toast.error((reason as Error)?.message || "The quest could not be deleted.");
		} finally {
			setBusyId(null);
		}
	};

	const lastPage = meta?.lastPage ?? 1;

	return (
		<section aria-labelledby="quest-v2-library-heading" className="mb-10">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id="quest-v2-library-heading" ref={headingRef} tabIndex={-1} className="text-xl font-bold text-dark focus:outline-none dark:text-white">
						Quest v2 <span className="ml-1 rounded-full bg-secondary-50 px-2 py-0.5 align-middle text-xs font-semibold text-secondary-600">New</span>
					</h2>
					<p className="text-sm text-dark-5 dark:text-dark-6">Slide-based quests with live results.{meta ? ` ${meta.total} in total.` : ""}</p>
				</div>
				<button
					type="button"
					onClick={createDeck}
					disabled={creating}
					className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-dark transition hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:opacity-60"
				>
					{creating ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
					New quest
				</button>
			</div>

			{error ? (
				<div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-light-3 bg-red-light-5 px-4 py-3 text-sm text-[#B42318]">
					{error}
					<button type="button" onClick={() => void load(page)} className="min-h-11 rounded px-2 font-semibold underline">
						Try again
					</button>
				</div>
			) : loading && decks.length === 0 ? (
				<ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading quests">
					{Array.from({ length: 4 }).map((_, index) => (
						<li key={index} className="h-72 animate-pulse rounded-xl bg-gray-2 dark:bg-dark-2" />
					))}
				</ul>
			) : decks.length === 0 ? (
				<p className="rounded-xl border border-dashed border-stroke px-4 py-10 text-center text-sm text-dark-5 dark:border-stroke-dark dark:text-dark-6">
					No v2 quests yet. Create one to try the new slide editor.
				</p>
			) : (
				<ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy={loading}>
					{decks.map((deck) => (
						<DeckCard key={deck.id} deck={deck} busy={busyId === deck.id} onDuplicate={duplicate} onDelete={setToDelete} />
					))}
				</ul>
			)}

			{lastPage > 1 ? (
				<nav aria-label="Quest v2 pages" className="mt-4 flex items-center justify-center gap-3 text-sm">
					<button
						type="button"
						disabled={page <= 1 || loading}
						onClick={() => setPage((p) => p - 1)}
						className="min-h-11 rounded-lg border border-stroke px-4 font-medium disabled:opacity-50 dark:border-stroke-dark dark:text-white"
					>
						Previous
					</button>
					<span className="tabular-nums text-dark-5" aria-live="polite">
						Page {page} of {lastPage}
					</span>
					<button
						type="button"
						disabled={page >= lastPage || loading}
						onClick={() => setPage((p) => p + 1)}
						className="min-h-11 rounded-lg border border-stroke px-4 font-medium disabled:opacity-50 dark:border-stroke-dark dark:text-white"
					>
						Next
					</button>
				</nav>
			) : null}

			<Modal
				title="Delete this quest?"
				open={toDelete !== null}
				onClose={() => setToDelete(null)}
				size="sm"
				footer={
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => setToDelete(null)}
							className="min-h-11 rounded-lg border border-stroke px-4 text-sm font-medium text-dark hover:bg-gray-2 dark:border-stroke-dark dark:text-white"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={confirmDelete}
							className="min-h-12 rounded-lg bg-[#B42318] px-5 text-sm font-semibold text-white hover:bg-red-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318] focus-visible:ring-offset-2"
						>
							Delete quest
						</button>
					</div>
				}
			>
				<p className="text-sm text-dark-4 dark:text-dark-6">
					“{toDelete?.title}” and its {toDelete?.slideCount ?? 0} {toDelete?.slideCount === 1 ? "slide" : "slides"} will be removed from your library.
				</p>
			</Modal>
		</section>
	);
}
