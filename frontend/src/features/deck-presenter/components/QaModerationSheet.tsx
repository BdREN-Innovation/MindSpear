"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "react-toastify";
import { CheckCircle2, ChevronUp, Eye, EyeOff, Loader2, Monitor, RefreshCw, Star, X } from "lucide-react";
import type { HostQaFeed } from "@/features/deck/live/qaFeed";
import type { QaFeedSort, QaHostItem, QaModerationFlags } from "@/features/deck/types";
import { cn } from "@/lib/utils";
import { timeAgo } from "../lib/format";

// Plan §6.4: right-side sheet for qa_audience runs. The feed (REST read +
// qa.question.* events merged by id) comes from useHostQaFeed in the shell,
// shared with the slide's own Presenter through host.qa, so both stay in
// step. Moderation is optimistic inside the feed; failures roll back there
// and surface here as a toast.
//
// The projected slide has no controls, so every host action lives here:
// star (starred questions go on screen first), mark answered (the next one
// comes up), hide. The row the big screen is showing is marked "On screen",
// using the Presenter's rule: first starred open question, else the top open one.

type Filter = "all" | "starred" | "answered" | "hidden";

const FILTERS: { key: Filter; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "starred", label: "Starred" },
	{ key: "answered", label: "Answered" },
	{ key: "hidden", label: "Hidden" },
];

/** The question the qa_audience Presenter features: first starred open one, else the first open one (feed order). */
export function onScreenQuestionId(questions: readonly QaHostItem[]): number | null {
	const open = questions.filter((item) => !item.is_hidden && !item.is_answered);
	return (open.find((item) => item.is_starred) ?? open[0])?.question_id ?? null;
}

