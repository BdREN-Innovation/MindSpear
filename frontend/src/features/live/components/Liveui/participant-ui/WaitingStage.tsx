"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Hourglass, RadioTower, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ParticipantStage } from "./ParticipantStage";

type WaitingStageProps = {
	mode?: "lobby" | "host" | "timeup" | "complete";
	title?: string;
	message?: string;
	statusLabel?: string;
	className?: string;
};

const copy = {
	lobby: {
		title: "You are in the lobby",
		message: "Get ready. The host will start the first question shortly.",
		statusLabel: "Queued and connected",
	},
	host: {
		title: "Answer locked in",
		message: "Nice move. Wait here while the host moves on to the next question.",
		statusLabel: "Waiting for host",
	},
	timeup: {
		title: "Time's up",
		message: "No answer was sent for this question. The host will move on shortly.",
		statusLabel: "Waiting for host",
	},
	complete: {
		title: "Session complete",
		message: "Your responses are saved. Results will be ready soon.",
		statusLabel: "Complete",
	},
};

export function WaitingStage({
	mode = "lobby",
	title,
	message,
	statusLabel,
	className,
}: WaitingStageProps) {
	const resolved = copy[mode];
	const Icon = mode === "complete" ? CheckCircle2 : mode === "host" ? Hourglass : RadioTower;

	return (
		<ParticipantStage
			size="narrow"
			className={cn(
				"items-center justify-center bg-white/90 px-5 py-8 text-center",
				className,
			)}
		>
			<div className="relative mx-auto flex w-full max-w-md flex-col items-center">
				<div className="absolute -top-6 h-40 w-40 rotate-45 rounded-[28px] border border-primary/20 bg-primary/10" />
				<motion.div
					animate={{ y: [0, -8, 0], rotate: [0, 2, -2, 0] }}
					transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
					className="relative flex h-24 w-24 items-center justify-center rounded-lg border border-secondary/20 bg-secondary/10 text-secondary shadow-sm"
				>
					<Icon className="h-10 w-10 text-secondary" />
					<Sparkles className="absolute -right-3 -top-3 h-6 w-6 text-accent" />
				</motion.div>

				<div className="mt-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
					<span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_14px_rgba(247,153,69,.65)]" />
					{statusLabel ?? resolved.statusLabel}
				</div>

				<h2 className="mt-4 text-3xl font-black tracking-normal text-slate-950">
					{title ?? resolved.title}
				</h2>
				<p className="mt-3 text-base font-medium leading-7 text-slate-600">
					{message ?? resolved.message}
				</p>

				<div className="mt-8 grid w-full grid-cols-3 gap-3">
					{[0, 1, 2].map((item) => (
						<motion.div
							key={item}
							className="h-20 rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-100 p-2"
							animate={{ y: [0, -6, 0] }}
							transition={{
								duration: 1.8,
								repeat: Infinity,
								delay: item * 0.18,
								ease: "easeInOut",
							}}
						>
							<div className="h-full rounded-md bg-gradient-to-br from-primary/20 via-white to-secondary/20" />
						</motion.div>
					))}
				</div>
			</div>
		</ParticipantStage>
	);
}
