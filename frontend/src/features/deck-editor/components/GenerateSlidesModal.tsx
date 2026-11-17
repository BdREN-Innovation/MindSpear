"use client";

import { DocumentToQuestionsModal } from "@/features/ai-generate/components/DocumentToQuestionsWizard";
import { toDeckSlidesBulk } from "@/features/ai-generate/mappers";
import { TARGET_NOUN } from "@/features/ai-generate/types";
import type { BulkSlidesInput, DeckProduct, Slide } from "@/features/deck/types";

export interface GenerateSlidesModalProps {
	open: boolean;
	/** quiz: scored slides with correct answers; quest: poll / word cloud / open-ended slides. */
	product: DeckProduct;
	onClose(): void;
	/** Slides are inserted after this position (the current slide); null = at the end. */
	afterPosition: number | null;
	/** Saves through the product's POST .../slides/bulk (the editor's API); throw to keep the wizard open with the message. */
	onAddSlides(input: BulkSlidesInput): Promise<Slide[]>;
	onAdded?(slides: Slide[]): void;
}

/**
 * §5.7: the document-to-AI wizard for the open deck, appending the generated
 * slides atomically through onAddSlides (the editor's own authoring API).
 */
export function GenerateSlidesModal({ open, product, onClose, afterPosition, onAddSlides, onAdded }: GenerateSlidesModalProps) {
	const noun = TARGET_NOUN[product];

	return (
		<DocumentToQuestionsModal
			open={open}
			onClose={onClose}
			title={`Generate ${product === "quiz" ? "quiz questions" : "slides"} from a document`}
			target={product}
			generateLabel={`Generate ${noun.plural}`}
			onGenerated={async (result) => {
				const body = toDeckSlidesBulk(result, afterPosition);
				if (body.slides.length === 0) {
					throw new Error(`The AI didn't write any usable ${noun.plural}. Try other pages or a clearer topic.`);
				}
				const slides = await onAddSlides(body);
				onAdded?.(slides);
				onClose();
			}}
		/>
	);
}
