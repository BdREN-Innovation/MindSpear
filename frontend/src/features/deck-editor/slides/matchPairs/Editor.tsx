"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Link2, Plus, Trash2 } from "lucide-react";
import { toDeckApiError } from "@/features/deck/api/errors";
import { QUIZ_LIMITS, type SlideOption } from "@/features/deck/types";
import type { EditorProps, OptionsApi } from "../types";
import { ImageSlot } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";
import { EditorError, EditorWarning, OptionLabelInput, nextAuthorKey } from "../shared/quizEditor";
import { authoringPairs, rowCells, type PairRow } from "./pairs";

// Content tab: 2–8 pairs, each a left and a right cell (label and/or image),
// stored as two options sharing a pair_key (payload {side, pair_key}). Pairs
// are added and removed two options at a time; Move up / down reorders whole
// pairs (players see the left column in this order, the right one shuffled).
//
// There is no batch delete, so removing a pair is checked up front (the
// type's option minimum counts every cell removed, strays included) and, if a
// later delete still fails (network, an edit elsewhere), the cells already
// deleted are put back in their old places: a pair is never left half-deleted.

const BUTTON =
	"flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-dark-5 outline-none transition hover:bg-gray-2 hover:text-dark focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-30 dark:text-dark-6 dark:hover:bg-dark-3";

export function MatchPairsEditor({ slide, onChange, onOptionsChange: api, errors, disabled }: EditorProps<"match_pairs">) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [focusId, setFocusId] = useState<number | null>(null);

	const { rows, orphans } = authoringPairs(slide.options);
	const count = slide.options.length;
	const pairCount = rows.filter((row) => row.left && row.right && row.extras.length === 0).length;
	const canAdd = !disabled && !busy && count + 2 <= api.max && rows.length < QUIZ_LIMITS.maxPairs;
	// Each removal takes every cell of the row, so the minimum is checked against all of them.
	const canRemove = (cells: SlideOption[]) => !disabled && !busy && cells.length > 0 && count - cells.length >= api.min;
	const ignored = [...orphans, ...rows.flatMap((row) => row.extras)];

	const run = async (work: () => Promise<void>) => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await work();
		} catch (reason) {
			const failure = toDeckApiError(reason);
			setError(failure.fieldError("options") ?? failure.fieldError("payload.side") ?? failure.fieldError("payload.pair_key") ?? failure.message);
		} finally {
			setBusy(false);
		}
	};

	const addPair = () =>
		run(async () => {
			const key = nextAuthorKey("p", rows.map((row) => row.key));
			const left = await api.add({ label: null, payload: { side: "left", pair_key: key } });
			await api.add({ label: null, payload: { side: "right", pair_key: key } });
			setFocusId(left.id);
		});

	const addSide = (row: PairRow, side: "left" | "right") =>
		run(async () => {
			const option = await api.add({ label: null, payload: { side, pair_key: row.key } });
			setFocusId(option.id);
		});

	const removeOptions = (cells: SlideOption[]) =>
		run(async () => {
			if (slide.options.length - cells.length < api.min) {
				throw new Error(`A match needs at least ${QUIZ_LIMITS.minPairs} pairs, so this can't be removed.`);
			}
			const before = [...slide.options].sort((a, b) => a.position - b.position || a.id - b.id);
			const removed: SlideOption[] = [];
			try {
				for (const cell of cells) {
					await api.remove(cell.id);
					removed.push(cell);
				}
			} catch (reason) {
				if (removed.length === 0) throw reason;
				const failure = toDeckApiError(reason);
				try {
					await restoreCells(api, before, removed);
				} catch {
					throw new Error(`${failure.message} Part of it was removed and couldn't be put back — complete or remove the leftover cell below.`);
				}
				throw new Error(`${failure.message} Nothing was removed.`);
			}
		});

	const movePair = (index: number, delta: number) =>
		run(async () => {
			const target = index + delta;
			if (target < 0 || target >= rows.length) return;
			const next = [...rows];
			[next[index], next[target]] = [next[target], next[index]];
			const ids = [
				...next.flatMap((row) => [row.left, row.right, ...row.extras].filter((option): option is SlideOption => !!option).map((option) => option.id)),
				...orphans.map((option) => option.id),
			];
			await api.reorder(ids);
		});

	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"match_pairs"> title={slide.title} onChange={onChange} errors={errors} disabled={disabled} placeholder="e.g. Match each country to its capital" />

			<EditorGroup title="Pairs">
				<div className="flex items-baseline justify-between">
					<p className="m-0 text-xs text-dark-5 dark:text-dark-6">
						Players see the left items in this order and the right items shuffled, then connect each pair.
					</p>
					<span className="shrink-0 pl-2 text-xs text-dark-5 dark:text-dark-6">
						{pairCount} / {QUIZ_LIMITS.maxPairs}
					</span>
				</div>

				<ol className="m-0 flex list-none flex-col gap-3 p-0">
					{rows.map((row, index) => (
						<li key={row.key} className="flex flex-col gap-2 rounded-lg border border-stroke p-2 dark:border-dark-3">
							<div className="flex items-center gap-1">
								<span className="flex flex-1 items-center gap-1.5 pl-1 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
									<Link2 className="h-3.5 w-3.5" aria-hidden />
									Pair {index + 1}
								</span>
								<button type="button" className={BUTTON} onClick={() => void movePair(index, -1)} disabled={disabled || busy || index === 0} aria-label={`Move pair ${index + 1} up`}>
									<ArrowUp className="h-4 w-4" aria-hidden />
								</button>
								<button
									type="button"
									className={BUTTON}
									onClick={() => void movePair(index, 1)}
									disabled={disabled || busy || index === rows.length - 1}
									aria-label={`Move pair ${index + 1} down`}
								>
									<ArrowDown className="h-4 w-4" aria-hidden />
								</button>
								<button
									type="button"
									className={`${BUTTON} hover:bg-red-light-6 hover:text-red dark:hover:bg-red/10`}
									onClick={() => void removeOptions(removalOrder(row))}
									disabled={!canRemove(rowCells(row))}
									aria-label={`Remove pair ${index + 1}`}
									title={count - rowCells(row).length >= api.min ? "Remove pair" : `A match needs at least ${QUIZ_LIMITS.minPairs} pairs`}
								>
									<Trash2 className="h-4 w-4" aria-hidden />
								</button>
							</div>
							<PairCell row={row} side="left" index={index} api={api} disabled={disabled || false} busy={busy} focusId={focusId} onFocused={() => setFocusId(null)} onAdd={() => void addSide(row, "left")} />
							<PairCell row={row} side="right" index={index} api={api} disabled={disabled || false} busy={busy} focusId={focusId} onFocused={() => setFocusId(null)} onAdd={() => void addSide(row, "right")} />
						</li>
					))}
				</ol>

				{ignored.length > 0 ? (
					<div className="flex flex-col gap-2">
						<EditorWarning>
							{ignored.length === 1 ? "One item isn't" : `${ignored.length} items aren't`} part of a complete pair, so players won&apos;t see {ignored.length === 1 ? "it" : "them"}.
						</EditorWarning>
						<button
							type="button"
							onClick={() => void removeOptions(ignored)}
							disabled={!canRemove(ignored)}
							className="min-h-11 self-start rounded-lg px-3 text-sm font-medium text-red outline-none hover:bg-red-light-6 focus-visible:ring-2 focus-visible:ring-red/40 disabled:opacity-40"
						>
							Remove {ignored.length === 1 ? "it" : "them"}
						</button>
					</div>
				) : null}
				{pairCount < QUIZ_LIMITS.minPairs ? <EditorWarning>Add at least {QUIZ_LIMITS.minPairs} complete pairs.</EditorWarning> : null}
				{error ? <EditorError>{error}</EditorError> : null}
				{errors?.options?.[0] ? <EditorError>{errors.options[0]}</EditorError> : null}

				<button
					type="button"
					onClick={() => void addPair()}
					disabled={!canAdd}
					className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-gray-5 text-sm font-medium text-dark-4 outline-none transition hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-4 dark:text-dark-6"
				>
					{busy ? (
						<span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />
					) : (
						<Plus className="h-4 w-4" aria-hidden />
					)}
					Add pair
					{!canAdd && rows.length >= QUIZ_LIMITS.maxPairs ? <span className="text-xs">(maximum {QUIZ_LIMITS.maxPairs})</span> : null}
				</button>
			</EditorGroup>
		</div>
	);
}

