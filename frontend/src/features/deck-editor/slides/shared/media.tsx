/* eslint-disable @next/next/no-img-element -- My Files URLs are arbitrary hosts; next/image needs a fixed list. */
"use client";

import { useCallback, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useDropzone } from "react-dropzone";
import { toast } from "react-toastify";
import { AlertCircle, FolderOpen, ImagePlus, Link2, RefreshCw, Video as VideoIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { libraryApi, parseLibraryError } from "@/features/file-library/api/libraryApi";
import { FileLibraryPicker } from "@/features/file-library/components/FileLibraryPicker";
import { emitLibraryChange } from "@/features/file-library/lib/events";
import { precheckFile } from "@/features/file-library/lib/format";
import type { LibraryError, LibraryFile } from "@/features/file-library/types";
import type { MediaFile } from "@/features/deck/types";

// Media slots for slide Editors (plan §5.5). Every image/video goes through
// My Files: clicking opens FileLibraryPicker (My Files / Upload new), dropping
// a file uploads it to My Files with progress, then the caller attaches the
// returned file id (PUT .../media or .../options/{id}/image). The × only
// detaches; the file stays in My Files. The picker is rendered OUTSIDE the
// drop zone: React events bubble through portals, so a drop inside the
// picker would otherwise upload twice (same as lib/StylableInputFile.tsx).

export type MediaAccept = "image" | "video";

const ACCEPT_ATTR: Record<MediaAccept, string> = {
	image: "image/png,image/jpeg,image/gif,image/webp",
	video: "video/mp4",
};

/* ------------------------------------------------------------------ */
/* Upload hook + error notice                                          */
/* ------------------------------------------------------------------ */

export interface LibraryUpload {
	/** Uploads to My Files; resolves the stored file, or null when it failed (see `error`). */
	upload: (file: File) => Promise<LibraryFile | null>;
	uploading: boolean;
	/** 0..100 */
	progress: number;
	error: LibraryError | null;
	clearError: () => void;
}

export function useLibraryUpload(accept: MediaAccept): LibraryUpload {
	const [uploading, setUploading] = useState(false);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<LibraryError | null>(null);

	const upload = useCallback(
		async (file: File) => {
			const problem = precheckFile(file, accept, null);
			if (problem) {
				setError({ code: "invalid_file", message: problem });
				return null;
			}
			setError(null);
			setUploading(true);
			setProgress(0);
			try {
				const result = await libraryApi.upload(file, { onProgress: setProgress });
				emitLibraryChange(result.usage);
				if (result.deduplicated) toast.info(`This ${accept} was already in My Files, so it was reused.`);
				return result.file;
			} catch (reason) {
				setError(parseLibraryError(reason));
				return null;
			} finally {
				setUploading(false);
			}
		},
		[accept]
	);

	return { upload, uploading, progress, error, clearError: () => setError(null) };
}

/** Inline library error with a "Manage My Files" link for quota / file problems. */
export function LibraryErrorNotice({
	error,
	onDismiss,
	className,
}: {
	error: LibraryError | string | null | undefined;
	onDismiss?: () => void;
	className?: string;
}) {
	if (!error) return null;
	const message = typeof error === "string" ? error : error.message;
	const showManage = typeof error !== "string" && (error.code === "quota_exceeded" || error.code === "invalid_file");
	return (
		<div role="alert" className={cn("flex items-start gap-2 rounded-lg bg-red-light-6 px-3 py-2 text-xs text-[#B42318] dark:bg-red/10 dark:text-red-light", className)}>
			<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
			<p className="flex-1">
				{message}
				{showManage ? (
					<>
						{" "}
						<Link href="/my-files" target="_blank" className="font-semibold underline">
							Manage My Files
						</Link>
					</>
				) : null}
			</p>
			{onDismiss ? (
				<button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1 rounded p-1 hover:bg-red/10">
					<X className="h-3.5 w-3.5" aria-hidden />
				</button>
			) : null}
		</div>
	);
}

function ProgressBar({ progress, className }: { progress: number; className?: string }) {
	return (
		<div
			role="progressbar"
			aria-label="Uploading"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={progress}
			className={cn("h-1.5 w-full overflow-hidden bg-white/60", className)}
		>
			<div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} />
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* ImageSlot (small square, e.g. option images)                        */
/* ------------------------------------------------------------------ */

export interface ImageSlotProps {
	imageUrl: string | null | undefined;
	/** Accessible name, e.g. "Image for option 2". */
	label: string;
	/** Attach a My Files image (picked or just uploaded). */
	onPickFile: (fileId: number) => Promise<void> | void;
	/** Detach (the file stays in My Files). */
	onDetach: () => Promise<void> | void;
	disabled?: boolean;
	/** Square size in px (default 44, the minimum tap target). */
	size?: number;
	className?: string;
}

/** Compact image picker: click = My Files picker, drop = upload; thumbnail with a detach ×. */
export function ImageSlot({ imageUrl, label, onPickFile, onDetach, disabled, size = 44, className }: ImageSlotProps) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const { upload, uploading, progress, error, clearError } = useLibraryUpload("image");

	const run = async (work: () => Promise<void> | void) => {
		setBusy(true);
		try {
			await work();
		} catch (reason) {
			toast.error(reason instanceof Error ? reason.message : "Could not update the image.");
		} finally {
			setBusy(false);
		}
	};

	const { getRootProps, getInputProps, isDragActive } = useDropzone({
		onDrop: async (files) => {
			const file = files[0] ? await upload(files[0]) : null;
			if (file) await run(() => onPickFile(file.id));
		},
		multiple: false,
		noClick: true,
		noKeyboard: true,
		disabled: disabled || uploading || busy,
	});

	const working = uploading || busy;
	const box: CSSProperties = { width: size, height: size };

	return (
		<>
			<div className={cn("relative shrink-0", className)} style={box} {...getRootProps()}>
				<input {...getInputProps({ accept: ACCEPT_ATTR.image })} />
				<button
					type="button"
					onClick={() => setPickerOpen(true)}
					disabled={disabled || working}
					aria-label={imageUrl ? `${label}: replace` : `${label}: add`}
					title={imageUrl ? "Replace image" : "Add image"}
					className={cn(
						"flex h-full w-full items-center justify-center overflow-hidden rounded-lg border outline-none transition focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-60",
						imageUrl ? "border-stroke dark:border-dark-3" : "border-dashed border-gray-5 text-dark-5 hover:border-primary hover:text-primary dark:border-dark-4",
						isDragActive && "border-primary bg-primary-50"
					)}
				>
					{imageUrl ? (
						<img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
					) : (
						<ImagePlus className="h-4 w-4" aria-hidden />
					)}
				</button>
				{uploading ? <ProgressBar progress={progress} className="absolute inset-x-0 bottom-0 rounded-b-lg" /> : null}
				{imageUrl && !working && !disabled ? (
					<button
						type="button"
						onClick={() => run(onDetach)}
						aria-label={`${label}: remove (stays in My Files)`}
						title="Remove from this slide"
						className="absolute -right-2 -top-2 flex h-6 w-6 items-center after:absolute after:-inset-2.5 after:content-[''] justify-center rounded-full bg-white text-red shadow ring-1 ring-stroke hover:bg-red hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red dark:bg-dark-2"
					>
						<X className="h-3 w-3" aria-hidden />
					</button>
				) : null}
			</div>
			{error ? <LibraryErrorNotice error={error} onDismiss={clearError} className="mt-1" /> : null}
			<FileLibraryPicker
				open={pickerOpen}
				onClose={() => setPickerOpen(false)}
				accept="image"
				confirmLabel="Use this image"
				busy={busy}
				onSelect={async (file) => {
					await run(() => onPickFile(file.id));
					setPickerOpen(false);
				}}
			/>
		</>
	);
}

/* ------------------------------------------------------------------ */
/* MediaSlot (slide image / video)                                     */
/* ------------------------------------------------------------------ */

/** https YouTube / Vimeo link with something that looks like a video id (the server has the final say). */
export const VIDEO_URL_PATTERN =
	/^https:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/)[\w-]{6,}|youtu\.be\/[\w-]{6,}|(?:www\.|player\.)?vimeo\.com\/(?:video\/)?\d+)/i;

