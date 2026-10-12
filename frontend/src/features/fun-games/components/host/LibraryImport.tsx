"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleSlash, Info, Library, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { getHostApi, toFunGamesError } from "../../api";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { formatSeconds } from "../../lib/format";
import type { HostImportRow, ImportSummary, LibraryQuiz, TimerMode } from "../../types";
import { btnPrimary, btnSecondary, card, inputClass } from "../shared/hostStyles";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Lets the editor's "Imported N · M skipped · Undo" banner show the counts. */
export function rememberImport(summary: ImportSummary) {
	try {
		sessionStorage.setItem(`fungame:import:${summary.id}`, JSON.stringify(summary));
	} catch {
		// The banner falls back to a plain message.
	}
}

export function ImportRowStatusChip({ row }: { row: Pick<HostImportRow, "status"> }) {
	const map = {
		ready: { label: "Ready", Icon: CheckCircle2, cls: "border-green-light-4 bg-green-light-7 text-green-dark" },
		check: { label: "Check", Icon: Info, cls: "border-urgent/30 bg-urgent-bg text-urgent-text" },
		error: { label: "Error", Icon: CircleSlash, cls: "border-red-light-3 bg-red-light-5 text-red-dark" },
		skipped: { label: "Skipped", Icon: CircleSlash, cls: "border-stroke bg-gray-2 text-dark-4 dark:border-stroke-dark dark:bg-dark-2 dark:text-dark-6" },
	} as const;
	const { label, Icon, cls } = map[row.status];
	return (
		<span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold", cls)}>
			<Icon className="h-3.5 w-3.5" aria-hidden />
			{label}
		</span>
	);
}

function QuizPicker({
	quizzes,
	selectedId,
	onSelect,
}: {
	quizzes: LibraryQuiz[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	const [query, setQuery] = useState("");
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? quizzes.filter((quiz) => quiz.title.toLowerCase().includes(q)) : quizzes;
	}, [quizzes, query]);

	return (
		<div className={card}>
			<label className="relative block">
				<span className="sr-only">Search your quizzes</span>
				<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-5" aria-hidden />
				<input
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search your quizzes"
					className={`${inputClass} pl-9`}
				/>
			</label>
			<div role="radiogroup" aria-label="Your quizzes" className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
				{filtered.length === 0 ? (
					<p className="py-6 text-center text-sm text-dark-5">No quizzes match “{query}”.</p>
				) : (
					filtered.map((quiz) => {
						const selected = quiz.id === selectedId;
						return (
							<button
								key={quiz.id}
								type="button"
								role="radio"
								aria-checked={selected}
								onClick={() => onSelect(quiz.id)}
								className={cn(
									"flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-light-4",
									selected
										? "border-2 border-blue-dark bg-blue-light-5 dark:bg-dark-2"
										: "border-stroke hover:border-blue-light-3 dark:border-stroke-dark",
								)}
							>
								<span className="min-w-0">
									<span className="block truncate font-semibold text-dark dark:text-white">{quiz.title}</span>
									<span className="block text-xs text-dark-5">
										{quiz.updatedAt ? `Updated ${dateFormat.format(new Date(quiz.updatedAt))}` : ""}
									</span>
								</span>
								<span className="shrink-0 font-mono text-sm tabular-nums text-dark-4 dark:text-dark-6">
									{quiz.questionCount} Q
								</span>
							</button>
						);
					})
				)}
			</div>
		</div>
	);
}

