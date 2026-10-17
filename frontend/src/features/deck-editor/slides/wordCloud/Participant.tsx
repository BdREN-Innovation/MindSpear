"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StoredAnswerMap, WordCloudAggregate } from "@/features/deck/types";
import type { ParticipantProps } from "../types";
import { SubmitBar, SubmittedState, haptic } from "../shared";
import { useAnswer } from "../shared/answer";
import { displayTitle } from "../shared/labels";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, ResultsSection, countLabel, isReadOnlyView, notVotingMessage, resultsTitle } from "../shared/participantKit";
import { cleanWord } from "../shared/text";

// word_cloud on the phone (plan §7.3): a text field that turns each word or
// phrase into a chip, up to max_entries_per_participant, then Submit.
// Entries are cleaned and de-duplicated the way the backend groups them
// (trim, collapse spaces, case-insensitive). With allow_multiple_submissions
// the server appends, so later rounds send only the new words and the
// remaining allowance counts what was already sent; otherwise a new submit
// replaces the earlier words. An entry of only invisible characters is
// refused here the way the backend would (cleanWord). Public results show the
// top words in every view.

type Stored = StoredAnswerMap["word_cloud"];

const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus,#C46620)]";

const cleanEntry = cleanWord;

function entryKey(text: string): string {
	return cleanEntry(text).normalize("NFC").toLowerCase();
}

