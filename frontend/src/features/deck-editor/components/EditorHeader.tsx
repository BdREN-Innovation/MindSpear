"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, Check, CircleDot, Loader2, MonitorPlay, Play, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DECK_LIMITS, type DeckProduct } from "@/features/deck/types";
import { productCopy } from "./productCopy";
import type { SaveStatus } from "./useDeckEditor";

export interface EditorHeaderProps {
	title: string;
	saveStatus: SaveStatus;
	backHref: string;
	/** Copy only ("Quest title" / "Quiz title"); default quest. */
	product?: DeckProduct;
	canPresent: boolean;
	presenting?: boolean;
	onTitleChange(title: string): void;
	onTitleCommit(): void;
	onRetrySave(): void;
	onPreview(): void;
	onOpenSettings(): void;
	onPresent(): void;
}

const STATUS: Record<SaveStatus, { label: string; className: string }> = {
	saved: { label: "All changes saved", className: "text-dark-5 dark:text-dark-6" },
	unsaved: { label: "Unsaved changes", className: "text-dark-4 dark:text-dark-6" },
	saving: { label: "Saving…", className: "text-dark-4 dark:text-dark-6" },
	error: { label: "Not saved · retrying", className: "text-[#B42318] dark:text-red-light" },
};

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry(): void }) {
	const { label, className } = STATUS[status];
	const Icon = status === "saved" ? Check : status === "saving" ? Loader2 : status === "error" ? AlertCircle : CircleDot;
	return (
		<div className={cn("flex items-center gap-1.5 text-xs font-medium", className)}>
			<span role="status" aria-live="polite" className="flex items-center gap-1.5">
				<Icon className={cn("h-3.5 w-3.5", status === "saving" && "motion-safe:animate-spin")} aria-hidden />
				<span className="hidden md:inline">{label}</span>
				<span className="sr-only md:hidden">{label}</span>
			</span>
			{status === "error" ? (
				<button type="button" onClick={onRetry} className="min-h-11 rounded px-2 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
					Retry now
				</button>
			) : null}
		</div>
	);
}

const secondaryButton =
	"inline-flex min-h-11 items-center gap-2 rounded-lg border border-stroke px-3 text-sm font-medium text-dark transition hover:bg-gray-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 dark:border-stroke-dark dark:text-white dark:hover:bg-dark-3";

export function EditorHeader({
	title,
	saveStatus,
	backHref,
	product = "quest",
	canPresent,
	presenting,
	onTitleChange,
	onTitleCommit,
	onRetrySave,
	onPreview,
	onOpenSettings,
	onPresent,
}: EditorHeaderProps) {
	const copy = productCopy(product);
	return (
		<header className="flex h-16 shrink-0 items-center gap-3 border-b border-stroke bg-white px-3 dark:border-stroke-dark dark:bg-gray-dark">
			<Link
				href={backHref}
				className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-dark transition hover:bg-gray-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 dark:text-white dark:hover:bg-dark-3"
				aria-label={`Back to my ${copy.plural}`}
			>
				<ArrowLeft className="h-5 w-5" aria-hidden />
			</Link>

			<div className="flex min-w-0 flex-1 items-center gap-3">
				<input
					value={title}
					maxLength={DECK_LIMITS.maxDeckTitle}
					onChange={(event) => onTitleChange(event.target.value)}
					onBlur={onTitleCommit}
					onKeyDown={(event) => {
						if (event.key === "Enter") event.currentTarget.blur();
					}}
					aria-label={`${copy.Noun} title`}
					placeholder={`Untitled ${copy.noun}`}
					className="min-h-11 w-full min-w-0 max-w-md truncate rounded-lg border border-transparent bg-transparent px-2 text-base font-semibold text-dark outline-none transition hover:border-stroke focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 dark:text-white dark:hover:border-stroke-dark"
				/>
				<SaveIndicator status={saveStatus} onRetry={onRetrySave} />
			</div>

			<div className="flex shrink-0 items-center gap-2">
				<button type="button" onClick={onPreview} className={secondaryButton} disabled={!canPresent}>
					<Play className="h-4 w-4" aria-hidden />
					<span className="hidden lg:inline">Preview</span>
					<span className="sr-only lg:hidden">Preview</span>
				</button>
				<button type="button" onClick={onOpenSettings} className={secondaryButton}>
					<Settings2 className="h-4 w-4" aria-hidden />
					<span className="hidden lg:inline">Settings</span>
					<span className="sr-only lg:hidden">{copy.Noun} settings</span>
				</button>
				<button
					type="button"
					onClick={onPresent}
					disabled={!canPresent || presenting}
					title={canPresent ? undefined : "Add a slide first"}
					className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-dark transition hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-dark"
				>
					{presenting ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <MonitorPlay className="h-4 w-4" aria-hidden />}
					Present
				</button>
			</div>
		</header>
	);
}
