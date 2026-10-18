import { HoverState } from '@/types/types';
import { PayloadAction } from '@reduxjs/toolkit';
export interface SortAnswerItem {
  id: string;
  text: string;
  placeholder: string;
  color: string;
  isSelected: boolean;
}

export interface QuizState {
  sortOptions: SortAnswerItem[];
}

export const initialState: QuizState = {
  sortOptions: [
    {
      id: '1',
      text: '',
      placeholder: 'Add answer 1',
      color: '#F79945',
      isSelected: false,
    },
  ],
};



export const sortAnswerReducers = {
  addSortAnswerOption: (state: HoverState) => {
  const selectedItem = state.selectedItem;

  if (
    !selectedItem ||
    selectedItem.key !== 'sortanswer' ||
    !selectedItem.options ||
    (selectedItem.maxOptions && selectedItem.options.length >= selectedItem.maxOptions)
  ) return;

  const colorList = ['#F79945', '#BC5EB3', '#5769E7', '#89c6c7'];
  const newIndex = selectedItem.options.length;
  // After a removal the count can repeat an id still in use, so take the next free one.
  const newId = (Math.max(0, ...selectedItem.options.map(opt => Number(opt.id) || 0)) + 1).toString();

  const newOption = {
    id: newId,
    text: '',
    placeholder: `Add answer ${newId}`,
    color: colorList[newIndex] || '#BC5EB3',
    isSelected: false,
  };

  // Add to selectedItem
  selectedItem.options.push({ ...newOption });

  // Also update the matching item inside multypleselectedItem
  const matchedItem = state.multypleselectedItem.find(item => item.id === selectedItem.id);
  if (matchedItem?.options) {
    matchedItem.options.push({ ...newOption });
  }
},
  
updateSortAnswerOption: (
  state: HoverState, 
  action: PayloadAction<{
    id: string;
    changes: Partial<{
      text: string;
      color: string;
      isCorrect: boolean;
      sequence: number;
    }>;
  }>
) => {
  const selectedItem = state.selectedItem;

  if (
    !selectedItem ||
    selectedItem.key !== 'sortanswer' ||
    !Array.isArray(selectedItem.options)
  ) return;

  const option = selectedItem.options.find(opt => opt.id === action.payload.id);
  
  if (option) {
    Object.assign(option, action.payload.changes);
  }

  const matchedItem = state.multypleselectedItem.find(item => item.id === selectedItem.id);
  const matchOption = matchedItem?.options?.find(opt => opt.id === action.payload.id);
  if (matchOption) {
    Object.assign(matchOption, action.payload.changes);
  }
},
  
  /** Removes an accepted answer (the last one always stays). */
  removeSortAnswerOption: (state: HoverState, action: PayloadAction<{ id: string }>) => {
    const selectedItem = state.selectedItem;
    if (!selectedItem || selectedItem.key !== 'sortanswer' || !selectedItem.options || selectedItem.options.length <= 1) return;
    selectedItem.options = selectedItem.options.filter(opt => opt.id !== action.payload.id);
    const matchedItem = state.multypleselectedItem.find(item => item.id === selectedItem.id);
    if (matchedItem?.options) {
      matchedItem.options = matchedItem.options.filter(opt => opt.id !== action.payload.id);
    }
  },

  updateSortAnswerItem: (
    state: HoverState,
    action: PayloadAction<Partial<{
      maxOptions: number;
      minOptions: number;
      allowDuplicates: boolean;
    }>>
  ) => {
    if (!state.selectedItem || state.selectedItem.key !== 'sortanswer') return;
    Object.assign(state.selectedItem, action.payload);
  }
};