function dedupe(entries: string[]): string[] {
	const seen = new Set<string>();
	return entries.filter((entry) => {
		const key = entryKey(entry);
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function storedEntries(answer: Stored | null | undefined): string[] {
	return Array.isArray(answer?.entries) ? answer.entries.filter((entry): entry is string => typeof entry === "string") : [];
}

export function WordCloudParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode }: ParticipantProps<"word_cloud">) {
	const review = mode === "review";
	const readOnly = isReadOnlyView(mode, run.state);
	const maxEntries = Math.max(1, run.config.max_entries_per_participant ?? 3);
	const maxLength = Math.max(1, run.config.max_entry_length ?? 25);
	const multiple = run.config.allow_multiple_submissions === true;

	const answer = useAnswer(run.id, mySubmission, onSubmit);
	const { latest, sent, busy } = answer;
	const [chips, setChips] = useState<string[]>([]);
	const [draft, setDraft] = useState("");
	const [notice, setNotice] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const inputId = useId();
	const formId = useId();

	// What the server holds: appended rounds when multiple, else the latest round.
	const submitted = useMemo(
		() => (multiple ? dedupe([...storedEntries(mySubmission), ...sent.flatMap((entry) => storedEntries(entry))]) : storedEntries(latest)),
		[latest, multiple, mySubmission, sent]
	);
	const capacity = multiple ? Math.max(0, maxEntries - submitted.length) : maxEntries;
	const locked = disabled || readOnly;
	const title = displayTitle(run.title, "word_cloud");
	const results = aggregate ? <WordResults aggregate={aggregate} mine={submitted} title={resultsTitle(mode, run.state)} /> : null;

	if (readOnly) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				{submitted.length > 0 ? (
					<AnswerSummary label={submitted.length === 1 ? "Your word" : "Your words"}>
						<ChipList entries={submitted} />
					</AnswerSummary>
				) : review ? (
					<ParticipantNotice>You didn&apos;t send any words on this slide.</ParticipantNotice>
				) : null}
				{results}
			</ParticipantLayout>
		);
	}

	if (submitted.length > 0 && !answer.editing) {
		const canAddMore = multiple && capacity > 0;
		return (
			<ParticipantLayout theme={theme} title={title}>
				<SubmittedState
					title="Thanks, your words are in"
					message="Watch them appear on the big screen."
					editHint={
						!disabled && canAddMore
							? `You can add ${capacity} more ${capacity === 1 ? "word" : "words"}.`
							: !disabled && multiple
								? "You've sent all your words."
								: undefined
					}
					onEdit={
						disabled || (multiple && !canAddMore)
							? undefined
							: () => {
									setNotice(null);
									setDraft("");
									setChips(multiple ? [] : submitted);
									answer.edit();
								}
					}
					editLabel={multiple ? "Add more words" : "Change words"}
					className="px-0 py-6"
				>
					<div className="flex flex-col gap-4">
						<AnswerSummary label={submitted.length === 1 ? "Your word" : "Your words"}>
							<ChipList entries={submitted} />
						</AnswerSummary>
						{results}
					</div>
				</SubmittedState>
			</ParticipantLayout>
		);
	}

	const taken = new Set([...chips, ...(multiple ? submitted : [])].map(entryKey));
	const full = chips.length >= capacity;

	/** Turns the draft into a chip; returns false (with a notice) when it can't. */
	const addDraft = (): boolean => {
		const entry = cleanEntry(draft);
		if (!entry) return false;
		if (taken.has(entryKey(entry))) {
			setNotice(`You already added “${entry}”.`);
			haptic("error");
			return false;
		}
		if (full) {
			setNotice(`You can send up to ${capacity} ${capacity === 1 ? "word" : "words"}.`);
			haptic("error");
			return false;
		}
		setChips([...chips, entry.slice(0, maxLength)]);
		setDraft("");
		setNotice(null);
		return true;
	};

	const onFormSubmit = (event: FormEvent) => {
		event.preventDefault();
		if (busy || locked) return;
		const pending = cleanEntry(draft);
		const entries = dedupe(pending && !taken.has(entryKey(pending)) && !full ? [...chips, pending.slice(0, maxLength)] : chips);
		if (entries.length === 0) {
			setNotice("Type a word first.");
			inputRef.current?.focus();
			return;
		}
		void answer.submit({ entries }, { entries, entry_times: entries.map(() => null) }).then((ok) => {
			if (!ok) return;
			setChips([]);
			setDraft("");
			setNotice(null);
		});
	};

	const pendingCount = chips.length + (cleanEntry(draft) && !full ? 1 : 0);
	const lockedMessage = disabled ? notVotingMessage(run.state) : null;
	const instruction =
		capacity === 1
			? "Send one word or short phrase."
			: `Add up to ${capacity} words or short phrases${multiple && submitted.length > 0 ? " more" : ""}.`;

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle={instruction}
			footer={
				<SubmitBar
					type="submit"
					form={formId}
					label={pendingCount > 1 ? `Submit ${pendingCount} words` : "Submit"}
					loading={busy}
					disabled={disabled || pendingCount === 0}
					hint={notice ?? `${chips.length} of ${capacity} added`}
					error={answer.fieldError}
				/>
			}
		>
			{lockedMessage ? <ParticipantNotice>{lockedMessage}</ParticipantNotice> : null}

			<form id={formId} onSubmit={onFormSubmit} className="flex flex-col gap-3" noValidate>
				<label htmlFor={inputId} className="sr-only">
					Your word
				</label>
				<div className="flex items-stretch gap-2">
					<div className="relative min-w-0 flex-1">
						<input
							ref={inputRef}
							id={inputId}
							type="text"
							value={draft}
							maxLength={maxLength}
							disabled={locked || full}
							placeholder={full ? "All words added" : "Type a word…"}
							autoComplete="off"
							autoCapitalize="none"
							enterKeyHint={chips.length + 1 >= capacity ? "send" : "next"}
							onChange={(event) => {
								setDraft(event.target.value);
								if (notice) setNotice(null);
							}}
							onKeyDown={(event) => {
								// Enter adds a chip while there is room; the last one submits the form.
								if (event.key === "Enter" && chips.length + 1 < capacity && cleanEntry(draft)) {
									event.preventDefault();
									addDraft();
								}
							}}
							className={cn(
								"min-h-12 w-full rounded-xl border-2 px-4 pr-16 text-base disabled:opacity-60",
								FOCUS_RING,
								"focus-visible:ring-offset-0"
							)}
							style={{
								borderColor: "var(--deck-border, #E5E7EB)",
								background: "var(--deck-surface, #fff)",
								color: "var(--deck-text, #111928)",
							}}
						/>
						<span
							aria-hidden
							className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums"
							style={{ color: draft.length >= maxLength ? "var(--deck-danger, #B91C1C)" : "var(--deck-text-muted, #4B5563)" }}
						>
							{draft.length}/{maxLength}
						</span>
					</div>
					{capacity > 1 ? (
						<button
							type="button"
							onClick={() => {
								addDraft();
								inputRef.current?.focus();
							}}
							disabled={locked || full || !cleanEntry(draft)}
							aria-label="Add word"
							className={cn("flex min-h-12 min-w-12 items-center justify-center rounded-xl border-2 disabled:opacity-50", FOCUS_RING)}
							style={{ borderColor: "var(--deck-primary, #F79945)", color: "var(--deck-text, #111928)", background: "var(--deck-surface, #fff)" }}
						>
							<Plus className="h-5 w-5" aria-hidden />
						</button>
					) : null}
				</div>

				{chips.length > 0 ? (
					<ul aria-label="Words to send" className="m-0 flex list-none flex-wrap gap-2 p-0">
						{chips.map((chip, index) => (
							<li
								key={entryKey(chip)}
								className="flex min-h-11 items-center gap-1 rounded-full border-2 pl-4 pr-1 text-base font-semibold"
								style={{
									borderColor: "var(--deck-primary, #F79945)",
									background: "color-mix(in srgb, var(--deck-primary, #F79945) 14%, var(--deck-surface, #fff))",
								}}
							>
								<span className="break-all">{chip}</span>
								<button
									type="button"
									onClick={() => {
										setChips(chips.filter((_, i) => i !== index));
										setNotice(null);
									}}
									disabled={busy}
									aria-label={`Remove ${chip}`}
									className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", FOCUS_RING)}
								>
									<X className="h-4 w-4" aria-hidden />
								</button>
							</li>
						))}
					</ul>
				) : null}
			</form>

			{answer.editing ? (
				<button
					type="button"
					onClick={answer.cancelEdit}
					disabled={busy}
					className={cn("min-h-11 self-center rounded-lg px-4 text-sm font-semibold underline-offset-4 hover:underline", FOCUS_RING)}
					style={{ color: "var(--deck-text-muted, #4B5563)" }}
				>
					Cancel
				</button>
			) : null}

			{results}
		</ParticipantLayout>
	);
}

