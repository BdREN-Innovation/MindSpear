"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { RadioTower, ShieldCheck, Trophy, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

/** Where the session is, for the status line in the header. */
export type ShellSessionStatus = "pending" | "started" | "ended";

type ParticipantShellProps = {
	children: React.ReactNode;
	variant: "quiz" | "quest";
	/** Badge text; defaults to the variant name. */
	label?: string;
	title?: string | null;
	participantName?: string | null;
	sessionStatus?: ShellSessionStatus;
	rightSlot?: React.ReactNode;
	className?: string;
	contentClassName?: string;
};

const statusCopy: Record<ShellSessionStatus, string> = {
	pending: "Lobby",
	started: "Live",
	ended: "Complete",
};

function ArcadeBackground() {
	const reduceMotion = useReducedMotion();
	const floatTransition = reduceMotion
		? undefined
		: {
				duration: 9,
				repeat: Infinity,
				repeatType: "mirror" as const,
				ease: "easeInOut" as const,
			};

	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			<div
				className="absolute inset-0"
				style={{
					background:
						"linear-gradient(135deg, #FFF5EB 0%, #FFFFFF 42%, #FBF0FA 100%)",
				}}
			/>
			<div
				className="absolute inset-0 opacity-60"
				style={{
					backgroundImage:
						"linear-gradient(rgba(247,153,69,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(188,94,179,.10) 1px, transparent 1px)",
					backgroundSize: "34px 34px",
					maskImage:
						"linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)",
				}}
			/>
			<motion.div
				className="absolute -left-20 top-20 h-44 w-[36rem] rotate-[-18deg] bg-primary/10 blur-[1px]"
				animate={reduceMotion ? undefined : { x: [0, 42], opacity: [0.14, 0.28] }}
				transition={floatTransition}
			/>
			<motion.div
				className="absolute -right-24 bottom-24 h-56 w-[40rem] rotate-[-22deg] bg-secondary/10 blur-[1px]"
				animate={reduceMotion ? undefined : { x: [0, -36], opacity: [0.12, 0.26] }}
				transition={floatTransition}
			/>
			{[0, 1, 2, 3, 4, 5].map((item) => (
				<motion.span
					key={item}
					className="absolute h-3 w-3 rotate-45 rounded-[2px] border border-primary/20 bg-white/70"
					style={{
						left: `${12 + item * 15}%`,
						top: `${18 + (item % 3) * 22}%`,
					}}
					animate={
						reduceMotion
							? undefined
							: {
									y: [0, item % 2 ? -12 : 12],
									opacity: [0.24, 0.7],
								}
					}
					transition={{
						duration: 3 + item * 0.4,
						repeat: Infinity,
						repeatType: "mirror",
						ease: "easeInOut",
					}}
				/>
			))}
			<div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-white/70 to-transparent" />
		</div>
	);
}

export function ParticipantShell({
	children,
	variant,
	label,
	title,
	participantName,
	sessionStatus = "pending",
	rightSlot,
	className,
	contentClassName,
}: ParticipantShellProps) {
	const status = statusCopy[sessionStatus] ?? "Live";
	const Icon = variant === "quest" ? ShieldCheck : Trophy;

	return (
		<section
			className={cn(
				"relative isolate min-h-[100dvh] overflow-hidden text-slate-950",
				className,
			)}
		>
			<ArcadeBackground />
			<div className="relative z-10 flex min-h-[100dvh] flex-col px-4 pb-4 pt-3 sm:px-6 lg:px-8">
				<header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-xl">
					<Link href="/" className="flex shrink-0 items-center rounded-md bg-white px-2 py-1">
						<Image
							src="/images/logo/logo.svg"
							alt="MindSpear"
							width={136}
							height={32}
							priority
							className="h-7 w-auto"
						/>
					</Link>

					<div className="min-w-0 flex-1 px-1 text-center">
						<div className="mx-auto inline-flex max-w-full items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold uppercase text-primary">
							<Icon className="h-3.5 w-3.5 text-secondary" />
							<span className="truncate">{label ?? variant}</span>
							<span className="h-1 w-1 rounded-full bg-secondary" />
							<span className="truncate">{status}</span>
						</div>
						{title ? (
							<p className="mt-1 truncate text-xs font-medium text-slate-500 sm:text-sm">
								{title}
							</p>
						) : null}
					</div>

					<div className="flex shrink-0 items-center justify-end gap-2">
						{rightSlot ?? (
							<div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-800 sm:flex">
								<UserRound className="h-4 w-4 text-primary" />
								<span className="max-w-32 truncate">
									{participantName || "Player"}
								</span>
							</div>
						)}
						<div className="flex h-9 w-9 items-center justify-center rounded-md border border-secondary/20 bg-secondary/10">
							<RadioTower className="h-4 w-4 text-secondary" />
						</div>
					</div>
				</header>

				<main
					className={cn(
						"mx-auto flex w-full max-w-6xl flex-1 flex-col py-4 sm:py-6",
						contentClassName,
					)}
				>
					{children}
				</main>
			</div>
		</section>
	);
}
