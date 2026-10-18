import React, { useState, useEffect } from 'react';
import { QuizQuestion } from '@/types/public';
import Image from "next/image";

interface SortAnswerBlanksProps {
  question: QuizQuestion;
  onOptionSelect: (optionId: string) => void;
  disabled?: boolean;
  timeLeft?: number;
  onAnswerChange?: (hasAnswer: boolean) => void;
  onTextChange?: (text: string) => void; 
}

const SortAnswerBlanksComponent: React.FC<SortAnswerBlanksProps> = ({ 
  question, 
  disabled,
  timeLeft,
  onAnswerChange,
  onOptionSelect,
  onTextChange
}) => {
  const { id, title, source_content_url } = question;
  const [newItemText, setNewItemText] = useState('');
  const [hasHydrated, setHasHydrated] = useState(false);

  // Generate a unique storage key based on quiz and question ID
  const storageKey = `quiz-${question.quiz_id}-q${id}-text`;

  const formatTime = (seconds: number) => {
    if (seconds === undefined) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const isTimeUp = timeLeft !== undefined && timeLeft <= 0;
  const optionsDisabled = disabled || isTimeUp;

  // Load saved text from localStorage on component mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedText = localStorage.getItem(storageKey);
      if (savedText) {
        try {
          setNewItemText(savedText);
          if (onAnswerChange) {
            onAnswerChange(savedText.trim().length > 0);
          }
        } catch (e) {
          console.error('Failed to parse saved text', e);
        }
      }
      setHasHydrated(true);
    }
  }, [storageKey]);

  // Save text to localStorage whenever it changes
  useEffect(() => {
    if (hasHydrated && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, newItemText);
    }
    if (onAnswerChange) {
      onAnswerChange(newItemText.trim().length > 0);
    }
  }, [newItemText, storageKey, onAnswerChange, hasHydrated]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setNewItemText(value);
    onOptionSelect(value); 
    if (onTextChange) {
      onTextChange(value); 
    }
  };

  return (
    <div className="quiz-container rounded-lg mb-6">
      <div className='grid grid-cols-12 gap-5 '>
        <div className='col-span-12 md:col-span-8 md:col-start-3 '>
          {timeLeft !== undefined && (
            <div className={`text-lg w-full justify-center flex pb-[20px] font-semibold ${timeLeft <= 0 ? 'text-red-600' : 'text-white'}`}>
              Time: {formatTime(timeLeft)}
            </div>
          )}
          
          <div className=" justify-between items-center mb-4 flex">
            <div className='w-full border border-[#fff] rounded-[10px] relative h-[100px] flex justify-start items-center'>
              <div className='w-[10px] h-[100px] bg-[#fff] rounded-[30px] '></div>
              <div className="text-xl font-bold text-[#fff] pl-[10px]" dangerouslySetInnerHTML={{ __html: title }} />
            </div>
          </div>

          <div className='flex items-center justify-center'>
            {source_content_url && (
              <div className="flex justify-center mb-4">
                <Image
                  src={source_content_url} 
                  alt="Quiz visual"
                  unoptimized
                  width={176}
                  height={64}
                  className="max-h-64 rounded-md"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 relative">
            <input
              type="text"
              value={newItemText}
              onChange={handleTextChange}
              placeholder="Enter your answer"
              className="flex-1 px-4 py-8 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              disabled={optionsDisabled}
            />
            <div
              className="w-full h-[5px] bg-primary rounded-full absolute top-0 left-0"
            ></div>
          </div>
        </div>
      </div>

      {isTimeUp && (
        <div className="mt-2 hidden text-red-600 text-sm">
          <p>Times up! Options are now disabled.</p>
        </div>
      )}
    </div>
  );
};

export default SortAnswerBlanksComponent;