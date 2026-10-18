import { QuizItem, HoverState } from '@/types/types';
import { PayloadAction } from '@reduxjs/toolkit';

export const addNewItem = (state: HoverState, action: PayloadAction<QuizItem>) => {
  // const timestamp = Date.now();
  // const generatedId = `${action.payload.key}-${timestamp}`;

  const nextPosition = state.multypleselectedItem.length > 0
    ? Math.max(...state.multypleselectedItem.map(item => item.position || 0)) + 1
    : 1;


  let newItem: QuizItem = {
    key: action.payload.key,
    // Ids are compared as strings everywhere (questions loaded from the API have string ids).
    id: String(action.payload.id),
    // Empty, not "Untitled question": the editor shows a placeholder and Save asks for a title.
    title: action.payload.title ?? '',
    layout_id: '',
    options: [],
    maxOptions: 0,
    minOptions: 0,
    position: nextPosition  ,
    allowDuplicates: false,
    isMultipleSelection: false,
    timeLimit: action.payload.timeLimit ?? '',
    points: action.payload.points,
    quiz_id: action.payload.quiz_id,
    quizTypeName: action.payload.quizTypeName,
    quizTypeModalStatus: action.payload.quizTypeModalStatus,
  };

  if (action.payload.key === 'quiz') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Add answer 1', color: '#F79945', isSelected: false },

        { id: '2', text: "", placeholder: 'Add answer 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Add answer 3 (optional)', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Add answer 4 (optional)', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }
  if (action.payload.key === 'fillintheblanks') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Add answer 1', color: '#F79945', isSelected: false },
        { id: '2', text: "", placeholder: 'Add answer 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Add answer 3 (optional)', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Add answer 4 (optional)', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }

  if (action.payload.key === 'truefalse') {
    newItem.options = [
      { id: '1', label: 'True', color: '#F79945', isSelected: false, text: 'True' },
      { id: '2', label: 'False', color: '#bc5eb3', isSelected: false, text: 'False' },
    ];
  }

  if (action.payload.key === 'sortanswer') {
    newItem = {
      ...newItem,
      options: [
        {
          id: '1',
          text: '',
          placeholder: 'Add answer 1',
          color: '#F79945',
          isSelected: false,
        }
      ],
      maxOptions: 4,
      minOptions: 1,
      allowDuplicates: false,
    };
  }

  // A question that already has content (imported from the question bank) keeps it.
  if (action.payload.options?.length) {
    newItem.options = action.payload.options;
    newItem.isMultipleSelection = !!action.payload.isMultipleSelection;
    if (action.payload.source_content_url) newItem.source_content_url = action.payload.source_content_url;
  }

  state.multypleselectedItem.push(newItem);
  state.selectedItem = newItem;
};

export const addNewQuestItem = (state: HoverState, action: PayloadAction<QuizItem>) => {
  const nextPosition = state.multypleselectedItem.length > 0
    ? Math.max(...state.multypleselectedItem.map(item => item.position || 0)) + 1
    : 1;

  let newItem: QuizItem = {
    key: action.payload.key,
    id: action.payload.id,
    title: '',
    layout_id: '',
    options: [],
    maxOptions: 0,
    minOptions: 0,
    position: nextPosition  ,
    allowDuplicates: false,
    isMultipleSelection: false,
    timeLimit: '',
    quiz_id: action.payload.quiz_id,
    quizTypeName: action.payload.quizTypeName,
    quizTypeModalStatus: action.payload.quizTypeModalStatus,
  };
  console.log(action.payload.key, "action.payload.key");


  if (action.payload.key === 'qsenchoice') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Option 1', color: '#F79945', isSelected: false },
        { id: '2', text: "", placeholder: 'Option 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Option 3', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Option 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }

  if (action.payload.key === 'truefalse') {
    newItem.options = [
      { id: '1', label: 'Yes', color: '#F79945', isSelected: false, text: 'Yes' },
      { id: '2', label: 'No', color: '#bc5eb3', isSelected: false, text: 'No' },
    ];
  }

  if (action.payload.key === 'sortanswer') {
    newItem = {
      ...newItem,
      options: [
        {
          id: '1',
          text: '',
          placeholder: 'Add answer 1',
          color: '#F79945',
          isSelected: false,
        }
      ],
      maxOptions: 4,
      minOptions: 1,
      allowDuplicates: false,
    };
  }

   if (action.payload.key === 'scales') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Statement 1', color: '#F79945', isSelected: false },
        { id: '2', text: "", placeholder: 'Statement 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Statement 3', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Statement 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false,
      minNumber: 1,
      maxNumber: 5,
    };
  }
   if (action.payload.key === 'wordcloud') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Option 1', color: '#F79945', isSelected: false },
        // { id: '2', text: "", placeholder: 'Statement 2', color: '#BC5EB3', isSelected: false },
        // { id: '3', text: "", placeholder: 'Statement 3', color: '#5769e7', isSelected: false },
        // { id: '4', text: "", placeholder: 'Statement 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }

  if (action.payload.key === 'ranking') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Item 1', color: '#F79945', isSelected: false },
        { id: '2', text: "", placeholder: 'Item 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Item 3', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Item 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }

  if (action.payload.key === 'shortanswer') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Item 1', color: '#F79945', isSelected: false },
        // { id: '2', text: "", placeholder: 'Item 2', color: '#BC5EB3', isSelected: false },
        // { id: '3', text: "", placeholder: 'Item 3', color: '#5769e7', isSelected: false },
        // { id: '4', text: "", placeholder: 'Item 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }

  if (action.payload.key === 'longanswer') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Item 1', color: '#F79945', isSelected: false },
        // { id: '2', text: "", placeholder: 'Item 2', color: '#BC5EB3', isSelected: false },
        // { id: '3', text: "", placeholder: 'Item 3', color: '#5769e7', isSelected: false },
        // { id: '4', text: "", placeholder: 'Item 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }

  if (action.payload.key === 'sorting') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Option 1', color: '#F79945', isSelected: false },
        { id: '2', text: "", placeholder: 'Option 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Option 3', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Option 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }
  if (action.payload.key === 'content') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Option 1', color: '#F79945', isSelected: false },
        { id: '2', text: "", placeholder: 'Option 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Option 3', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Option 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }




  state.multypleselectedItem.push(newItem);
  state.selectedItem = newItem;
};

export const addNewSurveyItem = (state: HoverState, action: PayloadAction<QuizItem>) => {
  const nextPosition = state.multypleselectedItem.length > 0
    ? Math.max(...state.multypleselectedItem.map(item => item.position || 0)) + 1
    : 1;

  let newItem: QuizItem = {
    key: action.payload.key,
    id: action.payload.id,
    title: '',
    layout_id: '',
    options: [],
    maxOptions: 0,
    minOptions: 0,
    position: nextPosition  ,
    allowDuplicates: false,
    isMultipleSelection: false,
    timeLimit: '',
    quiz_id: action.payload.quiz_id,
    quizTypeName: action.payload.quizTypeName,
    quizTypeModalStatus: action.payload.quizTypeModalStatus,
  };
  console.log(action.payload.key, "action.payload.key");


  if (action.payload.key === 'surveychoice') { // Changed from 'qsenchoice' to 'surveychoice'
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Option 1', color: '#F79945', isSelected: false },
        { id: '2', text: "", placeholder: 'Option 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Option 3', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Option 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }

  if (action.payload.key === 'truefalse') {
    newItem.options = [
      { id: '1', label: 'Yes', color: '#F79945', isSelected: false, text: 'Yes' },
      { id: '2', label: 'No', color: '#bc5eb3', isSelected: false, text: 'No' },
    ];
  }

  if (action.payload.key === 'sortanswer') {
    newItem = {
      ...newItem,
      options: [
        {
          id: '1',
          text: '',
          placeholder: 'Add answer 1',
          color: '#F79945',
          isSelected: false,
        }
      ],
      maxOptions: 4,
      minOptions: 1,
      allowDuplicates: false,
    };
  }

   if (action.payload.key === 'scales') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Statement 1', color: '#F79945', isSelected: false },
        { id: '2', text: "", placeholder: 'Statement 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Statement 3', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Statement 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false,
      minNumber: 1,
      maxNumber: 5,
    };
  }
   if (action.payload.key === 'wordcloud') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Option 1', color: '#F79945', isSelected: false },
        // { id: '2', text: "", placeholder: 'Statement 2', color: '#BC5EB3', isSelected: false },
        // { id: '3', text: "", placeholder: 'Statement 3', color: '#5769e7', isSelected: false },
        // { id: '4', text: "", placeholder: 'Statement 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }

  if (action.payload.key === 'ranking') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Item 1', color: '#F79945', isSelected: false },
        { id: '2', text: "", placeholder: 'Item 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Item 3', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Item 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }

  if (action.payload.key === 'shortanswer') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Item 1', color: '#F79945', isSelected: false },
        // { id: '2', text: "", placeholder: 'Item 2', color: '#BC5EB3', isSelected: false },
        // { id: '3', text: "", placeholder: 'Item 3', color: '#5769e7', isSelected: false },
        // { id: '4', text: "", placeholder: 'Item 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }

  if (action.payload.key === 'longanswer') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Item 1', color: '#F79945', isSelected: false },
        // { id: '2', text: "", placeholder: 'Item 2', color: '#BC5EB3', isSelected: false },
        // { id: '3', text: "", placeholder: 'Item 3', color: '#5769e7', isSelected: false },
        // { id: '4', text: "", placeholder: 'Item 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }

  if (action.payload.key === 'sorting') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Option 1', color: '#F79945', isSelected: false },
        { id: '2', text: "", placeholder: 'Option 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Option 3', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Option 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }
  if (action.payload.key === 'content') {
    newItem = {
      ...newItem,
      options: [
        { id: '1', text: "", placeholder: 'Option 1', color: '#F79945', isSelected: false },
        { id: '2', text: "", placeholder: 'Option 2', color: '#BC5EB3', isSelected: false },
        { id: '3', text: "", placeholder: 'Option 3', color: '#5769e7', isSelected: false },
        { id: '4', text: "", placeholder: 'Option 4', color: '#89c6c7', isSelected: false },
      ],
      isMultipleSelection: false
    };
  }




  state.multypleselectedItem.push(newItem);
  state.selectedItem = newItem;
};