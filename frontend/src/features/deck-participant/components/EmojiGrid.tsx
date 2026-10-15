"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { emojiLabel } from "@/features/deck/api/metaApi";
import type { EmojiAvatarMeta } from "@/features/deck/types";
import { TapFeedback } from "../shell";

// The curated avatar emoji as a 5-column radio grid (plan §4.5). Arrow keys
// move through the grid like a native radio group (roving tabindex).

const COLUMNS = 5;

export interface EmojiGridProps {
	meta: EmojiAvatarMeta;
	value: string | null;
	onChange: (emoji: string) => void;
	labelledBy?: string;
}

export function EmojiGrid({ meta, value, onChange, labelledBy }: EmojiGridProps) {
	const refs = useRef<(HTMLButtonElement | null)[]>([]);
	const selectedIndex = value ? meta.emojis.indexOf(value) : -1;
	const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;

	const move = (event: KeyboardEvent, index: number) => {
		const last = meta.emojis.length - 1;
		const next =
			event.key === "ArrowRight"
				? Math.min(last, index + 1)
				: event.key === "ArrowLeft"
					? Math.max(0, index - 1)
					: event.key === "ArrowDown"
						? Math.min(last, index + COLUMNS)
						: event.key === "ArrowUp"
							? Math.max(0, index - COLUMNS)
							: event.key === "Home"
								? 0
								: event.key === "End"
									? last
									: null;
		if (next === null) return;
		event.preventDefault();
		onChange(meta.emojis[next]);
		refs.current[next]?.focus();
	};

	return (
		<div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-5 gap-2 py-1">
			{meta.emojis.map((emoji, index) => {
				const selected = emoji === value;
				return (
					<TapFeedback
						key={emoji}
						ref={(element) => {
							refs.current[index] = element;
						}}
						role="radio"
						aria-checked={selected}
						aria-label={emojiLabel(meta, emoji)}
						tabIndex={index === focusIndex ? 0 : -1}
						onClick={() => onChange(emoji)}
						onKeyDown={(event) => move(event, index)}
						pressScale={0.88}
						className={cn(
							"flex aspect-square min-h-12 items-center justify-center rounded-2xl border-2 text-[32px] leading-none transition-colors",
							selected
								? "border-[var(--deck-primary)] bg-[color-mix(in_srgb,var(--deck-primary)_16%,var(--deck-surface))]"
								: "border-transparent bg-[var(--deck-surface-muted)] hover:border-[var(--deck-border)]"
						)}
					>
						<span aria-hidden>{emoji}</span>
					</TapFeedback>
				);
			})}
		</div>
	);
}