function Preview({ quizId }: { quizId: string }) {
	const router = useRouter();
	const preview = useAsyncResource(async (signal) => (await getHostApi()).previewLibraryQuiz(quizId, { signal }), [quizId]);
	const [mode, setMode] = useState<TimerMode>("perQuestion");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (preview.loading) {
		return (
			<div className={card} role="status">
				<Loader2 className="h-5 w-5 animate-spin text-dark-5" aria-hidden />
				<span className="sr-only">Checking the quiz…</span>
			</div>
		);
	}
	if (preview.error || !preview.data) {
		return (
			<div className={card} role="alert">
				<p className="text-sm text-red-dark">{preview.error?.message}</p>
				<button type="button" onClick={preview.reload} className={`${btnSecondary} mt-3`}>
					Try again
				</button>
			</div>
		);
	}

	const { rows, importable, suggestedTimer, quiz } = preview.data;
	const skipped = rows.filter((r) => r.status === "skipped").length;

	const create = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await (await getHostApi()).createGameFromLibrary(quizId, mode);
			rememberImport(result.import);
			router.push(`/fun-games/${result.game.id}/edit?imported=${result.import.id}`);
		} catch (reason) {
			setError(toFunGamesError(reason).message);
			setBusy(false);
		}
	};

	return (
		<div className="space-y-4">
			<div className={card}>
				<h2 className="text-lg font-bold text-dark dark:text-white">{quiz.title}</h2>
				<p className="mt-1 text-sm text-dark-4 dark:text-dark-6" aria-live="polite">
					<span className="font-mono font-semibold tabular-nums">{importable}</span> of{" "}
					<span className="font-mono tabular-nums">{rows.length}</span> questions can be imported
					{skipped ? (
						<>
							{" "}
							· <span className="font-mono tabular-nums">{skipped}</span> will be skipped
						</>
					) : null}
					. The game gets its own copy — editing either one later doesn&apos;t change the other.
				</p>

				<div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-stroke dark:border-stroke-dark">
					<table className="w-full text-left text-sm">
						<caption className="sr-only">Questions in this quiz</caption>
						<thead className="sticky top-0 bg-gray-1 text-xs font-semibold uppercase text-dark-5 dark:bg-dark-2">
							<tr>
								<th scope="col" className="w-10 px-3 py-2">#</th>
								<th scope="col" className="px-3 py-2">Question</th>
								<th scope="col" className="px-3 py-2">Type</th>
								<th scope="col" className="px-3 py-2">Result</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-2 dark:divide-dark-3">
							{rows.map((row) => (
								<tr key={row.index} className={row.status === "skipped" ? "bg-gray-1 dark:bg-dark-2/50" : undefined}>
									<td className="px-3 py-2 font-mono tabular-nums text-dark-5">{row.position}</td>
									<td className="max-w-md px-3 py-2">
										<span className="line-clamp-2 text-dark dark:text-white">{row.text || <em>(empty)</em>}</span>
										{row.messages.length ? <span className="block text-xs text-dark-5">{row.messages.join(" ")}</span> : null}
									</td>
									<td className="whitespace-nowrap px-3 py-2 text-dark-4 dark:text-dark-6">{row.type}</td>
									<td className="px-3 py-2">
										<ImportRowStatusChip row={row} />
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>

			<fieldset className={card}>
				<legend className="sr-only">Timer</legend>
				<p className="text-sm font-bold text-dark dark:text-white">Timer</p>
				<p className="text-xs text-dark-5">Starting values come from the quiz&apos;s time limits. You can change them on the next screen.</p>
				<div className="mt-3 grid gap-2 sm:grid-cols-2">
					{(
						[
							["perQuestion", "Per-question timer", `${formatSeconds(suggestedTimer.secondsPerQuestion)} per question; each player answers at their own pace.`],
							["total", "Total quiz timer", `${formatSeconds(suggestedTimer.totalSeconds)} for the whole quiz, one question at a time.`],
						] as const
					).map(([value, title, body]) => (
						<label
							key={value}
							className="flex cursor-pointer items-start gap-3 rounded-lg border border-stroke p-3 has-[:checked]:border-2 has-[:checked]:border-blue-dark has-[:checked]:bg-blue-light-5 dark:border-stroke-dark dark:has-[:checked]:bg-dark-2"
						>
							<input type="radio" name="timer" checked={mode === value} onChange={() => setMode(value)} className="mt-1" />
							<span>
								<span className="block text-sm font-semibold text-dark dark:text-white">{title}</span>
								<span className="block text-xs text-dark-5">{body}</span>
							</span>
						</label>
					))}
				</div>
			</fieldset>

			{error ? (
				<p role="alert" className="rounded-lg border border-red-light-3 bg-red-light-5 px-3 py-2 text-sm text-red-dark">
					{error}
				</p>
			) : null}

			<div className="flex justify-end">
				<button type="button" onClick={create} disabled={busy || importable === 0} className={btnPrimary}>
					{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Library className="h-4 w-4" aria-hidden />}
					{importable === 0 ? "Nothing to import" : `Create game with ${importable} question${importable === 1 ? "" : "s"}`}
				</button>
			</div>
		</div>
	);
}

/** /fun-games/import: copy a My Library quiz into a new Fun Game. */
export function LibraryImport() {
	const quizzes = useAsyncResource(async (signal) => (await getHostApi()).listLibraryQuizzes({ signal }), []);
	const [selected, setSelected] = useState<string | null>(null);

	return (
		<div className="relative mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
			<Link href="/fun-games" className="inline-flex items-center gap-1 text-sm font-semibold text-dark-5 hover:text-dark dark:hover:text-white">
				<ArrowLeft className="h-4 w-4" aria-hidden />
				Fun Games
			</Link>
			<header>
				<h1 className="text-heading-6 font-bold text-dark dark:text-white">Import from My Library</h1>
				<p className="mt-1 text-sm text-dark-5">
					Pick one of your quizzes. Single-choice and true/false questions come across; other types are listed and skipped.
				</p>
			</header>

			{quizzes.loading ? (
				<div className={card} role="status">
					<Loader2 className="h-5 w-5 animate-spin text-dark-5" aria-hidden />
					<span className="sr-only">Loading your quizzes…</span>
				</div>
			) : quizzes.error ? (
				<div className={card} role="alert">
					<p className="text-sm text-red-dark">{quizzes.error.message}</p>
					<button type="button" onClick={quizzes.reload} className={`${btnSecondary} mt-3`}>
						Try again
					</button>
				</div>
			) : !quizzes.data?.length ? (
				<div className={`${card} py-10 text-center`}>
					<p className="font-semibold text-dark dark:text-white">Your library has no quizzes yet.</p>
					<p className="mt-1 text-sm text-dark-5">Build one in My Library, then come back to import it.</p>
					<Link href="/my-library/quiz-page" className={`${btnPrimary} mt-4`}>
						Go to My Library
					</Link>
				</div>
			) : (
				<div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
					<QuizPicker quizzes={quizzes.data} selectedId={selected} onSelect={setSelected} />
					{selected ? (
						<Preview key={selected} quizId={selected} />
					) : (
						<div className={`${card} flex items-center justify-center py-16 text-sm text-dark-5`}>
							Select a quiz to see what will be imported.
						</div>
					)}
				</div>
			)}
		</div>
	);
}
