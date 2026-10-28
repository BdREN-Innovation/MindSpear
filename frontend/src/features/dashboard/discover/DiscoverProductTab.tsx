"use client";

import { useDeckV2Enabled } from "@/features/deck/api/featureFlags";
import type { DeckProduct } from "@/features/deck/types";
import DeckDiscoverSection from "./DeckDiscoverSection";
import QuestTab from "./QuestTab";
import QuizTab from "./QuizTab";

// Discover > Quiz / Quest. With the product's v2 on: the public v2 decks,
// then any public v1 ones under "Classic". Without it: the v1 list only
// (a v2 copy would open an editor the account cannot use).
export default function DiscoverProductTab({ product }: { product: DeckProduct }) {
	const { enabled } = useDeckV2Enabled(product);
	const Legacy = product === "quiz" ? QuizTab : QuestTab;

	if (enabled === null) return null;
	if (!enabled) return <Legacy />;

	return (
		<>
			<DeckDiscoverSection product={product} />
			<Legacy legacy />
		</>
	);
}
