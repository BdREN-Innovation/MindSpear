"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FileQuestion, Loader2, Lock, RefreshCw, WifiOff } from "lucide-react";
import { Modal } from "@/components/ui";
import type { DeckApiError } from "@/features/deck/api/errors";
import type { DeckProduct } from "@/features/deck/types";
import { productCopy } from "./productCopy";

// Full-page states of the editor route and the delete confirmation.

const linkClass =
	"inline-flex min-h-11 items-center justify-center rounded-lg border border-stroke px-4 text-sm font-medium text-dark transition hover:bg-gray-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 dark:border-stroke-dark dark:text-white dark:hover:bg-dark-3";
const primaryClass =
	"inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-dark transition hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2";

function FullPage({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
	return (
		<main className="flex h-full w-full items-center justify-center bg-gray-2 p-6 dark:bg-dark">
			<div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-gray-dark">
				<span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary-700 dark:bg-dark-3 dark:text-primary-light">
					{icon}
				</span>
				<h1 className="text-xl font-semibold text-dark dark:text-white">{title}</h1>
				{children}
			</div>
		</main>
	);
}

export function EditorLoading({ product = "quest" }: { product?: DeckProduct }) {
	return (
		<main className="flex h-full w-full items-center justify-center bg-gray-2 dark:bg-dark" aria-busy="true">
			<p role="status" className="flex items-center gap-2 text-sm text-dark-5 dark:text-dark-6">
				<Loader2 className="h-5 w-5 text-primary motion-safe:animate-spin" aria-hidden />
				Loading your {productCopy(product).noun}…
			</p>
		</main>
	);
}

/** 403 feature_disabled: Quest v2 / Quiz v2 is switched off for this account. */
export function FeatureDisabledPage({ error, product = "quest" }: { error: DeckApiError; product?: DeckProduct }) {
	const copy = productCopy(product);
	return (
		<FullPage icon={<Lock className="h-6 w-6" aria-hidden />} title={`The new ${copy.noun} editor isn't available for your account`}>
			<p className="text-sm text-dark-5 dark:text-dark-6">
				{error.message || `${copy.v2} is not enabled for your account.`} Your existing {copy.plural} are still in My
				Library.
			</p>
			<div className="flex flex-wrap justify-center gap-2">
				<Link href={copy.libraryHref} className={linkClass}>
					My {copy.plural}
				</Link>
				<Link href="/dashboard" className={primaryClass}>
					Back to dashboard
				</Link>
			</div>
		</FullPage>
	);
}

export function LoadErrorPage({
	error,
	onRetry,
	product = "quest",
}: {
	error: DeckApiError;
	onRetry(): void;
	product?: DeckProduct;
}) {
	const copy = productCopy(product);
	if (error.code === "not_found") {
		return (
			<FullPage icon={<FileQuestion className="h-6 w-6" aria-hidden />} title={`${copy.Noun} not found`}>
				<p className="text-sm text-dark-5 dark:text-dark-6">It may have been deleted, or it belongs to another account.</p>
				<Link href={copy.libraryHref} className={primaryClass}>
					Go to my {copy.plural}
				</Link>
			</FullPage>
		);
	}
	return (
		<FullPage icon={<WifiOff className="h-6 w-6" aria-hidden />} title={`The ${copy.noun} could not be loaded`}>
			<p className="text-sm text-dark-5 dark:text-dark-6">{error.message}</p>
			<div className="flex flex-wrap justify-center gap-2">
				<Link href={copy.libraryHref} className={linkClass}>
					My {copy.plural}
				</Link>
				<button type="button" onClick={onRetry} className={primaryClass}>
					<RefreshCw className="h-4 w-4" aria-hidden />
					Try again
				</button>
			</div>
		</FullPage>
	);
}

export interface DeleteSlideDialogProps {
	open: boolean;
	slideNumber: number;
	slideTitle: string;
	onCancel(): void;
	onConfirm(): void;
}

export function DeleteSlideDialog({ open, slideNumber, slideTitle, onCancel, onConfirm }: DeleteSlideDialogProps) {
	return (
		<Modal
			title={`Delete slide ${slideNumber}?`}
			open={open}
			onClose={onCancel}
			size="sm"
			footer={
				<div className="flex justify-end gap-2">
					<button type="button" onClick={onCancel} className={linkClass}>
						Cancel
					</button>
					<button
						type="button"
						// Enter confirms straight away; Esc / Cancel keep the slide.
						autoFocus
						onClick={onConfirm}
						className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#B42318] px-5 text-sm font-semibold text-white transition hover:bg-red-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318] focus-visible:ring-offset-2"
					>
						Delete slide
					</button>
				</div>
			}
		>
			<p className="text-sm text-dark-4 dark:text-dark-6">
				{slideTitle ? <>“{slideTitle}” will be removed. </> : null}This can&apos;t be undone.
			</p>
		</Modal>
	);
}