/** Question text for accessible names, kept short enough to be read out. */
function shortBody(body: string): string {
	const text = body.replace(/\s+/g, " ").trim();
	return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function matches(item: QaHostItem, filter: Filter): boolean {
	switch (filter) {
		case "starred":
			return item.is_starred && !item.is_hidden;
		case "answered":
			return item.is_answered && !item.is_hidden;
		case "hidden":
			return item.is_hidden;
		default:
			return !item.is_hidden;
	}
}

export interface QaModerationSheetProps {
	feed: HostQaFeed;
	onClose: () => void;
}

export function QaModerationSheet({ feed, onClose }: QaModerationSheetProps) {
	const [filter, setFilter] = useState<Filter>("all");
	const [busy, setBusy] = useState<Set<number>>(() => new Set());
	const [now, setNow] = useState(() => Date.now());
	const reduceMotion = useReducedMotion();
	const closeRef = useRef<HTMLButtonElement>(null);

	// "2 min ago" stays roughly right without a timer per item.
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 30_000);
		return () => window.clearInterval(timer);
	}, []);

	useEffect(() => {
		closeRef.current?.focus();
	}, []);

	const counts = useMemo(() => {
		const out: Record<Filter, number> = { all: 0, starred: 0, answered: 0, hidden: 0 };
		for (const item of feed.questions) {
			for (const { key } of FILTERS) if (matches(item, key)) out[key] += 1;
		}
		return out;
	}, [feed.questions]);

	const visible = useMemo(() => feed.questions.filter((item) => matches(item, filter)), [feed.questions, filter]);
	const onScreenId = useMemo(() => onScreenQuestionId(feed.questions), [feed.questions]);

	const moderate = async (item: QaHostItem, flags: QaModerationFlags) => {
		if (busy.has(item.question_id)) return;
		setBusy((set) => new Set(set).add(item.question_id));
		try {
			await feed.moderate(item.question_id, flags);
		} catch (error) {
			toast.error((error as Error)?.message || "Couldn't update the question. Try again.");
		} finally {
			setBusy((set) => {
				const next = new Set(set);
				next.delete(item.question_id);
				return next;
			});
		}
	};

	const setSort = (sort: QaFeedSort) => {
		if (sort !== feed.sort) feed.setSort(sort);
	};

	return (
		<aside
			aria-label="Q&A moderation"
			className="absolute inset-y-0 right-0 z-30 flex w-[min(440px,42%)] min-w-[320px] flex-col border-l border-[var(--deck-border)] bg-[var(--deck-surface)] text-[var(--deck-text)] shadow-2xl"
		>
			<header className="flex items-center gap-1.5 border-b border-[var(--deck-border)] py-2 pl-4 pr-2">
				<h2 className="min-w-0 flex-1 truncate text-lg font-bold">
					Q&amp;A moderation
					{/* The All tab shows the visible count; this announces arrivals. */}
					<span className="sr-only" aria-live="polite">
						{feed.total} {feed.total === 1 ? "question" : "questions"}
					</span>
				</h2>
				<div
					role="group"
					aria-label="Sort questions"
					className="flex rounded-lg border border-[var(--deck-border)] p-0.5"
				>
					{(
						[
							["top", "Top"],
							["new", "Newest"],
						] as const
					).map(([key, label]) => (
						<button
							key={key}
							type="button"
							aria-pressed={feed.sort === key}
							onClick={() => setSort(key)}
							className={cn(
								"min-h-10 rounded-md px-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--deck-focus)]",
								feed.sort === key ? "bg-[var(--deck-surface-muted)]" : "text-[var(--deck-text-muted)]"
							)}
						>
							{label}
						</button>
					))}
				</div>
				<button
					type="button"
					onClick={() => void feed.refresh()}
					aria-label="Reload questions"
					title="Reload questions"
					className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-[var(--deck-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--deck-focus)]"
				>
					<RefreshCw className={cn("h-5 w-5", feed.loading && "animate-spin motion-reduce:animate-none")} aria-hidden />
				</button>
				<button
					ref={closeRef}
					type="button"
					onClick={onClose}
					aria-label="Close moderation (M)"
					title="Close (M)"
					className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-[var(--deck-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--deck-focus)]"
				>
					<X className="h-5 w-5" aria-hidden />
				</button>
			</header>

			<div className="border-b border-[var(--deck-border)] px-3 py-2">
				<p className="mb-1.5 text-xs text-[var(--deck-text-muted)]">
					Starred questions go on screen first. Mark the one on screen answered to show the next.
				</p>
				<div role="tablist" aria-label="Filter questions" className="flex flex-wrap gap-1">
					{FILTERS.map(({ key, label }) => (
						<button
							key={key}
							type="button"
							role="tab"
							aria-selected={filter === key}
							onClick={() => setFilter(key)}
							className={cn(
								"inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold transition motion-reduce:transition-none",
								"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--deck-focus)]",
								filter === key
									? "bg-[var(--deck-primary)] text-[var(--deck-on-primary)]"
									: "text-[var(--deck-text-muted)] hover:bg-[var(--deck-surface-muted)]"
							)}
						>
							{label}
							<span className="tabular-nums opacity-80">{counts[key]}</span>
						</button>
					))}
				</div>
			</div>

			<div className="flex-1 overflow-y-auto px-3 py-3">
				{feed.error && (
					<p role="alert" className="mb-3 rounded-lg bg-red-light-5 px-3 py-2 text-sm text-red-dark">
						{feed.error.message}
					</p>
				)}
				{feed.loading && feed.questions.length === 0 ? (
					<p className="flex items-center justify-center gap-2 py-10 text-[var(--deck-text-muted)]">
						<Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> Loading questions…
					</p>
				) : visible.length === 0 ? (
					<p className="py-10 text-center text-[var(--deck-text-muted)]">
						{filter === "all"
							? "No questions yet. They appear here as the audience sends them."
							: `No ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} questions.`}
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						<AnimatePresence initial={false}>
							{visible.map((item) => (
								<motion.li
									key={item.question_id}
									layout={!reduceMotion}
									initial={reduceMotion ? false : { opacity: 0, y: -8 }}
									animate={{ opacity: 1, y: 0 }}
									exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
									transition={{ duration: reduceMotion ? 0 : 0.2 }}
									className={cn(
										"rounded-xl border border-[var(--deck-border)] bg-[var(--deck-bg)] p-3",
										item.is_starred && !item.is_hidden && "border-[var(--deck-primary)]",
										item.question_id === onScreenId && "border-2 border-[var(--deck-primary)]",
										item.is_hidden && "opacity-70"
									)}
								>
									<QuestionRow
										item={item}
										now={now}
										onScreen={item.question_id === onScreenId}
										busy={busy.has(item.question_id)}
										onModerate={(flags) => void moderate(item, flags)}
									/>
								</motion.li>
							))}
						</AnimatePresence>
					</ul>
				)}
			</div>
		</aside>
	);
}

