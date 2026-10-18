// import React from 'react';
// import { QuizQuestion } from '@/types/public';
// import Image from "next/image";
// // import { IoCheckmarkDoneSharp } from "react-icons/io5";
// interface QuizComponentProps {
//   question: QuizQuestion;
//   onOptionSelect: (optionId: string) => void;
//   disabled?: boolean;
//   timeLeft?: number;
// }

// const FillInTheBlanksComponent: React.FC<QuizComponentProps> = ({ 
//   question, 
//   onOptionSelect, 
//   disabled,
//   timeLeft
// }) => {
//   const { title, source_content_url, options, isMultipleSelection } = question;

//   const formatTime = (seconds: number) => {
//     if (seconds === undefined) return '';
//     const mins = Math.floor(seconds / 60);
//     const secs = seconds % 60;
//     return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
//   };

//   // Determine if options should be disabled
//   const isTimeUp = timeLeft !== undefined && timeLeft <= 0;
//   const optionsDisabled = disabled || isTimeUp;

//   return (
//     <div className="quiz-container rounded-lg mb-6 ">
//       <div className='grid grid-cols-12 gap-5 '>
//         <div className='col-span-12 md:col-span-8 md:col-start-3 '>
//           {timeLeft !== undefined && (
//             <div className={`text-lg w-full justify-center flex pb-[20px] font-semibold ${timeLeft <= 0 ? 'text-red-600' : 'text-white'}`}>
//               Time: {formatTime(timeLeft)}
//             </div>
//           )}

//           <div className=" justify-between items-center mb-4 flex">
//             <div className='w-full border border-[#fff]  rounded-[10px] relative h-[100px] flex justify-start items-center'>
//               <div className='w-[10px] h-[100px] bg-[#fff] rounded-[30px] '></div>
//               <div className="text-xl font-bold text-[#fff] pl-[10px]" dangerouslySetInnerHTML={{ __html: title }} />
//             </div>
//           </div>

//             <div className=' flex items-center justify-center'>
//               {source_content_url && (
//                 <div className="flex justify-center mb-4 ">
//                   <Image
//                     src={source_content_url} 
//                     alt="Quiz visual"
//                     width={176}
//                     height={64}
//                     className="max-h-64 rounded-md"
//                   />
//                 </div>
//               )}
//             </div>


//             <div className="grid grid-cols-1 md:grid-cols-1 gap-3">
//               {options.map((option) => (
//                 option.text && (
//                   <div 
//                     key={option.id}
//                     onClick={() => !optionsDisabled && onOptionSelect(option.id)}
//                     className={`flex items-center justify-between cursor-pointer relative bg-white px-4 py-6  border rounded-lg transition-colors ${
//                       optionsDisabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-gray-50'
//                     } `}
//                   >
//                     <div
//                       className="w-full h-[5px] rounded-full absolute top-0 left-0"
//                       style={{ backgroundColor: option.color }}
//                     ></div>
//                     <div className="flex items-center">
//                       <div 
//                         className="w-4 h-4 rounded-full mr-3" 
//                         style={{ backgroundColor: option.color }}
//                       ></div>
//                       <span>{option.text}</span>
//                     </div>
                    
//                     {option.isSelected ? (
//                       <svg className="h-10 w-10 text-purple-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
//                         <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
//                       </svg>
//                     ) : (
//                       <input
//                         type={isMultipleSelection ? "checkbox" : "radio"}
//                         checked={option.isSelected || false}
//                         readOnly
//                         className="h-4 w-4 text-purple-600 focus:ring-purple-500 opacity-0"
//                         disabled={optionsDisabled}
//                       />
//                     )}
//                   </div>
//                 )
//               ))}
//             </div>
//             {isTimeUp && (
//               <div className="mt-2 text-red-600 text-sm">
//                 <p> Time s up! Options are now disabled. </p>
//               </div>
//             )}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default FillInTheBlanksComponent;






import React, { useState, useEffect, JSX } from 'react';
import { QuizQuestion } from '@/types/public';
import Image from "next/image";

interface QuizComponentProps {
  question: QuizQuestion;
  onOptionSelect: (optionId: string) => void;
  disabled?: boolean;
  timeLeft?: number;
  onAllBlanksFilled?: (filled: boolean) => void;
}

interface BlankPosition {
  index: number;
  start: number;
  end: number;
  filledOptionId: string | null;
}

