import NewQuiz from "@/features/dashboard/components/Library/NewQuiz";
import { QuizV2LibrarySection } from "./QuizV2LibrarySection";

function QuizPage() {
	return (
		<div className="min-h-screen">
			{/* Quiz v2 decks (only while the user's quiz_v2_enabled flag is on), then legacy quizzes. */}
			<QuizV2LibrarySection />
			<NewQuiz />
		</div>
	);
}

export default QuizPage;
