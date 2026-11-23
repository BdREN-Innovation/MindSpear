import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/features/deck/types";
import { STATUS_LABEL } from "../format";

const STYLES: Record<SessionStatus, string> = {
	live: "bg-urgent-bg text-urgent-text dark:bg-urgent/20 dark:text-white",
	ended: "bg-gray-2 text-dark-4 dark:bg-dark-2 dark:text-dark-6",
	pending: "bg-secondary-50 text-secondary-700 dark:bg-secondary-900/40 dark:text-secondary-100",
};

export function SessionStatusPill({ status, className }: { status: SessionStatus; className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
				STYLES[status],
				className
			)}
		>
			{status === "live" && (
				<span className="relative flex h-2 w-2" aria-hidden>
					<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-urgent opacity-60 motion-reduce:animate-none" />
					<span className="relative inline-flex h-2 w-2 rounded-full bg-urgent" />
				</span>
			)}
			{STATUS_LABEL[status]}
		</span>
	);
}
