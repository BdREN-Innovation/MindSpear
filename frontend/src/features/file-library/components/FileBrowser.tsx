"use client";

import { useState, type ReactNode } from "react";
import { Check, FolderOpen, LayoutGrid, List, Loader2, Search, SearchX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pagination } from "@/components/ui";
import { useLibraryFiles } from "../hooks/useLibraryFiles";
import { useFileActions } from "../hooks/useFileActions";
import { formatBytes, formatDate, typeStyle } from "../lib/format";
import type { FileCategory, FileSort, LibraryFile } from "../types";
import { FileActionsMenu } from "./FileActionsMenu";
import { FileThumb } from "./FileThumb";
import { RenameFileModal } from "./RenameFileModal";

type CategoryFilter = FileCategory | "all";

interface Props {
	/** manage: rename/download/delete (My Files page). select: pick one file (picker). */
	mode: "manage" | "select";
	/** Only show this category and hide the filter. */
	lockedCategory?: FileCategory;
	selectedId?: number | null;
	onSelect?: (file: LibraryFile) => void;
	/** Double-click / Enter on a file in select mode. */
	onActivate?: (file: LibraryFile) => void;
	/** Shown in the empty state when there are no files at all. */
	emptyAction?: ReactNode;
	toolbarExtra?: ReactNode;
	perPage?: number;
	/** Scrollable height for the grid inside modals. */
	maxHeightClass?: string;
}

const SORTS: { value: FileSort; label: string }[] = [
	{ value: "newest", label: "Newest first" },
	{ value: "last_used", label: "Recently used" },
	{ value: "oldest", label: "Oldest first" },
	{ value: "name", label: "Name (A–Z)" },
	{ value: "size", label: "Largest first" },
];

function meta(file: LibraryFile): string {
	const parts = [typeStyle(file).label, formatBytes(file.size)];
	if (file.pageCount) {
		const unit = file.extension === "pptx" ? "slide" : file.extension === "docx" || file.extension === "pdf" ? "page" : "section";
		parts.push(`${file.pageCount} ${unit}${file.pageCount === 1 ? "" : "s"}`);
	}
	return parts.join(" · ");
}

