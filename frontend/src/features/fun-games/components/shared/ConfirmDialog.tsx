"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
	open: boolean;
	title: string;
	children?: React.ReactNode;
	confirmLabel: string;
	cancelLabel?: string;
	tone?: "default" | "danger";
	busy?: boolean;
	error?: string | null;
	onConfirm: () => void;
	onClose: () => void;
};

/** Native <dialog>: focus trap, Esc and an inert background come with it. */
export function ConfirmDialog({
	open,
	title,
	children,
	confirmLabel,
	cancelLabel = "Cancel",
	tone = "default",
	busy,
	error,
	onConfirm,
	onClose,
}: ConfirmDialogProps) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);

	return (
		<dialog
			ref={ref}
			onClose={onClose}
			aria-labelledby="fg-confirm-title"
			className="w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-stroke bg-white p-0 text-dark shadow-2xl backdrop:bg-dark/50 dark:border-stroke-dark dark:bg-gray-dark dark:text-white"
		>
			<div className="p-6">
				<h2 id="fg-confirm-title" className="text-lg font-bold">
					{title}
				</h2>
				{children ? <div className="mt-2 space-y-2 text-sm text-dark-4 dark:text-dark-6">{children}</div> : null}
				{error ? (
					<p role="alert" className="mt-3 text-sm font-semibold text-red-dark">
						{error}
					</p>
				) : null}
				<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<button
						type="button"
						onClick={onClose}
						autoFocus
						className="h-11 rounded-lg border border-stroke px-4 text-sm font-semibold hover:bg-gray-2 dark:border-stroke-dark dark:hover:bg-dark-2"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={busy}
						className={cn(
							"inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-60",
							tone === "danger" ? "bg-red-dark hover:bg-red" : "bg-dark hover:bg-dark-2 dark:bg-white dark:text-dark",
						)}
					>
						{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
						{confirmLabel}
					</button>
				</div>
			</div>
		</dialog>
	);
}
