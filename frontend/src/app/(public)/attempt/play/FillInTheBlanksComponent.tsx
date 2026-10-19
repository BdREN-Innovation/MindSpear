import React, { useMemo, useState } from 'react';
import { QuizQuestion } from '@/types/public';
import Image from "next/image";

interface QuizComponentProps {
  question: QuizQuestion;
  onOptionSelect: (optionId: string) => void;
  disabled?: boolean;
  timeLeft?: number;
}

// The editor asks for "____" where the answer goes.
const BLANK = /_{3,}/;

const htmlToText = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/**
 * A sentence with a gap and the answers to fill it with. Players tap an answer (or drag it onto
 * the gap). It used to take drag-and-drop only, with no hint: a tap did nothing, so on a phone
 * the question could not be answered and "Finish Quiz" stayed disabled.
 */
const FillInTheBlanksComponent: React.FC<QuizComponentProps> = ({
  question,
  onOptionSelect,
  disabled,
  timeLeft,
}) => {
  const { title, source_content_url, options, isMultipleSelection } = question;
  const [draggedOption, setDraggedOption] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  const parts = useMemo(() => htmlToText(title ?? "").split(BLANK), [title]);
  const blankCount = Math.max(parts.length - 1, 0);
  // What fills the gaps comes from the selection the quiz keeps, so it survives Previous / Next.
  const chosen = options.filter((option) => option.text && option.isSelected);

  const formatTime = (seconds: number) => {
    if (seconds === undefined) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const isTimeUp = timeLeft !== undefined && timeLeft <= 0;
  const optionsDisabled = disabled || isTimeUp;

  const pick = (optionId: string) => {
    if (optionsDisabled) return;
    const option = options.find((item) => item.id === optionId);
    // A single answer is replaced by the next pick; with several gaps, a picked answer is taken back.
    if (!isMultipleSelection && option?.isSelected) return;
    onOptionSelect(optionId);
  };

  const gap = (index: number) => {
    const filled = isMultipleSelection ? chosen[index] : chosen[0];
    return (
      <button
        key={`gap-${index}`}
        type="button"
        disabled={optionsDisabled || !filled || !isMultipleSelection}
        onClick={() => filled && pick(filled.id)}
        onDragOver={(e) => {
          e.preventDefault();
          setDropTarget(index);
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDropTarget(null);
          if (draggedOption) pick(draggedOption);
          setDraggedOption(null);
        }}
        aria-label={filled ? `Answer: ${filled.text}` : "Empty blank"}
        className={`mx-1 inline-flex min-w-[96px] items-center justify-center rounded-md border-b-2 px-3 py-0.5 align-baseline transition ${
          filled ? 'border-white bg-white text-[#1e3a8a]' : 'border-white/80 bg-white/10 text-white/60'
        } ${dropTarget === index ? 'ring-2 ring-white' : ''} disabled:cursor-default`}
      >
        {filled ? filled.text : '?'}
      </button>
    );
  };

  return (
    <div className="quiz-container rounded-lg mb-6">
      <div className='grid grid-cols-12 gap-5'>
        <div className='col-span-12 md:col-span-8 md:col-start-3'>
          {timeLeft !== undefined && (
            <div className={`text-lg w-full justify-center flex pb-[20px] font-semibold ${timeLeft <= 0 ? 'text-red-600' : 'text-white'}`}>
              Time: {formatTime(timeLeft)}
            </div>
          )}

          <div className="mb-4 flex min-h-[100px] w-full items-stretch rounded-[10px] border border-white">
            <div className='w-[10px] shrink-0 rounded-[30px] bg-white'></div>
            <p className="flex-1 px-4 py-6 text-xl font-bold leading-[2.2] text-white">
              {blankCount === 0
                ? <>{parts[0]} {gap(0)}</>
                : parts.map((text, index) => (
                    <React.Fragment key={index}>
                      {text}
                      {index < blankCount && gap(index)}
                    </React.Fragment>
                  ))}
            </p>
          </div>

          <p className="mb-3 inline-flex rounded-full bg-white/15 px-3 py-1 text-sm font-medium text-white">
            {isMultipleSelection ? 'Tap the answers to fill the blanks' : 'Tap an answer to fill the blank'}
          </p>

          {source_content_url && (
            <div className="flex justify-center mb-4">
              <Image
                src={source_content_url}
                alt="Quiz visual"
                unoptimized
                width={176}
                height={64}
                className="max-h-64 w-auto rounded-md"
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {options.map((option) => (
              option.text && (
                <button
                  key={option.id}
                  type="button"
                  draggable={!optionsDisabled}
                  onDragStart={() => setDraggedOption(option.id)}
                  onDragEnd={() => setDraggedOption(null)}
                  onClick={() => pick(option.id)}
                  disabled={optionsDisabled}
                  aria-pressed={option.isSelected || false}
                  className={`relative flex items-center justify-between rounded-lg border bg-white px-4 py-6 text-left transition ${
                    optionsDisabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-gray-50'
                  } ${option.isSelected ? 'ring-4 ring-purple-400' : ''}`}
                >
                  <span className="absolute left-0 top-0 h-[5px] w-full rounded-full" style={{ backgroundColor: option.color }} />
                  <span className="flex items-center">
                    <span className="mr-3 h-4 w-4 rounded-full" style={{ backgroundColor: option.color }} />
                    <span>{option.text}</span>
                  </span>
                  {option.isSelected && (
                    <svg className="h-8 w-8 text-purple-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              )
            ))}
          </div>

          {isTimeUp && (
            <div className="mt-3 inline-flex rounded-full bg-white/15 px-3 py-1 text-sm font-medium text-white">
              Time&apos;s up! Answers are closed for this question.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FillInTheBlanksComponent;
