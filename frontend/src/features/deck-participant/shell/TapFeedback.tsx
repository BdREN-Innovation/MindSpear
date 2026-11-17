"use client";

import { forwardRef } from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { pulse, type HapticKind } from "./haptics";

// A button with a native-feeling press (scale-in spring) and an optional
// haptic pulse (plan §4.2 / §4.4). No press animation under reduced motion;
// the pulse itself is suppressed there too (haptics.ts).

export interface TapFeedbackProps extends HTMLMotionProps<"button"> {
	/** Haptic on press; false for none. Default 'tap' (10 ms). */
	haptic?: HapticKind | false;
	/** Scale while pressed (default 0.96). */
	pressScale?: number;
}

export const TapFeedback = forwardRef<HTMLButtonElement, TapFeedbackProps>(function TapFeedback(
	{ haptic = "tap", pressScale = 0.96, onClick, className, type = "button", disabled, ...rest },
	ref
) {
	const reduceMotion = useReducedMotion();
	return (
		<motion.button
			ref={ref}
			type={type}
			disabled={disabled}
			whileTap={reduceMotion || disabled ? undefined : { scale: pressScale }}
			transition={{ type: "spring", stiffness: 600, damping: 32 }}
			onClick={(event) => {
				if (haptic) pulse(haptic);
				onClick?.(event);
			}}
			className={cn("touch-manipulation select-none", className)}
			{...rest}
		/>
	);
});
