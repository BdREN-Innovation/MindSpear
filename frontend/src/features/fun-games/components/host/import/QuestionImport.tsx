"use client";

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileJson, Library, Loader2, Pencil, Plus, Sparkles, Trash2, Undo2, Upload, X } from "lucide-react";
import { DocumentToQuestionsWizard } from "@/features/ai-generate/components/DocumentToQuestionsWizard";
import { toFunGameImport } from "@/features/ai-generate/mappers";
import { cn } from "@/lib/utils";
import { getHostApi, toFunGamesError } from "../../../api";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import { describeTimer } from "../../../lib/format";
import { checkRows, EXAMPLE_FILE, MAX_FILE_BYTES, parseImportText, toEditable, type JsonProblem, type ParsedImportFile } from "../../../lib/importSchema";
import type { HostGameDetail, HostImportRow, ImportFileQuestionV1, ImportSummary } from "../../../types";
import { btnPrimary, btnSecondary, card, inputClass, labelClass } from "../../shared/hostStyles";
import { ImportRowStatusChip, rememberImport } from "../LibraryImport";

type Source = "upload" | "paste" | "library";

interface Row {
	key: number;
	include: boolean;
	/** Raw from the file until edited, then a well-formed question. */
	value: unknown;
}

function ProblemBox({ problem }: { problem: JsonProblem }) {
	return (
		<div role="alert" className="rounded-lg border border-red-light-3 bg-red-light-5 p-3 text-sm text-red-dark">
			<p className="font-semibold">
				{problem.line ? `Line ${problem.line}, column ${problem.column}: ` : ""}
				{problem.message}
			</p>
			{problem.snippet ? (
				<pre className="mt-2 overflow-x-auto rounded bg-white p-2 font-mono text-xs text-dark dark:bg-dark-2 dark:text-white">{problem.snippet}</pre>
			) : null}
			<p className="mt-2 text-dark-4 dark:text-dark-6">Nothing was imported. Fix the file and try again.</p>
		</div>
	);
}

function RowEditor({ value, onSave, onCancel }: { value: ImportFileQuestionV1; onSave: (q: ImportFileQuestionV1) => void; onCancel: () => void }) {
	const id = useId();
	const [q, setQ] = useState(value);
	return (
		<div className="space-y-3 rounded-lg border-2 border-blue-dark bg-white p-3 dark:bg-gray-dark">
			<div>
				<label htmlFor={`${id}-t`} className={labelClass}>Question</label>
				<textarea id={`${id}-t`} rows={2} value={q.text} onChange={(e) => setQ({ ...q, text: e.target.value })} className={inputClass} />
			</div>
			<fieldset>
				<legend className={labelClass}>Options · select the correct one</legend>
				<ul className="space-y-1.5">
					{q.options.map((option, i) => (
						<li key={i} className="flex items-center gap-2">
							<input type="radio" name={`${id}-a`} checked={q.answer === i} onChange={() => setQ({ ...q, answer: i })} aria-label={`Option ${i + 1} is correct`} />
							<input
								value={option}
								onChange={(e) => setQ({ ...q, options: q.options.map((o, j) => (j === i ? e.target.value : o)) })}
								aria-label={`Option ${i + 1}`}
								className={inputClass}
							/>
							<button
								type="button"
								onClick={() =>
									setQ({ ...q, options: q.options.filter((_, j) => j !== i), answer: q.answer === i ? 0 : q.answer > i ? q.answer - 1 : q.answer })
								}
								disabled={q.options.length <= 2}
								aria-label={`Remove option ${i + 1}`}
								className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-dark-5 hover:bg-gray-2 disabled:opacity-30 dark:hover:bg-dark-2"
							>
								<X className="h-4 w-4" aria-hidden />
							</button>
						</li>
					))}
				</ul>
				{q.options.length < 10 ? (
					<button type="button" onClick={() => setQ({ ...q, options: [...q.options, ""] })} className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-blue-dark">
						<Plus className="h-4 w-4" aria-hidden />
						Add option
					</button>
				) : null}
			</fieldset>
			<div className="grid grid-cols-2 gap-3">
				<div>
					<label htmlFor={`${id}-m`} className={labelClass}>Marks</label>
					<input
						id={`${id}-m`}
						type="number"
						min={0}
						step={0.5}
						value={q.marks ?? ""}
						placeholder="Game default"
						onChange={(e) => setQ({ ...q, marks: e.target.value === "" ? undefined : Number(e.target.value) })}
						className={cn(inputClass, "font-mono")}
					/>
				</div>
				<div>
					<label htmlFor={`${id}-n`} className={labelClass}>Deduct if wrong</label>
					<input
						id={`${id}-n`}
						type="number"
						min={0}
						step={0.25}
						value={q.negative ?? ""}
						placeholder="Game default"
						onChange={(e) => setQ({ ...q, negative: e.target.value === "" ? undefined : Number(e.target.value) })}
						className={cn(inputClass, "font-mono")}
					/>
				</div>
			</div>
			<div className="flex justify-end gap-2">
				<button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
				<button type="button" onClick={() => onSave(q)} className={btnPrimary}>Done</button>
			</div>
		</div>
	);
}

