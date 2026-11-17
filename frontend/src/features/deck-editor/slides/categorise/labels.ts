import type { QuizCategory } from "@/features/deck/types";

/** A category's label, or "Category 2" when it has none (editor, big screen and phones alike). */
export function categoryName(category: Pick<QuizCategory, "label">, index: number): string {
	return category.label?.trim() || `Category ${index + 1}`;
}