const FillInTheBlanksComponent: React.FC<QuizComponentProps> = ({
  question,
  onOptionSelect,
  disabled,
  timeLeft,
  onAllBlanksFilled
}) => {
  const { title, source_content_url, options, isMultipleSelection } = question;
  const [draggedOption, setDraggedOption] = useState<string | null>(null);
  const [blankPositions, setBlankPositions] = useState<BlankPosition[]>([]);
  const [optionList, setOptionList] = useState([...options]);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setOptionList([...options]);
  }, [options]);

  const allBlanksFilled = blankPositions.every(blank => blank.filledOptionId !== null);

  useEffect(() => {
    if (onAllBlanksFilled) {
      onAllBlanksFilled(allBlanksFilled);
    }
  }, [allBlanksFilled, onAllBlanksFilled]);

  useEffect(() => {
    const regex = /_{4,}/g;
    const blanks: BlankPosition[] = [];
    let match;
    let index = 0;

    while ((match = regex.exec(title)) !== null) {
      blanks.push({
        index,
        start: match.index,
        end: match.index + match[0].length,
        filledOptionId: null
      });
      index++;
    }

    setBlankPositions(blanks);
  }, [title]);

  const formatTime = (seconds: number) => {
    if (seconds === undefined) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const isTimeUp = timeLeft !== undefined && timeLeft <= 0;
  const optionsDisabled = disabled || isTimeUp;

  const handleDragStart = (optionId: string) => {
    if (optionsDisabled) return;
    setDraggedOption(optionId);
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.currentTarget.classList.add('ring-2', 'ring-white', 'ring-opacity-50');
  };

  const handleDragLeave = (e: React.DragEvent<HTMLSpanElement>) => {
    e.currentTarget.classList.remove('ring-2', 'ring-white', 'ring-opacity-50');
  };

  const handleDrop = (e: React.DragEvent<HTMLSpanElement>, blankIndex: number) => {
    e.preventDefault();
    e.currentTarget.classList.remove('ring-2', 'ring-white', 'ring-opacity-50');

    if (!draggedOption || optionsDisabled) return;

    const updatedBlanks = blankPositions.map((blank, index) => {
      if (index === blankIndex) {
        return { ...blank, filledOptionId: draggedOption };
      }
      if (blank.filledOptionId === draggedOption) {
        return { ...blank, filledOptionId: null };
      }
      return blank;
    });

    const updatedOptions = optionList.map(opt =>
      opt.id === draggedOption ? { ...opt, isSelected: true } : opt
    );

    setBlankPositions(updatedBlanks);
    setOptionList(updatedOptions);
    setDraggedOption(null);
    onOptionSelect(draggedOption);
  };

  const handleRemoveBlank = (blankIndex: number) => {
    const removedOptionId = blankPositions[blankIndex].filledOptionId;

    const updatedBlanks = blankPositions.map((blank, index) => {
      if (index === blankIndex) {
        return { ...blank, filledOptionId: null };
      }
      return blank;
    });

    const updatedOptions = optionList.map(opt =>
      opt.id === removedOptionId ? { ...opt, isSelected: false } : opt
    );

    setBlankPositions(updatedBlanks);
    setOptionList(updatedOptions);

    if (removedOptionId) {
      onOptionSelect(removedOptionId);
    }
  };

  const getOptionTextById = (id: string) => {
    const option = optionList.find(opt => opt.id === id);
    return option ? option.text : '';
  };

  const renderTitleWithBlanks = () => {
    if (blankPositions.length === 0) {
      return <div dangerouslySetInnerHTML={{ __html: title }} />;
    }

    let lastPos = 0;
    const elements: JSX.Element[] = [];

    blankPositions.forEach((blank, index) => {
      if (blank.start > lastPos) {
        elements.push(
          <span key={`text-${lastPos}`} dangerouslySetInnerHTML={{
            __html: title.slice(lastPos, blank.start)
          }} />
        );
      }

      elements.push(
        <span
          key={`blank-${index}`}
          className={`inline-flex items-center min-w-[80px] border-b-2 border-white mx-1 px-2 py-1 transition-all duration-200 ${
            blank.filledOptionId ? '' : 'hover:bg-white hover:bg-opacity-10'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, index)}
        >
          {blank.filledOptionId ? (
            <div className="flex items-center">
              <span className="text-white mr-1">
                {getOptionTextById(blank.filledOptionId)}
              </span>
              <button
                onClick={() => handleRemoveBlank(index)}
                className="text-white hover:text-red-400 transition-colors duration-150"
                aria-label="Remove answer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <span className="text-transparent">____</span>
          )}
        </span>
      );

      lastPos = blank.end;
    });

    if (lastPos < title.length) {
      elements.push(
        <span key={`text-${lastPos}`} dangerouslySetInnerHTML={{
          __html: title.slice(lastPos)
        }} />
      );
    }

    return elements;
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {optionList.map((option) => (
              option.text && (
                <div
                  key={option.id}
                  draggable={!optionsDisabled}
                  onDragStart={() => handleDragStart(option.id)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center justify-between relative !bg-white px-4 py-6 border rounded-lg transition-all duration-200 opacity-100 ${
                    optionsDisabled
                      ? 'cursor-not-allowed bg-white'
                      : `cursor-grab ${isDragging ? 'opacity-100' : 'hover:bg-gray-50 hover:scale-[1.01]'}`
                  } ${isDragging && draggedOption === option.id ? 'scale-95 opacity-100' : ''}`}
                >
                  <div className="w-full h-[5px] rounded-full absolute top-0 left-0" style={{ backgroundColor: option.color }}></div>
                  <div className="flex items-center">
                    <div className="w-4 h-4 rounded-full mr-3" style={{ backgroundColor: option.color }}></div>
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

          <div className="justify-between items-center mt-6 flex">
            <div className='w-full border border-[#fff] rounded-[10px] relative h-[100px] flex justify-start items-center overflow-visible'>
              <div className='w-[10px] h-[100px] bg-[#fff] rounded-[30px]'></div>
              <div className="text-xl font-bold text-[#fff] px-4 overflow-visible">
                {renderTitleWithBlanks()}
              </div>
            </div>
          </div>

          {isTimeUp && (
            <div className="mt-2 text-red-600 text-sm">
              <p>Times up! Options are now disabled.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FillInTheBlanksComponent;
