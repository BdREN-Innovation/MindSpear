"use client";
import React from "react";
import clsx from "clsx";
import { Slider } from "antd";

export type ScaleOption = {
  id: number | string;
  text?: string;
  label?: string;
  color?: string;
};

type Props = {
  option: ScaleOption;
  index: number;
  min: number;
  max: number;
  value: number;
  onChange: (index: number, next: number) => void;
  onSkip: (index: number) => void;
  /** What the ends of the scale mean, e.g. "Strongly disagree" / "Strongly agree". */
  minLabel?: string;
  maxLabel?: string;
};

/**
 * One statement to rate. A short scale (up to 11 points) is a row of number buttons; it used to be
 * a slider that sat on the lowest value while saying "Skipped", with no hint what the ends meant.
 */
const ScaleRow: React.FC<Props> = ({
  option,
  index,
  min,
  max,
  value,
  onChange,
  onSkip,
  minLabel,
  maxLabel,
}) => {
  const displayText = option.text ?? option.label ?? `Statement ${index + 1}`;
  const rated = value !== 0;
  const points = max - min + 1;
  const asButtons = points > 1 && points <= 11;

  return (
    <div className="w-full space-y-3 rounded-lg bg-white p-1">
      <div className="flex items-start justify-between gap-3">
        <div className="text-base font-semibold text-gray-800">{displayText}</div>
        <div
          className={clsx(
            "flex-shrink-0 rounded-lg px-2 py-1 text-xs font-semibold",
            rated ? "bg-[#bc5eb3] text-white" : "bg-slate-100 text-slate-500"
          )}
        >
          {rated ? `Your rating: ${value}` : "Not rated"}
        </div>
      </div>

      {asButtons ? (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={displayText}>
          {Array.from({ length: points }, (_, i) => min + i).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              onClick={() => onChange(index, n)}
              className={clsx(
                "h-11 min-w-11 flex-1 rounded-lg border text-base font-bold transition",
                value === n
                  ? "border-[#bc5eb3] bg-[#bc5eb3] text-white shadow"
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:border-[#bc5eb3]/50 hover:bg-white"
              )}
            >
              {n}
            </button>
          ))}
        </div>
      ) : (
        <Slider
          min={min}
          max={max}
          step={1}
          value={rated ? value : min}
          onChange={(newValue) => onChange(index, Number(newValue))}
          className="w-full"
        />
      )}

      <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>{minLabel ? `${min} = ${minLabel}` : min}</span>
        {rated && (
          <button
            type="button"
            onClick={() => onSkip(index)}
            className="rounded-md px-2 py-1 font-semibold text-slate-500 hover:bg-slate-100"
          >
            Clear
          </button>
        )}
        <span className="text-right">{maxLabel ? `${max} = ${maxLabel}` : max}</span>
      </div>
    </div>
  );
};

export default ScaleRow;
