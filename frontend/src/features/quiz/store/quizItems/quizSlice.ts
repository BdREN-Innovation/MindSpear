import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { initialState } from "./initialState";
import * as itemReducers from "./items";
import * as optionReducers from "./options";
import { QuizItem } from "@/types/types";

interface TrueFalseOption {
	text: string;
	id: "1" | "2";
	label: string;
	color: string;
	isSelected: boolean;
}
export interface Option {
	id?: string;
	isSelected?: boolean;
}
// interface MenuItem {
// 	key: string;
// 	id: string;
// 	title: string;
// 	options: Option[];
// }
interface DeplucateItem {
	id: string;
	qid: string;
}
const generateUniqueId = (prefix: string = ""): string => {
	return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

const quizSlice = createSlice({
	name: "quiz",
	initialState,
	reducers: {
		setHoveredItem: (state, action: PayloadAction<QuizItem | null>) => {
			state.hoveredItem = action.payload;
		},

		// removeSelectedItem: (state, action) => {
		// 	const { id } = action.payload;
		// 	state.multypleselectedItem = state.multypleselectedItem.filter(
		// 		(item) => item.id !== id
		// 	);

		// 	state.multypleselectedItem = state.multypleselectedItem
		// 		.sort((a, b) => (a.position || 0) - (b.position || 0))
		// 		.map((item, index) => ({
		// 			...item,
		// 			position: index + 1,
		// 		}));
		// },
		removeSelectedItem: (state, action) => {
			const { id } = action.payload;

			state.multypleselectedItem = state.multypleselectedItem
				.filter((item) => item.id !== id)
				.map((item, index) => ({
					...item,
					position: index + 1,
				}));

			// fallback select
			if (state.selectedItem?.id === id) {
				state.selectedItem = state.multypleselectedItem[0] || null;
			}
		},

		duplicateItem: (state, action: PayloadAction<DeplucateItem>) => {
			const itemToDuplicate = state.multypleselectedItem.find(
				(item) => item.id === action.payload.id
			);

			console.log({ ...itemToDuplicate }, "currentActive");
			if (!itemToDuplicate) return;
			console.log(action.payload, "currentActive");
			const maxPosition = state.multypleselectedItem.reduce(
				(max, item) => Math.max(max, item.position || 0),
				0
			);
			const nextPosition = maxPosition + 1;

			const duplicatedItem = {
				...itemToDuplicate,
				id: String(action.payload.qid),
				// id: generateUniqueId(itemToDuplicate.key),
				position: nextPosition,
				options: itemToDuplicate.options.map((option) => ({
					...option,
					id: generateUniqueId("option"),
				})),
			};

			state.multypleselectedItem.push(duplicatedItem);
			state.selectedItem = duplicatedItem;
		},
		clearHoveredItem: (state) => {
			state.hoveredItem = null;
		},
		setSelectedItem: (state, action: PayloadAction<QuizItem | null>) => {
			if (action.payload) {
				// The title is kept as is: an empty one shows the editor's placeholder
				// instead of becoming the literal text "Untitled question".
				state.selectedItem = { ...action.payload, title: action.payload.title ?? "" };
			} else {
				state.selectedItem = null;
			}
		},

		clearSelectedItem: (state) => {
			state.selectedItem = null;
		},
		reorderOptions: (state, action) => {
			const { quizId, fromId, toId } = action.payload;
			const quiz = state.multypleselectedItem.find(
				(item) => item.id === quizId
			);

			if (quiz && quiz.options) {
				const fromIndex = quiz.options.findIndex(
					(opt) => opt.id === fromId
				);
				const toIndex = quiz.options.findIndex(
					(opt) => opt.id === toId
				);

				if (fromIndex !== -1 && toIndex !== -1) {
					const [movedOption] = quiz.options.splice(fromIndex, 1);
					quiz.options.splice(toIndex, 0, movedOption);
				}
			}
		},
		setMultipleSelectedItems: (
			state,
			action: PayloadAction<QuizItem[]>
		) => {
			state.multypleselectedItem = action.payload;
		},
		clearMultipleSelectedItems: (state) => {
			state.multypleselectedItem = [];
		},

		// Item reducers
		addNewItem: itemReducers.addNewItem,
		addNewQuestItem: itemReducers.addNewQuestItem,
		// removeSelectedItem: itemReducers.removeSelectedItem,
		clearAllSelectedItems: itemReducers.clearAllSelectedItems,
		updateQuizTitle: itemReducers.updateQuizTitle,
		updateQuizImages: itemReducers.updateQuizImages,
		updateLimitedTimeTitle: itemReducers.updateLimitedTimeTitle,
		contantData: itemReducers.contantData,
		scalesMaxMinData: itemReducers.scalesMaxMinData,
		updatePoints: itemReducers.updatePoints,

		// Option reducers
		addQuizOption: optionReducers.addQuizOption,
		addQuestOption: optionReducers.addQuestOption,
		addQuestOptionsFromPaste: optionReducers.addQuestOptionsFromPaste,
		removeQuizOption: optionReducers.removeQuizOption,
		removeQuestOption: optionReducers.removeQuestOption,
		updateOptionText: optionReducers.updateOptionText,
		updateOptionColor: optionReducers.updateOptionColor,
		toggleOptionSelection: optionReducers.toggleOptionSelection,
		updateTrueFalseOption: optionReducers.updateTrueFalseOption,
		toggleSwitchSelectionMode: optionReducers.toggleSwitchSelectionMode,
		// setTimeLimitForQuiz: optionReducers.setTimeLimitForQuiz,

		addSortAnswerOption:
			optionReducers.sortAnswerReducers.addSortAnswerOption,
		updateSortAnswerOption:
			optionReducers.sortAnswerReducers.updateSortAnswerOption,
		updateSortAnswerItem:
			optionReducers.sortAnswerReducers.updateSortAnswerItem,
		removeSortAnswerOption:
			optionReducers.sortAnswerReducers.removeSortAnswerOption,
	},
});

export const {
	setHoveredItem,
	clearHoveredItem,
	setSelectedItem,
	clearSelectedItem,
	setMultipleSelectedItems,
	addNewItem,
	reorderOptions,
	addNewQuestItem,
	clearAllSelectedItems,
	updateQuizTitle,
	updateQuizImages,
	updateLimitedTimeTitle,
	contantData,
	scalesMaxMinData,
	updatePoints,
	addQuizOption,
	addQuestOption,
	addQuestOptionsFromPaste,
	removeQuizOption,
	removeQuestOption,
	updateOptionText,
	updateOptionColor,
	toggleOptionSelection,
	updateTrueFalseOption,
	toggleSwitchSelectionMode,
	clearMultipleSelectedItems,
	addSortAnswerOption,
	updateSortAnswerOption,
	updateSortAnswerItem,
	removeSortAnswerOption,
	removeSelectedItem,
	duplicateItem,
} = quizSlice.actions;
export default quizSlice.reducer;
export type { TrueFalseOption };
