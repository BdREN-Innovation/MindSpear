"use client";

import { useId, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { getHostApi, toFunGamesError } from "../../../api";
import type { HostQuestion, HostQuestionInput, QuestionOption } from "../../../types";
import { btnPrimary, btnSecondary, inputClass, labelClass } from "../../shared/hostStyles";
import { PER_QUESTION_MAX, PER_QUESTION_MIN } from "./TimerModeSelector";

const MAX_OPTIONS = 10;

type QuestionEditorProps = {
	gameId: string;
	/** Omit to add a new question. */
	question?: HostQuestion;
	defaultMarks: number;
	defaultNegativeMarks: number;
	perQuestionMode: boolean;
	onSaved: (question: HostQuestion) => void;
	onCancel: () => void;
};

const nextOptionId = (options: QuestionOption[]) =>
	`o${options.reduce((max, o) => Math.max(max, Number(o.id.replace(/\D/g, "")) || 0), 0) + 1}`;

export function QuestionEditor({
	gameId,
	question,
	defaultMarks,
	defaultNegativeMarks,
	perQuestionMode,
	onSaved,
	onCancel,
}: QuestionEditorProps) {
	const id = useId();
	const [text, setText] = useState(question?.text ?? "");
	const [options, setOptions] = useState<QuestionOption[]>(
		question?.options ?? [
			{ id: "o1", text: "" },
			{ id: "o2", text: "" },
			{ id: "o3", text: "" },
			{ id: "o4", text: "" },
		],
	);
	const [correct, setCorrect] = useState<string | null>(question?.correctOptionId ?? null);
	const [marks, setMarks] = useState(String(question?.marks ?? defaultMarks));
	const [negative, setNegative] = useState(String(question?.negativeMarks ?? defaultNegativeMarks));
	const [ownTime, setOwnTime] = useState(question?.secondsOverride ? String(question.secondsOverride) : "");
	const [imageUrl, setImageUrl] = useState(question?.imageUrl ?? "");
	const [touched, setTouched] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const filled = options.filter((o) => o.text.trim());
	const problems: string[] = [];
	if (!text.trim()) problems.push("Write the question.");
	if (filled.length < 2) problems.push("Add at least two answer options.");
	if (!correct || !filled.some((o) => o.id === correct)) problems.push("Mark the correct answer.");
	if (!(Number(marks) >= 0)) problems.push("Marks must be 0 or more.");
	if (!(Number(negative) >= 0)) problems.push("The penalty must be 0 or more.");
	if (ownTime && !(Number(ownTime) >= PER_QUESTION_MIN && Number(ownTime) <= PER_QUESTION_MAX)) {
		problems.push(`Own time must be between ${PER_QUESTION_MIN} and ${PER_QUESTION_MAX} seconds.`);
	}
	if (imageUrl.trim() && !/^https?:\/\/\S+$/i.test(imageUrl.trim())) problems.push("The image must be a web address (https://…).");

	const save = async () => {
		setTouched(true);
		setError(null);
		if (problems.length) return;
		const input: HostQuestionInput = {
			type: "single_choice",
			text: text.trim(),
			options: filled.map((o) => ({ id: o.id, text: o.text.trim() })),
			correctOptionId: correct!,
			marks: Number(marks),
			negativeMarks: Number(negative),
			secondsOverride: ownTime ? Number(ownTime) : null,
			imageUrl: imageUrl.trim() || null,
		};
		setBusy(true);
		try {
			const api = await getHostApi();
			onSaved(question ? await api.updateQuestion(gameId, question.id, input) : await api.createQuestion(gameId, input));
		} catch (reason) {
			setError(toFunGamesError(reason).message);
			setBusy(false);
		}
	};

	return (
		<div className="space-y-4 rounded-xl border-2 border-blue-dark bg-white p-4 dark:bg-gray-dark">
			<div>
				<label htmlFor={`${id}-text`} className={labelClass}>
					Question
				</label>
				<textarea
					id={`${id}-text`}
					value={text}
					onChange={(e) => setText(e.target.value)}
					rows={3}
					maxLength={2000}
					className={inputClass}
					autoFocus
				/>
			</div>

			<fieldset>
				<legend className={labelClass}>Answer options · select the correct one</legend>
				<ul className="space-y-2">
					{options.map((option, index) => (
						<li key={option.id} className="flex items-center gap-2">
							<input
								type="radio"
								name={`${id}-correct`}
								checked={correct === option.id}
								onChange={() => setCorrect(option.id)}
								aria-label={`Option ${String.fromCharCode(65 + index)} is correct`}
								className="h-4 w-4 shrink-0"
							/>
							<span className="w-5 shrink-0 font-mono text-sm text-dark-5" aria-hidden>
								{String.fromCharCode(65 + index)}
							</span>
							<input
								value={option.text}
								onChange={(e) =>
									setOptions((prev) => prev.map((o) => (o.id === option.id ? { ...o, text: e.target.value } : o)))
								}
								aria-label={`Option ${String.fromCharCode(65 + index)}`}
								placeholder={index < 2 ? "Answer option" : "Answer option (optional)"}
								maxLength={500}
								className={inputClass}
							/>
							{correct === option.id ? (
								<span className="shrink-0 rounded-full bg-green-light-7 px-2 py-0.5 text-xs font-semibold text-green-dark">
									Correct
								</span>
							) : null}
							<button
								type="button"
								onClick={() => {
									setOptions((prev) => prev.filter((o) => o.id !== option.id));
									if (correct === option.id) setCorrect(null);
								}}
								disabled={options.length <= 2}
								aria-label={`Remove option ${String.fromCharCode(65 + index)}`}
								className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-dark-5 hover:bg-gray-2 disabled:opacity-30 dark:hover:bg-dark-2"
							>
								<X className="h-4 w-4" aria-hidden />
							</button>
						</li>
					))}
				</ul>
				{options.length < MAX_OPTIONS ? (
					<button
						type="button"
						onClick={() => setOptions((prev) => [...prev, { id: nextOptionId(prev), text: "" }])}
						className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-blue-dark hover:underline"
					>
						<Plus className="h-4 w-4" aria-hidden />
						Add option
					</button>
				) : null}
				<p className="mt-1 text-xs text-dark-5">The correct answer stays on the server — players never receive it.</p>
			</fieldset>

			<div className="grid gap-3 sm:grid-cols-3">
				<div>
					<label htmlFor={`${id}-marks`} className={labelClass}>
						Marks if correct
					</label>
					<input id={`${id}-marks`} type="number" min={0} step={0.5} value={marks} onChange={(e) => setMarks(e.target.value)} className={`${inputClass} font-mono`} />
				</div>
				<div>
					<label htmlFor={`${id}-neg`} className={labelClass}>
						Deduct if wrong
					</label>
					<input id={`${id}-neg`} type="number" min={0} step={0.25} value={negative} onChange={(e) => setNegative(e.target.value)} className={`${inputClass} font-mono`} />
				</div>
				<div>
					<label htmlFor={`${id}-time`} className={labelClass}>
						Own time <span className="font-normal text-dark-5">(seconds)</span>
					</label>
					<input
						id={`${id}-time`}
						type="number"
						min={PER_QUESTION_MIN}
						max={PER_QUESTION_MAX}
						value={ownTime}
						onChange={(e) => setOwnTime(e.target.value)}
						placeholder="Default"
						aria-describedby={`${id}-time-help`}
						className={`${inputClass} font-mono`}
					/>
					<p id={`${id}-time-help`} className="mt-1 text-xs text-dark-5">
						{perQuestionMode ? "Leave empty to use the game's time per question." : "Only used with the per-question timer."}
					</p>
				</div>
			</div>

			<div>
				<label htmlFor={`${id}-img`} className={labelClass}>
					Image <span className="font-normal text-dark-5">(optional web address)</span>
				</label>
				<input id={`${id}-img`} type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" className={inputClass} />
			</div>

			{touched && problems.length ? (
				<ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-red-dark">
					{problems.map((p) => (
						<li key={p}>{p}</li>
					))}
				</ul>
			) : null}
			{error ? (
				<p role="alert" className="text-sm font-semibold text-red-dark">
					{error}
				</p>
			) : null}

			<div className="flex justify-end gap-2">
				<button type="button" onClick={onCancel} className={btnSecondary}>
					Cancel
				</button>
				<button type="button" onClick={save} disabled={busy} className={btnPrimary}>
					{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
					{question ? "Save question" : "Add question"}
				</button>
			</div>
		</div>
	);
}
