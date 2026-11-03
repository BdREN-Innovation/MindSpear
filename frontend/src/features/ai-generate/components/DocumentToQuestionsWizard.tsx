"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeftRight, ArrowRight, Check, Loader2, RefreshCw } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import GeneratingLoader from "@/components/ui/loader/GeneratingLoader";
import { FilePickerPanel } from "@/features/file-library/components/FileLibraryPicker";
import { FileThumb } from "@/features/file-library/components/FileThumb";
import { formatBytes, typeStyle } from "@/features/file-library/lib/format";
import type { LibraryFile } from "@/features/file-library/types";
import { generateFromText } from "../aiClient";
import { chapterOfPage, type Chapter } from "../lib/chapters";
import { documentUnit, loadDocumentParts, loadSlideImages, withSlideImages, type DocumentPart, type LoadedDocument } from "../lib/documentPages";
import { aiTypesFor, DEFAULT_TYPES } from "../questionTypes";
import { MAX_QUESTIONS, MAX_TEXT_CHARS, TARGET_NOUN, type GeneratedFor, type GenerationOptions, type GenerationTarget } from "../types";
import { GenerationOptionsForm } from "./GenerationOptionsForm";
import { MAX_SELECTED_PARTS, PageSelectionStep } from "./PageSelectionStep";

type Step = "file" | "configure" | "generating";

export interface GeneratedContext {
	file: LibraryFile;
	options: GenerationOptions;
}

export interface DocumentToQuestionsWizardProps<T extends GenerationTarget> {
	target: T;
	/** Save the result (create questions/tasks). Throw to show an error and stay on the wizard. */
	onGenerated: (result: GeneratedFor<T>, context: GeneratedContext) => Promise<void> | void;
	onCancel?: () => void;
	/** Label of the final button, e.g. "Generate quiz". */
	generateLabel?: string;
	/** Tall layout for modals; inline keeps natural height. */
	layout?: "modal" | "inline";
}

const STEPS: { key: Step; label: string }[] = [
	{ key: "file", label: "Choose a document" },
	{ key: "configure", label: "Pick pages & options" },
	{ key: "generating", label: "Generate" },
];

