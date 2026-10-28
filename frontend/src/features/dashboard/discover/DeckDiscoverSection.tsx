"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Copy, Eye, Layers, Loader2, Search, User } from "lucide-react";
import GlobalPagination from "@/components/GlobalPagination";
import { createAuthoringApi } from "@/features/deck/api/authoringApi";
import { toDeckApiError, type DeckApiError } from "@/features/deck/api/errors";
import { getDeckTheme } from "@/features/deck/theme";
import type { DeckProduct, ListPublicDecksParams, PublicDeck, PublicDeckSummary } from "@/features/deck/types";
import { ThemeSwatch } from "@/features/deck-editor/components/inspector/DesignTab";
import { PreviewOverlay } from "@/features/deck-editor/components/PreviewOverlay";
import { productCopy } from "@/features/deck-editor/components/productCopy";
import { formatBytes } from "@/features/file-library/lib/format";

// Discover > Quiz / Quest: everyone's public v2 decks (backend GET
// /{authoring prefix}/public). Preview walks through the slides; "Use this
// template" copies the deck into the viewer's library (its images become
// their own My Files items) and opens it in the editor.

type Sort = NonNullable<ListPublicDecksParams["sort"]>;

const PER_PAGE = 12;

const SORTS: { value: Sort; label: string }[] = [
	{ value: "updated", label: "Recently updated" },
	{ value: "popular", label: "Most copied" },
	{ value: "title", label: "Title A–Z" },
];

const button =
	"inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-60";

function copyErrorMessage(error: DeckApiError, noun: string): string {
	if ((error.code as string) === "quota_exceeded") {
		const { required, used, limit } = error.data as { required?: number; used?: number; limit?: number };
		if (typeof required === "number" && typeof used === "number" && typeof limit === "number") {
			return `This ${noun}'s images need ${formatBytes(required)}, but only ${formatBytes(Math.max(0, limit - used))} of your ${formatBytes(limit)} is free. Delete some files in My Files to make room.`;
		}
	}
	return error.message || `The ${noun} could not be copied.`;
}

