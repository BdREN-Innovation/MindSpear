"use client";

import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

type StickySubmitBarProps = {
	onSubmit: () => void;
	disabled?: boolean;
	label?: string;
	helperText?: string;
	selectedText?: string;
	/** Shown in place of the selection, e.g. when the answer couldn't be sent. */
	errorText?: string;
	/** While the answer is being sent. */
	busy?: boolean;
	className?: string;
};

export function StickySubmitBar({
	onSubmit,
	disabled = false,
	label = "Submit",
	helperText,
	selectedText,
	errorText,
	busy = false,
	className,
}: StickySubmitBarProps) {
	return (
		<div
			className={cn(
				"sticky bottom-0 z-20 -mx-4 mt-auto border-t border-slate-200/80 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-16px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:mx-0 sm:rounded-b-lg",
				className,
			)}
		>
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-h-5 min-w-0 text-sm">
					{errorText ? (
						<p role="alert" className="font-semibold text-red-600">
							{errorText}
						</p>
					) : selectedText ? (
						<p className="truncate font-semibold text-slate-800">
							{selectedText}
						</p>
					) : (
						<p className="text-slate-500">
							{helperText ?? "Choose an answer to unlock submit."}
						</p>
					)}
				</div>
				<button
					type="button"
					onClick={onSubmit}
					disabled={disabled || busy}
					className="group relative inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded bg-gradient-to-r from-primary via-secondary to-accent px-6 text-base font-bold text-white shadow-lg shadow-primary/25 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
				>
					<span className="absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-18deg] bg-white/25 transition duration-700 group-hover:left-[120%]" />
					<Send className="h-4 w-4" />
					{busy ? "Sending…" : label}
				</button>
			</div>
		</div>
	);
}