/** Top words with their counts; the participant's own words are highlighted. */
function WordResults({ aggregate, mine, title }: { aggregate: WordCloudAggregate; mine: string[]; title: string }) {
	const own = new Set(mine.map(entryKey));
	const words = aggregate.words.slice(0, 15);
	return (
		<ResultsSection title={title} summary={countLabel(aggregate.total_responses, "response", "responses")}>
			{words.length === 0 ? (
				<p className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					No words yet.
				</p>
			) : (
				<ol aria-label="Top words" className="m-0 flex list-none flex-wrap gap-2 p-0">
					{words.map((word) => {
						const yours = own.has(entryKey(word.word));
						return (
							<li
								key={word.word}
								className="flex items-center gap-1.5 break-all rounded-full px-3 py-1 text-sm font-semibold"
								style={{
									background: yours
										? "color-mix(in srgb, var(--deck-primary, #F79945) 18%, var(--deck-surface, #fff))"
										: "var(--deck-surface-muted, #F3F4F6)",
									color: "var(--deck-text, #111928)",
								}}
							>
								{word.word}
								<span className="text-xs font-bold tabular-nums" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
									{word.count}
								</span>
								<span className="sr-only">{word.count === 1 ? " mention" : " mentions"}</span>
							</li>
						);
					})}
				</ol>
			)}
			{aggregate.distinct_words > words.length ? (
				<p className="m-0 text-xs" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					Top {words.length} of {aggregate.distinct_words} words
				</p>
			) : null}
		</ResultsSection>
	);
}

function ChipList({ entries, muted = false }: { entries: string[]; muted?: boolean }) {
	return (
		<ul className="m-0 flex list-none flex-wrap gap-2 p-0">
			{entries.map((entry) => (
				<li
					key={entryKey(entry)}
					className="break-all rounded-full px-3 py-1 text-sm font-semibold"
					style={{
						background: muted ? "var(--deck-surface-muted, #F3F4F6)" : "color-mix(in srgb, var(--deck-primary, #F79945) 18%, var(--deck-surface, #fff))",
						color: "var(--deck-text, #111928)",
					}}
				>
					{entry}
				</li>
			))}
		</ul>
	);
}
