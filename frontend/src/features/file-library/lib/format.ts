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

/** Badge colours and labels per extension. */
const TYPE_STYLES: Record<string, { label: string; className: string }> = {
	pdf: { label: "PDF", className: "bg-red-light-5 text-red-dark" },
	docx: { label: "DOCX", className: "bg-blue-light-5 text-blue-dark" },
	pptx: { label: "PPTX", className: "bg-primary-50 text-primary-dark" },
	txt: { label: "TXT", className: "bg-gray-2 text-dark-4 dark:bg-dark-3 dark:text-dark-6" },
};

export function typeStyle(file: Pick<LibraryFile, "extension" | "category">) {
	const ext = (file.extension || "").toLowerCase();
	return (
		TYPE_STYLES[ext] ?? {
			label: ext ? ext.toUpperCase() : file.category === "image" ? "IMG" : "FILE",
			className: "bg-secondary/10 text-secondary",
		}
	);
}

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function categoryOf(name: string, usage: StorageUsage | null): FileCategory | null {
	const ext = extensionOf(name);
	if (usage) {
		if (usage.allowed.image.includes(ext)) return "image";
		if (usage.allowed.document.includes(ext)) return "document";
		return null;
	}
	return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext) ? "image" : ["pdf", "docx", "pptx", "txt"].includes(ext) ? "document" : null;
}

/** Extensions a picker accepts, from the server's list when we have it. */
export function acceptedExtensions(accept: FileAccept, usage: StorageUsage | null): string[] {
	const allowed = usage?.allowed ?? { image: ["jpg", "jpeg", "png", "gif", "webp"], document: ["pdf", "docx", "pptx", "txt"] };
	return accept === "any" ? [...allowed.image, ...allowed.document] : allowed[accept];
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
	if (usage && category && file.size > usage.maxFileSize[category]) {
		return `${file.name} is ${formatBytes(file.size)}; ${category}s can be at most ${formatBytes(usage.maxFileSize[category])}.`;
	}
	if (usage && file.size > usage.remaining) {
		return `Not enough storage: ${file.name} needs ${formatBytes(file.size)} but only ${formatBytes(usage.remaining)} is free. Delete files in My Files to make room.`;
	}
	return null;
}
