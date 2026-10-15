"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { AlertCircle, CheckCircle2, FileUp, Loader2, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { libraryApi, parseLibraryError } from "../api/libraryApi";
import { emitLibraryChange } from "../lib/events";
import { acceptedExtensions, formatBytes, precheckFile } from "../lib/format";
import type { FileAccept, LibraryError, StorageUsage, UploadResult } from "../types";

interface UploadItem {
	key: number;
	name: string;
	size: number;
	progress: number;
	status: "queued" | "uploading" | "done" | "error";
	message?: string;
	errorCode?: LibraryError["code"];
	controller?: AbortController;
}

interface Props {
	accept: FileAccept;
	usage: StorageUsage | null;
	onUploaded?: (result: UploadResult) => void;
	multiple?: boolean;
	/** Shorter drop area for modals. */
	compact?: boolean;
	className?: string;
}

const ACCEPT_HINT: Record<FileAccept, string> = {
	image: "Images",
	document: "Documents",
	video: "Videos (browser-playable MP4)",
	any: "Documents, images and videos",
};

let nextKey = 1;

/** Share of the user's storage one largest-allowed video takes, or null when it's negligible. */
function videoQuotaShare(usage: StorageUsage): number | null {
	const { video } = usage.maxFileSize;
	if (!video || usage.limit <= 0) return null;
	const percent = Math.round((video / usage.limit) * 100);
	return percent >= 1 ? percent : null;
}

function maxSizeHint(accept: FileAccept, usage: StorageUsage): string {
	const { image, document, video } = usage.maxFileSize;
	// One large video can use a big share of the quota; say so before people pick one.
	const share = videoQuotaShare(usage);
	if (accept === "any") {
		const videoHint = video ? `, ${formatBytes(video)} per video${share ? ` (one uses ${share}% of your storage)` : ""}` : "";
		return `Up to ${formatBytes(document)} per document, ${formatBytes(image)} per image${videoHint}`;
	}
	const hint = `Up to ${formatBytes(usage.maxFileSize[accept])} per file`;
	if (accept === "video" && share) {
		return `${hint} · one ${formatBytes(video)} video uses ${share}% of your storage`;
	}
	return hint;
}

