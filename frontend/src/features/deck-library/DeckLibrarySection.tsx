"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "react-toastify";
import { Copy, Globe, History, Layers, Lock, MonitorPlay, Pencil, PencilLine, Plus, Trash2 } from "lucide-react";
import { ActionsMenu, Modal } from "@/components/ui";
import { authoringApiFor } from "@/features/deck/api/authoringApi";
import { isDeckApiError, toDeckApiError } from "@/features/deck/api/errors";
import { productCopy, type DeckProductCopy } from "@/features/deck/productCopy";
import { getDeckTheme } from "@/features/deck/theme";
import type { DeckListMeta, DeckProduct, DeckSummary } from "@/features/deck/types";
import { ThemeSwatch } from "@/features/deck-editor/components/inspector/DesignTab";
import { NewDeckDialog } from "./NewDeckCard";
import { RenameDeckModal } from "./RenameDeckModal";

// My Library > Quiz / Quest: the user's decks of one product, newest first,
// with edit, present, duplicate and delete.

const PER_PAGE = 12;

// Icon-only actions in the logo's two colours (no background chip), shown on hover.
const actionClass =
	"inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary-400 disabled:cursor-not-allowed disabled:opacity-40";
const editAction = "text-primary-600 hover:text-primary-800 dark:text-primary-300";
const presentAction = "text-secondary-500 hover:text-secondary-700 dark:text-secondary-300";

/** An icon with a small tooltip on hover or focus: what Public / Private means, for anyone new. */
function VisibilityIcon({ visibility }: { visibility: DeckSummary["visibility"] }) {
	const isPublic = visibility === "public";
	const Icon = isPublic ? Globe : Lock;
	const tip = isPublic ? "Public · listed in Discover" : "Private · only you can see it";
	return (
		// Above the card link, so hovering the icon shows its tooltip instead of only the link.
		<span tabIndex={0} aria-label={tip} className="group/tip relative z-10 inline-flex shrink-0 rounded-full p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary-400">
			<Icon className="h-4 w-4 text-dark-5 dark:text-dark-6" aria-hidden />
			<span
				role="tooltip"
				className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-md bg-dark px-2 py-1 text-xs font-medium text-white shadow-lg group-hover/tip:block group-focus/tip:block dark:bg-dark-3"
			>
				{tip}
			</span>
		</span>
	);
}

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
	onRename,
	onDuplicate,
	onDelete,
}: {
	deck: DeckSummary;
	copy: DeckProductCopy;
	busy: boolean;
	onRename(deck: DeckSummary): void;
	onDuplicate(deck: DeckSummary): void;
	onDelete(deck: DeckSummary): void;
}) {
	const theme = getDeckTheme(deck.settings?.theme);
	// The whole card opens the deck's sessions page: the title link stretches over it (after:inset-0),
	// and the buttons, the ⋮ menu and the visibility icon sit above that layer so they keep their own clicks.
	return (
		<li className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-stroke bg-white transition hover:-translate-y-0.5 hover:border-secondary-300 hover:shadow-md dark:hover:border-secondary-600 motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:border-stroke-dark dark:bg-gray-dark">
			<div className="p-3">
				{deck.cover?.url ? (
					// Covers come from My Files (any host), so a plain img keeps next/image config out of it.
					// eslint-disable-next-line @next/next/no-img-element
					<img src={deck.cover.url} alt="" className="aspect-video w-full rounded-lg object-cover" />
				) : (
					<ThemeSwatch theme={theme} className="rounded-lg" />
				)}
			</div>
			<div className="flex flex-1 flex-col gap-1.5 px-4 pb-3 pt-1">
				<div className="flex items-center gap-1">
					{/* Normal leading: Bangla vowel signs above and below the line need the room. */}
					<h3 className="min-w-0 flex-1 truncate text-[1.0625rem] font-semibold leading-normal text-dark dark:text-white">
						<Link
							href={copy.sessionsHref(deck.id)}
							title={deck.title}
							className="after:absolute after:inset-0 after:rounded-xl after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary-600"
						>
							{deck.title}
						</Link>
					</h3>
					<VisibilityIcon visibility={deck.visibility} />
				</div>
				<p className="flex items-center gap-1.5 text-[0.8125rem] text-dark-5 dark:text-dark-6">
					<Layers className="h-4 w-4" aria-hidden />
					{slides(deck.slideCount)}
				</p>
				{/* One slot, two faces: when it was updated at rest, the actions on hover / keyboard focus, so the
				    card never grows. Touch screens can't hover, so they always get the actions. */}
				<div className="relative h-9">
					<p
						className="flex h-full items-center gap-1.5 text-[0.8125rem] text-dark-5 transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0 dark:text-dark-6 [@media(hover:none)]:invisible"
						title={deck.updatedAt ? new Date(deck.updatedAt).toLocaleString() : undefined}
					>
						<History className="h-4 w-4" aria-hidden />
						Updated {formatUpdated(deck.updatedAt)}
					</p>
					<div className="pointer-events-none absolute inset-0 z-10 flex items-center gap-1 transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 motion-reduce:transition-none [@media(hover:hover)]:opacity-0 [@media(hover:none)]:pointer-events-auto">
						<Link href={copy.editHref(deck.id)} aria-label={`Edit ${deck.title}`} className={`${actionClass} ${editAction}`}>
							<Pencil className="h-[1.125rem] w-[1.125rem]" aria-hidden />
								Edit
						</Link>
						{deck.slideCount > 0 ? (
							<Link href={copy.presentHref(deck.id)} aria-label={`Present ${deck.title}`} className={`${actionClass} ${presentAction}`}>
								<MonitorPlay className="h-[1.125rem] w-[1.125rem]" aria-hidden />
								Present
							</Link>
						) : (
							<button type="button" disabled aria-label="Present (add a slide first)" title="Add a slide first" className={`${actionClass} ${presentAction}`}>
								<MonitorPlay className="h-[1.125rem] w-[1.125rem]" aria-hidden />
								Present
							</button>
						)}
						<ActionsMenu
							label={`More actions for ${deck.title}`}
							className="ml-auto"
							items={[
								{ label: "Rename", icon: PencilLine, onSelect: () => onRename(deck), disabled: busy },
								{ label: "Duplicate", icon: Copy, onSelect: () => onDuplicate(deck), disabled: busy },
								{ label: "Delete", icon: Trash2, onSelect: () => onDelete(deck), danger: true, disabled: busy },
							]}
						/>
					</div>
				</div>
			</div>
		</li>
	);
}