export interface MediaSlotProps {
	accept: MediaAccept;
	/** The attached My Files item (authoring slide `media`). */
	media: MediaFile | null;
	/** video: the stored link (slide config.video_url). */
	videoUrl?: string | null;
	/** video: config.embed_url, for an inline preview of the link. */
	embedUrl?: string | null;
	onPickFile: (fileId: number) => Promise<void> | void;
	/** video: attach (string) or clear (null) a YouTube / Vimeo link. */
	onVideoUrl?: (url: string | null) => Promise<void> | void;
	/** Detach the file (the file stays in My Files). */
	onDetach: () => Promise<void> | void;
	label: string;
	/** CSS aspect-ratio of the preview box, e.g. "16 / 9" (default) or "1 / 1". */
	aspect?: string;
	/** Server field error, e.g. errors.file_id / errors.video_url. */
	error?: string | string[] | null;
	hint?: string;
	disabled?: boolean;
	className?: string;
}

/** Slide media slot: preview, replace, detach; drop to upload; video also takes a YouTube / Vimeo link. */
export function MediaSlot({
	accept,
	media,
	videoUrl,
	embedUrl,
	onPickFile,
	onVideoUrl,
	onDetach,
	label,
	aspect = "16 / 9",
	error,
	hint,
	disabled,
	className,
}: MediaSlotProps) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const { upload, uploading, progress, error: uploadError, clearError } = useLibraryUpload(accept);
	const serverError = Array.isArray(error) ? error[0] : error;
	const isVideo = accept === "video";
	const working = uploading || busy;

	const run = async (work: () => Promise<void> | void) => {
		setBusy(true);
		try {
			await work();
		} catch (reason) {
			// Field errors (422) come back through `error`; anything else is a toast.
			const status = (reason as { status?: number })?.status;
			if (status !== 422) toast.error(reason instanceof Error ? reason.message : "Could not update the media.");
		} finally {
			setBusy(false);
		}
	};

	const { getRootProps, getInputProps, isDragActive } = useDropzone({
		onDrop: async (files) => {
			const file = files[0] ? await upload(files[0]) : null;
			if (file) await run(() => onPickFile(file.id));
		},
		multiple: false,
		noClick: true,
		noKeyboard: true,
		disabled: disabled || working,
	});

	const hasFile = !!media;
	const hasLink = isVideo && !!videoUrl;
	const empty = !hasFile && !hasLink;
	const kind = isVideo ? "video" : "image";

	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<span className="text-sm font-medium text-dark dark:text-white">{label}</span>

			<div {...getRootProps()} className="relative">
				<input {...getInputProps({ accept: ACCEPT_ATTR[accept] })} />
				<div
					className={cn(
						"relative w-full overflow-hidden rounded-lg border bg-gray-1 dark:bg-dark-2",
						empty ? "border-dashed border-gray-5 dark:border-dark-4" : "border-stroke dark:border-dark-3",
						isDragActive && "border-primary bg-primary-50"
					)}
					style={{ aspectRatio: aspect }}
				>
					{hasFile && media ? (
						isVideo ? (
							<video src={media.url} controls preload="metadata" className="h-full w-full bg-black object-contain">
								<track kind="captions" />
							</video>
						) : (
							<img src={media.url} alt="" className="h-full w-full object-contain" draggable={false} />
						)
					) : hasLink ? (
						embedUrl ? (
							<iframe
								src={embedUrl}
								title={`${label} preview`}
								className="h-full w-full"
								allow="encrypted-media; picture-in-picture"
								allowFullScreen
							/>
						) : (
							<div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-dark-5">
								<Link2 className="h-6 w-6" aria-hidden />
								<span className="break-all">{videoUrl}</span>
							</div>
						)
					) : (
						<button
							type="button"
							onClick={() => setPickerOpen(true)}
							disabled={disabled || working}
							className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
						>
							{isVideo ? <VideoIcon className="h-8 w-8" aria-hidden /> : <ImagePlus className="h-8 w-8" aria-hidden />}
							<span className="text-sm font-semibold">
								{uploading ? `Uploading… ${progress}%` : isDragActive ? "Drop to upload" : `Add ${kind}`}
							</span>
							<span className="flex items-center gap-1 text-xs text-dark-5">
								<FolderOpen className="h-3.5 w-3.5" aria-hidden />
								Upload, drop a file, or choose from My Files
							</span>
						</button>
					)}

					{uploading ? <ProgressBar progress={progress} className="absolute inset-x-0 bottom-0" /> : null}

					{!empty && !disabled ? (
						<div className="absolute right-2 top-2 flex gap-1.5">
							<button
								type="button"
								onClick={() => setPickerOpen(true)}
								disabled={working}
								aria-label={`Replace ${kind}`}
								title={`Replace ${kind}`}
								className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-dark shadow hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
							>
								<RefreshCw className="h-4 w-4" aria-hidden />
							</button>
							<button
								type="button"
								onClick={() => run(hasFile ? onDetach : () => onVideoUrl?.(null))}
								disabled={working}
								aria-label={hasFile ? `Remove ${kind} from this slide (stays in My Files)` : "Remove video link"}
								title="Remove from this slide"
								className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-red shadow hover:bg-red hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red disabled:opacity-60"
							>
								<X className="h-4 w-4" aria-hidden />
							</button>
						</div>
					) : null}
				</div>
			</div>

			{media && !media.inLibrary ? (
				<p className="text-xs text-dark-5 dark:text-dark-6">This file was deleted from My Files; the slide still shows it.</p>
			) : null}

			{isVideo && onVideoUrl ? (
				<VideoUrlInput value={videoUrl ?? ""} disabled={disabled || working} onCommit={(url) => run(() => onVideoUrl(url))} />
			) : null}

			{hint ? <p className="text-xs text-dark-5 dark:text-dark-6">{hint}</p> : null}
			{isVideo ? (
				<p className="text-xs text-dark-5 dark:text-dark-6">Uploaded mp4 videos (up to 50 MB) count toward your My Files storage.</p>
			) : null}
			<LibraryErrorNotice error={uploadError} onDismiss={clearError} />
			{serverError ? (
				<p role="alert" className="text-xs font-medium text-[#B42318] dark:text-red-light">
					{serverError}
				</p>
			) : null}

			{/* Outside the drop zone: see the note at the top of the file. */}
			<FileLibraryPicker
				open={pickerOpen}
				onClose={() => setPickerOpen(false)}
				accept={accept}
				confirmLabel={`Use this ${kind}`}
				busy={busy}
				onSelect={async (file) => {
					await run(() => onPickFile(file.id));
					setPickerOpen(false);
				}}
			/>
		</div>
	);
}

