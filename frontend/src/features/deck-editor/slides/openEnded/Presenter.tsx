"use client";

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play, Radio, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { chartColor, type DeckTheme } from "@/features/deck/theme";
import { DECK_LIMITS, type OpenEndedAggregate, type OpenEndedCard } from "@/features/deck/types";
import type { PresenterProps } from "../types";
import { fallbackTitle } from "../shared/labels";
import { PresenterStage, ResponseCount, ResultsEmpty, SlideTitle, usePrefersReducedMotion } from "../shared";

// open_ended presenter (plan §6.3): a 3-column card wall, newest first. The
// live broadcast only carries the 10 newest cards with bodies cut to 200
// characters, so when there are more the host pages through the full text
// (GET .../aggregate?page=N, 20 cards a page, via host.loadAggregatePage);
// "Live" returns to the auto-updating newest cards. New cards fade in at the
// top and the rest slide down (no motion with prefers-reduced-motion).
// Over capacity the wall also pages by itself (plan §6.3): Newest → page 1 →
// … → last → Newest, one step every AUTO_ADVANCE_MS; any manual page change
// restarts the wait, and the host can pause / resume it.

const PAGE_SIZE = DECK_LIMITS.openEndedPageSize;
const AUTO_ADVANCE_MS = 10_000;

interface BrowseState {
	runId: number;
	page: number;
	data: OpenEndedAggregate | null;
	loading: boolean;
	error: string | null;
}

/** A stable colour per card id, so a card keeps its accent when it moves. */
function cardColor(theme: DeckTheme, id: string): string {
	let hash = 0;
	for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
	return chartColor(theme, Math.abs(hash));
}

