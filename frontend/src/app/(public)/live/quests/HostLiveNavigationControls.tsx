/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FaAngleLeft, FaAngleRight, FaRegLightbulb } from "react-icons/fa6";
import { MdFullscreenExit, MdFullscreen } from "react-icons/md";
import { QuestHostControlDock } from "@/features/live/components/quest-host-ui";

// Readable type names ("longanswer" was shown as is).
const TYPE_LABELS: Record<string, string> = {
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  truefalse: "Yes / No",
  wordcloud: "Word cloud",
  shortanswer: "Short answer",
  longanswer: "Long answer",
  quick_form: "Quick form",
};

interface NavigationControlsProps {
  currentView: any;
  isFullscreen: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggleFullscreen: () => void;
  isBusy?: boolean;
  /** Previous does nothing on the first question; Next ends the quest on the last one. */
  isFirst?: boolean;
  isLast?: boolean;
}

export default function HostLiveNavigationControls({
  currentView,
  isFullscreen,
  onPrev,
  onNext,
  onToggleFullscreen,
  isBusy = false,
  isFirst = false,
  isLast = false,
}: NavigationControlsProps) {
  return (
    <QuestHostControlDock>
      <button
        type="button"
        onClick={onPrev}
        disabled={isBusy || isFirst}
        className="inline-flex h-12 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Previous question"
      >
        <FaAngleLeft className="text-lg" />
        <span className="hidden sm:inline">Previous</span>
      </button>

      <div className="hidden items-center gap-2 rounded-full bg-secondary/10 px-3 py-2 text-xs font-black uppercase tracking-wide text-secondary md:flex">
        <FaRegLightbulb />
        {TYPE_LABELS[String(currentView)] ?? String(currentView || "slide").replaceAll("_", " ")}
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={isBusy}
        className="group relative inline-flex h-14 items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-primary via-secondary to-accent px-6 text-base font-bold text-white shadow-lg shadow-primary/25 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={isLast ? "Finish the quest" : "Next question"}
      >
        <span className="absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-18deg] bg-white/25 transition duration-700 group-hover:left-[120%]" />
        <span>{isBusy ? "Starting..." : isLast ? "Finish" : "Next"}</span>
        <FaAngleRight className="text-xl" />
      </button>

      <button
        onClick={onToggleFullscreen}
        className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-secondary/20 bg-secondary text-[22px] text-white shadow-md transition hover:-translate-y-0.5 hover:bg-secondary/90"
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        type="button"
      >
        {isFullscreen ? <MdFullscreenExit /> : <MdFullscreen />}
      </button>
    </QuestHostControlDock>
  );
}