export function FileBrowser({
	mode,
	lockedCategory,
	selectedId,
	onSelect,
	onActivate,
	emptyAction,
	toolbarExtra,
	perPage = 24,
	maxHeightClass,
}: Props) {
	const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
	const [view, setView] = useState<"grid" | "list">("grid");
	const category = lockedCategory ?? (categoryFilter === "all" ? undefined : categoryFilter);
	const list = useLibraryFiles({ category, perPage, initialSort: mode === "select" ? "last_used" : "newest" });
	const actions = useFileActions();
	const selectable = mode === "select";

	const handleKey = (event: React.KeyboardEvent, file: LibraryFile) => {
		if (!selectable) return;
		if (event.key === "Enter") {
			onSelect?.(file);
			onActivate?.(file);
		} else if (event.key === " ") {
			event.preventDefault();
			onSelect?.(file);
		}
	};

	const empty = !list.loading && !list.error && list.files.length === 0;

	return (
		<div className="flex flex-col gap-4">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-[12rem] flex-1">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-5" aria-hidden />
					<input
						type="search"
						value={list.search}
						onChange={(e) => list.setSearch(e.target.value)}
						placeholder="Search by name"
						aria-label="Search files"
						className="h-10 w-full rounded-lg border border-stroke bg-white pl-9 pr-9 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-stroke-dark dark:bg-dark-2 dark:text-white"
					/>
					{list.search ? (
						<button
							type="button"
							onClick={() => list.setSearch("")}
							className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-dark-5 hover:text-dark"
							aria-label="Clear search"
						>
							<X className="h-4 w-4" aria-hidden />
						</button>
					) : null}
				</div>

				{!lockedCategory ? (
					<div className="flex h-10 items-center rounded-lg border border-stroke bg-white p-1 dark:border-stroke-dark dark:bg-dark-2" role="radiogroup" aria-label="File type">
						{(
							[
								["all", "All"],
								["document", "Documents"],
								["image", "Images"],
							] as const
						).map(([value, label]) => (
							<button
								key={value}
								type="button"
								role="radio"
								aria-checked={categoryFilter === value}
								onClick={() => setCategoryFilter(value)}
								className={cn(
									"h-full rounded-md px-3 text-sm font-medium transition",
									categoryFilter === value ? "bg-primary text-white shadow-sm" : "text-dark-4 hover:text-dark dark:text-dark-6 dark:hover:text-white",
								)}
							>
								{label}
							</button>
						))}
					</div>
				) : null}

				<select
					value={list.sort}
					onChange={(e) => list.setSort(e.target.value as FileSort)}
					aria-label="Sort files"
					className="h-10 rounded-lg border border-stroke bg-white px-3 text-sm outline-none focus:border-primary dark:border-stroke-dark dark:bg-dark-2 dark:text-white"
				>
					{SORTS.map((s) => (
						<option key={s.value} value={s.value}>
							{s.label}
						</option>
					))}
				</select>

				{mode === "manage" ? (
					<div className="flex h-10 items-center rounded-lg border border-stroke bg-white p-1 dark:border-stroke-dark dark:bg-dark-2">
						{(
							[
								["grid", LayoutGrid, "Grid view"],
								["list", List, "List view"],
							] as const
						).map(([value, Icon, label]) => (
							<button
								key={value}
								type="button"
								onClick={() => setView(value)}
								aria-pressed={view === value}
								aria-label={label}
								className={cn(
									"flex h-full w-8 items-center justify-center rounded-md transition",
									view === value ? "bg-gray-2 text-dark dark:bg-dark-3 dark:text-white" : "text-dark-5 hover:text-dark",
								)}
							>
								<Icon className="h-4 w-4" aria-hidden />
							</button>
						))}
					</div>
				) : null}

				{toolbarExtra}
			</div>

			{/* Content */}
			<div className={cn(maxHeightClass && "overflow-y-auto pr-1", maxHeightClass)}>
				{list.error ? (
					<div role="alert" className="rounded-xl border border-red-light-3 bg-red-light-5 p-4 text-sm text-red-dark">
						{list.error}{" "}
						<button type="button" onClick={list.reload} className="font-semibold underline">
							Try again
						</button>
					</div>
				) : list.loading && list.files.length === 0 ? (
					<div className={cn("grid gap-3", view === "grid" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "grid-cols-1")} aria-busy="true">
						{Array.from({ length: view === "grid" ? 8 : 5 }).map((_, i) => (
							<div key={i} className={cn("animate-pulse rounded-xl bg-gray-2 dark:bg-dark-2", view === "grid" ? "h-44" : "h-14")} />
						))}
					</div>
				) : empty ? (
					<div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stroke px-6 py-12 text-center dark:border-stroke-dark">
						{list.isSearching ? (
							<>
								<SearchX className="mb-3 h-10 w-10 text-dark-5" aria-hidden />
								<p className="font-semibold text-dark dark:text-white">No files match “{list.search.trim()}”</p>
								<p className="mt-1 text-sm text-dark-5">Try another name or clear the search.</p>
							</>
						) : (
							<>
								<FolderOpen className="mb-3 h-10 w-10 text-primary" aria-hidden />
								<p className="font-semibold text-dark dark:text-white">
									{category === "image" ? "No images yet" : category === "document" ? "No documents yet" : "No files yet"}
								</p>
								<p className="mt-1 max-w-sm text-sm text-dark-5">Files you upload are kept here so you can reuse them in quizzes, quests and games.</p>
								{emptyAction ? <div className="mt-4">{emptyAction}</div> : null}
							</>
						)}
					</div>
				) : view === "grid" ? (
					<ul
						className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", list.loading && "opacity-60 transition-opacity")}
						role={selectable ? "listbox" : undefined}
						aria-label={selectable ? "Your files" : undefined}
					>
						{list.files.map((file) => {
							const selected = selectable && selectedId === file.id;
							return (
								<li
									key={file.id}
									role={selectable ? "option" : undefined}
									aria-selected={selectable ? selected : undefined}
									tabIndex={selectable ? 0 : undefined}
									onClick={selectable ? () => onSelect?.(file) : undefined}
									onDoubleClick={selectable ? () => onActivate?.(file) : undefined}
									onKeyDown={(e) => handleKey(e, file)}
									className={cn(
										"group relative overflow-hidden rounded-xl border bg-white transition dark:bg-gray-dark",
										selectable && "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
										selected
											? "border-primary ring-2 ring-primary/30"
											: "border-stroke hover:border-primary/50 hover:shadow-md dark:border-stroke-dark",
									)}
								>
									<FileThumb file={file} className="aspect-[4/3] w-full" />
									{selected ? (
										<span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white shadow">
											<Check className="h-4 w-4" aria-hidden />
										</span>
									) : null}
									<div className="flex items-start gap-1 p-3">
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold text-dark dark:text-white" title={file.name}>
												{file.name}
											</p>
											<p className="mt-0.5 truncate text-xs text-dark-5">{meta(file)}</p>
										</div>
										{mode === "manage" ? (
											<FileActionsMenu
												fileName={file.name}
												onRename={() => actions.startRename(file)}
												onDownload={() => actions.download(file)}
												onDelete={() => actions.remove(file)}
												className="-mr-1 -mt-1"
											/>
										) : null}
									</div>
								</li>
							);
						})}
					</ul>
				) : (
					<div className="overflow-x-auto rounded-xl border border-stroke dark:border-stroke-dark">
						<table className={cn("w-full min-w-[36rem] text-left text-sm", list.loading && "opacity-60")}>
							<thead className="bg-gray-1 text-xs font-semibold uppercase text-dark-5 dark:bg-dark-2">
								<tr>
									<th scope="col" className="px-4 py-2.5">Name</th>
									<th scope="col" className="px-4 py-2.5">Type</th>
									<th scope="col" className="px-4 py-2.5">Size</th>
									<th scope="col" className="px-4 py-2.5">Uploaded</th>
									<th scope="col" className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th>
								</tr>
							</thead>
							<tbody className="divide-y divide-stroke bg-white dark:divide-stroke-dark dark:bg-gray-dark">
								{list.files.map((file) => (
									<tr key={file.id} className="hover:bg-gray-1 dark:hover:bg-dark-2">
										<td className="px-4 py-2.5">
											<div className="flex items-center gap-3">
												<FileThumb file={file} size="sm" className="h-10 w-10 shrink-0 rounded-lg" />
												<span className="truncate font-medium text-dark dark:text-white" title={file.name}>{file.name}</span>
											</div>
										</td>
										<td className="px-4 py-2.5 text-dark-5">{typeStyle(file).label}</td>
										<td className="px-4 py-2.5 text-dark-5">{formatBytes(file.size)}</td>
										<td className="px-4 py-2.5 text-dark-5">{formatDate(file.createdAt)}</td>
										<td className="px-2 py-2.5">
											<FileActionsMenu
												fileName={file.name}
												onRename={() => actions.startRename(file)}
												onDownload={() => actions.download(file)}
												onDelete={() => actions.remove(file)}
											/>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{list.pagination && list.pagination.lastPage > 1 ? (
				<div className="flex items-center justify-between gap-2">
					<span className="text-xs text-dark-5">
						{list.loading ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" aria-hidden /> : null} {list.pagination.total} files
					</span>
					<Pagination current={list.page} pageSize={list.pagination.perPage} total={list.pagination.total} onChange={list.setPage} size="small" />
				</div>
			) : null}

			<RenameFileModal file={actions.renaming} onClose={actions.stopRename} onRenamed={list.replaceFile} />
		</div>
	);
}
