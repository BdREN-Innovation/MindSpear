import Title from "@/components/ui/Title";
import { DeckDiscoverSection } from "@/features/deck-library/DeckDiscoverSection";

export default function DiscoverQuizzesPage() {
	return (
		<div className="min-h-screen">
			<Title as="h2">Discover Quizzes</Title>
			<DeckDiscoverSection product="quiz" />
		</div>
	);
}
