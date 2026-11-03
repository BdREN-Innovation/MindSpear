"use client";

import Link from "next/link";
import { HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "../lib/format";
import type { StorageUsage } from "../types";

function barColour(percent: number): string {
	if (percent >= 90) return "bg-red";
	if (percent >= 75) return "bg-yellow-dark";
	return "bg-secondary";
}

interface Props {
	usage: StorageUsage | null;
	loading?: boolean;
	/** compact: one line for modal headers; full: card with a breakdown. */
	variant?: "compact" | "full";
	showManageLink?: boolean;
	className?: string;
}

export function StorageUsageBar({ usage, loading, variant = "compact", showManageLink = false, className }: Props) {
	const percent = usage ? Math.min(100, usage.percent) : 0;
	const label = usage ? `${formatBytes(usage.used)} of ${formatBytes(usage.limit)} used` : loading ? "Checking storage…" : "Storage unavailable";
	const nearlyFull = usage ? percent >= 90 : false;

	const bar = (
		<div
			className="h-2 w-full overflow-hidden rounded-full bg-gray-3 dark:bg-dark-3"
			role="progressbar"
			aria-label="Storage used"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(percent)}
			aria-valuetext={label}
		>
			<div
				className={cn("h-full rounded-full transition-[width] duration-500", usage ? barColour(percent) : "bg-gray-4", loading && !usage && "animate-pulse")}
				style={{ width: usage ? `${Math.max(percent, usage.used > 0 ? 2 : 0)}%` : "30%" }}
			/>
		</div>
	);

	if (variant === "compact") {
		return (
			<div className={cn("w-full", className)}>
				<div className="mb-1 flex items-center justify-between gap-2 text-xs">
					<span className="flex items-center gap-1.5 font-medium text-dark-4 dark:text-dark-6">
						<HardDrive className="h-3.5 w-3.5" aria-hidden />
						{label}
					</span>
					{showManageLink ? (
						<Link href="/my-files" target="_blank" className="font-semibold text-secondary-600 hover:underline dark:text-secondary-200">
							Manage My Files
						</Link>
					) : usage ? (
						<span className={cn("font-semibold", nearlyFull ? "text-red-dark" : "text-dark-5")}>{formatBytes(usage.remaining)} free</span>
					) : null}
				</div>
				{bar}
			</div>
		);
	}

	return (
		<div className={cn("rounded-2xl border border-stroke bg-white p-5 dark:border-stroke-dark dark:bg-gray-dark", className)}>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-sm font-medium text-dark-5">Storage</p>
					<p className="mt-1 text-2xl font-bold text-dark dark:text-white">
						{usage ? formatBytes(usage.used) : "—"}
						<span className="text-base font-medium text-dark-5"> / {usage ? formatBytes(usage.limit) : "—"}</span>
					</p>
				</div>
				{usage ? (
					<p className={cn("text-sm font-semibold", nearlyFull ? "text-red-dark" : "text-dark-5")}>
						{nearlyFull ? "Almost full · " : ""}
						{formatBytes(usage.remaining)} free
					</p>
				) : null}
			</div>
			<div className="mt-3">{bar}</div>
			{usage ? (
				<div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
					<span className="flex items-center gap-2 text-dark-4 dark:text-dark-6">
						<span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
						Documents · {usage.documents.count} · {formatBytes(usage.documents.bytes)}
					</span>
					<span className="flex items-center gap-2 text-dark-4 dark:text-dark-6">
						<span className="h-2.5 w-2.5 rounded-full bg-secondary" aria-hidden />
						Images · {usage.images.count} · {formatBytes(usage.images.bytes)}
					</span>
					{usage.videos ? (
						<span className="flex items-center gap-2 text-dark-4 dark:text-dark-6">
							<span className="h-2.5 w-2.5 rounded-full bg-yellow-dark" aria-hidden />
							Videos · {usage.videos.count} · {formatBytes(usage.videos.bytes)}
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}
