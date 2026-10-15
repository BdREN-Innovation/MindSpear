import type { ParticipantRunView, RunState, SlimRunView } from "@/features/deck/types";

// How the host drives a run, mirroring the backend SessionStateMachine::kindOf():
//   poll    (accepts answers)   waiting → [get_ready →] voting → closed
//   qa      (moderated feed)    waiting → open → closed
//   content (everything else)   stays waiting; navigation only
// Derived from the run's category flags, never from a list of type keys, so
// new slide types work without touching the shell.

export type RunKind = "poll" | "qa" | "content";

type RunFlags = Pick<ParticipantRunView, "type" | "reveal_model" | "accepts_answers"> | SlimRunView;

export function runKindOf(run: RunFlags | null | undefined): RunKind | null {
	if (!run) return null;
	if (run.reveal_model === "moderated_feed") return "qa";
	if (run.accepts_answers) return "poll";
	return "content";
}

/** States in which leaving the run closes it (backend ACTIVE_STATES). */
const ACTIVE_STATES: readonly RunState[] = ["get_ready", "voting", "open"];

export function isActiveState(state: RunState | null | undefined): boolean {
	return !!state && ACTIVE_STATES.includes(state);
}

export type PrimaryAction =
	| { kind: "advance"; action: "start_voting" | "close_voting" | "next_slide"; label: string }
	| { kind: "end"; label: string }
	/** Nothing to do yet (get_ready countdown, run still loading). */
	| { kind: "wait"; label: string };

/**
 * The single "do the next thing" action (button, → / Space):
 * Start voting → Close voting → Next slide; Q&A: Open → Close → Next;
 * content: Next. On the last slide "Next" becomes "Finish" (ends the session, confirmed).
 */
export function primaryActionFor(kind: RunKind | null, state: RunState | null, isLast: boolean): PrimaryAction {
	if (!kind || !state) return { kind: "wait", label: "Loading…" };

	const next: PrimaryAction = isLast
		? { kind: "end", label: "Finish" }
		: { kind: "advance", action: "next_slide", label: "Next slide" };

	if (kind === "content") return next;

	switch (state) {
		case "waiting":
			return { kind: "advance", action: "start_voting", label: kind === "qa" ? "Open Q&A" : "Start voting" };
		case "get_ready":
			return { kind: "wait", label: "Get ready…" };
		case "voting":
		case "open":
			return { kind: "advance", action: "close_voting", label: kind === "qa" ? "Close Q&A" : "Close voting" };
		case "closed":
		default:
			return next;
	}
}

/** Short, human state label for chips and the slide list. */
export function stateLabel(kind: RunKind | null, state: RunState | null): string | null {
	if (!kind || !state || kind === "content") return null;
	switch (state) {
		case "waiting":
			return "Not started";
		case "get_ready":
			return "Get ready";
		case "voting":
			return "Voting open";
		case "open":
			return "Q&A open";
		case "closed":
			return kind === "qa" ? "Q&A closed" : "Voting closed";
		default:
			return null;
	}
}
