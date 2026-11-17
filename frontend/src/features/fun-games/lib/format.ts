const pad2 = (n: number) => String(n).padStart(2, "0");

/** 754000 → "12:34", 3_754_000 → "1:02:34". Rounds up so 00:00 means time is up. */
export function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** 1500 → "25 min", 45 → "45 s", 5400 → "1 h 30 min" */
export function formatSeconds(seconds: number): string {
	if (seconds < 60) return `${seconds} s`;
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	const parts = [h ? `${h} h` : "", m ? `${m} min` : "", s ? `${s} s` : ""];
	return parts.filter(Boolean).join(" ");
}

/** 2 → "2", 1.5 → "1.5", -0.5 → "−0.5" */
export function formatMarks(marks: number): string {
	const rounded = Math.round(marks * 100) / 100;
	return String(rounded).replace("-", "−");
}

/** 0.8125 → "81%" */
export function formatPercent(ratio: number): string {
	return `${Math.round(ratio * 100)}%`;
}

/** 0 → "Q01" */
export function formatQuestionCode(index: number): string {
	return `Q${pad2(index + 1)}`;
}

/** "25 min for the whole quiz" / "20 s per question" */
export function describeTimer(
	timer: { mode: "total"; totalSeconds: number } | { mode: "perQuestion"; secondsPerQuestion: number },
): string {
	return timer.mode === "total"
		? `${formatSeconds(timer.totalSeconds)} for the whole quiz`
		: `${formatSeconds(timer.secondsPerQuestion)} per question`;
}

/** 83400 → "1:23.4", 9400 → "9.4 s" — for answer and completion times. */
export function formatDuration(ms: number | null | undefined): string {
	if (ms == null) return "—";
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = ((ms % 60_000) / 1000).toFixed(1).padStart(4, "0");
	return `${minutes}:${seconds}`;
}

/** "points" for speed scoring, "marks" otherwise. */
export function scoreUnit(mode: "marks" | "speed" | undefined, count?: number): string {
	if (mode === "speed") return count === 1 ? "point" : "points";
	return count === 1 ? "mark" : "marks";
}
