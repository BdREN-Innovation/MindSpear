"use client";

import { useState } from "react";
import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Plus, Timer, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getHostApi, toFunGamesError } from "../../../api";
import { formatMarks } from "../../../lib/format";
import type { HostGameDetail, HostQuestion } from "../../../types";
import { ConfirmDialog } from "../../shared/ConfirmDialog";
import { btnSecondary } from "../../shared/hostStyles";
import { QuestionEditor } from "./QuestionEditor";

function Row({
	question,
	index,
	perQuestionMode,
	locked,
	onEdit,
	onDelete,
}: {
	question: HostQuestion;
	index: number;
	perQuestionMode: boolean;
	locked: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: question.id,
		disabled: locked,
	});
	const correct = question.options.find((o) => o.id === question.correctOptionId);
	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Transform.toString(transform), transition }}
			className={cn(
				"flex items-start gap-2 rounded-lg border border-stroke bg-white p-3 dark:border-stroke-dark dark:bg-gray-dark",
				isDragging && "relative z-10 shadow-lg",
			)}
		>
			<button
				type="button"
				{...attributes}
				{...listeners}
				disabled={locked}
				aria-label={`Move question ${index + 1}. Use arrow keys after pressing space.`}
				className="mt-0.5 flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded text-dark-5 hover:bg-gray-2 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-dark-2"
			>
				<GripVertical className="h-4 w-4" aria-hidden />
			</button>
			<span className="mt-1 w-8 shrink-0 font-mono text-sm tabular-nums text-dark-5">Q{String(index + 1).padStart(2, "0")}</span>
			<div className="min-w-0 flex-1">
				<p className="line-clamp-2 text-sm font-medium text-dark dark:text-white">{question.text}</p>
				<p className="mt-0.5 truncate text-xs text-dark-5">
					Correct: <span className="text-green-dark">{correct?.text ?? "—"}</span> · {question.options.length} options
				</p>
			</div>
			<div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
				{perQuestionMode && question.secondsOverride ? (
					<span className="inline-flex items-center gap-1 rounded-full border border-stroke px-2 py-0.5 font-mono text-xs tabular-nums text-dark-4 dark:border-stroke-dark dark:text-dark-6">
						<Timer className="h-3 w-3" aria-hidden />
						{question.secondsOverride}s
					</span>
				) : null}
				<span className="rounded-full border border-stroke px-2 py-0.5 font-mono text-xs tabular-nums text-dark-4 dark:border-stroke-dark dark:text-dark-6">
					{formatMarks(question.marks)} mark{question.marks === 1 ? "" : "s"}
				</span>
				<button
					type="button"
					onClick={onEdit}
					disabled={locked}
					aria-label={`Edit question ${index + 1}`}
					className="flex h-9 w-9 items-center justify-center rounded-lg text-dark-4 hover:bg-gray-2 disabled:opacity-30 dark:hover:bg-dark-2"
				>
					<Pencil className="h-4 w-4" aria-hidden />
				</button>
				<button
					type="button"
					onClick={onDelete}
					disabled={locked}
					aria-label={`Delete question ${index + 1}`}
					className="flex h-9 w-9 items-center justify-center rounded-lg text-red-dark hover:bg-red-light-5 disabled:opacity-30"
				>
					<Trash2 className="h-4 w-4" aria-hidden />
				</button>
			</div>
		</li>
	);
}

type QuestionListProps = {
	game: HostGameDetail;
	perQuestionMode: boolean;
	onChange: (questions: HostQuestion[]) => void;
};

/** Questions are saved one at a time; drag (or Space + arrows) to reorder. */
export function QuestionList({ game, perQuestionMode, onChange }: QuestionListProps) {
	const questions = game.questions;
	const [editing, setEditing] = useState<string | "new" | null>(null);
	const [deleting, setDeleting] = useState<HostQuestion | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const onDragEnd = async ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const previous = questions;
		const next = arrayMove(
			questions,
			questions.findIndex((q) => q.id === active.id),
			questions.findIndex((q) => q.id === over.id),
		);
		onChange(next);
		setError(null);
		try {
			await (await getHostApi()).reorderQuestions(game.id, next.map((q) => q.id));
		} catch (reason) {
			onChange(previous);
			setError(`The new order wasn't saved: ${toFunGamesError(reason).message}`);
		}
	};

	const confirmDelete = async () => {
		if (!deleting) return;
		setBusy(true);
		setError(null);
		try {
			await (await getHostApi()).deleteQuestion(game.id, deleting.id);
			onChange(questions.filter((q) => q.id !== deleting.id));
			setDeleting(null);
		} catch (reason) {
			setError(toFunGamesError(reason).message);
		} finally {
			setBusy(false);
		}
	};

	const editorProps = {
		gameId: game.id,
		defaultMarks: game.defaultMarks,
		defaultNegativeMarks: game.defaultNegativeMarks,
		perQuestionMode,
		onCancel: () => setEditing(null),
	};

	return (
		<div className="space-y-3">
			{error ? (
				<p role="alert" className="rounded-lg border border-red-light-3 bg-red-light-5 px-3 py-2 text-sm text-red-dark">
					{error}
				</p>
			) : null}

			{questions.length === 0 && editing !== "new" ? (
				<p className="rounded-lg border border-dashed border-stroke p-6 text-center text-sm text-dark-5 dark:border-stroke-dark">
					No questions yet. Add one, or import from JSON or My Library.
				</p>
			) : null}

			<DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
				<SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
					<ol className="space-y-2">
						{questions.map((question, index) =>
							editing === question.id ? (
								<li key={question.id}>
									<QuestionEditor
										{...editorProps}
										question={question}
										onSaved={(saved) => {
											onChange(questions.map((q) => (q.id === saved.id ? saved : q)));
											setEditing(null);
										}}
									/>
								</li>
							) : (
								<Row
									key={question.id}
									question={question}
									index={index}
									perQuestionMode={perQuestionMode}
									locked={game.locked}
									onEdit={() => setEditing(question.id)}
									onDelete={() => setDeleting(question)}
								/>
							),
						)}
					</ol>
				</SortableContext>
			</DndContext>

			{editing === "new" ? (
				<QuestionEditor
					{...editorProps}
					onSaved={(saved) => {
						onChange([...questions, saved]);
						setEditing(null);
					}}
				/>
			) : (
				<button type="button" onClick={() => setEditing("new")} disabled={game.locked} className={btnSecondary}>
					<Plus className="h-4 w-4" aria-hidden />
					Add question
				</button>
			)}

			<ConfirmDialog
				open={!!deleting}
				title="Delete this question?"
				confirmLabel="Delete question"
				tone="danger"
				busy={busy}
				onConfirm={confirmDelete}
				onClose={() => setDeleting(null)}
			>
				<p className="line-clamp-3">{deleting?.text}</p>
				<p>Results of games already played keep it.</p>
			</ConfirmDialog>
		</div>
	);
}