function VideoUrlInput({ value, disabled, onCommit }: { value: string; disabled?: boolean; onCommit: (url: string | null) => void }) {
	// Committed on blur / Enter only: a half-pasted link must not hit the server.
	const [draft, setDraft] = useState<string | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const shown = draft ?? value;

	const commit = () => {
		if (draft === null) return;
		const url = draft.trim();
		if (url !== "" && !VIDEO_URL_PATTERN.test(url)) {
			setProblem("Paste an https link to a YouTube or Vimeo video.");
			return;
		}
		setProblem(null);
		setDraft(null);
		if (url !== value.trim()) onCommit(url === "" ? null : url);
	};

	return (
		<div className="flex flex-col gap-1.5">
			<label className="flex flex-col gap-1.5">
				<span className="text-sm font-medium text-dark dark:text-white">Or a YouTube / Vimeo link</span>
				<input
					type="url"
					inputMode="url"
					value={shown}
					maxLength={2048}
					placeholder="https://www.youtube.com/watch?v=…"
					disabled={disabled}
					aria-invalid={problem ? true : undefined}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") commit();
						if (event.key === "Escape") {
							setDraft(null);
							setProblem(null);
						}
					}}
					className="min-h-11 w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
				/>
			</label>
			{problem ? (
				<p role="alert" className="text-xs font-medium text-[#B42318] dark:text-red-light">
					{problem}
				</p>
			) : null}
		</div>
	);
}
