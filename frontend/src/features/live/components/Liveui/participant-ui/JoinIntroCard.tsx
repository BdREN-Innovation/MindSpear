"use client";

import { FormEvent } from "react";
import { Clock3, ListChecks, Loader2, Play, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { ParticipantStage } from "./ParticipantStage";

type JoinIntroCardProps = {
	module: "quiz" | "quest";
	title?: string | null;
	name: string;
	onNameChange: (value: string) => void;
	onSubmit: () => void;
	durationText?: string;
	countLabel?: string;
	isSubmitting?: boolean;
	className?: string;
};

export function JoinIntroCard({
	module,
	title,
	name,
	onNameChange,
	onSubmit,
	durationText,
	countLabel,
	isSubmitting = false,
	className,
}: JoinIntroCardProps) {
	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSubmit();
	};

	return (
		<ParticipantStage
			size="narrow"
			className={cn("justify-center px-4 py-6 sm:px-8", className)}
		>
			<form onSubmit={handleSubmit} className="mx-auto w-full max-w-lg">
				<div className="text-center">
					<div className="mx-auto flex h-20 w-20 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary shadow-sm">
						<Play className="h-9 w-9 fill-primary text-primary" />
					</div>
					<div className="mt-5 inline-flex rounded-full border border-secondary/20 bg-secondary/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-secondary">
						Live {module}
					</div>
					<h1 className="mt-3 break-words text-3xl font-black tracking-normal text-slate-950 sm:text-4xl">
						{title || `Join this ${module}`}
					</h1>
					<p className="mt-2 text-sm font-medium text-slate-600">
						Enter your name to join. The host starts the questions for everyone.
					</p>
				</div>

				<div className="mt-6 grid grid-cols-2 gap-3">
					<div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
						<div className="flex items-center gap-2 text-xs font-bold uppercase text-primary">
							<Clock3 className="h-4 w-4" />
							Open for
						</div>
						<p className="mt-1 text-sm font-black text-slate-950">
							{durationText || "Live now"}
						</p>
					</div>
					<div className="rounded-lg border border-secondary/20 bg-secondary/10 p-3">
						<div className="flex items-center gap-2 text-xs font-bold uppercase text-secondary">
							<ListChecks className="h-4 w-4" />
							Questions
						</div>
						<p className="mt-1 text-sm font-black text-slate-950">
							{countLabel || "Ready"}
						</p>
					</div>
				</div>

				<label className="mt-6 block">
					<span className="mb-2 flex items-center gap-2 text-sm font-black text-slate-800">
						<UserRound className="h-4 w-4 text-primary" />
						Player name
					</span>
					<input
						value={name}
						onChange={(event) => onNameChange(event.target.value)}
						placeholder="Enter your name"
						className="h-14 w-full rounded-lg border border-slate-300 bg-white px-4 text-base font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/15"
					/>
				</label>

				<button
					type="submit"
					disabled={isSubmitting || !name.trim()}
					className="group relative mt-4 inline-flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded bg-gradient-to-r from-primary via-secondary to-accent px-6 text-base font-bold text-white shadow-lg shadow-primary/25 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<span className="absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-18deg] bg-white/25 transition duration-700 group-hover:left-[120%]" />
					{isSubmitting ? (
						<Loader2 className="h-5 w-5 animate-spin" />
					) : (
						<Play className="h-5 w-5 fill-white" />
					)}
					Join live {module}
				</button>
			</form>
		</ParticipantStage>
	);
}
