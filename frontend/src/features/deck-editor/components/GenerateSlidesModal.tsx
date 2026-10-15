"use client";

import { DocumentToQuestionsModal } from "@/features/ai-generate/components/DocumentToQuestionsWizard";
import { toQuestSlidesBulk } from "@/features/ai-generate/mappers";
import type { GeneratedFor } from "@/features/ai-generate/types";
import type { BulkSlidesInput, Slide } from "@/features/deck/types";

export interface GenerateSlidesModalProps {
	open: boolean;
	onClose(): void;
	/** Slides are inserted after this position (the current slide); null = at the end. */
	afterPosition: number | null;
	/** Saves through POST .../slides/bulk; throw to keep the wizard open with the message. */
	onAddSlides(input: BulkSlidesInput): Promise<Slide[]>;
	onAdded?(slides: Slide[]): void;
}

/** §5.7: the document-to-AI wizard (target quest_v2), appending the generated slides atomically. */
export function GenerateSlidesModal({ open, onClose, afterPosition, onAddSlides, onAdded }: GenerateSlidesModalProps) {
	const save = async (result: GeneratedFor<"quest_v2">) => {
		const body = toQuestSlidesBulk(result.questions, afterPosition);
		if (body.slides.length === 0) throw new Error("The AI didn't write any usable slides. Try other pages or a clearer topic.");
		const slides = await onAddSlides(body);
		onAdded?.(slides);
		onClose();
	};

	return (
		<DocumentToQuestionsModal
			open={open}
			onClose={onClose}
			title="Generate slides from a document"
			target="quest_v2"
			generateLabel="Generate slides"
			onGenerated={save}
		/>
	);
}
