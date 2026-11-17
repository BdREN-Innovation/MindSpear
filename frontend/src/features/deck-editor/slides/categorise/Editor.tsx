"use client";

import { useRef, useState } from "react";
import { toast } from "react-toastify";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toDeckApiError } from "@/features/deck/api/errors";
import { QUIZ_LIMITS, type CategoriseOptionPayload, type QuizCategory, type SlideOption } from "@/features/deck/types";
import type { EditorProps } from "../types";
import { OptionListEditor, useDebouncedValue } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";
import { EditorError, EditorWarning, InlineSelect, nextAuthorKey } from "../shared/quizEditor";
import { categoryName } from "./labels";

// Content tab: 2–5 categories (config.categories [{key, label}], lists
// replace on PATCH) and 4–20 items, each with the category it belongs to
// (option payload {correct_category_key}). Removing a category moves its
// items to the first remaining one, so no item silently drops out. 422s on a
// category (config.categories.N.label / .key) show under that row.

const keyOf = (option: SlideOption) => (option.payload as Partial<CategoriseOptionPayload>).correct_category_key ?? null;

/** The first message per category row (config.categories.N and config.categories.N.*), plus any others under the list. */
function categoryErrors(errors: Record<string, string[]> | undefined, rows: number): { byRow: (string | null)[]; other: string[] } {
	const byRow: (string | null)[] = Array.from({ length: rows }, () => null);
	const other: string[] = [];
	for (const [key, messages] of Object.entries(errors ?? {})) {
		const message = messages?.[0];
		if (!message) continue;
		if (key === "config.categories") {
			other.push(message);
			continue;
		}
		const match = /^config\.categories\.(\d+)(?:\.|$)/.exec(key);
		if (!match) continue;
		const index = Number(match[1]);
		if (index < rows) byRow[index] ??= message;
		else other.push(message);
	}
	return { byRow, other: [...new Set(other)] };
}

export function CategoriseEditor({ slide, onChange, onOptionsChange: api, errors, disabled }: EditorProps<"categorise">) {
	const categories = slide.config.categories ?? [];
	const latest = useRef(categories);
	latest.current = categories;
	const [pending, setPending] = useState<Record<number, string>>({});
	const [busy, setBusy] = useState(false);
	const keys = categories.map((category) => category.key);
	const homeless = slide.options.filter((option) => !keys.includes(pending[option.id] ?? keyOf(option) ?? ""));

	const patchCategories = (next: QuizCategory[]) => onChange({ config: { categories: next } });

	const setLabel = (key: string, label: string) =>
		patchCategories(latest.current.map((category) => (category.key === key ? { ...category, label: label.trim() === "" ? null : label } : category)));

	const addCategory = () => {
		if (categories.length >= QUIZ_LIMITS.maxCategories) return;
		patchCategories([...categories, { key: nextAuthorKey("c", keys), label: null }]);
	};

	const removeCategory = async (key: string) => {
		const rest = categories.filter((category) => category.key !== key);
		if (rest.length < QUIZ_LIMITS.minCategories || busy) return;
		const moved = slide.options.filter((option) => keyOf(option) === key);
		setBusy(true);
		try {
			for (const option of moved) await api.update(option.id, { payload: { correct_category_key: rest[0].key } });
			patchCategories(rest);
			if (moved.length > 0) toast.info(`${moved.length === 1 ? "1 item moved" : `${moved.length} items moved`} to “${categoryName(rest[0], 0)}”.`);
		} catch (reason) {
			toast.error(toDeckApiError(reason).message);
		} finally {
			setBusy(false);
		}
	};

	const setItemCategory = async (option: SlideOption, key: string) => {
		setPending((previous) => ({ ...previous, [option.id]: key }));
		try {
			await api.update(option.id, { payload: { correct_category_key: key } });
		} catch (reason) {
			const failure = toDeckApiError(reason);
			toast.error(failure.fieldError("payload.correct_category_key") ?? failure.message);
		} finally {
			setPending((previous) => {
				const next = { ...previous };
				delete next[option.id];
				return next;
			});
		}
	};

	// New items go to the category with the fewest items, so filling the list in order stays balanced.
	const emptiest = () => {
		const counts = keys.map((key) => slide.options.filter((option) => keyOf(option) === key).length);
		return keys[counts.indexOf(Math.min(...counts))] ?? keys[0] ?? "c1";
	};

	const choices = categories.map((category, index) => ({ value: category.key, label: categoryName(category, index) }));
	const categoryProblems = categoryErrors(errors, categories.length);

	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"categorise"> title={slide.title} onChange={onChange} errors={errors} disabled={disabled} placeholder="e.g. Sort these animals" />

			<EditorGroup title="Categories">
				<div className="flex items-baseline justify-between">
					<p className="m-0 text-xs text-dark-5 dark:text-dark-6">Players drag every item into one of these.</p>
					<span className="shrink-0 pl-2 text-xs text-dark-5 dark:text-dark-6">
						{categories.length} / {QUIZ_LIMITS.maxCategories}
					</span>
				</div>
				<ol className="m-0 flex list-none flex-col gap-2 p-0">
					{categories.map((category, index) => (
						<CategoryRow
							key={category.key}
							category={category}
							index={index}
							onLabel={(label) => setLabel(category.key, label)}
							onRemove={() => void removeCategory(category.key)}
							canRemove={!disabled && !busy && categories.length > QUIZ_LIMITS.minCategories}
							disabled={disabled}
							error={categoryProblems.byRow[index]}
						/>
					))}
				</ol>
				{categoryProblems.other.map((message) => (
					<EditorError key={message}>{message}</EditorError>
				))}
				<button
					type="button"
					onClick={addCategory}
					disabled={disabled || categories.length >= QUIZ_LIMITS.maxCategories}
					className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-gray-5 text-sm font-medium text-dark-4 outline-none transition hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-4 dark:text-dark-6"
				>
					<Plus className="h-4 w-4" aria-hidden />
					Add category
					{categories.length >= QUIZ_LIMITS.maxCategories ? <span className="text-xs">(maximum {QUIZ_LIMITS.maxCategories})</span> : null}
				</button>
			</EditorGroup>

			<EditorGroup title="Items">
				<OptionListEditor
					slide={slide}
					options={api}
					label="Items to sort"
					itemNoun="item"
					labelPlaceholder={(index) => `Item ${index + 1}`}
					hint="Pick the right category for each item. Players see the items shuffled; each item in its right category earns part of the points."
					allowImages
					errors={errors}
					disabled={disabled || busy}
					newOptionInput={() => ({ label: null, payload: { correct_category_key: emptiest() } })}
					renderRowDetails={(option) => (
						<InlineSelect
							label="Category"
							value={pending[option.id] ?? keyOf(option)}
							options={choices}
							onChange={(key) => void setItemCategory(option, key)}
							disabled={disabled || busy}
						/>
					)}
				/>
				{homeless.length > 0 ? (
					<EditorWarning>
						{homeless.length === 1 ? "One item has" : `${homeless.length} items have`} no category, so players won&apos;t see {homeless.length === 1 ? "it" : "them"}.
					</EditorWarning>
				) : null}
			</EditorGroup>
		</div>
	);
}

