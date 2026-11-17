import Title from "@/components/ui/Title";
import { DeckDiscoverSection } from "@/features/deck-library/DeckDiscoverSection";

export default function DiscoverQuestsPage() {
	return (
		<div className="min-h-screen">
			<Title as="h2">Discover Quests</Title>
			<DeckDiscoverSection product="quest" />
		</div>
	);
}
