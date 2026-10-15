/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { FaPlus, FaTimes } from "react-icons/fa";
import { FolderOpen, RefreshCw } from "lucide-react";
import Image from "next/image";
import { toast } from "react-toastify";
import { cn } from "@/lib/utils";
import { libraryApi, parseLibraryError } from "@/features/file-library/api/libraryApi";
import { emitLibraryChange } from "@/features/file-library/lib/events";
import { precheckFile } from "@/features/file-library/lib/format";
import { FileLibraryPicker } from "@/features/file-library/components/FileLibraryPicker";

interface SelectedImage {
	path: string;
	id: number;
}

interface StylableInputFileProps {
	/** Called with the chosen image, whether it was just uploaded or picked from My Files. */
	onImageSelected?: (image: SelectedImage) => unknown;
	/** Older callers that upload the file themselves. */
	onImageUpload?: (file: File) => Promise<SelectedImage>;
	/** Detaches the image from the question; the file itself stays in My Files. */
	onImageRemove?: () => unknown;
	initialImageUrl?: string | null;
	initialImageId?: number | null;
}

/** Question image: drop a file to upload it, or click to choose from My Files / upload new. */
export default function StylableInputFile({
	onImageSelected,
	onImageUpload,
	onImageRemove,
	initialImageUrl,
	initialImageId,
}: StylableInputFileProps) {
	const [image, setImage] = useState<string | null>(initialImageUrl || null);
	const [imageId, setImageId] = useState<number | null>(initialImageId || null);
	const [isUploading, setIsUploading] = useState(false);
	const [progress, setProgress] = useState(0);
	const [pickerOpen, setPickerOpen] = useState(false);

	// Update image when initialImageUrl changes
	useEffect(() => {
		setImage(initialImageUrl || null);
		setImageId(initialImageId || null);
	}, [initialImageUrl, initialImageId]);

	const apply = async (selected: SelectedImage) => {
		setImage(selected.path);
		setImageId(selected.id);
		await onImageSelected?.(selected);
	};

	const uploadDropped = async (file: File) => {
		const problem = precheckFile(file, "image", null);
		if (problem) {
			toast.error(problem);
			return;
		}
		const previous = { image, imageId };
		const preview = URL.createObjectURL(file);
		setImage(preview);
		setIsUploading(true);
		setProgress(0);
		try {
			if (onImageSelected) {
				const result = await libraryApi.upload(file, { onProgress: setProgress });
				emitLibraryChange(result.usage);
				await apply({ path: result.file.url, id: result.file.id });
				if (result.deduplicated) toast.info("This image was already in My Files, so it was reused.");
			} else if (onImageUpload) {
				const uploaded = await onImageUpload(file);
				setImage(uploaded.path);
				setImageId(uploaded.id);
			}
		} catch (error) {
			console.error("Upload failed:", error);
			toast.error(parseLibraryError(error).message);
			setImage(previous.image);
			setImageId(previous.imageId);
		} finally {
			URL.revokeObjectURL(preview);
			setIsUploading(false);
		}
	};

	const { getRootProps, getInputProps, isDragActive, open: openFileDialog } = useDropzone({
		onDrop: (files) => files[0] && uploadDropped(files[0]),
		multiple: false,
		noClick: true,
		noKeyboard: true,
		disabled: isUploading,
	});

	// The picker covers both uploading and reusing; older callers only get the file dialog.
	const choose = () => {
		if (isUploading) return;
		if (onImageSelected) setPickerOpen(true);
		else openFileDialog();
	};

	const removeImage = async () => {
		try {
			if (imageId || image) await onImageRemove?.();
			setImage(null);
			setImageId(null);
		} catch (error) {
			console.error("Failed to remove image:", error);
		}
	};

	return (
		<>
			<div className="w-full" {...getRootProps()}>
				<input {...getInputProps({ accept: "image/png,image/jpeg,image/gif,image/webp" })} />

				{!image ? (
					<button
						type="button"
						onClick={choose}
						disabled={isUploading}
						className={cn(
							"flex w-full cursor-pointer flex-col mb-[20px] items-center justify-center rounded-md border-2 border-dashed bg-white p-4 transition sm:py-10 dark:bg-dark-2",
							isDragActive ? "border-primary bg-primary-50" : "border-transparent hover:border-primary/50 dark:border-dark-3",
							isUploading && "opacity-50",
						)}
					>
						<Image src="/images/media-icon.svg" alt="" width={176} height={32} className="mb-6" />
						<span className="flex size-13.5 items-center justify-center rounded-[10px] border border-stroke bg-white dark:border-dark-3 dark:bg-gray-dark">
							{isUploading ? <span className="loading-spinner"></span> : <FaPlus />}
						</span>
						<span className="mt-1 text-[.875rem] font-bold">
							{isUploading ? `Uploading… ${progress}%` : isDragActive ? "Drop to upload" : "Add Media"}
						</span>
						{!isUploading && onImageSelected ? (
							<span className="mt-1 flex items-center gap-1 text-xs text-dark-5">
								<FolderOpen className="h-3.5 w-3.5" aria-hidden />
								Upload or choose from My Files
							</span>
						) : null}
					</button>
				) : (
					<div className="group relative w-full mb-[20px] rounded-lg overflow-hidden border border-gray-300">
						<img src={image} alt="Question media" className="w-full h-full object-cover cursor-pointer" onClick={choose} />

						{isUploading ? (
							<div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/60">
								<div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
							</div>
						) : (
							<>
								<button
									type="button"
									onClick={choose}
									title="Replace image"
									aria-label="Replace image"
									className="absolute top-2 right-2 bg-white bg-opacity-70 rounded-full p-1.5 hover:bg-opacity-100 transition cursor-pointer"
								>
									<RefreshCw size={14} />
								</button>

								<button
									type="button"
									onClick={removeImage}
									title="Remove from this question"
									aria-label="Remove image from this question"
									className="absolute top-2 left-2 bg-white bg-opacity-70 rounded-full p-1.5 hover:bg-opacity-100 transition cursor-pointer"
								>
									<FaTimes size={14} className="text-red-600" />
								</button>
							</>
						)}
					</div>
				)}
			</div>

			{/* Outside the drop area: React events bubble through portals, so a drop in the picker would upload twice. */}
			{onImageSelected ? (
				<FileLibraryPicker
					open={pickerOpen}
					onClose={() => setPickerOpen(false)}
					accept="image"
					confirmLabel="Use this image"
					onSelect={async (file) => {
						await apply({ path: file.url, id: file.id });
						setPickerOpen(false);
					}}
				/>
			) : null}
		</>
	);
}