function CategoryRow({
	category,
	index,
	onLabel,
	onRemove,
	canRemove,
	disabled,
	error,
}: {
	category: QuizCategory;
	index: number;
	onLabel: (label: string) => void;
	onRemove: () => void;
	canRemove: boolean;
	disabled?: boolean;
	/** 422 message for this category (config.categories.N.*). */
	error?: string | null;
}) {
	const { local, setLocal, flush } = useDebouncedValue(category.label ?? "", onLabel, 500);
	const errorId = `category-${category.key}-error`;
	return (
		<li className="flex flex-col gap-1">
			<div className="flex items-center gap-2">
				<input
					value={local}
					onChange={(event) => setLocal(event.target.value)}
					onBlur={flush}
					onKeyDown={(event) => event.key === "Enter" && flush()}
					maxLength={QUIZ_LIMITS.maxCategoryLabel}
					placeholder={`Category ${index + 1}`}
					aria-label={`Category ${index + 1} name`}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? errorId : undefined}
					disabled={disabled}
					className={cn(
						"min-h-11 min-w-0 flex-1 rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition placeholder:text-dark-6 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 dark:border-dark-3 dark:bg-dark-2 dark:text-white",
						error && "border-red"
					)}
				/>
				<button
					type="button"
					onClick={onRemove}
					disabled={!canRemove}
					aria-label={`Remove category ${index + 1}`}
					title={canRemove ? "Remove category (its items move to the first category)" : `A categorise slide needs at least ${QUIZ_LIMITS.minCategories} categories`}
					className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-dark-5 outline-none transition hover:bg-red-light-6 hover:text-red focus-visible:ring-2 focus-visible:ring-red/40 disabled:cursor-not-allowed disabled:opacity-30 dark:text-dark-6 dark:hover:bg-red/10"
				>
					<Trash2 className="h-4 w-4" aria-hidden />
				</button>
			</div>
			{error ? (
				<p id={errorId} role="alert" className="m-0 text-xs font-medium text-[#B42318] dark:text-red-light">
					{error}
				</p>
			) : null}
		</li>
	);
}
