"use client";

import { Sparkles } from "lucide-react";
import { Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { DeckProduct, SlideTypeKey } from "@/features/deck/types";
import { slideTypesByCategory, type SlideTypeEntry } from "../slideRegistry";

export interface SlidePickerProps {
	open: boolean;
	product: DeckProduct;
	onClose(): void;
	onPick(type: SlideTypeKey): void;
	/** §5.7: opens the document-to-slides wizard. */
	onGenerate?(): void;
	/** Disables the cards while a slide is being added. */
	busy?: boolean;
}

const cardClass =
	"flex min-h-[4.5rem] w-full items-start gap-3 rounded-xl border border-stroke bg-white p-3 text-left transition hover:border-primary hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:border-stroke-dark dark:bg-dark-2 dark:hover:bg-dark-3 dark:focus-visible:ring-offset-dark";

function TypeCard({ entry, onPick, disabled }: { entry: SlideTypeEntry; onPick(type: SlideTypeKey): void; disabled?: boolean }) {
	const Icon = entry.icon;
	return (
		<li>
			<button type="button" className={cardClass} onClick={() => onPick(entry.key)} disabled={disabled}>
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700 dark:bg-dark-3 dark:text-primary-light">
					<Icon className="h-5 w-5" aria-hidden />
				</span>
				<span className="min-w-0">
					<span className="block text-sm font-semibold text-dark dark:text-white">{entry.label}</span>
					<span className="mt-0.5 block text-xs leading-snug text-dark-5 dark:text-dark-6">{entry.description}</span>
				</span>
			</button>
		</li>
	);
}

/** "New slide": every type the product offers, grouped Interactive / Content (plan §5.3). */
export function SlidePicker({ open, product, onClose, onPick, onGenerate, busy }: SlidePickerProps) {
	const groups = slideTypesByCategory(product);
	const interactive = [...groups.poll, ...groups.interactive];
	const content = groups.content;

	return (
		<Modal title="Add a slide" open={open} onClose={onClose} size="lg" destroyOnClose>
			<div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-1">
				{onGenerate ? (
					<button
						type="button"
						onClick={onGenerate}
						disabled={busy}
						className={cn(
							cardClass,
							"border-secondary/40 bg-secondary-50 hover:border-secondary hover:bg-secondary-100 dark:bg-dark-2"
						)}
					>
						<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-white">
							<Sparkles className="h-5 w-5" aria-hidden />
						</span>
						<span>
							<span className="block text-sm font-semibold text-dark dark:text-white">Generate from a document</span>
							<span className="mt-0.5 block text-xs leading-snug text-dark-5 dark:text-dark-6">
								Pick a PDF, Word or PowerPoint file from My Files and let AI write poll, word cloud and open-ended slides. They are added after the current slide.
							</span>
						</span>
					</button>
				) : null}

				<section aria-labelledby="slide-picker-interactive">
					<h3 id="slide-picker-interactive" className="mb-2 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
						Interactive
					</h3>
					<ul className="grid gap-2 sm:grid-cols-2">
						{interactive.map((entry) => (
							<TypeCard key={entry.key} entry={entry} onPick={onPick} disabled={busy} />
						))}
					</ul>
				</section>

				<section aria-labelledby="slide-picker-content">
					<h3 id="slide-picker-content" className="mb-2 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
						Content
					</h3>
					<ul className="grid gap-2 sm:grid-cols-2">
						{content.map((entry) => (
							<TypeCard key={entry.key} entry={entry} onPick={onPick} disabled={busy} />
						))}
					</ul>
				</section>
			</div>
		</Modal>
	);
}
