"use client";

import { useCallback } from "react";
import { AlertCircle, HelpCircle } from "lucide-react";
import type { Deck, Slide, SlidePatch } from "@/features/deck/types";
import { getSlideType } from "../../slideRegistry";
import type { OptionsApi, SlideMediaApi } from "../../slides/types";
import { SlideErrorBoundary } from "../SlidePreview";

export interface ContentTabProps {
	slide: Slide;
	deck: Deck;
	errors?: Record<string, string[]>;
	onPatch(slideId: number, patch: SlidePatch): void;
	options: OptionsApi;
	media: SlideMediaApi;
}

/** The slide type's own Editor (plan §5.4), wired to autosave. */
export function ContentTab({ slide, deck, errors, onPatch, options, media }: ContentTabProps) {
	const entry = getSlideType(slide.type);
	const slideId = slide.id;
	const onChange = useCallback((patch: SlidePatch) => onPatch(slideId, patch), [onPatch, slideId]);
	const messages = Object.values(errors ?? {}).flat();

	if (!entry) {
		return (
			<p className="flex items-start gap-2 text-sm text-dark-5 dark:text-dark-6">
				<HelpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
				This slide type (“{slide.type}”) can&apos;t be edited here.
			</p>
		);
	}

	const Editor = entry.Editor;
	const Icon = entry.icon;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start gap-3">
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700 dark:bg-dark-3 dark:text-primary-light">
					<Icon className="h-4 w-4" aria-hidden />
				</span>
				<div className="min-w-0">
					<p className="text-sm font-semibold text-dark dark:text-white">{entry.label}</p>
					<p className="text-xs text-dark-5 dark:text-dark-6">{entry.description}</p>
				</div>
			</div>

			{/* One summary line; type Editors also show each error next to its field. */}
			{messages.length > 0 ? (
				<p role="alert" className="flex items-start gap-2 rounded-lg border border-red-light-3 bg-red-light-5 px-3 py-2 text-sm text-[#B42318] dark:border-red-dark dark:bg-transparent dark:text-red-light">
					<AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
					<span>Not saved: {messages[0]}</span>
				</p>
			) : null}

			<SlideErrorBoundary resetKey={slide.id}>
				<Editor key={slide.id} slide={slide} deck={deck} onChange={onChange} onOptionsChange={options} media={media} errors={errors} />
			</SlideErrorBoundary>
		</div>
	);
}
