import type { FileAccept, FileCategory, LibraryFile, StorageUsage } from "../types";

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDate(iso: string | null): string {
	if (!iso) return "";
	const date = new Date(iso);
	return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Label and colour per extension: the colours people know the formats by (PDF red, Word blue, PowerPoint orange-red). */
const TYPE_STYLES: Record<string, { label: string; color: string }> = {
	pdf: { label: "PDF", color: "#D93025" },
	docx: { label: "DOCX", color: "#2B579A" },
	pptx: { label: "PPTX", color: "#C43E1C" },
	txt: { label: "TXT", color: "#64748B" },
	mp4: { label: "MP4", color: "#7E2D78" },
};

/** Used before the server's list has loaded; keep in sync with config/file_library.php. */
const DEFAULT_ALLOWED: Record<FileCategory, string[]> = {
	image: ["jpg", "jpeg", "png", "gif", "webp"],
	document: ["pdf", "docx", "pptx", "txt"],
	video: ["mp4"],
};

const CATEGORIES: FileCategory[] = ["image", "video", "document"];

/** Server lists from before videos existed have no video key. */
function allowedLists(usage: StorageUsage | null): Record<FileCategory, string[]> {
	return { ...DEFAULT_ALLOWED, ...(usage?.allowed ?? {}) };
}

export function typeStyle(file: Pick<LibraryFile, "extension" | "category">) {
	const ext = (file.extension || "").toLowerCase();
	return (
		TYPE_STYLES[ext] ?? {
			label: ext ? ext.toUpperCase() : file.category === "image" ? "IMG" : file.category === "video" ? "VIDEO" : "FILE",
			color: "#64748B",
		}
	);
}

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function categoryOf(name: string, usage: StorageUsage | null): FileCategory | null {
	const ext = extensionOf(name);
	const allowed = allowedLists(usage);
	return CATEGORIES.find((category) => allowed[category].includes(ext)) ?? null;
}

/** Extensions a picker accepts, from the server's list when we have it. */
export function acceptedExtensions(accept: FileAccept, usage: StorageUsage | null): string[] {
	const allowed = allowedLists(usage);
	return accept === "any" ? CATEGORIES.flatMap((category) => allowed[category]) : allowed[accept];
}

/** Checks a file before uploading so people get an answer without waiting for the upload. */
export function precheckFile(file: File, accept: FileAccept, usage: StorageUsage | null): string | null {
	const ext = extensionOf(file.name);
	const allowed = acceptedExtensions(accept, usage);
	if (ext === "doc" || ext === "ppt") {
		return `.${ext} files aren't supported. Save it as .${ext}x and upload again.`;
	}
	if (!allowed.includes(ext)) {
		return `${file.name} isn't supported here. Use ${allowed.map((e) => `.${e}`).join(", ")}.`;
	}
	if (file.size === 0) return `${file.name} is empty.`;
	const category = categoryOf(file.name, usage);
	const maxSize = category ? usage?.maxFileSize[category] : undefined;
	if (maxSize && file.size > maxSize) {
		return `${file.name} is ${formatBytes(file.size)}; ${category}s can be at most ${formatBytes(maxSize)}.`;
	}
	if (usage && file.size > usage.remaining) {
		return `Not enough storage: ${file.name} needs ${formatBytes(file.size)} but only ${formatBytes(usage.remaining)} is free. Delete files in My Files to make room.`;
	}
	return null;
}