export function DeckLibrarySection({ product }: { product: DeckProduct }) {
	const copy = productCopy(product);
	const api = authoringApiFor(product);
	const [decks, setDecks] = useState<DeckSummary[]>([]);
	const [meta, setMeta] = useState<DeckListMeta | null>(null);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<number | null>(null);
	const [newOpen, setNewOpen] = useState(false);
	const [toDelete, setToDelete] = useState<DeckSummary | null>(null);
	const [toRename, setToRename] = useState<DeckSummary | null>(null);
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

	/** Saves the title and updates the card in place (the list order stays as it was). */
	const rename = async (deck: DeckSummary, title: string) => {
		const updated = await api.updateDeck(deck.id, { title });
		setDecks((list) => list.map((item) => (item.id === deck.id ? { ...item, title: updated.title, updatedAt: updated.updatedAt } : item)));
		toast.success(`Renamed to “${updated.title}”.`);
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
					onClick={() => setNewOpen(true)}
					aria-haspopup="dialog"
					className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-primary-300 px-4 text-sm font-semibold text-dark transition hover:bg-primary-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:opacity-60 dark:bg-primary-900/40 dark:text-white dark:hover:bg-primary-900/60"
				>
					<Plus className="h-4 w-4" aria-hidden />
					New {copy.noun}
				</button>
				<NewDeckDialog product={product} open={newOpen} onClose={() => setNewOpen(false)} />
				<RenameDeckModal deck={toRename} noun={copy.noun} onClose={() => setToRename(null)} onRename={rename} />
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
						<DeckCard key={deck.id} deck={deck} copy={copy} busy={busyId === deck.id} onRename={setToRename} onDuplicate={duplicate} onDelete={setToDelete} />
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
