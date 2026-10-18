/* eslint-disable @typescript-eslint/no-explicit-any */
export type LocalOption = {
  id: string | number;
  text: string;
};

export type LocalItem = {
  id: string;
  type: "checkbox" | "radio" | "dropdown" | "short-answer" | string;
  label: string;
  serial_number: number | string;
  questId: string | number;
  options: LocalOption[];
};

export type QuestionOption = {
  id: number;
  text: string;
};

export type Question = {
  id: number;
  title: string;
  type: "checkbox" | "radio" | "dropdown" | "short-answer";
  options: QuestionOption[];
  is_required: boolean;
  serial_number: number;
};

export type QuestionsResponse = {
  questions: Question[];
};

export function QuickFromTransform(items: LocalItem[]): QuestionsResponse {
  const allowed = new Set(["checkbox", "radio", "dropdown", "short-answer"]);

  const questions: Question[] = items
    .filter((it) => allowed.has(it.type))
    .filter((it) => {
      if (it.type === "short-answer") return true;
      return Array.isArray(it.options) && it.options.length > 0;
    })
    .map((it, idx) => {
      const titleFallbacks: Record<string, string> = {
        checkbox: "Select all that apply",
        radio: "Select one",
        dropdown: "Select an option",
        "short-answer": "Your answer",
      };


      const isRequired =
        it.type === "short-answer"
          ? true
          : false;

      const serial_number = Number(it.serial_number) || idx + 1;

      const options: QuestionOption[] =
        it.type === "short-answer"
          ? []
          : (it.options || []).map((o, i) => ({
              id: Number(o.id) || i + 1,
              text: o.text,
            }));

      return {
        id: Number(it.id) || idx + 1,
        title: it.label?.trim() || titleFallbacks[it.type] || "Question",
        type: it.type as Question["type"],
        options,
        is_required: isRequired,
        serial_number,
      };
    })
    .sort((a, b) => a.serial_number - b.serial_number);

  return { questions };
}

declare global {
  interface Window {
    processQuestions?: (items: LocalItem[]) => QuestionsResponse;
  }
}
if (typeof window !== "undefined") {
  window.processQuestions = QuickFromTransform;
}




type Option = { id: string; text: string };
type QuestionQuickFrom = {
  id: string;
  type: string;
  label: string;
  serial_number: string;
  options: Option[];
};

type QuickFormData = {
  id: number;
  quest_id: string;
  title: string;
  description: string;
  task_type: "quick_form";
  serial_number: number;
  is_required: boolean;
  questions: QuestionQuickFrom[];
};


type AnyTask<Q = unknown> = {
  quest_id: string;
  title: string;
  description: string;
  task_type: string;
  serial_number: number;
  task_data: {
    time_limit?: number;
    questions: Q[];
  };
  updated_at: string;
  created_at: string;
  id: number;
};


type QuickFormTask = AnyTask<QuestionQuickFrom> & { task_type: "quick_form" };


function isQuickFormTask(task: AnyTask<any>): task is QuickFormTask {
  return task.task_type === "quick_form";
}


export function quickFormTaskArray<T extends AnyTask<any>>(
  mainDataArr: T[],
  quickFormArr: QuickFormData[]
): T[] {
  const byId = new Map<number, QuickFormData>(quickFormArr.map(q => [q.id, q]));
  // console.log(mainDataArr, "mainDataArrmainDataArrmainDataArrmainDataArr");
  
  return mainDataArr.map((task) => {
    if (!isQuickFormTask(task)) return task; 

    const match = byId.get(task.id);
    
    if (!match) return task;

    const merged: QuickFormTask = {
      ...task,
      title: task.title ,
      description: task.description,
      task_data: {
        ...task.task_data,
        questions: match.questions,
      },
    };


    return merged as T;
  });
}




export function normalizeTasks(data: any) {
  // console.log(data, "datadatadatadatadatadatadatadatadatadata");
  
    return data.map((item:any) => {
    // === Normalize TASKS dataset ===
    if (item.task_type) {
      const baseTask = {
        id: item.id,
        quest_id: item.quest_id,
        title: item.title,
        minNumber: item?.task_data?.minNumber,
        maxNumber: item?.task_data?.maxNumber,
        contant_title: item?.task_data?.contant_title,
        image_url: item?.task_data?.image_url,
        layout_id: item?.task_data?.layout_id,
        description: item.description,
        task_type: item.task_type,
        serial_number: item.serial_number,
        is_required: item.is_required,
        created_at: item.created_at,
        updated_at: item.updated_at,
      };

      // Group 1: wordcloud, longanswer, shortanswer
      // if (["wordcloud", "longanswer", "shortanswer"].includes(item.task_type)) {
      //   return baseTask;
      // }

      // Group 2: scales, ranking, single_choice, truefalse, sorting
      if (["scales", "ranking", "single_choice", "multiple_choice", "truefalse", "sorting", "wordcloud", "content"].includes(item.task_type)) {
        return {
          ...baseTask,
          questions: item.task_data?.questions || []
        };
      }

      // Group 3: quick_form
      if (item.task_type === "quick_form") {
        return {
          ...baseTask,
          questions: item.task_data?.questions || []
        };
      }

      return baseTask;
    }

    // === Normalize QUIZ dataset ===
    if (item.question_type) {
      const baseQuiz = {
        id: item.id,
        quiz_id: item.quiz_id,
        serial_number: item.serial_number,
        title: item.question_text,
        question_type: item.question_type,
        time_limit_seconds: item.time_limit_seconds,
        points: item.points,
        is_ai_generated: item.is_ai_generated,
        source_content_url: item.source_content_url,
        visibility: item.visibility,
        deleted_at: item.deleted_at,
        deleted_by: item.deleted_by,
        created_at: item.created_at,
        updated_at: item.updated_at,
      };

      // Group A: quiz_single_choice, quiz_multiple_choice, true_false_choice, fill_in_the_blanks_choice
      if (["quiz_single_choice", "quiz_multiple_choice", "true_false_choice", "fill_in_the_blanks_choice", "fill_in_the_blanks_multiple_choice"].includes(item.question_type)) {
        // The id is the answer's position in the question (numbered before empty answers are
        // dropped, so it still matches what the scoring compares).
        return {
          ...baseQuiz,
          questions: (item.options?.choices ?? [])
            .map((choice: string | null, idx: number) => ({
              id: idx,
              text: choice,
              color: item.options?.color?.[idx] || null
            }))
            .filter((choice: { text: string | null }) => choice.text !== null && `${choice.text}`.trim() !== "")
        };
      }

      // Group B: sort_answer_choice
      if (item.question_type === "sort_answer_choice") {
        return baseQuiz;
      }

      return baseQuiz;
    }

    return item; // fallback
  });
}


