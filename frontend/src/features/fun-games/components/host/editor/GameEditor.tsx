"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleAlert, FileJson, Loader2, Lock, Radio, Save, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getHostApi, toFunGamesError } from "../../../api";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import type { HostGameDetail, HostTimerSettings, ImportSummary, QuestionSelection, ScoringMode, TimerConfig } from "../../../types";
import { btnPrimary, btnSecondary, card, inputClass, labelClass } from "../../shared/hostStyles";
import { StatusTag } from "../../shared/StatusTag";
import { HostLiveDialog } from "../HostLiveDialog";
import { QuestionList } from "./QuestionList";
import { poolError, QuestionPoolSelector } from "./QuestionPoolSelector";
import { ScoringSelector } from "./ScoringSelector";
import { TimerModeSelector, validateTimer } from "./TimerModeSelector";

interface Basics {
	title: string;
	description: string;
	instructions: string;
	timer: HostTimerSettings;
	scoringMode: ScoringMode;
	shuffleQuestions: boolean;
	questionsPerPlayer: number | null;
	questionSelection: QuestionSelection;
}

const basicsOf = (game: HostGameDetail): Basics => ({
	title: game.title,
	description: game.description,
	instructions: game.instructions,
	timer: game.timerSettings,
	scoringMode: game.scoringMode,
	shuffleQuestions: game.shuffleQuestions,
	questionsPerPlayer: game.questionsPerPlayer,
	questionSelection: game.questionSelection,
});

const toTimerConfig = (t: HostTimerSettings): TimerConfig =>
	t.mode === "perQuestion"
		? { mode: "perQuestion", secondsPerQuestion: t.secondsPerQuestion }
		: { mode: "total", totalSeconds: t.totalSeconds };

const sameTimer = (a: HostTimerSettings, b: HostTimerSettings) =>
	a.mode === b.mode &&
	(a.mode === "perQuestion"
		? a.secondsPerQuestion === b.secondsPerQuestion
		: a.totalSeconds === b.totalSeconds);

function ImportedBanner({ importId, onUndone }: { importId: string; onUndone: (game: HostGameDetail) => void }) {
	const [summary, setSummary] = useState<ImportSummary | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showSkipped, setShowSkipped] = useState(false);

	// The page that ran the import leaves its summary here; without it the banner
	// still offers Undo, just without the counts.
	useEffect(() => {
		try {
			const raw = sessionStorage.getItem(`fungame:import:${importId}`);
			if (raw) setSummary(JSON.parse(raw) as ImportSummary);
		} catch {
			// ignore
		}
	}, [importId]);

	const undo = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await (await getHostApi()).undoImport(importId);
			setSummary(result.import);
			onUndone(result.game);
		} catch (reason) {
			setError(toFunGamesError(reason).message);
		} finally {
			setBusy(false);
		}
	};

	if (summary?.undoneAt) {
		return (
			<p role="status" className="rounded-lg border border-stroke bg-gray-1 px-3 py-2 text-sm text-dark-4 dark:border-stroke-dark dark:bg-dark-2">
				Import undone.
			</p>
		);
	}

	return (
		<div role="status" className="rounded-lg border border-green-light-4 bg-green-light-7 px-4 py-3 text-sm text-green-dark">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="flex items-center gap-2 font-semibold">
					<CheckCircle2 className="h-4 w-4" aria-hidden />
					{summary
						? `Imported ${summary.added} question${summary.added === 1 ? "" : "s"}${
								summary.skipped.length ? ` · ${summary.skipped.length} skipped` : ""
							}${summary.removed ? ` · replaced ${summary.removed}` : ""}.`
						: "Questions imported."}
				</p>
				<div className="flex gap-2">
					{summary?.skipped.length ? (
						<button type="button" onClick={() => setShowSkipped((v) => !v)} aria-expanded={showSkipped} className="font-semibold underline">
							{showSkipped ? "Hide skipped" : "Show skipped"}
						</button>
					) : null}
					<button type="button" onClick={undo} disabled={busy} className="inline-flex items-center gap-1 font-semibold underline disabled:opacity-60">
						{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Undo2 className="h-3.5 w-3.5" aria-hidden />}
						Undo import
					</button>
				</div>
			</div>
			{showSkipped && summary ? (
				<ul className="mt-2 space-y-1 text-dark-4 dark:text-dark-6">
					{summary.skipped.map((s) => (
						<li key={s.position}>
							<span className="font-mono">#{s.position}</span> {s.text} — <em>{s.reason}</em>
						</li>
					))}
				</ul>
			) : null}
			{error ? <p className="mt-1 font-semibold text-red-dark">{error}</p> : null}
		</div>
	);
}

