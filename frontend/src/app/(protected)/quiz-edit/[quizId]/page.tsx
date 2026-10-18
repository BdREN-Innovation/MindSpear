'use client';
import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/stores/store';
import QuizCreatorPreview from '@/features/quiz/components/CreateQuiz/QuizCreatorPreview';
import TrueFalseCreatorPreview from '@/features/quiz/components/CreateQuiz/TrueFalseCreatorPreview';
import SortAnswerCreatorPreview from '@/features/quiz/components/CreateQuiz/SortAnswerCreatorPreview';
import FillInTheBlanksCreatorPreview from '@/features/quiz/components/CreateQuiz/FillInTheBlanksCreatorPreview';
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from 'axios';
import { useParams } from "next/navigation";
import { setQuiz } from "@/features/quiz/store/quizInformationSlice";
import type { Quiz } from "@/types/types";
import QuizEmptyState from '@/features/quiz/components/CreateQuiz/QuizEmptyState';
import UnsupportedQuestion, { EditorLoading } from '@/features/quiz/components/CreateQuiz/UnsupportedQuestion';
import { transformQuestionData } from '@/utils/quizUtils';
import { clearHoveredItem, setMultipleSelectedItems, setSelectedItem } from '@/features/quiz/store/quizItems/quizSlice';
import { store } from '@/stores/store';
import { toast } from 'react-toastify';

interface QuizItem {
  key: string;
  id: string;
}

interface QuizApiResponse {
  data: Quiz;
}

function QuizCreator() {
  const params = useParams();
  const dispatch = useDispatch();
  const selectedItem = useSelector((state: RootState) => state.quiz.selectedItem);
  const items = useSelector((state: RootState) => state.quiz.multypleselectedItem);
  const quizId = `${params?.quizId ?? ""}`;
  const quizItems = items.filter((i) => `${i.quiz_id}` === quizId);
  const [loaded, setLoaded] = useState(false);

  // The selected question of this quiz (hovering a question in the list no longer swaps the editor).
  const activeItem: QuizItem | null =
    selectedItem && quizItems.some((i) => `${i.id}` === `${selectedItem.id}`) ? selectedItem : null;

  // Questions but none selected (e.g. the selected one was deleted): open the first one.
  useEffect(() => {
    if (loaded && !activeItem && quizItems.length > 0) {
      const first = [...quizItems].sort((a, b) => (a.position || 0) - (b.position || 0))[0];
      dispatch(setSelectedItem(first));
    }
  }, [loaded, activeItem, quizItems, dispatch]);

  const renderPreview = (item: QuizItem | null) => {
    if (!loaded) return <EditorLoading />;
    if (!item) return quizItems.length === 0 ? <QuizEmptyState quizId={quizId} /> : null;
    switch (item.key) {
      case 'quiz':
        return <QuizCreatorPreview id={item.id} />;
      case 'truefalse':
        return <TrueFalseCreatorPreview id={item.id} />;
      case 'sortanswer':
        return <SortAnswerCreatorPreview id={item.id} />;
      case 'fillintheblanks':
        return <FillInTheBlanksCreatorPreview id={item.id} />;
      default:
        return <UnsupportedQuestion />;
    }
  };

  useEffect(() => {
    const dataFetch = async () => {
      try {
        const response = await axiosInstance.get<QuizApiResponse>(`/quizes/show/${params?.quizId}`);
        const transformedData = transformQuestionData(response?.data?.data?.quiz?.questions);
        dispatch(setMultipleSelectedItems(transformedData));
        dispatch(clearHoveredItem());
        // Keep the selection only if it is one of these questions (the store may hold another quiz's), else the first.
        const current = store.getState().quiz.selectedItem;
        const keep = current && transformedData.find((item) => item.id === `${current.id}`);
        dispatch(setSelectedItem(keep ?? transformedData[0] ?? null));

        dispatch(setQuiz(response?.data?.data));
      } catch (error) {
        const axiosError = error as AxiosError<{ message?: string }>;

        if (axiosError.response) {
          console.error('Error verifying token:', axiosError.response.data);
          toast.error(`Error: ${axiosError.response.data?.message || 'Verification failed.'}`);
        } else {
          console.error('Unexpected error:', axiosError.message);
          toast.error('Unexpected error occurred. Please try again.');
        }
      } finally {
        setLoaded(true);
      }
    }
    dataFetch()
  }, [params?.quizId, dispatch])
  return (
    <div>
      {renderPreview(activeItem)}
    </div>
  )
}

export default QuizCreator
