/* eslint-disable @typescript-eslint/no-explicit-any */
// import { QuizItem } from '@/types/types';
interface Option {
	id: string;
	text: string;
	placeholder: string;
	color: string;
	isSelected: boolean;
}

interface InputQuestionData {
	maxText: any;
	minText: any;
	minNumber: number | undefined;
	maxNumber: number | undefined;
	key: string;
	id: number;
	title: string;
	options: Option[];
	maxOptions: number;
	minOptions: number;
	position: number;
	allowDuplicates: boolean;
	isMultipleSelection: boolean;
	timeLimit: string;
	quiz_id: string;
	task_data: any;
	contant_title?: any;
	image_url?: any;
	layout_id?: any;
}

interface OutputQuestion {
	id: number;
	text: string;
	color: string;
}

interface OutputTaskData {
	time_limit: number;
	questions: OutputQuestion[];
	minText?: any;
	maxText?: number;
	maxNumber?: number;
	minNumber?: number;
	contant_title: any;
	image_url: any;
	layout_id: any;
}

interface OutputQuestTask {
	quest_id: string;
	title: string;
	description: string;
	task_type: string;
	serial_number: number;
	task_data: OutputTaskData;
	updated_at: string;
	created_at: string;
	id: number;
	maxNumber?: number;
	minNumber?: number;
	minText?: any;
	maxText?: any;
}

// Input data types
interface QuestionOption {
	id: number;
	text: string;
	color: string;
}

interface TaskData {
	questions: QuestionOption[];
	time_limit: number;
}

interface InputTask {
	id: number;
	quest_id: number;
	title: string;
	description: string | null;
	task_type: string;
	serial_number: number;
	task_data: TaskData;
	is_required: boolean;
	created_at: string;
	updated_at: string;
}

// Output data types
interface OutputOption {
	id: string;
	text: string;
	placeholder: string;
	color: string;
	isSelected: boolean;
}

interface OutputTask {
	key: string;
	id: string;
	title: string;
	points: string;
	options: OutputOption[];
	maxOptions: number;
	minOptions: number;
	position: number;
	allowDuplicates: boolean;
	isMultipleSelection: boolean;
	timeLimit: string;
	quiz_id: string;
	source_content_url: string;
	open_datetime: string;
	close_datetime: string;
	contant_title?: string;
	image_url?: string;
	layout_id?: string;
}

export function QuestConvertDataComponent(
	input: InputQuestionData | InputQuestionData[]
): { tasks: OutputQuestTask[] } {
	const currentTimestamp = new Date()
		.toISOString()
		.replace(/\.\d+Z$/, ".000000Z");

	const processSingleItem = (item: InputQuestionData): OutputQuestTask => {

		return {
			quest_id: item?.quiz_id,
			title: item?.title || "Untitled question",
			description: "",
			task_type:
				item?.key === "qsenchoice"
					? item?.isMultipleSelection
						? "multiple_choice"
						: "single_choice"
					: item?.key,
			serial_number: item?.position,
			task_data: {
				time_limit: item?.timeLimit ? parseInt(item.timeLimit) : 30,
				// Only answers the host typed. Empty ones used to be saved with their placeholder, so
				// players saw "Option 3" as a choice and "Item 1" as a suggested short answer.
				// A loaded quick form keeps its fields in task_data (its options are empty); without this,
				// saving the quest without opening the quick form wiped them.
				questions:
					item?.key === "quick_form"
						? ((item as any)?.task_data?.questions ?? []).map((question: any) => ({
								...question,
								options: (question.options ?? []).filter((option: any) => `${option?.text ?? ""}`.trim() !== ""),
							}))
						: (item?.options ?? [])
								.filter((option) => `${option?.text ?? ""}`.trim() !== "")
								.map((option) => ({
									id: parseInt(option?.id),
									text: `${option?.text}`.trim(),
									color: option?.color,
								})),
				minNumber:
					item?.key === "scales"
						? item?.task_data?.minNumber || 1
						: 0,
				maxNumber:
					item?.key === "scales"
						? item?.task_data?.maxNumber || 5
						: 0,
				// The low end is "disagree", as the editor shows (these defaults were the other way round).
				minText:
					item?.key === "scales"
						? item?.task_data?.minText || "Strongly disagree"
						: "Strongly disagree",
				maxText:
					item?.key === "scales"
						? item?.task_data?.maxText || "Strongly agree"
						: "Strongly agree",
				contant_title: item?.contant_title,
				image_url: item?.image_url,
				layout_id: item?.layout_id,
			},
			updated_at: currentTimestamp,
			created_at: currentTimestamp,
			id: item.id,
		};
	};

	const items = (Array.isArray(input) ? input : [input]).map((item) => ({
		...item,
		id: typeof item.id === "string" ? parseInt(item.id) : item.id,
	}));

	return {
		tasks: items.map(processSingleItem),
	};
}

