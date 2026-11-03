"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { CalendarClock, Copy, Globe, Layers, Loader2, Lock, MonitorPlay, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui";
import { authoringApiFor } from "@/features/deck/api/authoringApi";
import { isDeckApiError, toDeckApiError } from "@/features/deck/api/errors";
import { productCopy, type DeckProductCopy } from "@/features/deck/productCopy";
import { getDeckTheme } from "@/features/deck/theme";
import type { DeckListMeta, DeckProduct, DeckSummary } from "@/features/deck/types";
import { ThemeSwatch } from "@/features/deck-editor/components/inspector/DesignTab";

// My Library > Quiz / Quest: the user's decks of one product, newest first,
// with edit, present, duplicate and delete.

const PER_PAGE = 12;

const actionClass =
	"inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50";

function formatUpdated(iso: string | null): string {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function slides(count: number): string {
	return `${count} ${count === 1 ? "slide" : "slides"}`;
}

function DeckCard({
	deck,
	copy,
	busy,
	onDuplicate,
	onDelete,
}: {
	deck: DeckSummary;
	copy: DeckProductCopy;
	busy: boolean;
	onDuplicate(deck: DeckSummary): void;
	onDelete(deck: DeckSummary): void;
}) {
	const theme = getDeckTheme(deck.settings?.theme);
	// The whole card opens the deck: the title link stretches over it (after:inset-0), and the
	// action row sits above that layer so its buttons keep their own clicks.
	return (
		<li className="relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-stroke bg-white transition hover:border-primary hover:shadow-md dark:border-stroke-dark dark:bg-gray-dark">
			<div className="p-3">
				{deck.cover?.url ? (
					// Covers come from My Files (any host), so a plain img keeps next/image config out of it.
					// eslint-disable-next-line @next/next/no-img-element
					<img src={deck.cover.url} alt="" className="aspect-video w-full rounded-md object-cover" />
				) : (
					<ThemeSwatch theme={theme} />
				)}
			</div>
			<div className="flex flex-1 flex-col gap-1 px-4 pb-3">
				<div className="flex items-center gap-2">
					<h3 className="min-w-0 flex-1 truncate text-base font-semibold text-dark dark:text-white">
						<Link
							href={copy.editHref(deck.id)}
							title={deck.title}
							className="after:absolute after:inset-0 after:rounded-xl after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary-600"
						>
							{deck.title}
						</Link>
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
					{slides(deck.slideCount)}
				</p>
				<p className="flex items-center gap-1.5 text-sm text-dark-5 dark:text-dark-6">
					<CalendarClock className="h-4 w-4" aria-hidden />
					Updated {formatUpdated(deck.updatedAt)}
				</p>
			</div>
			<div className="relative z-10 grid cursor-default grid-cols-2 gap-1 border-t border-stroke bg-white p-2 dark:border-stroke-dark dark:bg-gray-dark">
				<Link href={copy.editHref(deck.id)} className={`${actionClass} bg-primary font-semibold text-dark hover:bg-primary-dark`}>
					<Pencil className="h-4 w-4" aria-hidden />
					Edit
				</Link>
				{deck.slideCount > 0 ? (
					<Link
						href={copy.presentHref(deck.id)}
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

export function DeckLibrarySection({ product }: { product: DeckProduct }) {
	const copy = productCopy(product);
	const api = authoringApiFor(product);
	const router = useRouter();
	const [decks, setDecks] = useState<DeckSummary[]>([]);
	const [meta, setMeta] = useState<DeckListMeta | null>(null);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<number | null>(null);
	const [creating, setCreating] = useState(false);
	const [toDelete, setToDelete] = useState<DeckSummary | null>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const headingId = `${product}-library-heading`;

	const load = useCallback(
		async (pageNumber: number, signal?: AbortSignal) => {
			setLoading(true);
			setError(null);
			try {
				const result = await api.listDecks({ sort: "updated", direction: "desc", perPage: PER_PAGE, page: pageNumber }, signal);
				setDecks(result.items);
				setMeta(result.meta);
			} catch (reason) {
				const err = toDeckApiError(reason);
				if (err.code === "cancelled") return;
				setError(err.message);
			} finally {
				if (!signal?.aborted) setLoading(false);
			}
		},
		[api]
	);

	useEffect(() => {
		const controller = new AbortController();
		void load(page, controller.signal);
		return () => controller.abort();
	}, [page, load]);

	const createDeck = async () => {
		setCreating(true);
		try {
			const deck = await api.createDeck();
			router.push(copy.editHref(deck.id));
		} catch (reason) {
			toast.error((reason as Error)?.message || `The ${copy.noun} could not be created.`);
			setCreating(false);
		}
	};

	const duplicate = async (deck: DeckSummary) => {
		setBusyId(deck.id);
		try {
			const duplicated = await api.duplicateDeck(deck.id);
			toast.success(`“${duplicated.title}” created.`);
			if (page === 1) await load(1);
			else setPage(1);
		} catch (reason) {
			toast.error((reason as Error)?.message || `The ${copy.noun} could not be duplicated.`);
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
			await api.deleteDeck(deck.id);
			toast.success(`“${deck.title}” deleted.`);
			if (decks.length === 1 && page > 1) setPage(page - 1);
			else await load(page);
			headingRef.current?.focus();
		} catch (reason) {
			if (isDeckApiError(reason) && reason.code === "not_found") await load(page);
			else toast.error((reason as Error)?.message || `The ${copy.noun} could not be deleted.`);
		} finally {
			setBusyId(null);
		}
	};

	const lastPage = meta?.lastPage ?? 1;

	return (
		<section aria-labelledby={headingId} className="mb-10">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl font-bold text-dark focus:outline-none dark:text-white">
						Your {copy.plural}
					</h2>
					<p className="text-sm text-dark-5 dark:text-dark-6">
						{copy.tagline}
						{meta ? ` ${meta.total} in total.` : ""}
					</p>
				</div>
				<button
					type="button"
					onClick={createDeck}
					disabled={creating}
					className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-dark transition hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:opacity-60"
				>
					{creating ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
					New {copy.noun}
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
				<ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label={`Loading ${copy.plural}`}>
					{Array.from({ length: 4 }).map((_, index) => (
						<li key={index} className="h-72 animate-pulse rounded-xl bg-gray-2 dark:bg-dark-2" />
					))}
				</ul>
			) : decks.length === 0 ? (
				<p className="rounded-xl border border-dashed border-stroke px-4 py-10 text-center text-sm text-dark-5 dark:border-stroke-dark dark:text-dark-6">
					No {copy.plural} yet. Create one to get started.
				</p>
			) : (
				<ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy={loading}>
					{decks.map((deck) => (
						<DeckCard key={deck.id} deck={deck} copy={copy} busy={busyId === deck.id} onDuplicate={duplicate} onDelete={setToDelete} />
					))}
				</ul>
			)}

			{lastPage > 1 ? (
				<nav aria-label={`${copy.Noun} pages`} className="mt-4 flex items-center justify-center gap-3 text-sm">
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
				title={`Delete this ${copy.noun}?`}
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
							Delete {copy.noun}
						</button>
					</div>
				}
			>
				<p className="text-sm text-dark-4 dark:text-dark-6">
					“{toDelete?.title}” and its {slides(toDelete?.slideCount ?? 0)} will be removed from your library.
				</p>
			</Modal>
		</section>
	);
}
