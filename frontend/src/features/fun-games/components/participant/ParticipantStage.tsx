"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type ParticipantStageProps = {
	children: React.ReactNode;
	className?: string;
	size?: "narrow" | "wide" | "full";
};

const sizeClasses = {
	narrow: "max-w-2xl",
	wide: "max-w-4xl",
	full: "max-w-6xl",
};

export function ParticipantStage({
	children,
	className,
	size = "wide",
}: ParticipantStageProps) {
	return (
		<motion.div
			initial={{ opacity: 0, y: 18, scale: 0.98 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			transition={{ duration: 0.35, ease: "easeOut" }}
			className={cn(
				"mx-auto flex w-full flex-1 flex-col rounded-lg border border-white/20 bg-white/95 text-slate-950 shadow-2xl shadow-black/25 backdrop-blur-xl",
				"min-h-[calc(100dvh-7.75rem)] overflow-hidden sm:min-h-0",
				sizeClasses[size],
				className,
			)}
		>
			{children}
		</motion.div>
	);
}
