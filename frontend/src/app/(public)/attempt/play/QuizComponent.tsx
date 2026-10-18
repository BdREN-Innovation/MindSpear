import React from 'react';
import { QuizQuestion } from '@/types/public';
import Image from "next/image";
interface QuizComponentProps {
  question: QuizQuestion;
  onOptionSelect: (optionId: string) => void;
  disabled?: boolean;
  timeLeft?: number;
}

const QuizComponent: React.FC<QuizComponentProps> = ({ 
  question, 
  onOptionSelect, 
  disabled,
  timeLeft
}) => {
  const { title, source_content_url, options, isMultipleSelection } = question;
  const formatTime = (seconds: number) => {
    if (seconds === undefined) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const isTimeUp = timeLeft !== undefined && timeLeft <= 0;
  const optionsDisabled = disabled || isTimeUp;

  return (
    <div className="quiz-container rounded-lg mb-6 ">


              
      <div className='grid grid-cols-12 gap-5 '>
        <div className='col-span-12 md:col-span-8 md:col-start-3 '>
           {timeLeft !== undefined && (
                <div className={`text-lg w-full justify-center flex pb-[20px] font-semibold ${timeLeft <= 0 ? 'text-red-600' : 'text-white'}`}>
                  Time: {formatTime(timeLeft)}
                </div>
              )}

            <div className=" justify-between items-center mb-4 flex">
              <div className='w-full border border-[#fff]  rounded-[10px] relative h-[100px] flex justify-start items-center'>
                <div className='w-[10px] h-[100px] bg-[#fff] rounded-[30px] '></div>
                <div className="text-xl font-bold text-[#fff] pl-[10px]" dangerouslySetInnerHTML={{ __html: title }} />
              </div>
            </div>
            
            {isMultipleSelection && (
              <p className="mb-3 inline-flex rounded-full bg-white/15 px-3 py-1 text-sm font-medium text-white">
                Select all that apply
              </p>
            )}

            <div className='flex items-center justify-center'>
              {source_content_url && (
                <div className="flex justify-center mb-4 ">
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
          
            <div className="grid grid-cols-1 md:grid-cols-1 gap-3 ">
              {options.map((option) => (
                option.text && (
                  <div 
                    key={option.id}
                    onClick={() => !optionsDisabled && onOptionSelect(option.id)}
                    className={`flex items-center justify-between cursor-pointer relative bg-white px-4 py-6  border rounded-lg transition-colors ${
                      optionsDisabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-gray-50'
                    } `}
                  >
                    <div
                      className="w-full h-[5px] rounded-full absolute top-0 left-0"
                      style={{ backgroundColor: option.color }}
                    ></div>
                    <div className="flex items-center">
                      <div 
                        className="w-4 h-4 rounded-full mr-3" 
                        style={{ backgroundColor: option.color }}
                      ></div>
                      <span>{option.text}</span>
                    </div>
                    
                    {option.isSelected ? (
                      <svg className="h-10 w-10 text-purple-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <input
                        type={isMultipleSelection ? "checkbox" : "radio"}
                        checked={option.isSelected || false}
                        readOnly
                        className="h-4 w-4 text-purple-600 focus:ring-purple-500 opacity-0"
                        disabled={optionsDisabled}
                      />
                    )}
                  </div>
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

export default QuizComponent;