export function convertTaskData(inputData: InputTask[]): OutputTask[] {
	// console.log(inputData, "inputDatainputDatainputDatainputData");

	return inputData.map((task: any) => {
		// Determine key
		let key: string;
		switch (task.task_type) {
			case "single_choice":
			case "multiple_choice":
				key = "qsenchoice";
				break;
			case "quick_form":
				key = "quick_form";
				break;
			default:
				key = task.task_type;
		}

		if (task.task_type === "quick_form") {
			const questions = (task.task_data?.questions ?? []).map(
				(q: any, idx: number) => {
					if (q && ("type" in q || "label" in q || "options" in q)) {
						return {
							id: String(q.id),
							type: q.type,
							label: q.label ?? "",
							options: (q.options ?? []).map((opt: any) => ({
								id: String(opt.id),
								text: opt.text ?? "",
							})),
							serial_number: String(q.serial_number ?? idx + 1),
						};
					}

					return {
						id: String(q.id),
						type: "short-answer",
						label: q.text ?? "",
						options: [],
						serial_number: String(idx + 1),
					};
				}
			);

			const timeLimitNum = task?.task_data?.time_limit ?? 0;

			return {
				key,
				id: String(task.id),
				title: task.title,
				points: "1",
				task_data: {
					questions,
					time_limit: timeLimitNum,
				},

				options: [],

				maxOptions: 0,
				minOptions: 0,
				position: task.serial_number,
				allowDuplicates: false,
				isMultipleSelection: false,
				timeLimit: timeLimitNum > 0 ? String(timeLimitNum) : "",
				quiz_id: String(task.quest_id),
				source_content_url: "",
				open_datetime: "",
				close_datetime: "",
			} as unknown as OutputTask;
		}

		// Older saves stored the placeholder ("Option 1", "Item 1") as a word cloud / text answer's
		// suggestion; those aren't real suggestions.
		const isLegacyPlaceholder = (text?: string) =>
			["wordcloud", "shortanswer", "longanswer"].includes(task.task_type) && /^(Option|Item) \d+$/.test(`${text ?? ""}`.trim());
		const options: OutputOption[] = (task?.task_data?.questions ?? []).filter((question: any) => !isLegacyPlaceholder(question?.text)).map(
			(question: any) => ({
				id: String(question.id),
				text: question.text,
				placeholder: `Add answer ${question.id}`,
				color: question.color,
				isSelected: false,
			})
		);

		const timeLimitNum = task?.task_data?.time_limit ?? 0;

		return {
			key,
			id: String(task.id),
			title: task.title,
			points: "1",
			options,
			maxOptions: 0,
			minOptions: 0,
			position: task.serial_number,
			allowDuplicates: false,
			isMultipleSelection: task.task_type === "multiple_choice",
			timeLimit: timeLimitNum > 0 ? String(timeLimitNum) : "",
			quiz_id: String(task.quest_id),
			source_content_url: "",
			open_datetime: "",
			close_datetime: "",

			contant_title: task?.task_data?.contant_title,
			image_url: task?.task_data?.image_url,
			layout_id: task?.task_data?.layout_id,

			task_data: {
				minNumber: task?.task_data?.minNumber,
				maxNumber: task?.task_data?.maxNumber,
				minText: task?.task_data?.minText,
				maxText: task?.task_data?.maxText,
			},
		} as OutputTask;
	});
}

export function convertTaskData2(inputData: InputTask[]): OutputTask[] {
	return inputData?.map((task) => {
		// Special handling for quick_form
		if (task.task_type === "quick_form") {
			// return raw object unchanged
			return task as unknown as OutputTask;
		}

		// Determine the key based on task_type
		let key: string;
		switch (task.task_type) {
			case "single_choice":
			case "multiple_choice":
				key = "qsenchoice";
				break;
			default:
				key = task.task_type;
		}

		// Convert options. Older saves stored the placeholder ("Option 1", "Item 1") as a word
		// cloud / text answer's suggestion; those aren't real suggestions.
		const legacyPlaceholder = (text?: string) =>
			["wordcloud", "shortanswer", "longanswer"].includes(task.task_type) && /^(Option|Item) \d+$/.test(`${text ?? ""}`.trim());
		const options: OutputOption[] =
			task?.task_data?.questions?.filter((question) => !legacyPlaceholder(question.text)).map((question) => ({
				id: question.id.toString(),
				text: question.text,
				placeholder: `Add answer ${question.id}`,
				color: question.color,
				isSelected: false,
			})) ?? [];

		return {
			key,
			id: task.id.toString(),
			title: task.title,
			points: "1", // Default points
			options,
			maxOptions: 0,
			minOptions: 0,
			position: task.serial_number,
			allowDuplicates: false,
			isMultipleSelection: task.task_type === "multiple_choice",
			timeLimit:
				task?.task_data?.time_limit > 0
					? task?.task_data?.time_limit.toString()
					: "",
			quiz_id: task.quest_id.toString(),
			source_content_url: "",
			open_datetime: "",
			close_datetime: "",
		};
	});
}
