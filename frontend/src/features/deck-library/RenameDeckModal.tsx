"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { DECK_LIMITS, type DeckSummary } from "@/features/deck/types";

interface Props {
	/** The deck being renamed; null = closed. */
	deck: DeckSummary | null;
	/** Quiz / quest, for the wording. */
	noun: string;
	onClose: () => void;
	/** Saves the new title; throws to keep the dialog open with the message. */
	onRename: (deck: DeckSummary, title: string) => Promise<void>;
}

export function RenameDeckModal({ deck, noun, onClose, onRename }: Props) {
	const [title, setTitle] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setTitle(deck?.title ?? "");
		setError(null);
	}, [deck]);

	const save = async () => {
		if (!deck) return;
		const trimmed = title.trim();
		if (!trimmed) {
			setError("The name cannot be blank.");
			return;
		}
		if (trimmed === deck.title) {
			onClose();
			return;
		}
		setSaving(true);
		try {
			await onRename(deck, trimmed);
			onClose();
		} catch (reason) {
			setError((reason as Error)?.message || `The ${noun} could not be renamed.`);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal title={`Rename ${noun}`} open={!!deck} onClose={saving ? undefined : onClose} size="sm" destroyOnClose>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void save();
				}}
				className="space-y-4 pt-2"
			>
				<div>
					<label htmlFor="rename-deck" className="mb-1 block text-sm font-semibold text-dark dark:text-white">
						Name
					</label>
					<input
						id="rename-deck"
						autoFocus
						value={title}
						maxLength={DECK_LIMITS.maxDeckTitle}
						onChange={(e) => setTitle(e.target.value)}
						onFocus={(e) => e.target.select()}
						aria-invalid={!!error}
						className="w-full rounded-lg border border-stroke px-3 py-2 text-sm outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20 dark:border-stroke-dark dark:bg-dark-2 dark:text-white"
					/>
					{error ? <p className="mt-1 text-sm text-red-dark">{error}</p> : null}
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="outline" onClick={onClose} disabled={saving}>
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
