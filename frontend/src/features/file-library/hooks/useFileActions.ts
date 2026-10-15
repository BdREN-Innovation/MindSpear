"use client";

import { useState } from "react";
import { toast } from "react-toastify";
import { ConfirmDialog } from "@/components/ui";
import { libraryApi, parseLibraryError } from "../api/libraryApi";
import { emitLibraryChange } from "../lib/events";
import { formatBytes } from "../lib/format";
import type { LibraryFile } from "../types";

/** Rename / download / delete with confirmations, shared by the My Files page and the picker. */
export function useFileActions() {
	const [renaming, setRenaming] = useState<LibraryFile | null>(null);

	const remove = (file: LibraryFile, onDeleted?: () => void) =>
		ConfirmDialog.show(
			{
				title: `Delete “${file.name}”?`,
				text: `It will be removed from My Files and ${formatBytes(file.size)} of storage will be freed.`,
				confirmButtonText: "Delete",
			},
			async () => {
				try {
					emitLibraryChange(await libraryApi.remove(file.id));
					toast.success("File deleted.");
					onDeleted?.();
				} catch (reason) {
					const error = parseLibraryError(reason);
					if (error.code !== "file_in_use") {
						toast.error(error.message);
						return;
					}
					const places = Object.entries(error.references ?? {})
						.map(([place, count]) => `${count} ${place}`)
						.join(", ");
					await ConfirmDialog.show(
						{
							title: "This image is still in use",
							text: `It appears in ${places}. Those questions will keep showing it, but you won't be able to reuse it from My Files. Delete anyway?`,
							confirmButtonText: "Delete anyway",
						},
						async () => {
							try {
								emitLibraryChange(await libraryApi.remove(file.id, true));
								toast.success("File deleted.");
								onDeleted?.();
							} catch (again) {
								toast.error(parseLibraryError(again).message);
							}
						},
					);
				}
			},
		);

	const download = async (file: LibraryFile) => {
		try {
			await libraryApi.download(file);
		} catch (reason) {
			toast.error(parseLibraryError(reason).message);
		}
	};

	return { renaming, startRename: setRenaming, stopRename: () => setRenaming(null), remove, download };
}
