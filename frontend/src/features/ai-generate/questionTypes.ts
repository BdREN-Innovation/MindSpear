import {
	ArrowDownNarrowWide,
	ArrowUpDown,
	Brackets,
	CircleCheckBig,
	CircleDot,
	Cloud,
	Coins,
	Columns3,
	Grid2x2,
	Link2,
	ListChecks,
	MessageSquareText,
	SlidersHorizontal,
	SquareDashedMousePointer,
	Star,
	TextCursorInput,
	ToggleRight,
	type LucideIcon,
} from "lucide-react";
import type { GenerationTarget } from "./types";

// The kinds of item the AI can write for each target. Quiz and quest types use
// the label, icon and order of the editor's slide picker (deck-editor/slides/*/
// index.ts), so people recognise them; the registry itself isn't imported, as
// it would pull every slide editor into the pages that only generate.

export interface QuestionTypeOption {
	value: string;
	label: string;
	icon: LucideIcon;
	hint?: string;
	/** The AI server types this choice asks for (default: just `value`). */
	aiTypes?: string[];
}

export const QUESTION_TYPES: Record<GenerationTarget, QuestionTypeOption[]> = {
	quiz: [
		// One slide type takes one or several correct answers; the AI writes both kinds.
		{ value: "pick_answer_single", label: "Pick answer", icon: CircleCheckBig, hint: "One or several correct answers", aiTypes: ["pick_answer_single", "pick_answer_multi"] },
		{ value: "true_false", label: "True or false", icon: ToggleRight },
		{ value: "short_answer", label: "Short answer", icon: TextCursorInput, hint: "Typed answer, up to 5 accepted spellings" },
		{ value: "fill_blanks", label: "Fill in the blanks", icon: Brackets, hint: "Players type the missing words" },
		{ value: "drag_drop", label: "Drag and drop", icon: SquareDashedMousePointer, hint: "Players drag words into the blanks" },
		{ value: "match_pairs", label: "Match pairs", icon: Link2 },
		{ value: "correct_order", label: "Correct order", icon: ArrowUpDown },
		{ value: "categorise", label: "Categorise", icon: Columns3 },
	],
	quest: [
		{ value: "poll_single", label: "Multiple choice", icon: CircleDot, hint: "Includes yes / no questions" },
		{ value: "poll_multi", label: "Multiple select", icon: ListChecks },
		{ value: "word_cloud", label: "Word cloud", icon: Cloud },
		{ value: "open_ended", label: "Open ended", icon: MessageSquareText },
		{ value: "scales", label: "Scales", icon: SlidersHorizontal, hint: "Rate statements" },
		{ value: "ranking", label: "Ranking", icon: ArrowDownNarrowWide },
		{ value: "points_allocation", label: "100 points", icon: Coins, hint: "Share 100 points between items" },
		{ value: "rating", label: "Rating", icon: Star, hint: "Star-rate items" },
		{ value: "matrix_2x2", label: "2×2 matrix", icon: Grid2x2, hint: "Place a dot on two scales" },
	],
	fungame: [
		{ value: "single_choice", label: "Multiple choice", icon: CircleCheckBig, hint: "One correct answer" },
		{ value: "true_false", label: "True or false", icon: ToggleRight },
	],
};

export const DEFAULT_TYPES: Record<GenerationTarget, string[]> = {
	quiz: QUESTION_TYPES.quiz.map((type) => type.value),
	quest: ["poll_single", "poll_multi", "word_cloud", "open_ended"],
	fungame: ["single_choice", "true_false"],
};

/** The AI server types for the chosen options, once each. */
export function aiTypesFor(target: GenerationTarget, chosen: string[]): string[] {
	const options = new Map(QUESTION_TYPES[target].map((type) => [type.value, type]));
	return [...new Set(chosen.flatMap((value) => options.get(value)?.aiTypes ?? [value]))];
}
