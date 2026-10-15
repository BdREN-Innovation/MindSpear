// My Files: the signed-in user's library of uploaded images and documents.

export type FileCategory = "image" | "document";

/** Which files a picker shows and accepts. */
export type FileAccept = FileCategory | "any";

export type ExtractionStatus = "none" | "ready" | "failed" | "client" | "unsupported";

export interface LibraryFile {
	id: number;
	name: string;
	originalName: string | null;
	category: FileCategory;
	extension: string | null;
	mimeType: string | null;
	size: number;
	/** Public URL for images; an authenticated API URL for documents (load with libraryApi.getContent). */
	url: string;
	isPublic: boolean;
	pageCount: number | null;
	extractionStatus: ExtractionStatus;
	createdAt: string | null;
	lastUsedAt: string | null;
}

export interface StorageUsage {
	used: number;
	limit: number;
	remaining: number;
	percent: number;
	images: { count: number; bytes: number };
	documents: { count: number; bytes: number };
	maxFileSize: Record<FileCategory, number>;
	allowed: Record<FileCategory, string[]>;
}

export type FileSort = "newest" | "oldest" | "name" | "size" | "last_used";

export interface ListFilesParams {
	search?: string;
	category?: FileCategory;
	sort?: FileSort;
	page?: number;
	perPage?: number;
}

export interface Pagination {
	currentPage: number;
	lastPage: number;
	perPage: number;
	total: number;
}

export interface FileListResult {
	files: LibraryFile[];
	pagination: Pagination;
	usage: StorageUsage;
}

export interface UploadResult {
	file: LibraryFile;
	deduplicated: boolean;
	usage: StorageUsage;
	message: string;
}

export interface DocumentPage {
	index: number;
	label: string;
	text: string;
	word_count: number;
}

/** A chapter/heading of a document and the page (or section) it starts on (1-based). */
export interface OutlineEntry {
	title: string;
	level: number;
	page: number;
}

export interface DocumentPages {
	/** "pdf": read the bytes in the browser with pdfjs. "text": pages were extracted on the server. */
	kind: "pdf" | "text";
	pageCount: number | null;
	pages: DocumentPage[];
	/** Headings of DOCX files; PDFs read their bookmarks in the browser instead. */
	outline: OutlineEntry[];
}

export type LibraryErrorCode = "quota_exceeded" | "invalid_file" | "file_in_use" | "not_found" | "network" | "unknown";

export interface LibraryError {
	code: LibraryErrorCode;
	message: string;
	status?: number;
	/** file_in_use: where the image is still shown, e.g. { "quiz questions": 2 }. */
	references?: Record<string, number>;
}
