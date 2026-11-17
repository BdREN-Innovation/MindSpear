import { cn } from "@/lib/utils";
import type { QuizStatus, SessionStatus } from "../../types";

type Status = QuizStatus | SessionStatus;

const LABEL: Record<Status, string> = {
	draft: "Draft",
	upcoming: "Scheduled",
	lobby: "Lobby open",
	live: "Live",
	completed: "Completed",
	waiting: "Lobby open",
	finishing: "Scoring",
	finished: "Finished",
};

/** Status is never colour alone: each one has its own marker shape. */
function Marker({ status }: { status: Status }) {
	switch (status) {
		case "live":
		case "finishing":
			return <span className="h-2 w-2 rounded-full bg-urgent" />; // filled circle
		case "lobby":
		case "waiting":
			return <span className="h-2 w-2 rounded-full border-2 border-primary-dark" />; // ring
		case "upcoming":
			return <span className="h-2 w-2 border-[1.5px] border-blue-dark" />; // open square
		case "completed":
		case "finished":
			return <span className="h-2 w-2 bg-dark-4 dark:bg-dark-6" />; // filled square
		default:
			return <span className="h-0.5 w-2.5 bg-dark-5" />; // dash
	}
}

export function StatusTag({ status, className }: { status: Status; className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold",
				(status === "live" || status === "finishing") && "border-urgent/30 bg-urgent-bg text-urgent-text",
				(status === "lobby" || status === "waiting") && "border-primary/30 bg-primary-50 text-primary-800",
				status === "upcoming" && "border-blue-light-4 bg-blue-light-5 text-blue-dark",
				(status === "completed" || status === "finished") && "border-stroke bg-gray-2 text-dark-4 dark:border-stroke-dark dark:bg-dark-2 dark:text-dark-6",
				status === "draft" && "border-dashed border-stroke bg-white text-dark-5 dark:border-stroke-dark dark:bg-transparent",
				className,
			)}
		>
			<Marker status={status} />
			{LABEL[status]}
		</span>
	);
}
