"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { PanelRightClose, PanelRightOpen, Palette, PencilLine, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Deck, DeckProduct, DeckSettingsPatch, Slide, SlidePatch } from "@/features/deck/types";
import type { OptionsApi, SlideMediaApi } from "../slides/types";
import { ContentTab } from "./inspector/ContentTab";
import { DesignTab } from "./inspector/DesignTab";
import { ToggleField } from "../slides/shared";
import { SettingsTab } from "./inspector/SettingsTab";

type Tab = "content" | "design" | "settings";

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
	{ key: "content", label: "Content", icon: PencilLine },
	{ key: "design", label: "Design", icon: Palette },
	{ key: "settings", label: "Settings", icon: SlidersHorizontal },
];

const railButton =
	"flex h-11 w-11 items-center justify-center rounded-lg text-dark-5 transition hover:bg-gray-2 hover:text-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 dark:text-dark-6 dark:hover:bg-dark-2 dark:hover:text-white";

export interface InspectorPanelProps {
	/** Quiz decks get the scoring fields on the Settings tab. Default: the deck's product. */
	product?: DeckProduct;
	deck: Deck;
	slide: Slide | null;
	errors?: Record<string, string[]>;
	onPatch(slideId: number, patch: SlidePatch, options?: { immediate?: boolean }): void;
	options: OptionsApi | null;
	media: SlideMediaApi | null;
	onUpdateSettings(patch: DeckSettingsPatch): Promise<void>;
	onOpenDeckSettings(): void;
	/** Quiz: whether a Leaderboard slide follows the selected slide, and the switch for it. */
	leaderboardAfter?: { on: boolean; busy: boolean; onToggle(): void };
	/** Folded to a narrow rail, giving the canvas the room. */
	collapsed?: boolean;
	onToggleCollapsed?(): void;
}

/**
 * Right column: Content (type Editor) / Design (theme) / Settings (timer,
 * results, submissions; quiz: points). Collapsible to a rail of tab icons;
 * a tab icon opens the panel on that tab.
 */
export function InspectorPanel({
	product,
	deck,
	slide,
	errors,
	onPatch,
	options,
	media,
	onUpdateSettings,
	onOpenDeckSettings,
	leaderboardAfter,
	collapsed = false,
	onToggleCollapsed,
}: InspectorPanelProps) {
	const [tab, setTab] = useState<Tab>("content");
	const baseId = useId();
	const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

	// WAI-ARIA tabs: arrows move between tabs (automatic activation).
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		const index = TABS.findIndex((t) => t.key === tab);
		let next: number | null = null;
		if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
		else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = TABS.length - 1;
		if (next === null) return;
		event.preventDefault();
		const key = TABS[next].key;
		setTab(key);
		tabRefs.current[key]?.focus();
	};

	if (collapsed) {
		return (
			<aside
				data-deck-inspector
				aria-label="Slide inspector (collapsed)"
				className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-l border-stroke bg-white py-2 dark:border-stroke-dark dark:bg-gray-dark"
			>
				<button type="button" onClick={onToggleCollapsed} className={railButton} aria-label="Expand the inspector" title="Expand the inspector">
					<PanelRightOpen className="h-5 w-5" aria-hidden />
				</button>
				<span aria-hidden className="my-1 h-px w-8 bg-stroke dark:bg-stroke-dark" />
				{TABS.map(({ key, label, icon: Icon }) => (
					<button
						key={key}
						type="button"
						onClick={() => {
							setTab(key);
							onToggleCollapsed?.();
						}}
						className={cn(railButton, tab === key && "text-primary dark:text-primary")}
						aria-label={`Open ${label}`}
						title={label}
					>
						<Icon className="h-5 w-5" aria-hidden />
					</button>
				))}
			</aside>
		);
	}

	return (
		<aside
			// The shell's single-key shortcuts stay out of here (type editors own the keyboard).
			data-deck-inspector
			aria-label="Slide inspector"
			className="flex h-full w-[22rem] shrink-0 flex-col border-l border-stroke bg-white dark:border-stroke-dark dark:bg-gray-dark"
		>
			<div role="tablist" aria-label="Inspector" className="flex border-b border-stroke px-2 dark:border-stroke-dark">
				{TABS.map(({ key, label }) => (
					<button
						key={key}
						ref={(element) => {
							tabRefs.current[key] = element;
						}}
						type="button"
						role="tab"
						id={`${baseId}-tab-${key}`}
						aria-selected={tab === key}
						aria-controls={`${baseId}-panel-${key}`}
						tabIndex={tab === key ? 0 : -1}
						onClick={() => setTab(key)}
						onKeyDown={onKeyDown}
						className={cn(
							"relative min-h-12 flex-1 px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600",
							tab === key
								? "text-dark after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary dark:text-white"
								: "text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white"
						)}
					>
						{label}
					</button>
				))}
				{onToggleCollapsed ? (
					<button
						type="button"
						onClick={onToggleCollapsed}
						className={cn(railButton, "my-0.5 shrink-0")}
						aria-label="Collapse the inspector"
						title="Collapse the inspector"
					>
						<PanelRightClose className="h-5 w-5" aria-hidden />
					</button>
				) : null}
			</div>

			<div
				role="tabpanel"
				id={`${baseId}-panel-${tab}`}
				aria-labelledby={`${baseId}-tab-${tab}`}
				tabIndex={0}
				className="min-h-0 flex-1 overflow-y-auto p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
			>
				{tab === "design" ? (
					<DesignTab deck={deck} onUpdateSettings={onUpdateSettings} onOpenDeckSettings={onOpenDeckSettings} />
				) : !slide || !options || !media ? (
					<p className="text-sm text-dark-5 dark:text-dark-6">Select a slide to edit it.</p>
				) : tab === "content" ? (
					<ContentTab slide={slide} deck={deck} errors={errors} onPatch={onPatch} options={options} media={media} />
				) : (
					<div className="flex flex-col gap-6">
						<SettingsTab slide={slide} deck={deck} product={product ?? deck.product} errors={errors} onPatch={onPatch} />
						{leaderboardAfter ? (
							<div className="border-t border-stroke pt-4 dark:border-stroke-dark">
								<ToggleField
									label="Show leaderboard after this slide"
									description="Adds a Leaderboard slide right after this one, so players see the scores so far. Same as the podium beside the slide."
									checked={leaderboardAfter.on}
									disabled={leaderboardAfter.busy}
									onChange={leaderboardAfter.onToggle}
								/>
							</div>
						) : null}
					</div>
				)}
			</div>
		</aside>
	);
}
