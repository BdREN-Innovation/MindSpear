"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { libraryApi, parseLibraryError } from "../api/libraryApi";
import { emitLibraryChange, onLibraryChange } from "../lib/events";
import type { FileCategory, FileSort, LibraryFile, Pagination, StorageUsage } from "../types";

interface Options {
	category?: FileCategory;
	perPage?: number;
	initialSort?: FileSort;
}

/** A searchable, paginated page of the user's files that stays in sync with uploads and deletes. */
export function useLibraryFiles({ category, perPage = 24, initialSort = "newest" }: Options = {}) {
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<FileSort>(initialSort);
	const [page, setPage] = useState(1);
	const [files, setFiles] = useState<LibraryFile[]>([]);
	const [pagination, setPagination] = useState<Pagination | null>(null);
	const [usage, setUsage] = useState<StorageUsage | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const debouncedSearch = useDebounce(search, 300) as string;
	const firstLoad = useRef(true);

	// New filters start from the first page.
	useEffect(() => {
		if (firstLoad.current) {
			firstLoad.current = false;
			return;
		}
		setPage(1);
	}, [debouncedSearch, category, sort]);

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		libraryApi
			.list({ search: debouncedSearch.trim(), category, sort, page, perPage }, controller.signal)
			.then((result) => {
				setFiles(result.files);
				setPagination(result.pagination);
				setUsage(result.usage);
				setError(null);
				// Deleting the last file on a page: step back a page.
				if (result.files.length === 0 && page > 1 && result.pagination.lastPage < page) {
					setPage(result.pagination.lastPage);
				}
			})
			.catch((reason) => {
				if (!controller.signal.aborted) setError(parseLibraryError(reason).message);
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [debouncedSearch, category, sort, page, perPage, reloadKey]);

	useEffect(() => onLibraryChange(() => setReloadKey((k) => k + 1)), []);

	const reload = useCallback(() => setReloadKey((k) => k + 1), []);

	/** Optimistic local update after a rename, then tell everyone else. */
	const replaceFile = useCallback((file: LibraryFile) => {
		setFiles((prev) => prev.map((f) => (f.id === file.id ? file : f)));
		emitLibraryChange();
	}, []);

	return {
		files,
		pagination,
		usage,
		loading,
		error,
		search,
		setSearch,
		sort,
		setSort,
		page,
		setPage,
		reload,
		replaceFile,
		isSearching: debouncedSearch.trim() !== "",
	};
}
