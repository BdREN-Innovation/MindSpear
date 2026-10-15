"use client";

import type { ReactNode } from "react";
import { AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// Inline message block. Errors are role="alert" (announced at once); info is
// role="status".

export function Notice({
	tone = "info",
	children,
	className,
	id,
	action,
}: {
	tone?: "info" | "error";
	children: ReactNode;
	className?: string;
	id?: string;
	action?: ReactNode;
}) {
	const Icon = tone === "error" ? AlertCircle : Info;
	return (
		<div
			id={id}
			role={tone === "error" ? "alert" : "status"}
			className={cn(
				"flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-sm",
				tone === "error"
					? "border-[color-mix(in_srgb,var(--deck-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--deck-danger)_10%,var(--deck-bg))] text-[var(--deck-text)]"
					: "border-[var(--deck-border)] bg-[var(--deck-surface-muted)] text-[var(--deck-text)]",
				className
			)}
		>
			<Icon
				className={cn(
					"mt-0.5 h-4 w-4 shrink-0",
					tone === "error" ? "text-[var(--deck-danger)]" : "text-[var(--deck-text-muted)]"
				)}
				aria-hidden
			/>
			<div className="min-w-0 flex-1">
				{children}
				{action && <div className="mt-2">{action}</div>}
			</div>
		</div>
	);
}
