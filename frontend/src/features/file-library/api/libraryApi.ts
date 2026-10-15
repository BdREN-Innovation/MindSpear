import axios, { type AxiosProgressEvent } from "axios";
import axiosInstance from "@/utils/axiosInstance";
import type {
	DocumentPages,
	FileListResult,
	LibraryError,
	LibraryErrorCode,
	LibraryFile,
	ListFilesParams,
	StorageUsage,
	UploadResult,
} from "../types";

// Backend: /api/v1/library (backend/app/Modules/FileLibrary/routes.php)

interface Envelope<T> {
	status: boolean;
	message: string;
	data: T;
}

const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export const libraryApi = {
	async list(params: ListFilesParams = {}, signal?: AbortSignal): Promise<FileListResult> {
		const res = await axiosInstance.get<Envelope<FileListResult>>("/library/files", {
			params: {
				search: params.search || undefined,
				category: params.category,
				sort: params.sort,
				page: params.page,
				per_page: params.perPage,
			},
			signal,
		});
		return res.data.data;
	},

	async usage(signal?: AbortSignal): Promise<StorageUsage> {
		const res = await axiosInstance.get<Envelope<{ usage: StorageUsage }>>("/library/usage", { signal });
		return res.data.data.usage;
	},

	async upload(
		file: File,
		options: { name?: string; signal?: AbortSignal; onProgress?: (percent: number) => void } = {},
	): Promise<UploadResult> {
		const form = new FormData();
		form.append("file", file);
		if (options.name) form.append("name", options.name);

		const res = await axiosInstance.post<Envelope<Omit<UploadResult, "message">>>("/library/files", form, {
			headers: { "Content-Type": "multipart/form-data" },
			timeout: UPLOAD_TIMEOUT_MS,
			signal: options.signal,
			onUploadProgress: (event: AxiosProgressEvent) => {
				if (options.onProgress && event.total) {
					options.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
				}
			},
		});
		return { ...res.data.data, message: res.data.message };
	},

	async rename(id: number, name: string): Promise<LibraryFile> {
		const res = await axiosInstance.patch<Envelope<{ file: LibraryFile }>>(`/library/files/${id}`, { name });
		return res.data.data.file;
	},

	/** Soft delete. Images still used by questions answer 409 unless force is set. */
	async remove(id: number, force = false): Promise<StorageUsage> {
		const res = await axiosInstance.delete<Envelope<{ usage: StorageUsage }>>(`/library/files/${id}`, {
			params: force ? { force: 1 } : undefined,
		});
		return res.data.data.usage;
	},

	async markUsed(id: number): Promise<void> {
		await axiosInstance.post(`/library/files/${id}/use`);
	},

	async pages(id: number, signal?: AbortSignal): Promise<DocumentPages> {
		const res = await axiosInstance.get<Envelope<DocumentPages>>(`/library/files/${id}/pages`, { signal, timeout: 120_000 });
		return res.data.data;
	},

	/** The file's bytes (works for private documents, and avoids CORS for pdfjs). */
	async getContent(id: number, signal?: AbortSignal): Promise<ArrayBuffer> {
		const res = await axiosInstance.get<ArrayBuffer>(`/library/files/${id}/content`, {
			responseType: "arraybuffer",
			timeout: 120_000,
			signal,
		});
		return res.data;
	},

	/** Downloads through the API (documents are private, so a plain link would lack the token). */
	async download(file: LibraryFile): Promise<void> {
		const res = await axiosInstance.get<Blob>(`/library/files/${file.id}/content`, {
			params: { download: 1 },
			responseType: "blob",
			timeout: 120_000,
		});
		const url = URL.createObjectURL(res.data);
		const link = document.createElement("a");
		link.href = url;
		link.download = downloadName(file);
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	},
};

function downloadName(file: LibraryFile): string {
	const ext = file.extension ? `.${file.extension}` : "";
	return file.name.toLowerCase().endsWith(ext) ? file.name : `${file.name}${ext}`;
}

/** Turns any failure from the library API into something a person can read. */
export function parseLibraryError(error: unknown): LibraryError {
	if (axios.isCancel(error)) {
		return { code: "network", message: "Upload cancelled." };
	}
	if (axios.isAxiosError(error)) {
		const status = error.response?.status;
		const body = error.response?.data as
			| { message?: string; data?: { code?: string; references?: Record<string, number>; validation_errors?: Record<string, string[]> } }
			| undefined;
		if (!error.response) {
			return {
				code: "network",
				message:
					error.code === "ECONNABORTED"
						? "The upload took too long. Check your connection and try again."
						: "Can't reach the server. Check your connection and try again.",
			};
		}
		if (status === 413) {
			return { code: "invalid_file", status, message: "This file is larger than the server accepts." };
		}
		const firstValidation = body?.data?.validation_errors ? Object.values(body.data.validation_errors).flat()[0] : undefined;
		const known: LibraryErrorCode[] = ["quota_exceeded", "invalid_file", "file_in_use", "not_found"];
		const code = (known.includes(body?.data?.code as LibraryErrorCode) ? body?.data?.code : "unknown") as LibraryErrorCode;
		return {
			code,
			status,
			message: firstValidation || body?.message || "Something went wrong. Please try again.",
			references: body?.data?.references,
		};
	}
	return { code: "unknown", message: error instanceof Error ? error.message : "Something went wrong. Please try again." };
}