function JsonSource({ onParsed }: { onParsed: (file: ParsedImportFile) => void }) {
	const [source, setSource] = useState<Exclude<Source, "library">>("upload");
	const [text, setText] = useState("");
	const [problem, setProblem] = useState<JsonProblem | null>(null);
	const [dragOver, setDragOver] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const check = (content: string) => {
		const result = parseImportText(content);
		if (result.ok) {
			setProblem(null);
			onParsed(result.file);
		} else {
			setProblem(result.problem);
		}
	};

	const readFile = async (file: File | undefined) => {
		if (!file) return;
		if (file.size > MAX_FILE_BYTES) {
			setProblem({ message: `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB.` });
			return;
		}
		check(await file.text());
	};

	return (
		<div className="space-y-3">
			<div role="tablist" aria-label="How to provide the JSON" className="inline-flex rounded-lg border border-stroke p-1 dark:border-stroke-dark">
				{(["upload", "paste"] as const).map((s) => (
					<button
						key={s}
						type="button"
						role="tab"
						aria-selected={source === s}
						onClick={() => setSource(s)}
						className={cn("h-9 rounded-md px-3 text-sm font-semibold", source === s ? "bg-dark text-white dark:bg-white dark:text-dark" : "text-dark-4 dark:text-dark-6")}
					>
						{s === "upload" ? "Upload file" : "Paste JSON"}
					</button>
				))}
			</div>

			{source === "upload" ? (
				<label
					onDragOver={(e) => {
						e.preventDefault();
						setDragOver(true);
					}}
					onDragLeave={() => setDragOver(false)}
					onDrop={(e) => {
						e.preventDefault();
						setDragOver(false);
						readFile(e.dataTransfer.files[0]);
					}}
					className={cn(
						"flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition",
						dragOver ? "border-blue-dark bg-blue-light-5" : "border-stroke dark:border-stroke-dark",
					)}
				>
					<Upload className="h-8 w-8 text-dark-5" aria-hidden />
					<span className="font-semibold text-dark dark:text-white">Drop a .json file here, or choose one</span>
					<span className="text-xs text-dark-5">Up to 2 MB and 500 questions</span>
					<input ref={inputRef} type="file" accept=".json,application/json" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
				</label>
			) : (
				<div className="space-y-2">
					<label htmlFor="fg-paste" className={labelClass}>JSON</label>
					<textarea id="fg-paste" rows={12} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className={cn(inputClass, "font-mono text-xs")} placeholder={EXAMPLE_FILE} />
					<button type="button" onClick={() => check(text)} disabled={!text.trim()} className={btnPrimary}>Check JSON</button>
				</div>
			)}

			{problem ? <ProblemBox problem={problem} /> : null}

			<details className="text-sm">
				<summary className="cursor-pointer font-semibold text-dark-4 dark:text-dark-6">File format</summary>
				<p className="mt-2 text-dark-5">
					<code>answer</code> is the 0-based index of the correct option. <code>marks</code>, <code>negative</code> and <code>settings</code> are optional.
				</p>
				<pre className="mt-2 overflow-x-auto rounded-lg bg-gray-1 p-3 font-mono text-xs text-dark dark:bg-dark-2 dark:text-white">{EXAMPLE_FILE}</pre>
			</details>
		</div>
	);
}

