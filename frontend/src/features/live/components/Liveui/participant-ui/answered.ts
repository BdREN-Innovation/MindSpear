// Whether this player sent an answer to a live question (kept across reloads), so the waiting
// screen can say "Answer locked in" or "Time's up" correctly; it said "locked in" either way.
const key = (taskId: unknown) => `answered_${taskId}`;

export function markAnswered(taskId: unknown): void {
	if (taskId === undefined || taskId === null) return;
	try {
		localStorage.setItem(key(taskId), "1");
	} catch {
		// Storage can be unavailable (private mode); the screen then assumes it was answered.
	}
}

export function wasAnswered(taskId: unknown): boolean {
	if (taskId === undefined || taskId === null) return true;
	try {
		return localStorage.getItem(key(taskId)) === "1";
	} catch {
		return true;
	}
}
