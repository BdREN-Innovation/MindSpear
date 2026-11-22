import { Check } from "lucide-react";
import type { LegacyQuestion } from "../api";

function Bar({ label, count, total, highlight }: { label: string; count: number; total: number; highlight?: boolean }) {
	const percent = total > 0 ? Math.round((count / total) * 100) : 0;
	return (
		<li>
			<div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
				<span className={`flex min-w-0 items-center gap-1 ${highlight ? "font-semibold text-green-dark" : "text-dark dark:text-white"}`}>
					{highlight && <Check className="h-4 w-4 shrink-0" aria-label="Correct answer" />}
					<span className="truncate">{label}</span>
				</span>
				<span className="shrink-0 tabular-nums text-dark-5">
					{count} · {percent}%
				</span>
			</div>
			<div className="h-2 overflow-hidden rounded-full bg-gray-2 dark:bg-dark-3" aria-hidden>
				<div className={`h-full rounded-full ${highlight ? "bg-green" : "bg-primary"}`} style={{ width: `${percent}%` }} />
			</div>
		</li>
	);
}

/** What one question's answers add up to (backend LegacyAnswers::summary). */
export function QuestionSummary({ question }: { question: LegacyQuestion }) {
	const s = question.summary;
	const total = question.answered;

	if (total === 0) return <p className="text-sm text-dark-5">Nobody answered this question in this session.</p>;

	switch (s.kind) {
		case "choices":
			return (
				<ul className="space-y-3">
					{s.choices.map((c, i) => (
						<Bar key={i} label={c.label} count={c.count} total={total} highlight={c.correct} />
					))}
				</ul>
			);
		case "words":
			return (
				<ul className="flex flex-wrap gap-2">
					{s.words.map((w) => (
						<li key={w.text} className="rounded-full bg-gray-2 px-3 py-1 text-sm text-dark dark:bg-dark-3 dark:text-white">
							{w.text}
							{w.count > 1 && <span className="ml-1.5 font-semibold text-primary">×{w.count}</span>}
						</li>
					))}
				</ul>
			);
		case "ranking":
			return (
				<ol className="space-y-2">
					{s.items.map((item, i) => (
						<li key={item.label} className="flex items-baseline justify-between gap-3 text-sm">
							<span className="text-dark dark:text-white">
								<span className="mr-2 font-semibold text-primary">{i + 1}.</span>
								{item.label}
							</span>
							<span className="shrink-0 text-dark-5">
								{item.average_position === null
									? "not ranked"
									: `average place ${item.average_position} · ranked first by ${item.first} · ranked by ${item.ranked}`}
							</span>
						</li>
					))}
				</ol>
			);
		case "scale":
			return (
				<div className="space-y-4">
					<p className="text-xs text-dark-5">
						Scale {s.min} ({s.min_label ?? "low"}) to {s.max} ({s.max_label ?? "high"})
					</p>
					{s.statements.map((st) => (
						<div key={st.label}>
							<div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
								<span className="text-dark dark:text-white">{st.label}</span>
								<span className="shrink-0 text-dark-5">
									{st.average === null ? "no ratings" : `average ${st.average}`} · {st.answered} rated
									{st.skipped > 0 && ` · ${st.skipped} left it unset`}
								</span>
							</div>
							<div className="flex gap-1" aria-label={`Ratings for ${st.label}`}>
								{Object.entries(st.distribution).map(([value, count]) => {
									const max = Math.max(1, ...Object.values(st.distribution));
									return (
										<div key={value} className="flex flex-1 flex-col items-center gap-1">
											<div className="flex h-12 w-full items-end rounded bg-gray-2 dark:bg-dark-3">
												<div className="w-full rounded bg-primary" style={{ height: `${(count / max) * 100}%` }} />
											</div>
											<span className="text-xs text-dark-5">
												{value}: {count}
											</span>
										</div>
									);
								})}
							</div>
						</div>
					))}
				</div>
			);
		default:
			return <p className="text-sm text-dark-5">See each participant&apos;s answer in the Participants tab.</p>;
	}
}
