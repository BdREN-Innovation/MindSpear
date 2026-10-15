/* eslint-disable @typescript-eslint/no-explicit-any */
// import * as pdfjsLib from "pdfjs-dist";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Set the worker source correctly for Next.js
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
	"pdfjs-dist/legacy/build/pdf.worker.mjs",
	import.meta.url,
).toString();

interface Page {
	id: number;
	thumbnail: string;
	text: string;
}

interface ExtractOptions {
	/** Thumbnail width in CSS pixels. */
	thumbnailWidth?: number;
	onProgress?: (done: number, total: number) => void;
	signal?: AbortSignal;
}

/** A bookmark (chapter) of the PDF and the page it opens (1-based). */
export interface PdfOutlineEntry {
	title: string;
	level: number;
	page: number;
}

/** The PDF's bookmarks, flattened in order. Bookmarks that don't point at a page are skipped (their children are kept). */
async function readOutline(pdf: any): Promise<PdfOutlineEntry[]> {
	const outline = await pdf.getOutline().catch(() => null);
	if (!Array.isArray(outline)) return [];

	const entries: PdfOutlineEntry[] = [];
	const walk = async (items: any[], level: number) => {
		for (const item of items) {
			if (entries.length >= 500) return;
			let page: number | null = null;
			try {
				const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
				const ref = Array.isArray(dest) ? dest[0] : null;
				if (ref && typeof ref === "object") page = (await pdf.getPageIndex(ref)) + 1;
				else if (typeof ref === "number") page = ref + 1;
			} catch {
				page = null;
			}
			const title = String(item.title ?? "").trim();
			if (page && title) entries.push({ title, level, page });
			if (Array.isArray(item.items) && item.items.length) await walk(item.items, level + 1);
		}
	};
	await walk(outline, 1);
	return entries;
}

/** Text and a small JPEG thumbnail for every page of a PDF (a File or its bytes). */
export async function extractPdfThumbnails(source: File | ArrayBuffer, options: ExtractOptions = {}): Promise<Page[]> {
	return (await extractPdfDocument(source, options)).pages;
}

/** Pages (text + thumbnail) and bookmarks (chapters) of a PDF. */
export async function extractPdfDocument(
	source: File | ArrayBuffer,
	options: ExtractOptions = {},
): Promise<{ pages: Page[]; outline: PdfOutlineEntry[] }> {
	const arrayBuffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
	const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
	const width = options.thumbnailWidth ?? 240;

	const pages: Page[] = [];
	let outline: PdfOutlineEntry[] = [];

	try {
		outline = await readOutline(pdf);

		// Loop through each page in the PDF
		for (let i = 1; i <= pdf.numPages; i++) {
			if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
			const page = await pdf.getPage(i);

			// Extract text content from the page
			const textContent = await page.getTextContent();
			const text = textContent.items
				.map((item: any) => item.str + (item.hasEOL ? "\n" : ""))
				.join(" ")
				.replace(/[ \t]+/g, " ")
				.trim();

			// Render a small copy of the page for the thumbnail
			const base = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: (width * 2) / base.width });
			const canvas = document.createElement("canvas");
			canvas.width = viewport.width;
			canvas.height = viewport.height;
			await page.render({ canvas, viewport }).promise;

			pages.push({
				id: i,
				thumbnail: canvas.toDataURL("image/jpeg", 0.8),
				text,
			});
			page.cleanup();
			options.onProgress?.(i, pdf.numPages);
		}
	} finally {
		pdf.destroy();
	}

	return { pages, outline };
}

/**
 * Extract page count from a PDF file
 * @param file The uploaded PDF file
 * @returns The number of pages in the PDF
 */
export const getPdfPageCount = async (file: File): Promise<number> => {
	try {
		const arrayBuffer = await file.arrayBuffer();
		const pdf = await getDocument({ data: arrayBuffer }).promise;
		return pdf.numPages; // Return the number of pages in the PDF
	} catch (error) {
		console.error("Error reading PDF file:", error);
		throw new Error("Unable to extract page count from PDF.");
	}
};
