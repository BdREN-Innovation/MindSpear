import { libraryApi, parseLibraryError } from "@/features/file-library/api/libraryApi";
import type { LibraryFile } from "@/features/file-library/types";
import { buildChapters, type Chapter } from "./chapters";

/** One selectable part of a document: a PDF page, a slide, or a text section. */
export interface DocumentPart {
	id: number;
	label: string;
	text: string;
	wordCount: number;
	thumbnail?: string;
}

export interface LoadedDocument {
	kind: "pdf" | "text";
	parts: DocumentPart[];
	/** From PDF bookmarks or DOCX headings; empty when the document has none. */
	chapters: Chapter[];
}

const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/u).length : 0);

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
			const parts = pages.map((p) => ({ id: p.id, label: `Page ${p.id}`, text: p.text, wordCount: countWords(p.text), thumbnail: p.thumbnail }));
			if (parts.every((p) => p.wordCount === 0)) {
				throw new Error("This PDF has no selectable text — it may be a scan. Try a text-based PDF, DOCX or PPTX.");
			}
			return { kind: "pdf", parts, chapters: buildChapters(outline, parts.length) };
		}

		const result = await libraryApi.pages(file.id, options.signal);
		return {
			kind: "text",
			parts: result.pages.map((p) => ({ id: p.index, label: p.label, text: p.text, wordCount: p.word_count })),
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
