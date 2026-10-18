// utils/quizUtils.ts
import {
	QuizItem,
	FinalData,
	TransformedQuestion,
	ApiQuestion,
	TransformedQuestionData,
} from "@/types/types";

function getQuestionType(
	key: string,
	isMultiple: boolean
): TransformedQuestion["question_type"] {
	console.log(isMultiple, key, "isMultipleisMultipleisMultipleisMultiple");

	if (key === "quiz") {
		return isMultiple ? "quiz_multiple_choice" : "quiz_single_choice";
	}
	if (key === "fillintheblanks") {
		return isMultiple
			? "fill_in_the_blanks_multiple_choice"
			: "fill_in_the_blanks_choice";
	}
	if (key === "truefalse") return "true_false_choice";
	if (key === "sortanswer") return "sort_answer_choice";
	return "quiz_single_choice";
}

export function convertDataToQuestions(data: QuizItem[]): FinalData {
	// time_limit_seconds   timeLimit

	const questions: TransformedQuestion[] = data.map((item) => {
		const questionType = getQuestionType(
			item.key,
			item.isMultipleSelection
		);
		const choices = item.options.map((opt) => opt.text || "");
		const color = item.options.map((opt) => opt.color || "");

		let correct_answer: number | number[];

		if (questionType === "sort_answer_choice") {
			correct_answer = item.options.map((_, index) => index);
		} else {
			const correctIndexes = item.options
				.map((opt, idx) => (opt.isSelected ? idx : -1))
				.filter((i) => i !== -1);

			correct_answer =
				questionType === "quiz_multiple_choice" ||
				questionType === "fill_in_the_blanks_multiple_choice"
					? correctIndexes
					: correctIndexes[0];
		}
	

		return {
			quiz_id: Number(item.quiz_id),
			question_text: item.title,
			question_id: item.id,
			// Save what the editor shows: its Points / Time limit selects fall back to "Single Points" / 30 seconds
			// (a missing value used to be stored as null, and null points score 0).
			points: item.points || "1",
			id: Number(item.id),
			visibility: "private",
			question_type: questionType,
			serial_number: item?.position,
			// null (not undefined, which JSON drops) so a removed image is cleared on the server.
			source_content_url: item?.source_content_url || null,
			source_image_id: item?.source_image_id,
			time_limit_seconds: item?.timeLimit || "30",
			options: {
				choices,
				correct_answer,
				color,
			},
		};
	});
	console.log(questions, "data");
	return { questions };
}

export function transformQuestionData(
	apiData: ApiQuestion[]
): TransformedQuestionData[] {
console.log(apiData, "response?.data.data.questions");

	return apiData
	.filter((question) => question.options !== null)
	.map((question) => {
			const keyMap: Record<string, string> = {
				quiz_single_choice: "quiz",
				single_choice: "quiz",
				multiple_choice: "quiz",
				quiz_multiple_choice: "quiz",
				true_false_choice: "truefalse",
				true_false: "truefalse",
				sort_answer_choice: "sortanswer",
				sort_answer: "sortanswer",
				short_answer: "sortanswer",
				fill_in_the_blanks_choice: "fillintheblanks",
				fill_in_the_blanks_multiple_choice: "fillintheblanks",
				fill_in_the_blanks: "fillintheblanks",
			};
			
			console.log(question.points, "transformedDatatransformedDatatransformedData");
			

			const key = keyMap[question.question_type] || "";
			const choices = question.options?.choices ?? [];
			const colors = question.options?.color ?? [
				"#F79945",
				"#BC5EB3",
				"#5769e7",
				"#89c6c7",
			];
			const correctAnswer = question.options?.correct_answer;

			const options = choices.map(
				(choice: string | null, index: number) => ({
					id: (index + 1).toString(),
					text: choice || "",
					placeholder:
						index < 2
							? `Add answer ${index + 1}`
							: `Add answer ${index + 1} (optional)`,
					color: colors[index],
					isSelected: Array.isArray(correctAnswer)
						? correctAnswer.includes(index)
						: correctAnswer === index,
				})
			);

			while (options.length < 4 && options.length < colors.length) {
				options.push({
					id: (options.length + 1).toString(),
					text: "",
					placeholder:
						options.length < 2
							? `Add answer ${options.length + 1}`
							: `Add answer ${options.length + 1} (optional)`,
					color: colors[options.length],
					isSelected: false,
				});
			}
			
			return {
				key,
				id: question.id?.toString() ?? "",
				title: question.question_text ?? "",
				points: `${question.points}` !== 'undefined' && `${question.points}` !== 'null' ? `${question.points}` : "1",
				options,
				maxOptions: 0,
				minOptions: 0,
				position: question.serial_number || 1,
				allowDuplicates: false,
				isMultipleSelection:
					question.question_type === "quiz_multiple_choice" ||
					question.question_type === "fill_in_the_blanks_multiple_choice" || 
					question.question_type === "multiple_choice",
				timeLimit: question.time_limit_seconds?.toString() ?? "",
				quiz_id: question.quiz_id?.toString() ?? "",
				source_content_url: question.source_content_url ?? "",
				open_datetime: question.open_datetime ?? "",
				close_datetime: question.close_datetime ?? "",
			};
		});
}