function topicFromName(name: string): string {
	return name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * The text sent to the AI: each page labelled with its chapter, and — when the
 * selection is too long — every page shortened by the same ratio, so the whole
 * selection is covered rather than only its beginning.
 */
function buildTextData(parts: DocumentPart[], chapters: Chapter[]): string {
	const headers = parts.map((p) => {
		const chapter = chapterOfPage(chapters, p.id);
		return `[${p.label}${chapter ? ` — ${chapter.path.join(" › ")}` : ""}]`;
	});
	const budget = MAX_TEXT_CHARS - headers.reduce((sum, h) => sum + h.length + 3, 0);
	const total = parts.reduce((sum, p) => sum + p.text.length, 0);
	const ratio = total > budget ? Math.max(0, budget) / total : 1;
	return parts.map((p, i) => `${headers[i]}\n${ratio < 1 ? p.text.slice(0, Math.floor(p.text.length * ratio)) : p.text}`).join("\n\n");
}

/** Choose a document from My Files (or upload one), pick pages, and let AI write questions from them. */
export function DocumentToQuestionsWizard<T extends GenerationTarget>({
	target,
	onGenerated,
	onCancel,
	generateLabel,
	layout = "modal",
}: DocumentToQuestionsWizardProps<T>) {
	const [step, setStep] = useState<Step>("file");
	const [file, setFile] = useState<LibraryFile | null>(null);
	const [doc, setDoc] = useState<LoadedDocument | null>(null);
	const [docLoading, setDocLoading] = useState(false);
	const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
	const [docError, setDocError] = useState<string | null>(null);
	const [slideImages, setSlideImages] = useState<"loading" | "ready" | "unavailable" | null>(null);
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [options, setOptions] = useState<GenerationOptions>({
		topic: "",
		questionCount: 10,
		questionTypes: DEFAULT_TYPES[target],
		difficulty: "Medium",
		audienceLevel: "Generic",
		focusArea: "",
	});
	const [error, setError] = useState<string | null>(null);
	// Once the user types a topic, picking chapters no longer replaces it.
	const [topicTouched, setTopicTouched] = useState(false);
	const [phase, setPhase] = useState<"writing" | "saving">("writing");
	const loadController = useRef<AbortController | null>(null);
	const generateController = useRef<AbortController | null>(null);
	const noun = TARGET_NOUN[target];
	const unit = doc ? documentUnit(doc) : "page";

	useEffect(
		() => () => {
			loadController.current?.abort();
			generateController.current?.abort();
		},
		[],
	);

	/** Slide images take a while to render, so they arrive after the slides can already be picked. */
	const showSlideImages = async (chosen: LibraryFile, signal: AbortSignal) => {
		setSlideImages("loading");
		try {
			const images = await loadSlideImages(chosen, signal);
			if (signal.aborted) return;
			if (images) setDoc((current) => current && withSlideImages(current, images));
			setSlideImages(images ? "ready" : "unavailable");
		} catch {
			if (!signal.aborted) setSlideImages("unavailable");
		}
	};

	const openFile = async (chosen: LibraryFile) => {
		if (chosen.category !== "document") return;
		loadController.current?.abort();
		const controller = new AbortController();
		loadController.current = controller;
		setFile(chosen);
		setDoc(null);
		setSlideImages(null);
		setDocError(null);
		setError(null);
		setProgress(null);
		setDocLoading(true);
		setStep("configure");
		// The topic follows the document until the user types their own.
		setOptions((o) => ({ ...o, topic: topicTouched && o.topic.trim() ? o.topic : topicFromName(chosen.name) }));
		try {
			const loaded = await loadDocumentParts(chosen, {
				signal: controller.signal,
				onProgress: (done, total) => setProgress({ done, total }),
			});
			if (controller.signal.aborted) return;
			setDoc(loaded);
			// With chapters, let the user pick one; otherwise start with every page that has text.
			const withText = loaded.parts.filter((p) => p.wordCount > 0).map((p) => p.id);
			setSelected(new Set(loaded.chapters.length === 0 && withText.length <= MAX_SELECTED_PARTS ? withText : []));
			if (loaded.kind === "slides") void showSlideImages(chosen, controller.signal);
		} catch (reason) {
			if (!controller.signal.aborted) setDocError((reason as Error).message);
		} finally {
			if (!controller.signal.aborted) setDocLoading(false);
		}
	};

	const generate = async () => {
		if (!file || !doc) return;
		const parts = doc.parts.filter((p) => selected.has(p.id));
		const problem =
			parts.length === 0
				? `Select at least one ${unit}.`
				: parts.every((p) => p.wordCount === 0)
					? `The selected ${unit}s have no text. Choose ${unit}s with text.`
					: !options.topic.trim()
						? "Enter a topic."
						: options.questionTypes.length === 0
							? `Choose at least one ${noun.singular} type.`
							: options.questionCount < 1 || options.questionCount > MAX_QUESTIONS
								? `Choose between 1 and ${MAX_QUESTIONS} ${noun.plural}.`
								: null;
		if (problem) {
			setError(problem);
			return;
		}

		const controller = new AbortController();
		generateController.current = controller;
		setError(null);
		setPhase("writing");
		setStep("generating");
		try {
			const textData = buildTextData(parts, doc.chapters);
			const request = { target, textData, ...options, topic: options.topic.trim(), questionTypes: aiTypesFor(target, options.questionTypes) };
			const result = await generateFromText(request, controller.signal);
			if (controller.signal.aborted) return;
			setPhase("saving");
			await onGenerated(result as GeneratedFor<T>, { file, options });
		} catch (reason) {
			if (controller.signal.aborted || (reason as Error)?.name === "AbortError") return;
			setError((reason as Error)?.message || "Something went wrong. Please try again.");
			setStep("configure");
		}
	};

	const cancelGenerating = () => {
		generateController.current?.abort();
		setStep("configure");
	};

	const stepIndex = STEPS.findIndex((s) => s.key === step);
	// Something with text must be selected before the AI can write anything.
	const hasContext = !!doc && doc.parts.some((p) => selected.has(p.id) && p.wordCount > 0);
	const tall = layout === "modal";

	return (
		<div className="flex flex-col gap-4">
			{/* Steps */}
			<ol className="flex items-center gap-2 text-xs sm:text-sm" aria-label="Progress">
				{STEPS.map((s, i) => (
					<li key={s.key} className="flex items-center gap-2">
						<span
							className={cn(
								"flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
								i < stepIndex
									? "bg-secondary-50 text-secondary-600 dark:bg-secondary-900/40 dark:text-secondary-200"
									: i === stepIndex
										? "bg-secondary-500 text-white"
										: "bg-gray-2 text-dark-5 dark:bg-dark-2",
							)}
							aria-current={i === stepIndex ? "step" : undefined}
						>
							{i < stepIndex ? <Check className="h-3.5 w-3.5" aria-label="Done" /> : i + 1}
						</span>
						<span className={cn("hidden font-medium sm:inline", i === stepIndex ? "text-dark dark:text-white" : "text-dark-5")}>{s.label}</span>
						{i < STEPS.length - 1 ? (
							<span className={cn("h-px w-6 sm:w-10", i < stepIndex ? "bg-secondary-200 dark:bg-secondary-700" : "bg-stroke dark:bg-stroke-dark")} aria-hidden />
						) : null}
					</li>
				))}
			</ol>

			{step === "file" ? (
				<FilePickerPanel
					accept="document"
					onSelect={openFile}
					onCancel={onCancel}
					confirmLabel="Continue"
					hint="Pick a PDF, Word (.docx), PowerPoint (.pptx) or text file. New uploads are saved in My Files for next time."
				/>
			) : null}

			{step === "configure" && file ? (
				<div className="flex flex-col gap-4">
					<div className="flex items-center gap-3 rounded-xl border border-stroke bg-white p-3 dark:border-stroke-dark dark:bg-dark-2">
						<FileThumb file={file} size="sm" className="h-10 w-10 shrink-0" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-semibold text-dark dark:text-white">{file.name}</p>
							<p className="text-xs text-dark-5">
								{typeStyle(file).label} · {formatBytes(file.size)}
								{doc ? ` · ${doc.parts.length} ${unit}${doc.parts.length === 1 ? "" : "s"}` : ""}
							</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								loadController.current?.abort();
								setStep("file");
							}}
							className="shrink-0 hover:border-secondary-200 hover:text-secondary-600 dark:hover:text-secondary-200"
						>
							<ArrowLeftRight className="h-4 w-4" aria-hidden />
							Change file
						</Button>
					</div>

					{docLoading ? (
						<div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stroke dark:border-stroke-dark", tall ? "h-[50vh]" : "h-64")} role="status">
							<Loader2 className="h-8 w-8 animate-spin text-secondary motion-reduce:animate-none" aria-hidden />
							<p className="text-sm font-medium text-dark dark:text-white">Reading your document…</p>
							{progress ? (
								<div className="w-56">
									<div className="h-1.5 overflow-hidden rounded-full bg-gray-3 dark:bg-dark-3">
										<div className="h-full rounded-full bg-secondary transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
									</div>
									<p className="mt-1 text-center text-xs text-dark-5">
										Page {progress.done} of {progress.total}
									</p>
								</div>
							) : null}
						</div>
					) : docError ? (
						<div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-red-light-3 bg-red-light-5 p-6 text-center">
							<AlertCircle className="h-8 w-8 text-red" aria-hidden />
							<p className="max-w-md text-sm text-red-dark">{docError}</p>
							<div className="flex gap-2">
								<Button variant="outline" size="sm" onClick={() => openFile(file)}>
									<RefreshCw className="h-4 w-4" aria-hidden />
									Try again
								</Button>
								<Button variant="outline" size="sm" onClick={() => setStep("file")}>
									Choose another file
								</Button>
							</div>
						</div>
					) : doc ? (
						<div className={cn("grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]", tall && "lg:h-[55vh]")}>
							<PageSelectionStep
								doc={doc}
								selected={selected}
								onChange={setSelected}
								slideImages={slideImages}
								onChapterSelected={(chapter) => {
									if (!topicTouched) setOptions((o) => ({ ...o, topic: chapter.title.slice(0, 200) }));
								}}
								className={cn(tall ? "max-h-[45vh] lg:max-h-none" : "max-h-[32rem]")}
							/>
							<div className="flex min-h-0 flex-col rounded-xl bg-gray-1 p-4 dark:bg-dark-2">
								<div className="min-h-0 flex-1 overflow-y-auto pr-1">
									<GenerationOptionsForm
										target={target}
										value={options}
										onChange={(next) => {
											if (next.topic !== options.topic) setTopicTouched(true);
											setOptions(next);
										}}
									/>
								</div>
								{error ? (
									<p role="alert" className="mt-3 rounded-lg border border-red-light-3 bg-red-light-5 px-3 py-2 text-sm text-red-dark">
										{error}
									</p>
								) : null}
								{!hasContext ? (
									<p className="mt-3 text-right text-xs text-dark-5" aria-live="polite">
										{selected.size === 0
											? `Select ${doc.chapters.length ? "a chapter or " : ""}${unit}s to generate from.`
											: `The selected ${unit}s have no text. Choose ${unit}s with text.`}
									</p>
								) : null}
								<div className="mt-3 flex justify-end gap-2">
									{onCancel ? (
										<Button variant="outline" onClick={onCancel}>
											Cancel
										</Button>
									) : null}
									<Button onClick={generate} disabled={!hasContext} title={hasContext ? undefined : `Select ${unit}s with text first`}>
										{generateLabel ?? `Generate ${options.questionCount} ${options.questionCount === 1 ? noun.singular : noun.plural}`}
										<ArrowRight className="h-4 w-4" aria-hidden />
									</Button>
								</div>
							</div>
						</div>
					) : null}
				</div>
			) : null}

			{step === "generating" ? (
				<div className="flex flex-col items-center gap-2" role="status" aria-live="polite">
					<GeneratingLoader />
					<p className="text-sm text-dark-5">
						{phase === "writing"
							? `Writing ${options.questionCount} ${options.questionCount === 1 ? noun.singular : noun.plural} from ${selected.size} ${selected.size === 1 ? unit : `${unit}s`}… this can take up to a minute.`
							: `Adding the ${noun.plural}…`}
					</p>
					{phase === "writing" ? (
						<Button variant="ghost" size="sm" onClick={cancelGenerating}>
							Cancel
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}

interface ModalProps<T extends GenerationTarget> extends DocumentToQuestionsWizardProps<T> {
	open: boolean;
	onClose: () => void;
	title?: string;
}

export function DocumentToQuestionsModal<T extends GenerationTarget>({ open, onClose, title, ...wizard }: ModalProps<T>) {
	return (
		<Modal title={title ?? "Generate from a document"} open={open} onClose={onClose} size="xl" destroyOnClose>
			{open ? <DocumentToQuestionsWizard {...wizard} onCancel={onClose} layout="modal" /> : null}
		</Modal>
	);
}