/** /fun-games/[id]/import: add or replace questions from a JSON file or a My Library quiz. */
export function QuestionImport({ gameId }: { gameId: string }) {
	const router = useRouter();
	const game = useAsyncResource(async (signal) => (await getHostApi()).getGame(gameId, { signal }), [gameId]);
	const library = useAsyncResource(async (signal) => (await getHostApi()).listLibraryQuizzes({ signal }), []);
	const [source, setSource] = useState<"json" | "library" | "document">("json");
	/** Shown after AI generation: the file it came from, with a way to start over. */
	const [generatedFrom, setGeneratedFrom] = useState<{ name: string; count: number } | null>(null);
	const [file, setFile] = useState<ParsedImportFile | null>(null);
	const [rows, setRows] = useState<Row[]>([]);
	const [libraryQuizId, setLibraryQuizId] = useState<string>("");
	const [libraryRows, setLibraryRows] = useState<HostImportRow[] | null>(null);
	const [mode, setMode] = useState<"append" | "replace">("append");
	const [useFileTimer, setUseFileTimer] = useState(false);
	const [attentionOnly, setAttentionOnly] = useState(false);
	const [editing, setEditing] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [serverRows, setServerRows] = useState<Map<number, HostImportRow> | null>(null);
	const [done, setDone] = useState<{ summary: ImportSummary; game: HostGameDetail } | null>(null);

	const g = game.data;
	// AI-generated questions use the same editable preview and import as a JSON file.
	const jsonLike = source !== "library";
	const checks = useMemo(
		() =>
			g
				? checkRows(
						rows.map((r) => r.value),
						mode === "append" ? g.questions.map((q) => q.text) : [],
						g.defaultMarks,
					)
				: [],
		[rows, g, mode],
	);

	const included = rows.map((r, i) => ({ row: r, check: checks[i], index: i })).filter((x) => x.row.include);
	const errorCount = included.filter((x) => x.check?.status === "error").length;
	const checkCount = included.filter((x) => x.check?.status === "check").length;

	const loadFile = (parsed: ParsedImportFile) => {
		setFile(parsed);
		setRows(parsed.questions.map((value, key) => ({ key, include: true, value })));
		setUseFileTimer(false);
		setServerRows(null);
		setError(null);
	};

	const previewLibrary = async (quizId: string) => {
		setLibraryQuizId(quizId);
		setLibraryRows(null);
		setError(null);
		if (!quizId) return;
		setBusy(true);
		try {
			const result = await (await getHostApi()).importDryRun(gameId, { source: "library_quiz", quizId, mode });
			setLibraryRows(result.rows);
		} catch (reason) {
			setError(toFunGamesError(reason).message);
		} finally {
			setBusy(false);
		}
	};

	const runImport = async () => {
		if (!g) return;
		setBusy(true);
		setError(null);
		setServerRows(null);
		try {
			const api = await getHostApi();
			const result =
				source === "library"
					? await api.importQuestions(gameId, { source: "library_quiz", quizId: libraryQuizId, mode })
					: await api.importQuestions(gameId, {
							source: "json",
							mode,
							questions: included.map((x) => x.row.value as ImportFileQuestionV1),
							timer: useFileTimer && file?.timer ? file.timer : null,
							skipped: rows
								.map((r, i) => ({ r, i }))
								.filter(({ r }) => !r.include)
								.map(({ r, i }) => ({
									position: i + 1,
									text: String((r.value as { text?: unknown })?.text ?? "").slice(0, 160),
									reason: "Left out in the preview",
								})),
						});
			rememberImport(result.import);
			setDone({ summary: result.import, game: result.game });
		} catch (reason) {
			const err = toFunGamesError(reason);
			setError(err.message);
			const reported = err.details?.rows;
			if (Array.isArray(reported) && jsonLike) {
				// Server rows are numbered by position in what was sent (the included rows).
				setServerRows(new Map((reported as HostImportRow[]).map((r) => [included[r.index]?.index ?? -1, r])));
			}
		} finally {
			setBusy(false);
		}
	};

	const undo = async () => {
		if (!done) return;
		setBusy(true);
		setError(null);
		try {
			const result = await (await getHostApi()).undoImport(done.summary.id);
			setDone({ summary: result.import, game: result.game });
		} catch (reason) {
			setError(toFunGamesError(reason).message);
		} finally {
			setBusy(false);
		}
	};

	if (game.loading || !g) {
		return (
			<div className="relative mx-auto max-w-5xl p-6" role={game.error ? "alert" : "status"}>
				{game.error ? <p className="text-red-dark">{game.error.message}</p> : <Loader2 className="h-6 w-6 animate-spin text-dark-5" aria-hidden />}
			</div>
		);
	}

	const back = (
		<Link href={`/fun-games/${gameId}/edit`} className="inline-flex items-center gap-1 text-sm font-semibold text-dark-5 hover:text-dark dark:hover:text-white">
			<ArrowLeft className="h-4 w-4" aria-hidden />
			Back to “{g.title}”
		</Link>
	);

	if (done) {
		const s = done.summary;
		return (
			<div className="relative mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
				{back}
				<div className={cn(card, "space-y-3")} role="status">
					<h1 className="flex items-center gap-2 text-xl font-bold text-dark dark:text-white">
						<CheckCircle2 className="h-6 w-6 text-green-dark" aria-hidden />
						{s.undoneAt ? "Import undone" : "Import complete"}
					</h1>
					{s.undoneAt ? (
						<p className="text-sm text-dark-5">The game is back to how it was before the import.</p>
					) : (
						<p className="text-sm text-dark-4 dark:text-dark-6">
							Added <strong>{s.added}</strong> question{s.added === 1 ? "" : "s"}
							{s.removed ? <>, removed <strong>{s.removed}</strong></> : null}
							{s.skipped.length ? <>, skipped <strong>{s.skipped.length}</strong></> : null}. The game now has {done.game.questionCount} questions.
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						<button type="button" onClick={() => router.push(`/fun-games/${gameId}/edit`)} className={btnPrimary}>Back to the editor</button>
						{!s.undoneAt ? (
							<button type="button" onClick={undo} disabled={busy} className={btnSecondary}>
								{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />}
								Undo import
							</button>
						) : null}
					</div>
					{error ? <p role="alert" className="text-sm font-semibold text-red-dark">{error}</p> : null}
				</div>
			</div>
		);
	}

	const visibleRows = rows
		.map((row, index) => ({ row, index, check: serverRows?.get(index) ?? checks[index] }))
		.filter((x) => !attentionOnly || (x.check && x.check.status !== "ready"));
	const libraryImportable = libraryRows?.filter((r) => r.status !== "skipped").length ?? 0;
	const canImport =
		!busy && !g.locked && (source === "library" ? !!libraryQuizId && libraryImportable > 0 : included.length > 0 && errorCount === 0);

	return (
		<div className="relative mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
			{back}
			<header>
				<h1 className="text-heading-6 font-bold text-dark dark:text-white">Import questions</h1>
				<p className="mt-1 text-sm text-dark-5">Into “{g.title}”, which has {g.questions.length} question{g.questions.length === 1 ? "" : "s"} now.</p>
			</header>
			{g.locked ? (
				<p role="status" className="rounded-lg border border-urgent/30 bg-urgent-bg px-3 py-2 text-sm text-urgent-text">A session is running; importing is available once it ends.</p>
			) : null}

			<section className={card} aria-labelledby="fg-source">
				<h2 id="fg-source" className="mb-3 font-bold text-dark dark:text-white">1 · Source</h2>
				<div className="mb-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Import from">
					{(
						[
							["json", "JSON file", FileJson],
							["library", "A quiz in My Library", Library],
							["document", "From a document (AI)", Sparkles],
						] as const
					).map(([value, label, Icon]) => (
						<button
							key={value}
							type="button"
							role="radio"
							aria-checked={source === value}
							onClick={() => {
								// A JSON file and AI questions share the preview; don't carry one into the other.
								if (value !== source && (value === "document" || source === "document")) {
									setRows([]);
									setFile(null);
									setGeneratedFrom(null);
								}
								setSource(value);
								setError(null);
							}}
							className={cn(
								"flex items-center gap-2 rounded-lg border p-3 text-left text-sm font-semibold",
								source === value ? "border-2 border-blue-dark bg-blue-light-5 text-blue-dark dark:bg-dark-2" : "border-stroke text-dark dark:border-stroke-dark dark:text-white",
							)}
						>
							<Icon className="h-4 w-4" aria-hidden />
							{label}
						</button>
					))}
				</div>

				{source === "json" ? (
					<JsonSource onParsed={loadFile} />
				) : source === "document" ? (
					generatedFrom ? (
						<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stroke bg-gray-1 px-3 py-2.5 text-sm dark:border-stroke-dark dark:bg-dark-2">
							<span className="flex items-center gap-2 text-dark dark:text-white">
								<Sparkles className="h-4 w-4 text-secondary" aria-hidden />
								{generatedFrom.count} question{generatedFrom.count === 1 ? "" : "s"} generated from “{generatedFrom.name}”. Review them below.
							</span>
							<button
								type="button"
								onClick={() => {
									setGeneratedFrom(null);
									setRows([]);
									setFile(null);
								}}
								className={btnSecondary}
							>
								Generate again
							</button>
						</div>
					) : (
						<DocumentToQuestionsWizard
							target="fungame"
							layout="inline"
							generateLabel="Generate questions"
							onGenerated={(result, { file: sourceFile }) => {
								loadFile({ title: null, timer: null, timerNote: null, questions: toFunGameImport(result.questions) });
								setGeneratedFrom({ name: sourceFile.name, count: result.questions.length });
							}}
						/>
					)
				) : (
					<div className="space-y-2">
						<label htmlFor="fg-lib" className={labelClass}>Quiz</label>
						<select id="fg-lib" value={libraryQuizId} onChange={(e) => previewLibrary(e.target.value)} className={inputClass}>
							<option value="">Choose a quiz…</option>
							{library.data?.map((q) => (
								<option key={q.id} value={q.id}>
									{q.title} ({q.questionCount} questions)
								</option>
							))}
						</select>
						{library.error ? <p className="text-sm text-red-dark">{library.error.message}</p> : null}
					</div>
				)}
			</section>

			{(jsonLike && rows.length > 0) || (source === "library" && libraryRows) ? (
				<section className={card} aria-labelledby="fg-preview">
					<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
						<h2 id="fg-preview" className="font-bold text-dark dark:text-white">2 · Preview</h2>
						{jsonLike ? (
							<div className="flex flex-wrap items-center gap-3 text-sm">
								<span className="text-dark-5" aria-live="polite">
									{included.length} included · <span className={errorCount ? "font-semibold text-red-dark" : undefined}>{errorCount} with errors</span> · {checkCount} to check
								</span>
								<label className="flex items-center gap-1.5">
									<input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
									Needs attention only
								</label>
							</div>
						) : (
							<span className="text-sm text-dark-5">
								{libraryImportable} of {libraryRows!.length} can be imported
							</span>
						)}
					</div>

					<div className="overflow-x-auto rounded-lg border border-stroke dark:border-stroke-dark">
						<table className="w-full min-w-[40rem] text-left text-sm">
							<caption className="sr-only">Questions to import</caption>
							<thead className="bg-gray-1 text-xs font-semibold uppercase text-dark-5 dark:bg-dark-2">
								<tr>
									{jsonLike ? <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Include</span></th> : null}
									<th scope="col" className="w-10 px-3 py-2">#</th>
									<th scope="col" className="px-3 py-2">Question</th>
									<th scope="col" className="px-3 py-2">Status</th>
									{jsonLike ? <th scope="col" className="w-24 px-3 py-2"><span className="sr-only">Actions</span></th> : null}
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-2 dark:divide-dark-3">
								{source === "library"
									? libraryRows!.map((r) => (
											<tr key={r.index} className={r.status === "skipped" ? "bg-gray-1 dark:bg-dark-2/50" : undefined}>
												<td className="px-3 py-2 font-mono tabular-nums text-dark-5">{r.position}</td>
												<td className="max-w-md px-3 py-2">
													<span className="line-clamp-2">{r.text}</span>
													<span className="text-xs text-dark-5">{r.type}</span>
												</td>
												<td className="px-3 py-2">
													<ImportRowStatusChip row={r} />
													{r.messages.length ? <p className="mt-1 text-xs text-dark-5">{r.messages.join(" ")}</p> : null}
												</td>
											</tr>
										))
									: visibleRows.map(({ row, index, check }) => {
											const value = row.value as Record<string, unknown>;
											if (editing === row.key) {
												return (
													<tr key={row.key}>
														<td colSpan={5} className="p-2">
															<RowEditor
																value={toEditable(row.value)}
																onCancel={() => setEditing(null)}
																onSave={(q) => {
																	setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, value: q } : r)));
																	setServerRows(null);
																	setEditing(null);
																}}
															/>
														</td>
													</tr>
												);
											}
											return (
												<tr key={row.key} className={cn(!row.include && "opacity-50")}>
													<td className="px-3 py-2">
														<input
															type="checkbox"
															checked={row.include}
															onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, include: e.target.checked } : r)))}
															aria-label={`Include question ${index + 1}`}
														/>
													</td>
													<td className="px-3 py-2 font-mono tabular-nums text-dark-5">{index + 1}</td>
													<td className="max-w-md px-3 py-2">
														<span className="line-clamp-2 text-dark dark:text-white">{typeof value?.text === "string" && value.text ? value.text : <em>(no text)</em>}</span>
														<span className="text-xs text-dark-5">
															{Array.isArray(value?.options) ? `${value.options.length} options` : "no options"}
															{typeof value?.marks === "number" ? ` · ${value.marks} marks` : ""}
														</span>
													</td>
													<td className="px-3 py-2">
														{check ? <ImportRowStatusChip row={check} /> : null}
														{check?.messages.length ? <p className="mt-1 text-xs text-dark-5">{check.messages.join(" ")}</p> : null}
													</td>
													<td className="px-3 py-2">
														<div className="flex justify-end gap-1">
															<button type="button" onClick={() => setEditing(row.key)} aria-label={`Edit question ${index + 1}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-dark-4 hover:bg-gray-2 dark:hover:bg-dark-2">
																<Pencil className="h-4 w-4" aria-hidden />
															</button>
															<button
																type="button"
																onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
																aria-label={`Remove question ${index + 1}`}
																className="flex h-9 w-9 items-center justify-center rounded-lg text-red-dark hover:bg-red-light-5"
															>
																<Trash2 className="h-4 w-4" aria-hidden />
															</button>
														</div>
													</td>
												</tr>
											);
										})}
							</tbody>
						</table>
					</div>
				</section>
			) : null}

			{(jsonLike && rows.length > 0) || (source === "library" && libraryRows) ? (
				<section className={card} aria-labelledby="fg-apply">
					<h2 id="fg-apply" className="mb-3 font-bold text-dark dark:text-white">3 · Apply</h2>
					<fieldset className="grid gap-2 sm:grid-cols-2">
						<legend className="sr-only">How to add them</legend>
						{(
							[
								["append", "Add to existing questions", `The ${g.questions.length} current questions stay; new ones go at the end.`],
								["replace", `Replace all ${g.questions.length} questions`, "Current questions are removed. Results of games already played keep them."],
							] as const
						).map(([value, title, body]) => (
							<label key={value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-stroke p-3 has-[:checked]:border-2 has-[:checked]:border-blue-dark has-[:checked]:bg-blue-light-5 dark:border-stroke-dark dark:has-[:checked]:bg-dark-2">
								<input type="radio" name="fg-mode" checked={mode === value} onChange={() => setMode(value)} className="mt-1" />
								<span>
									<span className="block text-sm font-semibold text-dark dark:text-white">{title}</span>
									<span className="block text-xs text-dark-5">{body}</span>
								</span>
							</label>
						))}
					</fieldset>
					{jsonLike && file?.timer ? (
						<label className="mt-3 flex items-start gap-2 text-sm">
							<input type="checkbox" checked={useFileTimer} onChange={(e) => setUseFileTimer(e.target.checked)} className="mt-1" />
							<span>
								<span className="font-semibold text-dark dark:text-white">Use the file&apos;s timer: {describeTimer(file.timer)}</span>
								<span className="block text-xs text-dark-5">Currently {describeTimer(g.timer)}. Left unticked, the game&apos;s timer doesn&apos;t change.</span>
							</span>
						</label>
					) : null}
					{jsonLike && file?.timerNote ? <p className="mt-3 text-xs text-dark-5">{file.timerNote}</p> : null}

					{error ? <p role="alert" className="mt-3 rounded-lg border border-red-light-3 bg-red-light-5 px-3 py-2 text-sm text-red-dark">{error}</p> : null}

					<div className="mt-4 flex items-center justify-end gap-3">
						{jsonLike && errorCount > 0 ? (
							<p className="text-sm text-red-dark">Fix or untick the {errorCount} row{errorCount === 1 ? "" : "s"} with errors to import.</p>
						) : null}
						<button type="button" onClick={runImport} disabled={!canImport} className={btnPrimary}>
							{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
							{source === "library"
								? `Import ${libraryImportable} question${libraryImportable === 1 ? "" : "s"}`
								: `Import ${included.length} question${included.length === 1 ? "" : "s"}`}
						</button>
					</div>
				</section>
			) : null}
		</div>
	);
}
