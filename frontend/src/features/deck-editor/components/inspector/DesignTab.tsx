"use client";

import { useState } from "react";
import { Check, Settings2 } from "lucide-react";
import { toast } from "react-toastify";
import { cn } from "@/lib/utils";
import { DECK_THEME_KEYS, DECK_THEMES, getDeckTheme, type DeckTheme } from "@/features/deck/theme";
import type { Deck, DeckSettingsPatch } from "@/features/deck/types";

export interface DesignTabProps {
	deck: Deck;
	onUpdateSettings(patch: DeckSettingsPatch): Promise<void>;
	onOpenDeckSettings(): void;
}

/** Small swatch of a palette: background, text and the first chart colours. */
export function ThemeSwatch({ theme, className }: { theme: DeckTheme; className?: string }) {
	const c = theme.colors;
	return (
		<span
			aria-hidden
			className={cn("flex aspect-video w-full flex-col justify-between overflow-hidden rounded-md p-2", className)}
			style={{ background: c.background, color: c.text, boxShadow: `inset 0 0 0 1px ${c.border}` }}
		>
			<span className="block h-1.5 w-3/5 rounded-full" style={{ background: c.text }} />
			<span className="flex items-end gap-1">
				{c.chart.slice(0, 4).map((color, index) => (
					<span key={color} className="block w-full rounded-sm" style={{ background: color, height: `${10 + ((index * 7) % 14)}px` }} />
				))}
			</span>
		</span>
	);
}

/** Theme picker (deck-wide: decks.settings.theme). */
export function ThemeGrid({ value, onChange, disabled }: { value: string; onChange(key: string): void; disabled?: boolean }) {
	const current = getDeckTheme(value).key;
	return (
		<div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2">
			{DECK_THEME_KEYS.map((key) => {
				const theme = DECK_THEMES[key];
				const selected = key === current;
				return (
					<button
						key={key}
						type="button"
						role="radio"
						aria-checked={selected}
						disabled={disabled}
						onClick={() => onChange(key)}
						className={cn(
							"relative flex flex-col gap-1.5 rounded-lg border-2 p-1.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:opacity-60 dark:focus-visible:ring-offset-dark",
							selected ? "border-primary" : "border-transparent hover:border-stroke dark:hover:border-stroke-dark"
						)}
					>
						<ThemeSwatch theme={theme} />
						<span className="flex items-center justify-between px-0.5 text-xs font-medium text-dark dark:text-white">
							{theme.label}
							{selected ? <Check className="h-3.5 w-3.5 text-primary-600" aria-hidden /> : null}
						</span>
					</button>
				);
			})}
		</div>
	);
}

export function DesignTab({ deck, onUpdateSettings, onOpenDeckSettings }: DesignTabProps) {
	const [saving, setSaving] = useState(false);

	const changeTheme = async (theme: string) => {
		if (theme === deck.settings.theme) return;
		setSaving(true);
		try {
			await onUpdateSettings({ theme });
		} catch (error) {
			toast.error((error as Error)?.message || "The theme could not be changed.");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h3 className="text-sm font-semibold text-dark dark:text-white">Theme</h3>
				<p className="mt-0.5 text-xs text-dark-5 dark:text-dark-6">
					Colours for every slide in this quest, on the big screen and on participants&apos; phones.
				</p>
			</div>
			<ThemeGrid value={deck.settings.theme} onChange={changeTheme} disabled={saving} />
			<button
				type="button"
				onClick={onOpenDeckSettings}
				className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stroke px-3 text-sm font-medium text-dark transition hover:bg-gray-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 dark:border-stroke-dark dark:text-white dark:hover:bg-dark-3"
			>
				<Settings2 className="h-4 w-4" aria-hidden />
				More quest settings
			</button>
		</div>
	);
}
