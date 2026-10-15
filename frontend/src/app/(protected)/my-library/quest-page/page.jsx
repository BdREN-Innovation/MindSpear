import NewQuest from "@/features/dashboard/components/Library/NewQuest";
import { QuestV2LibrarySection } from "@/features/deck-editor/components/library/QuestV2LibrarySection";

function QuestPage() {
	return (
		<div className="min-h-screen">
			{/* Quest v2 decks (only while the user's quest_v2_enabled flag is on), then legacy quests. */}
			<QuestV2LibrarySection />
			<NewQuest />
		</div>
	);
}

export default QuestPage;