/** Review & publish: what's missing before the game can go live. */
function ReviewPanel({ game, dirty, timerError }: { game: HostGameDetail; dirty: boolean; timerError: string | null }) {
	const checks = [
		{ ok: !!game.title.trim(), label: "The game has a title" },
		{ ok: game.questions.length > 0, label: game.questions.length ? `${game.questions.length} questions` : "At least one question" },
		{
			ok: game.questions.every((q) => q.options.length >= 2 && q.options.some((o) => o.id === q.correctOptionId)),
			label: "Every question has two or more options and a correct answer",
		},
		{ ok: !timerError, label: "The timer is valid" },
		{ ok: !dirty, label: "All changes are saved" },
	];
	return (
		<ul className="space-y-1.5">
			{checks.map((c) => (
				<li key={c.label} className={cn("flex items-center gap-2 text-sm", c.ok ? "text-dark dark:text-white" : "text-red-dark")}>
					{c.ok ? <CheckCircle2 className="h-4 w-4 text-green-dark" aria-hidden /> : <CircleAlert className="h-4 w-4" aria-hidden />}
					<span>
						<span className="sr-only">{c.ok ? "Done: " : "To do: "}</span>
						{c.label}
					</span>
				</li>
			))}
		</ul>
	);
}

export function GameEditor({ gameId }: { gameId: string }) {
	const router = useRouter();
	const importedId = useSearchParams().get("imported");
	const id = useId();
	const game = useAsyncResource(async (signal) => (await getHostApi()).getGame(gameId, { signal }), [gameId]);
	const [basics, setBasics] = useState<Basics | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [savedAt, setSavedAt] = useState<number | null>(null);
	const [hosting, setHosting] = useState(false);

	useEffect(() => {
		if (game.data && !basics) setBasics(basicsOf(game.data));
	}, [game.data, basics]);

	if (game.loading || (!game.data && !game.error)) {
		return (
			<div className="relative mx-auto max-w-5xl p-6" role="status">
				<Loader2 className="h-6 w-6 animate-spin text-dark-5" aria-hidden />
				<span className="sr-only">Loading the game…</span>
			</div>
		);
	}
	if (!game.data || !basics) {
		return (
			<div className="relative mx-auto max-w-5xl p-6">
				<div className={card} role="alert">
					<p className="font-semibold text-dark dark:text-white">
						{game.error?.code === "notFound" ? "This game doesn't exist or isn't yours." : "Couldn't load the game."}
					</p>
					<p className="mt-1 text-sm text-dark-5">{game.error?.message}</p>
					<Link href="/fun-games" className={cn(btnSecondary, "mt-4")}>
						Back to Fun Games
					</Link>
				</div>
			</div>
		);
	}

	const g = game.data;
	const saved = basicsOf(g);
	const dirty =
		basics.title !== saved.title ||
		basics.description !== saved.description ||
		basics.instructions !== saved.instructions ||
		basics.scoringMode !== saved.scoringMode ||
		basics.shuffleQuestions !== saved.shuffleQuestions ||
		basics.questionsPerPlayer !== saved.questionsPerPlayer ||
		basics.questionSelection !== saved.questionSelection ||
		!sameTimer(basics.timer, saved.timer);
	const timerError = validateTimer(basics.timer) ?? poolError(basics.questionsPerPlayer, g.questions.length);
	// Each player's question count, for the timer summary.
	const perPlayer = basics.questionsPerPlayer ? Math.min(basics.questionsPerPlayer, g.questions.length) : g.questions.length;
	const titleError = !basics.title.trim() ? "The game needs a title." : null;

	const setGame = (next: HostGameDetail) => {
		game.setData(next);
		setBasics(basicsOf(next));
	};

	const save = async () => {
		setSaveError(null);
		if (titleError || timerError) {
			setSaveError(titleError ?? timerError);
			return;
		}
		setSaving(true);
		try {
			const payload = {
				title: basics.title.trim(),
				description: basics.description,
				instructions: basics.instructions,
				scoringMode: basics.scoringMode,
				shuffleQuestions: basics.shuffleQuestions,
				questionsPerPlayer: basics.questionsPerPlayer,
				questionSelection: basics.questionSelection,
				...(sameTimer(basics.timer, saved.timer) ? {} : { timer: toTimerConfig(basics.timer) }),
			};
			setGame(await (await getHostApi()).updateGame(g.id, payload));
			setSavedAt(Date.now());
		} catch (reason) {
			setSaveError(toFunGamesError(reason).message);
		} finally {
			setSaving(false);
		}
	};

	const perQuestionMode = basics.timer.mode === "perQuestion";
	const openSession = g.latestSessionId && g.latestSessionStatus && g.latestSessionStatus !== "finished" ? g.latestSessionId : null;

	return (
		// `relative`: keeps absolutely positioned bits (sr-only labels) inside the
		// layout's scrolling <main>; otherwise they make the whole page scroll.
		<div className="relative mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
			<Link href="/fun-games" className="inline-flex items-center gap-1 text-sm font-semibold text-dark-5 hover:text-dark dark:hover:text-white">
				<ArrowLeft className="h-4 w-4" aria-hidden />
				Fun Games
			</Link>

			<header className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-stroke bg-white/95 px-4 py-3 backdrop-blur dark:border-stroke-dark dark:bg-gray-dark/95 sm:-mx-6 sm:px-6">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<h1 className="truncate text-xl font-bold text-dark dark:text-white">{g.title || "Untitled game"}</h1>
						<StatusTag status={g.status} />
					</div>
					<p className="text-xs text-dark-5" aria-live="polite">
						{saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? "All changes saved" : "Edit game"}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Link href={`/fun-games/${g.id}/import`} className={cn(btnSecondary, g.locked && "pointer-events-none opacity-50")} aria-disabled={g.locked}>
						<FileJson className="h-4 w-4" aria-hidden />
						Import questions
					</Link>
					<button type="button" onClick={save} disabled={!dirty || saving} className={btnSecondary}>
						{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
						Save
					</button>
					{openSession ? (
						<button type="button" onClick={() => router.push(`/fun-games/sessions/${openSession}`)} className={btnPrimary}>
							<Radio className="h-4 w-4" aria-hidden />
							Live control
						</button>
					) : (
						<button
							type="button"
							onClick={() => setHosting(true)}
							disabled={dirty || g.questions.length === 0}
							title={dirty ? "Save your changes first" : g.questions.length === 0 ? "Add questions first" : undefined}
							className={btnPrimary}
						>
							<Radio className="h-4 w-4" aria-hidden />
							{g.published ? "Host live" : "Publish & host"}
						</button>
					)}
				</div>
			</header>

			{importedId ? <ImportedBanner importId={importedId} onUndone={setGame} /> : null}
			{g.locked ? (
				<p role="status" className="flex items-center gap-2 rounded-lg border border-urgent/30 bg-urgent-bg px-3 py-2 text-sm text-urgent-text">
					<Lock className="h-4 w-4" aria-hidden />
					A session is running, so questions and the timer are locked until it ends.
				</p>
			) : null}
			{saveError ? (
				<p role="alert" className="rounded-lg border border-red-light-3 bg-red-light-5 px-3 py-2 text-sm text-red-dark">
					{saveError}
				</p>
			) : null}

			<section aria-labelledby={`${id}-basics`} className={card}>
				<h2 id={`${id}-basics`} className="text-lg font-bold text-dark dark:text-white">
					1 · Basics
				</h2>
				<div className="mt-3 grid gap-3">
					<div>
						<label htmlFor={`${id}-title`} className={labelClass}>
							Title
						</label>
						<input
							id={`${id}-title`}
							value={basics.title}
							onChange={(e) => setBasics({ ...basics, title: e.target.value })}
							maxLength={200}
							aria-invalid={!!titleError}
							className={inputClass}
						/>
					</div>
					<div>
						<label htmlFor={`${id}-desc`} className={labelClass}>
							Description <span className="font-normal text-dark-5">· shown on the join screen</span>
						</label>
						<textarea
							id={`${id}-desc`}
							rows={2}
							value={basics.description}
							onChange={(e) => setBasics({ ...basics, description: e.target.value })}
							maxLength={2000}
							className={inputClass}
						/>
					</div>
					<div>
						<label htmlFor={`${id}-instr`} className={labelClass}>
							Instructions <span className="font-normal text-dark-5">· shown in the lobby</span>
						</label>
						<textarea
							id={`${id}-instr`}
							rows={2}
							value={basics.instructions}
							onChange={(e) => setBasics({ ...basics, instructions: e.target.value })}
							maxLength={4000}
							className={inputClass}
						/>
					</div>
				</div>
			</section>

			<section aria-labelledby={`${id}-timer`} className={card}>
				<h2 id={`${id}-timer`} className="text-lg font-bold text-dark dark:text-white">
					2 · Timer & scoring
				</h2>
				<p className="mb-3 text-sm text-dark-5">
					Players answer one question at a time, at their own pace. These settings are fixed once a session starts — deadlines and
					scores then come from the server.
				</p>
				<TimerModeSelector
					value={basics.timer}
					onChange={(timer) => setBasics({ ...basics, timer })}
					savedMode={saved.timer.mode}
					questionCount={perPlayer}
					overrides={
						// With a pool, which overrides a player meets depends on their draw; leave them out of the estimate.
						perPlayer < g.questions.length ? [] : g.questions.map((q) => q.secondsOverride).filter((s): s is number => !!s)
					}
					disabled={g.locked}
				/>
				<div className="mt-5 border-t border-stroke pt-5 dark:border-stroke-dark">
					<QuestionPoolSelector
						poolSize={g.questions.length}
						perPlayer={basics.questionsPerPlayer}
						selection={basics.questionSelection}
						marksDiffer={new Set(g.questions.map((q) => q.marks)).size > 1}
						onChange={({ perPlayer: n, selection }) =>
							setBasics({ ...basics, questionsPerPlayer: n, questionSelection: selection })
						}
						disabled={g.locked}
					/>
				</div>
				<div className="mt-5 border-t border-stroke pt-5 dark:border-stroke-dark">
					<ScoringSelector
						value={basics.scoringMode}
						onChange={(scoringMode) => setBasics({ ...basics, scoringMode })}
						shuffle={basics.shuffleQuestions}
						onShuffleChange={(shuffleQuestions) => setBasics({ ...basics, shuffleQuestions })}
						timerMode={basics.timer.mode}
						secondsPerQuestion={basics.timer.secondsPerQuestion}
						totalSeconds={basics.timer.totalSeconds}
						disabled={g.locked}
					/>
				</div>
				{dirty ? (
					<div className="mt-4 flex justify-end">
						<button type="button" onClick={save} disabled={saving} className={btnPrimary}>
							{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
							Save changes
						</button>
					</div>
				) : null}
			</section>

			<section aria-labelledby={`${id}-questions`} className={card}>
				<div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
					<h2 id={`${id}-questions`} className="text-lg font-bold text-dark dark:text-white">
						3 · Questions
					</h2>
					<p className="text-sm text-dark-5">
						<span className="font-mono tabular-nums">{g.questions.length}</span> questions ·{" "}
						<span className="font-mono tabular-nums">{g.questions.reduce((sum, q) => sum + q.marks, 0)}</span> marks
					</p>
				</div>
				<QuestionList
					game={g}
					perQuestionMode={perQuestionMode}
					onChange={(questions) => game.setData({ ...g, questions, questionCount: questions.length })}
				/>
			</section>

			<section aria-labelledby={`${id}-review`} className={card}>
				<h2 id={`${id}-review`} className="mb-3 text-lg font-bold text-dark dark:text-white">
					4 · Review & host
				</h2>
				<ReviewPanel game={{ ...g, title: basics.title }} dirty={dirty} timerError={timerError} />
			</section>

			<HostLiveDialog game={hosting ? g : null} onClose={() => setHosting(false)} />
		</div>
	);
}