/** Accessible names stay the same when toggled (aria-pressed carries the state). */
const ACTION_NAMES: Record<keyof QaModerationFlags, string> = {
	is_starred: "Star",
	is_answered: "Mark answered",
	is_hidden: "Hide",
};

function QuestionRow({
	item,
	now,
	onScreen,
	busy,
	onModerate,
}: {
	item: QaHostItem;
	now: number;
	onScreen: boolean;
	busy: boolean;
	onModerate: (flags: QaModerationFlags) => void;
}) {
	const toggles: {
		key: keyof QaModerationFlags;
		on: boolean;
		onLabel: string;
		offLabel: string;
		Icon: typeof Star;
		OffIcon?: typeof Star;
	}[] = [
		{ key: "is_starred", on: item.is_starred, onLabel: "Unstar", offLabel: "Star (goes on screen first)", Icon: Star },
		{
			key: "is_answered",
			on: item.is_answered,
			onLabel: "Mark not answered",
			offLabel: onScreen ? "Mark answered and show the next question" : "Mark answered",
			Icon: CheckCircle2,
		},
		{ key: "is_hidden", on: item.is_hidden, onLabel: "Unhide", offLabel: "Hide from audience", Icon: Eye, OffIcon: EyeOff },
	];
	const question = shortBody(item.body);

	return (
		<div className="flex gap-3">
			<div className="flex w-10 shrink-0 flex-col items-center gap-1 pt-0.5">
				<span className="text-2xl leading-none" aria-hidden>
					{item.participant_emoji ?? "🙂"}
				</span>
				<span className="flex items-center text-sm font-bold tabular-nums" title="Upvotes">
					<ChevronUp className="h-4 w-4" aria-hidden />
					{item.upvote_count}
					<span className="sr-only"> upvotes</span>
				</span>
			</div>
			<div className="min-w-0 flex-1">
				<p
					className={cn(
						"whitespace-pre-wrap break-words text-base",
						item.is_answered && "text-[var(--deck-text-muted)] line-through"
					)}
				>
					{item.body}
				</p>
				<p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--deck-text-muted)]">
					{onScreen && (
						<span className="inline-flex items-center gap-1 rounded-full bg-[var(--deck-primary)] px-2 py-0.5 font-semibold text-[var(--deck-on-primary)]">
							<Monitor className="h-3 w-3" aria-hidden />
							On screen
						</span>
					)}
					<span>{timeAgo(item.submitted_at, now)}</span>
					{item.is_starred && <span className="font-semibold text-[var(--deck-primary)]">Starred</span>}
					{item.is_answered && <span className="font-semibold text-[var(--deck-success)]">Answered</span>}
					{item.is_hidden && <span className="font-semibold">Hidden from audience</span>}
				</p>
				<div className="mt-1.5 flex gap-1">
					{toggles.map(({ key, on, onLabel, offLabel, Icon, OffIcon }) => {
						const Shown = !on && OffIcon ? OffIcon : Icon;
						const label = on ? onLabel : offLabel;
						return (
							<button
								key={key}
								type="button"
								// Stable name (action + question) + aria-pressed; the tooltip says what a click does.
								aria-pressed={on}
								aria-label={`${ACTION_NAMES[key]}: ${question}`}
								title={label}
								disabled={busy}
								onClick={() => onModerate({ [key]: !on })}
								className={cn(
									"inline-flex h-11 w-11 items-center justify-center rounded-lg border transition motion-reduce:transition-none",
									"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--deck-focus)] disabled:opacity-50",
									on
										? "border-[var(--deck-primary)] bg-[var(--deck-primary)] text-[var(--deck-on-primary)]"
										: "border-[var(--deck-border)] text-[var(--deck-text-muted)] hover:bg-[var(--deck-surface-muted)]"
								)}
							>
								<Shown className={cn("h-5 w-5", key === "is_starred" && on && "fill-current")} aria-hidden />
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}