export function OpenEndedPresenter({ run, aggregate, theme, mode, host }: PresenterProps<"open_ended">) {
	const reducedMotion = usePrefersReducedMotion();
	const [browse, setBrowse] = useState<BrowseState | null>(null);
	const request = useRef(0);

	const active = browse && browse.runId === run.id ? browse : null;
	const loadPage = host?.loadAggregatePage;
	const liveItems = aggregate?.items ?? [];
	const totalEntries = aggregate?.total_entries ?? 0;
	const lastPage = Math.max(1, active?.data?.last_page ?? Math.ceil(totalEntries / PAGE_SIZE));
	const canBrowse = mode === "live" && !!loadPage && (totalEntries > liveItems.length || !!aggregate?.truncated);
	const items: OpenEndedCard[] = active?.data?.items ?? liveItems;
	const waiting = aggregate === null && mode === "live";
	const [autoAdvance, setAutoAdvance] = useState(true);
	const autoActive = canBrowse && autoAdvance && !active?.loading && !active?.error;

	const goTo = async (page: number) => {
		if (!loadPage) return;
		const id = ++request.current;
		setBrowse({ runId: run.id, page, data: active?.data ?? null, loading: true, error: null });
		try {
			const snapshot = await loadPage(page);
			if (id !== request.current) return;
			setBrowse({ runId: run.id, page, data: snapshot.aggregate as OpenEndedAggregate, loading: false, error: null });
		} catch {
			if (id !== request.current) return;
			setBrowse((previous) => (previous ? { ...previous, loading: false, error: "Couldn't load these responses. Try again." } : previous));
		}
	};

	const backToLive = () => {
		request.current++;
		setBrowse(null);
	};

	// The next auto step; keyed on the page shown, so a manual change restarts the wait.
	const shownPage = active?.page ?? 0;
	const step = useRef<() => void>(() => undefined);
	step.current = () => {
		if (!active) void goTo(1);
		else if (active.page < lastPage) void goTo(active.page + 1);
		else backToLive();
	};
	useEffect(() => {
		if (!autoActive) return;
		const timer = window.setTimeout(() => step.current(), AUTO_ADVANCE_MS);
		return () => window.clearTimeout(timer);
	}, [autoActive, shownPage, run.id]);

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<header className="flex items-start justify-between gap-[3cqw]">
				<SlideTitle title={run.title} fallback={fallbackTitle("open_ended")} />
				<div className="flex shrink-0 flex-col items-end gap-[0.6cqw] pt-[0.8cqw]">
					{aggregate ? <ResponsesAndPeople entries={totalEntries} people={aggregate.total_responses} /> : null}
					{canBrowse || active ? (
						<nav aria-label="Response pages" className="flex items-center gap-[0.5cqw]">
							{active ? (
								<PagerButton onClick={backToLive} label="Back to live responses">
									<Radio className="h-4 w-4" aria-hidden />
									<span className="text-sm font-semibold">Live</span>
								</PagerButton>
							) : null}
							<PagerButton
								onClick={() => (active && active.page > 1 ? void goTo(active.page - 1) : backToLive())}
								label="Newer responses"
								disabled={!active}
							>
								<ChevronLeft className="h-5 w-5" aria-hidden />
							</PagerButton>
							<span className="min-w-[5.5rem] text-center text-sm font-semibold tabular-nums" aria-live="polite" style={{ color: "var(--deck-text-muted)" }}>
								{active ? `Page ${active.page} of ${lastPage}` : "Newest"}
							</span>
							<PagerButton
								onClick={() => void goTo(active ? active.page + 1 : 1)}
								label="Older responses"
								disabled={!!active && (active.page >= lastPage || active.loading)}
							>
								<ChevronRight className="h-5 w-5" aria-hidden />
							</PagerButton>
							{canBrowse ? (
								<PagerButton
									onClick={() => setAutoAdvance((on) => !on)}
									label={autoAdvance ? "Pause automatic paging" : "Resume automatic paging"}
								>
									{autoAdvance ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
								</PagerButton>
							) : null}
						</nav>
					) : null}
				</div>
			</header>

			{active?.error ? (
				<p role="alert" className="m-0 text-sm font-medium" style={{ color: "var(--deck-danger)" }}>
					{active.error}
				</p>
			) : null}

			{waiting ? (
				<ResultsEmpty />
			) : items.length === 0 ? (
				<ResultsEmpty message={active?.loading ? "Loading responses…" : "Waiting for the first responses…"} />
			) : (
				<ul
					aria-label={active ? `Responses, page ${active.page}` : "Newest responses"}
					aria-busy={active?.loading || undefined}
					className={cn(
						"m-0 grid min-h-0 flex-1 list-none auto-rows-min grid-cols-3 content-start gap-[1.4cqw] overflow-y-auto p-0 transition-opacity",
						active?.loading && "opacity-50"
					)}
				>
					<AnimatePresence initial={false}>
						{items.map((card) => (
							<motion.li
								key={card.id}
								layout={reducedMotion ? false : "position"}
								initial={reducedMotion ? false : { opacity: 0, y: -16, scale: 0.96 }}
								animate={{ opacity: 1, y: 0, scale: 1 }}
								exit={reducedMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.96 }}
								transition={{ duration: reducedMotion ? 0 : 0.3, ease: "easeOut" }}
								className="min-w-0"
							>
								<article
									className="flex h-full flex-col gap-[0.8cqw] rounded-[1cqw] border p-[1.4cqw]"
									style={{
										background: "var(--deck-surface)",
										borderColor: "var(--deck-border)",
										borderLeft: `0.45cqw solid ${cardColor(theme, card.id)}`,
									}}
								>
									<p
										className="m-0 line-clamp-6 whitespace-pre-line break-words font-medium leading-snug"
										style={{ fontSize: "clamp(0.875rem, 1.7cqw, 1.5rem)" }}
									>
										{card.body}
										{card.body_truncated ? "…" : ""}
									</p>
									{card.participant_emoji ? (
										<span className="mt-auto leading-none" style={{ fontSize: "clamp(1rem, 2cqw, 1.75rem)" }} aria-hidden>
											{card.participant_emoji}
										</span>
									) : null}
								</article>
							</motion.li>
						))}
					</AnimatePresence>
				</ul>
			)}

			{!active && aggregate && totalEntries > liveItems.length && liveItems.length > 0 ? (
				<p className="m-0 text-right" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.75rem, 1.3cqw, 1rem)" }}>
					Showing the {liveItems.length} newest of {totalEntries} responses
				</p>
			) : null}
		</PresenterStage>
	);
}

/**
 * "4 responses · 3 people" when people sent several each (same wording as the
 * presenter control bar), else "3 responses".
 */
function ResponsesAndPeople({ entries, people }: { entries: number; people: number }) {
	if (entries === people) return <ResponseCount count={entries} />;
	return (
		<p
			aria-live="polite"
			aria-atomic="true"
			className="m-0 inline-flex items-center gap-[0.6cqw] font-semibold tabular-nums"
			style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.875rem, 1.6cqw, 1.25rem)" }}
		>
			<Users className="h-[1.2em] w-[1.2em]" aria-hidden />
			{entries} {entries === 1 ? "response" : "responses"} · {people} {people === 1 ? "person" : "people"}
		</p>
	);
}

function PagerButton({ onClick, label, disabled, children }: { onClick: () => void; label: string; disabled?: boolean; children: ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			title={label}
			className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border px-2 outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus)] disabled:cursor-not-allowed disabled:opacity-40"
			style={{ borderColor: "var(--deck-border)", background: "var(--deck-surface)", color: "var(--deck-text)" }}
		>
			{children}
		</button>
	);
}