function DeckCard({
	deck,
	product,
	copying,
	opening,
	onPreview,
	onUse,
}: {
	deck: PublicDeckSummary;
	product: DeckProduct;
	copying: boolean;
	opening: boolean;
	onPreview(deck: PublicDeckSummary): void;
	onUse(deck: PublicDeckSummary): void;
}) {
	const copy = productCopy(product);
	return (
		<li className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:border-primary/40 dark:border-stroke-dark dark:bg-gray-dark">
			<button
				type="button"
				onClick={() => onPreview(deck)}
				className="relative block p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
				aria-label={`Preview ${deck.title}`}
			>
				{deck.cover?.url ? (
					// Covers come from My Files (any host), so a plain img keeps next/image config out of it.
					// eslint-disable-next-line @next/next/no-img-element
					<img src={deck.cover.url} alt="" className="aspect-video w-full rounded-md object-cover" />
				) : (
					<ThemeSwatch theme={getDeckTheme(deck.settings?.theme)} />
				)}
				{deck.isMine ? (
					<span className="absolute right-5 top-5 rounded-full bg-white/95 px-2 py-0.5 text-xs font-semibold text-dark shadow-sm ring-1 ring-black/10">Yours</span>
				) : null}
			</button>
			<div className="flex flex-1 flex-col gap-1.5 px-4 pb-3">
				<h3 className="line-clamp-2 text-base font-semibold text-dark dark:text-white" title={deck.title}>
					{deck.title}
				</h3>
				{deck.description ? <p className="line-clamp-2 text-sm text-dark-5 dark:text-dark-6">{deck.description}</p> : null}
				{deck.creator ? (
					<p className="flex items-center gap-1.5 text-sm text-dark-5 dark:text-dark-6">
						<User className="h-4 w-4 shrink-0" aria-hidden />
						<span className="truncate">{deck.creator.name}</span>
					</p>
				) : null}
				<p className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-sm text-dark-5 dark:text-dark-6">
					<span className="inline-flex items-center gap-1.5">
						<Layers className="h-4 w-4" aria-hidden />
						{deck.slideCount} {deck.slideCount === 1 ? "slide" : "slides"}
					</span>
					<span className="inline-flex items-center gap-1.5" title={`Copied to someone's library ${deck.copyCount} ${deck.copyCount === 1 ? "time" : "times"}`}>
						<Copy className="h-4 w-4" aria-hidden />
						{deck.copyCount === 0 ? "Not copied yet" : `Copied ${deck.copyCount}×`}
					</span>
				</p>
			</div>
			<div className="grid grid-cols-2 gap-1 border-t border-gray-200 p-2 dark:border-stroke-dark">
				<button
					type="button"
					onClick={() => onPreview(deck)}
					disabled={opening}
					className={`${button} bg-gray-2 text-dark hover:bg-gray-3 dark:bg-dark-2 dark:text-white dark:hover:bg-dark-3`}
				>
					{opening ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
					Preview
				</button>
				<button
					type="button"
					onClick={() => onUse(deck)}
					disabled={copying}
					className={`${button} bg-primary font-semibold text-dark hover:bg-primary-dark`}
					aria-label={`Use ${deck.title}: copy it to your ${copy.plural}`}
				>
					{copying ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
					{copying ? "Copying…" : "Use this"}
				</button>
			</div>
		</li>
	);
}

export default function DeckDiscoverSection({ product }: { product: DeckProduct }) {
	const copy = productCopy(product);
	const router = useRouter();
	const api = useRef(createAuthoringApi(product)).current;

	const [search, setSearch] = useState("");
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<Sort>("updated");
	const [page, setPage] = useState(1);
	const [items, setItems] = useState<PublicDeckSummary[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [copyingId, setCopyingId] = useState<number | null>(null);
	const [openingId, setOpeningId] = useState<number | null>(null);
	const [preview, setPreview] = useState<PublicDeck | null>(null);

	// Search after typing stops.
	useEffect(() => {
		const timer = setTimeout(() => {
			setQuery(search.trim());
			setPage(1);
		}, 350);
		return () => clearTimeout(timer);
	}, [search]);

	const load = useCallback(
		async (signal?: AbortSignal) => {
			setLoading(true);
			setLoadError(null);
			try {
				const result = await api.listPublicDecks({ search: query, sort, page, perPage: PER_PAGE }, signal);
				setItems(result.items);
				setTotal(result.meta.total);
			} catch (reason) {
				if (signal?.aborted) return;
				setLoadError(toDeckApiError(reason).message || `Public ${copy.plural} could not be loaded.`);
			} finally {
				if (!signal?.aborted) setLoading(false);
			}
		},
		[api, copy.plural, page, query, sort]
	);

	useEffect(() => {
		const controller = new AbortController();
		void load(controller.signal);
		return () => controller.abort();
	}, [load]);

	const use = async (deck: PublicDeckSummary) => {
		if (copyingId !== null) return;
		setCopyingId(deck.id);
		try {
			const created = await api.copyPublicDeck(deck.id);
			toast.success(`“${created.title}” is now in your ${copy.plural}.`);
			router.push(copy.editHref(created.id));
		} catch (reason) {
			toast.error(copyErrorMessage(toDeckApiError(reason), copy.noun));
			setCopyingId(null);
		}
	};

	const openPreview = async (deck: PublicDeckSummary) => {
		if (openingId !== null) return;
		setOpeningId(deck.id);
		try {
			setPreview(await api.getPublicDeck(deck.id));
		} catch (reason) {
			toast.error(toDeckApiError(reason).message || "The preview could not be opened.");
		} finally {
			setOpeningId(null);
		}
	};

	return (
		<section aria-labelledby={`discover-${product}-heading`} className="mb-10">
			<div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<p id={`discover-${product}-heading`} className="text-sm text-dark-5 dark:text-dark-6">
					{copy.Noun} templates shared by other people. Use one to copy it into your library, then change anything you like.
				</p>
				<div className="flex gap-2">
					<label className="relative block min-w-0 flex-1 sm:w-64">
						<span className="sr-only">Search {copy.plural}</span>
						<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-5" aria-hidden />
						<input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder={`Search ${copy.plural}`}
							maxLength={100}
							className="min-h-11 w-full rounded-lg border border-stroke bg-white pl-9 pr-3 text-sm text-dark outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-stroke-dark dark:bg-gray-dark dark:text-white"
						/>
					</label>
					<label className="shrink-0">
						<span className="sr-only">Sort</span>
						<select
							value={sort}
							onChange={(event) => {
								setSort(event.target.value as Sort);
								setPage(1);
							}}
							className="min-h-11 rounded-lg border border-stroke bg-white px-3 text-sm text-dark outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-stroke-dark dark:bg-gray-dark dark:text-white"
						>
							{SORTS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
				</div>
			</div>

			{loading && items.length === 0 ? (
				<ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true">
					{Array.from({ length: 4 }).map((_, index) => (
						<li key={index} className="h-72 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-stroke-dark dark:bg-gray-dark" />
					))}
				</ul>
			) : loadError ? (
				<div className="rounded-2xl border border-red-light-3 bg-red-light-5 p-6 text-sm text-[#B42318]" role="alert">
					<p>{loadError}</p>
					<button type="button" onClick={() => void load()} className="mt-3 min-h-11 rounded-lg border border-current px-4 font-medium">
						Try again
					</button>
				</div>
			) : items.length === 0 ? (
				<div className="rounded-2xl border border-gray-100 bg-white px-6 py-14 text-center dark:border-stroke-dark dark:bg-gray-dark">
					<h3 className="text-lg font-semibold text-dark dark:text-white">
						{query ? `No public ${copy.plural} match “${query}”` : `No public ${copy.plural} yet`}
					</h3>
					<p className="mx-auto mt-2 max-w-md text-sm text-dark-5 dark:text-dark-6">
						To share one of yours, open it in the editor, choose Settings, and set “Who can find this {copy.noun}” to Public in Discover.
					</p>
				</div>
			) : (
				<>
					<ul className={`grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
						{items.map((deck) => (
							<DeckCard
								key={deck.id}
								deck={deck}
								product={product}
								copying={copyingId === deck.id}
								opening={openingId === deck.id}
								onPreview={(item) => void openPreview(item)}
								onUse={(item) => void use(item)}
							/>
						))}
					</ul>
					{total > PER_PAGE ? (
						<div className="mt-6">
							<GlobalPagination
								current={page}
								total={total}
								pageSize={PER_PAGE}
								onChange={(next: number) => {
									setPage(next);
									window.scrollTo({ top: 0, behavior: "smooth" });
								}}
							/>
						</div>
					) : null}
				</>
			)}

			{preview ? (
				<PreviewOverlay
					product={product}
					slides={preview.slides}
					startIndex={0}
					theme={getDeckTheme(preview.settings?.theme)}
					title={preview.title}
					actions={
						<button
							type="button"
							onClick={() => void use(preview)}
							disabled={copyingId !== null}
							className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-dark hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
						>
							{copyingId === preview.id ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
							{copyingId === preview.id ? "Copying…" : "Use this template"}
						</button>
					}
					onClose={() => setPreview(null)}
				/>
			) : null}
		</section>
	);
}
