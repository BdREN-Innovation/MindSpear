import { AlertTriangle, Loader2 } from "lucide-react";
import { ParticipantStage } from "./ParticipantStage";
import { cn } from "@/lib/utils";

type StageMessageProps = {
	title: string;
	body?: React.ReactNode;
	busy?: boolean;
	tone?: "neutral" | "error";
	icon?: React.ReactNode;
	action?: { label: string; onClick: () => void };
	children?: React.ReactNode;
};

/** A centred card for loading, waiting and error states. */
export function StageMessage({ title, body, busy, tone = "neutral", icon, action, children }: StageMessageProps) {
	return (
		<ParticipantStage size="narrow" className="items-center justify-center px-6 py-10 text-center">
			<div className="mx-auto flex max-w-md flex-col items-center" role={tone === "error" ? "alert" : "status"}>
				<div
					className={cn(
						"flex h-16 w-16 items-center justify-center rounded-lg border",
						tone === "error" ? "border-red-light-3 bg-red-light-5 text-red-dark" : "border-secondary/20 bg-secondary/10 text-secondary",
					)}
					aria-hidden
				>
					{icon ??
						(busy ? (
							<Loader2 className="h-7 w-7 animate-spin motion-reduce:animate-none" />
						) : (
							<AlertTriangle className="h-7 w-7" />
						))}
				</div>
				<h1 className="mt-5 text-2xl font-black text-slate-950">{title}</h1>
				{body ? <div className="mt-2 text-base text-slate-600">{body}</div> : null}
				{children}
				{action ? (
					<button
						type="button"
						onClick={action.onClick}
						className="mt-6 h-11 rounded-lg bg-slate-900 px-5 text-sm font-bold text-white hover:bg-slate-800"
					>
						{action.label}
					</button>
				) : null}
			</div>
		</ParticipantStage>
	);
}