/** A row's cells, stray duplicates first and the left cell last, so the pair stays whole as long as possible. */
function removalOrder(row: PairRow): SlideOption[] {
	return [...row.extras, row.right, row.left].filter((option): option is SlideOption => !!option);
}

/**
 * Puts deleted cells back (same label, payload and image) and restores the
 * old option order. `before` is the slide's options before the removal; the
 * cells not deleted are still there, so the order lists every current option.
 */
async function restoreCells(api: OptionsApi, before: SlideOption[], removed: SlideOption[]): Promise<void> {
	const replaced = new Map<number, number>();
	for (const cell of removed) {
		const copy = await api.add({ label: cell.label, payload: cell.payload });
		replaced.set(cell.id, copy.id);
		if (cell.imageFileId !== null) await api.setImage(copy.id, cell.imageFileId);
	}
	await api.reorder(before.map((option) => replaced.get(option.id) ?? option.id));
}

function PairCell({
	row,
	side,
	index,
	api,
	disabled,
	busy,
	focusId,
	onFocused,
	onAdd,
}: {
	row: PairRow;
	side: "left" | "right";
	index: number;
	api: OptionsApi;
	disabled: boolean;
	busy: boolean;
	focusId: number | null;
	onFocused: () => void;
	onAdd: () => void;
}) {
	const option = row[side];
	const name = `Pair ${index + 1}, ${side} item`;
	return (
		<div className="flex items-center gap-2">
			<span className="w-10 shrink-0 text-xs font-medium text-dark-5 dark:text-dark-6">{side === "left" ? "Left" : "Right"}</span>
			{option ? (
				<>
					<ImageSlot
						imageUrl={option.image?.url}
						label={`Image for ${name.toLowerCase()}`}
						disabled={disabled}
						onPickFile={async (fileId) => {
							await api.setImage(option.id, fileId);
						}}
						onDetach={async () => {
							await api.setImage(option.id, null);
						}}
					/>
					<OptionLabelInput
						option={option}
						api={api}
						ariaLabel={name}
						placeholder={side === "left" ? "e.g. France" : "e.g. Paris"}
						disabled={disabled}
						autoFocus={focusId === option.id}
						onFocused={onFocused}
					/>
				</>
			) : (
				<button
					type="button"
					onClick={onAdd}
					disabled={disabled || busy}
					className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-[#F59E0B] text-sm font-medium text-[#92400E] outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 dark:text-[#FCD34D]"
				>
					<Plus className="h-4 w-4" aria-hidden />
					Add the {side} item
				</button>
			)}
		</div>
	);
}
