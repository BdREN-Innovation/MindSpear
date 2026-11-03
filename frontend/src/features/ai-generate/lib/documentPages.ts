import { libraryApi, parseLibraryError } from "@/features/file-library/api/libraryApi";
import type { LibraryFile } from "@/features/file-library/types";
import { buildChapters, type Chapter } from "./chapters";

/** One selectable part of a document: a PDF page, a slide, or a text section. */
export interface DocumentPart {
	id: number;
	/** The number people see and type ("Slide 6"). Differs from `id` in DOCX files, whose empty pages have no part. */
	number: number;
	label: string;
	text: string;
	wordCount: number;
	thumbnail?: string;
}

export interface LoadedDocument {
	kind: "pdf" | "slides" | "text";
	parts: DocumentPart[];
	/** From PDF bookmarks or DOCX headings; empty when the document has none. */
	chapters: Chapter[];
}

const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/u).length : 0);

/** "Slide 6: Intro" → 6. The server skips parts without text, so a part's position isn't its number. */
function labelNumber(label: string): number | null {
	const match = /^(?:Slide|Page|Section)\s+(\d+)/.exec(label);
	return match ? Number(match[1]) : null;
}

/** What one part of this document is called. */
export function documentUnit(doc: LoadedDocument): "page" | "slide" | "section" {
	if (doc.kind === "pdf") return "page";
	if (doc.kind === "slides") return "slide";
	return doc.parts[0]?.label.startsWith("Page") ? "page" : "section";
}

/** Loads the pages of a library document: PDFs are rendered in the browser, other types come from the server. */
export async function loadDocumentParts(
	file: LibraryFile,
	options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<LoadedDocument> {
	try {
		if (file.extension === "pdf") {
			const bytes = await libraryApi.getContent(file.id, options.signal);
			const { extractPdfDocument } = await import("@/utils/pdfUtils");
			const { pages, outline } = await extractPdfDocument(bytes, { onProgress: options.onProgress, signal: options.signal });
			const parts = pages.map((p) => ({ id: p.id, number: p.id, label: `Page ${p.id}`, text: p.text, wordCount: countWords(p.text), thumbnail: p.thumbnail }));
			if (parts.every((p) => p.wordCount === 0)) {
				throw new Error("This PDF has no selectable text — it may be a scan. Try a text-based PDF, DOCX or PPTX.");
			}
			return { kind: "pdf", parts, chapters: buildChapters(outline, parts.length) };
		}

		const result = await libraryApi.pages(file.id, options.signal);
		const isSlides = file.extension === "pptx";
		return {
			kind: isSlides ? "slides" : "text",
			parts: result.pages.map((p) => {
				const number = labelNumber(p.label) ?? p.index;
				// A slide's id is its number, so it lines up with its image (see withSlideImages).
				return { id: isSlides ? number : p.index, number, label: p.label, text: p.text, wordCount: p.word_count };
			}),
			chapters: buildChapters(result.outline ?? [], result.pages.length),
		};
	} catch (error) {
		if ((error as Error)?.name === "AbortError" || (error as Error)?.name === "CanceledError") throw error;
		if (error instanceof Error && !("isAxiosError" in error)) {
			throw new Error(error.message.includes("Invalid PDF") ? "This PDF couldn't be opened. It may be damaged or password-protected." : error.message);
		}
		throw new Error(parseLibraryError(error).message);
	}
}

export type SlideImage = { id: number; thumbnail: string };

const SLIDE_POLL_MS = 2500;
/** About three minutes, longer than the server gives one conversion. */
const SLIDE_POLL_ATTEMPTS = 72;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new DOMException("Aborted", "AbortError"));
			},
			{ once: true },
		);
	});
}

/** The images of a PPTX's slides, once the server has rendered them; null if it can't (the text cards remain). */
export async function loadSlideImages(file: LibraryFile, signal?: AbortSignal): Promise<SlideImage[] | null> {
	for (let attempt = 0; attempt < SLIDE_POLL_ATTEMPTS; attempt++) {
		const status = await libraryApi.slidePreviewStatus(file.id, signal);
		if (status === "failed") return null;
		if (status === "ready") {
			const bytes = await libraryApi.slidePreviewContent(file.id, signal);
			const { extractPdfDocument } = await import("@/utils/pdfUtils");
			return (await extractPdfDocument(bytes, { signal })).pages;
		}
		await wait(SLIDE_POLL_MS, signal);
	}
	return null;
}

/** Adds the images to the slides, and the slides that have only pictures, which have no text part yet. */
export function withSlideImages(doc: LoadedDocument, images: SlideImage[]): LoadedDocument {
	const parts = new Map(doc.parts.map((part) => [part.id, part]));
	for (const { id, thumbnail } of images) {
		const part = parts.get(id) ?? { id, number: id, label: `Slide ${id}`, text: "", wordCount: 0 };
		parts.set(id, { ...part, thumbnail });
	}
	return { ...doc, parts: [...parts.values()].sort((a, b) => a.id - b.id) };
}
