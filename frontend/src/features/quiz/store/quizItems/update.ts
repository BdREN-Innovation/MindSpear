/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PayloadAction } from '@reduxjs/toolkit';
import { HoverState, UpdateOptionTextPayload, UpdateOptionColorPayload, QuizItem  } from '@/types/types';
type UpdateContentPayload = {
  id: string;
  contant_title?: string;
  image_url?: string;
  layout_id?: string;
};


export const updateOptionText = (state: HoverState, action: PayloadAction<UpdateOptionTextPayload>) => {
  const quizItem = state.multypleselectedItem.find(item => item.id === action.payload.quizId);
  if (quizItem && quizItem.options) {
    const option = quizItem.options.find(opt => opt.id === action.payload.optionId);
    if (option) {
      option.text = action.payload.text;
      if (action.payload.text.trim() === "") {
        option.isSelected = false;
      }
    }
  }
  
  if (state.selectedItem?.id === action.payload.quizId && state.selectedItem.options) {
    const option = state.selectedItem.options.find(opt => opt.id === action.payload.optionId);
    if (option) {
      option.text = action.payload.text;
      if (action.payload.text.trim() === "") option.isSelected = false;
    }
  }
  if (state.hoveredItem?.id === action.payload.quizId && state.hoveredItem.options) {
    const option = state.hoveredItem.options.find(opt => opt.id === action.payload.optionId);
    if (option) {
      option.text = action.payload.text;
      if (action.payload.text.trim() === "") option.isSelected = false;
    }
  }
};

export const updateOptionColor = (state: HoverState, action: PayloadAction<UpdateOptionColorPayload>) => {
  const quizItem = state.multypleselectedItem.find(item => item.id === action.payload.quizId);
  if (quizItem && quizItem.options) {
    const option = quizItem.options.find(opt => opt.id === action.payload.optionId);
    if (option) {
      option.color = action.payload.color;
    }
  }
  if (state.selectedItem?.id === action.payload.quizId && state.selectedItem.options) {
    const option = state.selectedItem.options.find(opt => opt.id === action.payload.optionId);
    if (option) {
      option.color = action.payload.color;
    }
  }
  if (state.hoveredItem?.id === action.payload.quizId && state.hoveredItem.options) {
    const option = state.hoveredItem.options.find(opt => opt.id === action.payload.optionId);
    if (option) {
      option.color = action.payload.color;
    }
  }
};

export const updateQuizTitle = (state: HoverState, action: PayloadAction<{ id: string; title: string }>) => {
  const quizItem = state.multypleselectedItem.find(item => item.id === action.payload.id);
  if (quizItem) {
    quizItem.title = action.payload.title;
  }

  if (state.selectedItem?.id === action.payload.id) {
    state.selectedItem.title = action.payload.title;
  }

  if (state.hoveredItem?.id === action.payload.id) {
    state.hoveredItem.title = action.payload.title;
  }
};


export const updateQuizImages = (
  state: HoverState, 
  action: PayloadAction<{ 
    id: string;
    imageUrl?: string;
    imageId?: number;
  }>
) => {
  // A key that is present is applied even when undefined: that is how "remove image" clears it.
  const updateItem = (item: QuizItem) => {
    if ("imageUrl" in action.payload) {
      item.source_content_url = action.payload.imageUrl;
    }
    if ("imageId" in action.payload) {
      item.source_image_id = action.payload.imageId;
    }
  };

  const quizItem = state.multypleselectedItem.find(item => item.id === action.payload.id);
  if (quizItem) updateItem(quizItem);

  if (state.selectedItem?.id === action.payload.id) {
    updateItem(state.selectedItem);
  }

  if (state.hoveredItem?.id === action.payload.id) {
    updateItem(state.hoveredItem);
  }
};

// export const updateLimitedTimeTitle = (state: HoverState, action: PayloadAction<{ id: string; timeLimit: string }>) => {

//   const quizItem = state.multypleselectedItem.find(item => item.id === action.payload.id);
//   if (quizItem) {
//     quizItem.timeLimit = action.payload.timeLimit;
//   }

//   if (state.selectedItem?.id === action.payload.id) {
//     state.selectedItem.timeLimit = action.payload.timeLimit;
//   }

