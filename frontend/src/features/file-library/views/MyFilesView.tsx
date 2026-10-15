"use client";

import { useState } from "react";
import { FolderOpen, UploadCloud } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { FileBrowser } from "../components/FileBrowser";
import { FileDropzone } from "../components/FileDropzone";
import { StorageUsageBar } from "../components/StorageUsageBar";
import { useStorageUsage } from "../hooks/useStorageUsage";

/** /my-files: everything the user has uploaded, with storage usage. */
export function MyFilesView() {
	const { usage, loading } = useStorageUsage();
	const [uploadOpen, setUploadOpen] = useState(false);

	const uploadButton = (
		<Button onClick={() => setUploadOpen(true)}>
			<UploadCloud className="h-4 w-4" aria-hidden />
			Upload
		</Button>
	);

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-dark dark:text-white">
						<FolderOpen className="h-7 w-7 text-primary" aria-hidden />
						My Files
					</h1>
					<p className="mt-1 text-sm text-dark-5">
						Documents and images you&apos;ve uploaded. Reuse them to generate quizzes, quests and games, or as question images.
					</p>
				</div>
				{uploadButton}
			</header>

			<StorageUsageBar usage={usage} loading={loading} variant="full" />

			<FileBrowser mode="manage" emptyAction={uploadButton} />

			<Modal title="Upload files" open={uploadOpen} onClose={() => setUploadOpen(false)} size="md" destroyOnClose>
				<div className="space-y-4 pt-1">
					<StorageUsageBar usage={usage} loading={loading} />
					<FileDropzone accept="any" usage={usage} multiple />
					<div className="flex justify-end">
						<Button variant="outline" onClick={() => setUploadOpen(false)}>
							Done
						</Button>
					</div>
				</div>
			</Modal>
		</div>
	);
}
