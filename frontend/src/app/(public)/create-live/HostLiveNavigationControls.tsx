/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Square } from "lucide-react";

interface NavigationControlsProps {
  currentView: any;
  isFullscreen: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggleFullscreen: () => void;
  /** 1-based position and count, shown between the buttons. */
  current?: number;
  total?: number;
  /** "Question" for a quiz, "Slide" for a quest. */
  itemLabel?: string;
  onEnd?: () => void;
  endLabel?: string;
}

/**
 * The host's controls, pinned to the bottom of the screen. They used to be three unlabeled
 * 16px icons below the fold, so a host couldn't find how to move on.
 * Arrow keys / PageUp / PageDown also work (presentation clickers send those).
 */
export default function HostLiveNavigationControls({
  isFullscreen,
  onPrev,
  onNext,
  onToggleFullscreen,
  current,
  total,
  itemLabel = "Question",
  onEnd,
  endLabel = "End",
}: NavigationControlsProps) {
  const isFirst = current !== undefined && current <= 1;
  const isLast = current !== undefined && total !== undefined && current >= total;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        onNext();
      } else if ((event.key === "ArrowLeft" || event.key === "PageUp") && !isFirst) {
        event.preventDefault();
        onPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, onPrev, isFirst]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={isFirst}
            className="inline-flex h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Previous
          </button>
          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
            title={isFullscreen ? "Exit full screen" : "Full screen"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>

        {current !== undefined && total ? (
          <span className="text-sm font-semibold text-slate-600">
            {itemLabel} {current} of {total}
          </span>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          {onEnd && (
            <button
              type="button"
              onClick={onEnd}
              className="hidden h-10 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 sm:inline-flex"
            >
              <Square className="h-3.5 w-3.5" aria-hidden />
              {endLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            className="inline-flex h-10 items-center gap-1 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition hover:opacity-90"
          >
            {isLast ? "Finish" : `Next ${itemLabel.toLowerCase()}`}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