//   if (state.hoveredItem?.id === action.payload.id) {
//     state.hoveredItem.timeLimit = action.payload.timeLimit;
//   }
// };


export const updateLimitedTimeTitle = (state: HoverState, action: { payload: { id: string; timeLimit: string } }) => {
  const { id, timeLimit } = action.payload;
  console.log(timeLimit, "timeLimit");
  console.log(id, "timeLimit");
  
  
  return {
    ...state,
    selectedItem: state.selectedItem?.id === id 
      ? { ...state.selectedItem, timeLimit }
      : state.selectedItem,
    hoveredItem: state.hoveredItem?.id === id 
      ? { ...state.hoveredItem, timeLimit }
      : state.hoveredItem,
    multypleselectedItem: state.multypleselectedItem.map(item => 
      item.id === id ? { ...item, timeLimit } : item
    )
  };
};

const sameId = (a: string | number | undefined, b: string | number) =>
  String(a) === String(b);

export const contantData = (
  state: HoverState,
  action: { payload: UpdateContentPayload }
) => {
  const { id, ...patch } = action.payload;
 
  

  return {
    ...state,
    selectedItem:
      state.selectedItem?.id === id
        ? { ...state.selectedItem, ...patch }
        : state.selectedItem,

    hoveredItem:
      state.hoveredItem?.id === id
        ? { ...state.hoveredItem, ...patch }
        : state.hoveredItem,

    multypleselectedItem: state.multypleselectedItem.map((item) =>
      item.id === id ? { ...item, ...patch } : item
    ),
  };
};


// export const scalesMaxMinData = (
//   state: any, 
//   action: { payload: any }
// ) => {
//   const { id, minNumber, maxNumber } = action.payload;

//   const patch: Partial<any> = {};
//   if (typeof minNumber === "number") patch.minNumber = minNumber;
//   if (typeof maxNumber === "number") patch.maxNumber = maxNumber;

//   const patchIfMatch = (item: any | null) =>
//     item && item.id === id ? { ...item, ...patch } : item;

//   return {
//     ...state,
//     selectedItem: patchIfMatch(state.selectedItem),
//     hoveredItem: patchIfMatch(state.hoveredItem),
//     multypleselectedItem: state.multypleselectedItem.map((item: any) =>
//       item.id === id ? { ...item, ...patch } : item
//     ),
//   };
// };



export const scalesMaxMinData = (state: any, action: { payload: any }) => {
  const { id, minNumber, maxNumber, minText, maxText } = action.payload;

  const apply = (item: any | null) => {
    if (!item || item.id !== id) return item;

    const prev = item.task_data ?? {};

    let nextMin = typeof minNumber === "number" ? minNumber : (prev.minNumber ?? 1);
    let nextMax = typeof maxNumber === "number" ? maxNumber : (prev.maxNumber ?? 5);

    // ✔ keep range valid
    if (typeof minNumber === "number" && nextMin > nextMax) nextMax = nextMin;
    if (typeof maxNumber === "number" && nextMax < nextMin) nextMin = nextMax;

    return {
      ...item,
      task_data: {
        ...prev,
        minNumber: nextMin,
        maxNumber: nextMax,
        minText: minText ?? prev.minText ?? "Strongly disagree",
        maxText: maxText ?? prev.maxText ?? "Strongly agree",
      },
    };
  };

  return {
    ...state,
    selectedItem: apply(state.selectedItem),
    hoveredItem: apply(state.hoveredItem),
    multypleselectedItem: Array.isArray(state.multypleselectedItem)
      ? state.multypleselectedItem.map(apply)
      : state.multypleselectedItem,
  };
};



export const updatePoints = (state: HoverState, action: { payload: { id: string; points: string } }) => {
  const { id, points } = action.payload;
  console.log(points, "timeLimit");
  console.log(id, "timeLimit");
  
  
  return {
    ...state,
    selectedItem: state.selectedItem?.id === id 
      ? { ...state.selectedItem, points }
      : state.selectedItem,
    hoveredItem: state.hoveredItem?.id === id 
      ? { ...state.hoveredItem, points }
      : state.hoveredItem,
    multypleselectedItem: state.multypleselectedItem.map(item => 
      item.id === id ? { ...item, points } : item
    )
  };
};
