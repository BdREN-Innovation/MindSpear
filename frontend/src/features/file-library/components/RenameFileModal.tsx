"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { libraryApi, parseLibraryError } from "../api/libraryApi";
import type { LibraryFile } from "../types";

interface Props {
	file: LibraryFile | null;
	onClose: () => void;
	onRenamed: (file: LibraryFile) => void;
}

export function RenameFileModal({ file, onClose, onRenamed }: Props) {
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setName(file?.name ?? "");
		setError(null);
	}, [file]);

	const save = async () => {
		if (!file) return;
		const trimmed = name.trim();
		if (!trimmed) {
			setError("The name cannot be blank.");
			return;
		}
		setSaving(true);
		try {
			onRenamed(await libraryApi.rename(file.id, trimmed));
			onClose();
		} catch (reason) {
			setError(parseLibraryError(reason).message);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal title="Rename file" open={!!file} onClose={onClose} size="sm" destroyOnClose>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					save();
				}}
				className="space-y-4 pt-2"
			>
				<div>
					<label htmlFor="rename-file" className="mb-1 block text-sm font-semibold text-dark dark:text-white">
						Name
					</label>
					<input
						id="rename-file"
						autoFocus
						value={name}
						maxLength={255}
						onChange={(e) => setName(e.target.value)}
						aria-invalid={!!error}
						className="w-full rounded-lg border border-stroke px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-stroke-dark dark:bg-dark-2 dark:text-white"
					/>
					{error ? <p className="mt-1 text-sm text-red-dark">{error}</p> : null}
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" loading={saving}>
						Save
					</Button>
				</div>
			</form>
		</Modal>
	);
}
