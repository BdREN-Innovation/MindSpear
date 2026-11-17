"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, Check, CircleDot, Globe, Loader2, Lock, MonitorPlay, Pencil, Play, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DECK_LIMITS, type DeckProduct, type DeckVisibility } from "@/features/deck/types";
import { productCopy } from "@/features/deck/productCopy";
import type { SaveStatus } from "./useDeckEditor";

export interface EditorHeaderProps {
	title: string;
	saveStatus: SaveStatus;
	backHref: string;
	/** Copy only ("Quest title" / "Quiz title"); default quest. */
	product?: DeckProduct;
	canPresent: boolean;
	presenting?: boolean;
	/** Shown as a Private / Public button that opens the settings (Sharing). */
	visibility?: DeckVisibility;
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
	visibility = "private",
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
				{/* A visible box and a pencil, so the title reads as something to click and rename. */}
				<label className="group relative flex min-w-0 max-w-md flex-1 items-center" title={`Rename this ${copy.noun}`}>
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
						className="min-h-11 w-full min-w-0 truncate rounded-lg border border-dashed border-gray-4 bg-gray-1 pl-3 pr-9 text-base font-semibold text-dark outline-none transition hover:border-solid hover:border-secondary-200 hover:bg-white focus-visible:border-solid focus-visible:border-secondary focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-secondary/20 dark:border-dark-4 dark:bg-dark-2 dark:text-white"
					/>
					<Pencil
						className="pointer-events-none absolute right-3 h-4 w-4 text-dark-5 transition group-hover:text-secondary-600 group-focus-within:opacity-0"
						aria-hidden
					/>
				</label>
				<SaveIndicator status={saveStatus} onRetry={onRetrySave} />
			</div>

			<div className="flex shrink-0 items-center gap-2">
				<button
					type="button"
					onClick={onOpenSettings}
					className={secondaryButton}
					title={visibility === "public" ? "Listed in Discover. Change it in Settings." : "Only you can see it. Share it in Settings."}
				>
					{visibility === "public" ? <Globe className="h-4 w-4 text-green" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
					<span className="hidden md:inline">{visibility === "public" ? "Public" : "Private"}</span>
					<span className="sr-only md:hidden">{visibility === "public" ? "Public, in Discover" : "Private"}</span>
				</button>
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
