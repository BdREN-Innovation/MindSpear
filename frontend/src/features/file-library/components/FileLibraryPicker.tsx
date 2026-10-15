"use client";

import { useEffect, useRef, useState } from "react";
import { FolderOpen, UploadCloud } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import { libraryApi } from "../api/libraryApi";
import { useStorageUsage } from "../hooks/useStorageUsage";
import { formatBytes, typeStyle } from "../lib/format";
import type { FileAccept, LibraryFile } from "../types";
import { FileBrowser } from "./FileBrowser";
import { FileDropzone } from "./FileDropzone";
import { FileThumb } from "./FileThumb";
import { StorageUsageBar } from "./StorageUsageBar";

type Tab = "upload" | "library";

export interface FilePickerPanelProps {
	accept: FileAccept;
	onSelect: (file: LibraryFile) => void | Promise<void>;
	onCancel?: () => void;
	confirmLabel?: string;
	/** Short line under the tabs, e.g. what the file will be used for. */
	hint?: string;
	/** Disable the confirm button while the caller works on the chosen file. */
	busy?: boolean;
}

/** "Upload new" or "Choose from My Files", with storage usage on top. Usable inline or in FileLibraryPicker. */
export function FilePickerPanel({ accept, onSelect, onCancel, confirmLabel = "Use this file", hint, busy = false }: FilePickerPanelProps) {
	const { usage, loading } = useStorageUsage();
	const [tab, setTab] = useState<Tab>("library");
	const [selected, setSelected] = useState<LibraryFile | null>(null);
	const [confirming, setConfirming] = useState(false);
	const tabChosen = useRef(false);
	const lockedCategory = accept === "any" ? undefined : accept;

	// Nothing to choose from yet? Start on the upload tab.
	useEffect(() => {
		if (!usage || tabChosen.current) return;
		tabChosen.current = true;
		const count = accept === "any" ? usage.images.count + usage.documents.count : usage[accept === "image" ? "images" : "documents"].count;
		if (count === 0) setTab("upload");
	}, [usage, accept]);

	const confirm = async (file: LibraryFile | null = selected) => {
		if (!file) return;
		setConfirming(true);
		try {
			libraryApi.markUsed(file.id).catch(() => undefined);
			await onSelect(file);
		} finally {
			setConfirming(false);
		}
	};

	const tabButton = (value: Tab, label: string, Icon: typeof UploadCloud) => (
		<button
			type="button"
			role="tab"
			aria-selected={tab === value}
			onClick={() => {
				tabChosen.current = true;
				setTab(value);
			}}
			className={cn(
				"flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition",
				tab === value ? "bg-white text-dark shadow-sm dark:bg-dark-3 dark:text-white" : "text-dark-5 hover:text-dark dark:hover:text-white",
			)}
		>
			<Icon className="h-4 w-4" aria-hidden />
			{label}
		</button>
	);

	return (
		<div className="flex flex-col gap-4">
			<StorageUsageBar usage={usage} loading={loading} showManageLink />

			<div className="flex gap-1 rounded-xl bg-gray-2 p-1 dark:bg-dark-2" role="tablist">
				{tabButton("library", "My Files", FolderOpen)}
				{tabButton("upload", "Upload new", UploadCloud)}
			</div>
			{hint ? <p className="-mt-1 text-sm text-dark-5">{hint}</p> : null}

			<div role="tabpanel">
				{tab === "upload" ? (
					<FileDropzone accept={accept} usage={usage} compact onUploaded={(result) => setSelected(result.file)} />
				) : (
					<FileBrowser
						mode="select"
						lockedCategory={lockedCategory}
						selectedId={selected?.id ?? null}
						onSelect={setSelected}
						onActivate={(file) => confirm(file)}
						perPage={12}
						maxHeightClass="max-h-[45vh]"
						emptyAction={
							<Button size="sm" onClick={() => setTab("upload")}>
								<UploadCloud className="h-4 w-4" aria-hidden />
								Upload a file
							</Button>
						}
					/>
				)}
			</div>

			<div className="flex flex-col-reverse gap-3 border-t border-stroke pt-4 dark:border-stroke-dark sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 flex-1" aria-live="polite">
					{selected ? (
						<div className="flex items-center gap-3">
							<FileThumb file={selected} size="sm" className="h-10 w-10 shrink-0 rounded-lg" />
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold text-dark dark:text-white">{selected.name}</p>
								<p className="text-xs text-dark-5">
									{typeStyle(selected).label} · {formatBytes(selected.size)}
								</p>
							</div>
						</div>
					) : (
						<p className="text-sm text-dark-5">{tab === "upload" ? "Upload a file, then use it." : "Select a file to continue."}</p>
					)}
				</div>
				<div className="flex justify-end gap-2">
					{onCancel ? (
						<Button variant="outline" onClick={onCancel}>
							Cancel
						</Button>
					) : null}
					<Button onClick={() => confirm()} disabled={!selected} loading={confirming || busy}>
						{confirmLabel}
					</Button>
				</div>
			</div>
		</div>
	);
}

interface PickerProps extends Omit<FilePickerPanelProps, "onCancel"> {
	open: boolean;
	onClose: () => void;
	title?: string;
}

/** Modal file picker: reuse something from My Files or upload a new file. */
export function FileLibraryPicker({ open, onClose, title, ...panel }: PickerProps) {
	const defaultTitle = panel.accept === "image" ? "Choose an image" : panel.accept === "document" ? "Choose a document" : "Choose a file";
	return (
		<Modal title={title ?? defaultTitle} open={open} onClose={onClose} size="md" destroyOnClose>
			{open ? <FilePickerPanel {...panel} onCancel={onClose} /> : null}
		</Modal>
	);
}
