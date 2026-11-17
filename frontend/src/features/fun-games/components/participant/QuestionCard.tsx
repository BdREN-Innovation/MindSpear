import { formatMarks } from "../../lib/format";
import type { Question } from "../../types";

type QuestionCardProps = {
	question: Question;
	index: number;
	total: number;
	/** id for the radiogroup's aria-labelledby */
	headingId: string;
};

export function QuestionCard({ question, index, total, headingId }: QuestionCardProps) {
	return (
		<div>
			<div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
				<span className="font-mono tabular-nums">
					Question {String(index + 1).padStart(2, "0")} of {String(total).padStart(2, "0")}
				</span>
				<span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono normal-case tabular-nums tracking-normal text-slate-600">
					+{formatMarks(question.marks)} correct
					{question.negativeMarks > 0 ? ` · −${formatMarks(question.negativeMarks)} wrong` : ""}
				</span>
			</div>
			<h2 id={headingId} className="mt-3 break-words text-xl font-black leading-snug text-slate-950 sm:text-2xl">
				{question.text}
			</h2>
			{question.imageUrl ? (
				// Host-provided URLs from any domain, so next/image's allow-list doesn't fit.
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={question.imageUrl}
					alt={`Image for question ${index + 1}`}
					className="mt-4 max-h-72 w-full rounded-lg border border-slate-200 bg-slate-50 object-contain"
				/>
			) : null}
		</div>
	);
}
