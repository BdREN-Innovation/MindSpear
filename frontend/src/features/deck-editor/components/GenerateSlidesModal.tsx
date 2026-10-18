"use client";

import { DocumentToQuestionsModal } from "@/features/ai-generate/components/DocumentToQuestionsWizard";
import { toQuestSlidesBulk, toQuizSlidesBulk } from "@/features/ai-generate/mappers";
import type { GeneratedFor } from "@/features/ai-generate/types";
import type { BulkSlidesInput, DeckProduct, Slide } from "@/features/deck/types";

export interface GenerateSlidesModalProps {
	open: boolean;
	/** quest: target quest_v2 (poll / word cloud / open-ended slides); quiz: target quiz_v2 (scored slides). Default quest. */
	product?: DeckProduct;
	onClose(): void;
	/** Slides are inserted after this position (the current slide); null = at the end. */
	afterPosition: number | null;
	/** Saves through the product's POST .../slides/bulk (the editor's API); throw to keep the wizard open with the message. */
	onAddSlides(input: BulkSlidesInput): Promise<Slide[]>;
	onAdded?(slides: Slide[]): void;
}

const NOTHING_USABLE = "The AI didn't write any usable slides. Try other pages or a clearer topic.";
const NOTHING_USABLE_QUIZ = "The AI didn't write any usable questions. Try other pages or a clearer topic.";

/**
 * §5.7: the document-to-AI wizard, appending the generated slides atomically.
 * Quest decks use target quest_v2 (toQuestSlidesBulk); quiz decks quiz_v2
 * (toQuizSlidesBulk: scored slides with correct answers). Both save through
 * onAddSlides, i.e. the editor's own authoring API (/quests/v2 or /quizzes).
 */
export function GenerateSlidesModal({ open, product = "quest", onClose, afterPosition, onAddSlides, onAdded }: GenerateSlidesModalProps) {
	const add = async (body: BulkSlidesInput, emptyMessage: string) => {
		if (body.slides.length === 0) throw new Error(emptyMessage);
		const slides = await onAddSlides(body);
		onAdded?.(slides);
		onClose();
	};

	if (product === "quiz") {
		return (
			<DocumentToQuestionsModal
				open={open}
				onClose={onClose}
				title="Generate quiz questions from a document"
				target="quiz_v2"
				generateLabel="Generate questions"
				onGenerated={(result: GeneratedFor<"quiz_v2">) =>
					add(toQuizSlidesBulk(result.questions, afterPosition), NOTHING_USABLE_QUIZ)
				}
			/>
		);
	}

	return (
		<DocumentToQuestionsModal
			open={open}
			onClose={onClose}
			title="Generate slides from a document"
			target="quest_v2"
			generateLabel="Generate slides"
			onGenerated={(result: GeneratedFor<"quest_v2">) => add(toQuestSlidesBulk(result.questions, afterPosition), NOTHING_USABLE)}
		/>
	);
}
