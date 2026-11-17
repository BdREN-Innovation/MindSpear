import type { StorageUsage } from "../types";

// Lets every usage bar and file list refresh after an upload, rename or delete anywhere on the page.

type Listener = (usage: StorageUsage | null) => void;

const listeners = new Set<Listener>();

export function onLibraryChange(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Pass the fresh usage when the API returned it, so listeners can skip a refetch. */
export function emitLibraryChange(usage: StorageUsage | null = null): void {
	listeners.forEach((listener) => listener(usage));
}