/** Drag-and-drop upload into My Files, with per-file progress and friendly errors. */
export function FileDropzone({ accept, usage, onUploaded, multiple = false, compact = false, className }: Props) {
	const [items, setItems] = useState<UploadItem[]>([]);
	const usageRef = useRef(usage);
	const mounted = useRef(true);

	useEffect(() => {
		usageRef.current = usage;
	}, [usage]);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const update = (key: number, patch: Partial<UploadItem>) => {
		if (mounted.current) setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
	};

	const uploadOne = useCallback(
		async (file: File, key: number) => {
			const problem = precheckFile(file, accept, usageRef.current);
			if (problem) {
				update(key, { status: "error", message: problem, errorCode: problem.startsWith("Not enough storage") ? "quota_exceeded" : "invalid_file" });
				return;
			}
			const controller = new AbortController();
			update(key, { status: "uploading", controller });
			try {
				const result = await libraryApi.upload(file, {
					signal: controller.signal,
					onProgress: (progress) => update(key, { progress }),
				});
				usageRef.current = result.usage;
				update(key, { status: "done", progress: 100, message: result.deduplicated ? "Already in My Files — reused" : undefined, controller: undefined });
				emitLibraryChange(result.usage);
				onUploaded?.(result);
			} catch (reason) {
				const error = parseLibraryError(reason);
				update(key, { status: "error", message: error.message, errorCode: error.code, controller: undefined });
			}
		},
		[accept, onUploaded],
	);

	const onDrop = useCallback(
		async (files: File[]) => {
			const chosen = multiple ? files : files.slice(0, 1);
			if (!chosen.length) return;
			const queued = chosen.map((file) => ({ file, item: { key: nextKey++, name: file.name, size: file.size, progress: 0, status: "queued" as const } }));
			setItems((prev) => [...queued.map((q) => q.item), ...(multiple ? prev.filter((p) => p.status !== "done") : [])]);
			// One at a time, so each upload sees the storage left by the one before.
			for (const { file, item } of queued) {
				await uploadOne(file, item.key);
			}
		},
		[multiple, uploadOne],
	);

	const extensions = acceptedExtensions(accept, usage);
	const { getRootProps, getInputProps, isDragActive, open } = useDropzone({ onDrop, multiple, noClick: true, noKeyboard: true });
	const full = usage ? usage.remaining <= 0 : false;
	const maxSizes = usage ? maxSizeHint(accept, usage) : null;

	return (
		<div className={className}>
			<div
				{...getRootProps()}
				className={cn(
					"relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition",
					compact ? "px-4 py-8" : "px-6 py-12",
					isDragActive ? "border-primary bg-primary-50 dark:bg-dark-2" : "border-gray-4 bg-gray-1 hover:border-primary/60 dark:border-dark-3 dark:bg-dark-2/40",
				)}
			>
				<input {...getInputProps({ accept: extensions.map((e) => `.${e}`).join(",") })} />
				<div className={cn("mb-3 flex items-center justify-center rounded-full bg-white shadow-sm dark:bg-dark-2", compact ? "h-12 w-12" : "h-14 w-14")}>
					<FileUp className={cn("text-primary", compact ? "h-6 w-6" : "h-7 w-7")} aria-hidden />
				</div>
				<p className="text-base font-semibold text-dark dark:text-white">
					{isDragActive ? "Drop to upload" : multiple ? "Drag files here" : "Drag a file here"}
				</p>
				<p className="mt-1 text-sm text-dark-5">
					or{" "}
					<button type="button" onClick={open} className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:underline">
						browse your computer
					</button>
				</p>
				<p className="mt-3 text-xs text-dark-5">
					{ACCEPT_HINT[accept]}: {extensions.map((e) => e.toUpperCase()).join(", ")}
					{maxSizes ? <> · {maxSizes}</> : null}
				</p>
				<p className="mt-1 text-xs text-dark-5">Everything you upload is saved in My Files so you can reuse it later.</p>
				{full ? (
					<p role="alert" className="mt-3 rounded-lg bg-red-light-5 px-3 py-1.5 text-xs font-semibold text-red-dark">
						Your storage is full.{" "}
						<Link href="/my-files" target="_blank" className="underline">
							Free up space in My Files
						</Link>
					</p>
				) : null}
			</div>

			{items.length > 0 ? (
				<ul className="mt-3 space-y-2" aria-live="polite">
					{items.map((item) => (
						<li key={item.key} className="rounded-xl border border-stroke bg-white px-3 py-2.5 dark:border-stroke-dark dark:bg-gray-dark">
							<div className="flex items-center gap-3">
								<span className="shrink-0">
									{item.status === "done" ? (
										<CheckCircle2 className="h-5 w-5 text-green" aria-label="Uploaded" />
									) : item.status === "error" ? (
										<AlertCircle className="h-5 w-5 text-red" aria-label="Failed" />
									) : (
										<Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Uploading" />
									)}
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-center justify-between gap-2">
										<p className="truncate text-sm font-medium text-dark dark:text-white" title={item.name}>
											{item.name}
										</p>
										<span className="shrink-0 text-xs text-dark-5">
											{item.status === "uploading" ? `${item.progress}%` : formatBytes(item.size)}
										</span>
									</div>
									{item.status === "uploading" || item.status === "queued" ? (
										<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-3 dark:bg-dark-3">
											<div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${item.progress}%` }} />
										</div>
									) : null}
									{item.message ? (
										<p className={cn("mt-1 text-xs", item.status === "error" ? "text-red-dark" : "text-dark-5")}>
											{item.message}
											{item.errorCode === "quota_exceeded" ? (
												<>
													{" "}
													<Link href="/my-files" target="_blank" className="font-semibold underline">
														Open My Files
													</Link>
												</>
											) : null}
										</p>
									) : null}
								</div>
								{item.status === "uploading" ? (
									<button
										type="button"
										onClick={() => item.controller?.abort()}
										className="shrink-0 rounded-md p-1 text-dark-5 hover:bg-gray-2 hover:text-dark dark:hover:bg-dark-2"
										aria-label={`Cancel uploading ${item.name}`}
									>
										<X className="h-4 w-4" aria-hidden />
									</button>
								) : item.status !== "queued" ? (
									<button
										type="button"
										onClick={() => setItems((prev) => prev.filter((p) => p.key !== item.key))}
										className="shrink-0 rounded-md p-1 text-dark-5 hover:bg-gray-2 hover:text-dark dark:hover:bg-dark-2"
										aria-label={`Dismiss ${item.name}`}
									>
										<X className="h-4 w-4" aria-hidden />
									</button>
								) : null}
							</div>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
