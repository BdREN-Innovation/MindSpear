import type { ParticipantRunView, RunState, SlimRunView } from "@/features/deck/types";

// How the host drives a run, mirroring the backend SessionStateMachine::kindOf():
//   poll        (accepts answers, live results)  waiting → [get_ready →] voting → closed
//   qa          (moderated feed)                 waiting → open → closed
//   quiz        (accepts answers, hidden_until_reveal)
//                                                waiting → [get_ready →] voting → reveal
//   spin        (spinner_wheel)                  waiting → voting (spinning) → reveal (by itself)
//   leaderboard (quiz ranking slide)             stays waiting; navigation only
//   content     (everything else)                stays waiting; navigation only
// Derived from the run's flags (reveal model, accepts_answers); only the two
// quiz engagement slides are named, as the backend does (QuizRuntime::spins /
// isLeaderboard), because their flags look like content.

export type RunKind = "poll" | "qa" | "quiz" | "spin" | "leaderboard" | "content";

type RunFlags = Pick<ParticipantRunView, "type" | "reveal_model" | "accepts_answers"> | SlimRunView;

export function runKindOf(run: RunFlags | null | undefined): RunKind | null {
	if (!run) return null;
	if (run.reveal_model === "moderated_feed") return "qa";
	if (run.type === "spinner_wheel") return "spin";
	if (run.type === "leaderboard") return "leaderboard";
	if (run.accepts_answers && run.reveal_model === "hidden_until_reveal") return "quiz";
	if (run.accepts_answers) return "poll";
	return "content";
}

/** Kinds that end in `reveal` instead of `closed`: leaving them while active reveals them. */
export function revealsOnLeave(kind: RunKind | null): boolean {
	return kind === "quiz" || kind === "spin";
}

/** Kinds with nothing to start (navigation only). */
export function isNavigationOnly(kind: RunKind | null): boolean {
	return kind === "content" || kind === "leaderboard";
}

/** States in which leaving the run closes / reveals it (backend ACTIVE_STATES). */
const ACTIVE_STATES: readonly RunState[] = ["get_ready", "voting", "open"];

export function isActiveState(state: RunState | null | undefined): boolean {
	return !!state && ACTIVE_STATES.includes(state);
}

/** Finished runs (results final): closed polls / Q&A, revealed quiz and spinner runs. */
export function isFinishedState(state: RunState | null | undefined): boolean {
	return state === "closed" || state === "reveal";
}

export type PrimaryIconName = "start" | "stop" | "reveal" | "spin" | "next";

export type PrimaryAction =
	| {
			kind: "advance";
			action: "start_voting" | "close_voting" | "reveal" | "next_slide";
			label: string;
			icon: PrimaryIconName;
	  }
	| { kind: "end"; label: string }
	/** Nothing to do yet (get_ready countdown, the wheel spinning, run still loading). */
	| { kind: "wait"; label: string };

/**
 * The single "do the next thing" action (button, → / Space):
 *   poll:  Start voting → Close voting → Next slide
 *   Q&A:   Open Q&A → Close Q&A → Next slide
 *   quiz:  Start → (get ready) → Reveal → Next slide
 *   spin:  Spin → (spins, reveals by itself) → Next slide
 *   leaderboard / content: Next slide
 * On the last slide "Next slide" becomes "Finish" (ends the session, confirmed).
 */
export function primaryActionFor(kind: RunKind | null, state: RunState | null, isLast: boolean): PrimaryAction {
	if (!kind || !state) return { kind: "wait", label: "Loading…" };

	const next: PrimaryAction = isLast
		? { kind: "end", label: "Finish" }
		: { kind: "advance", action: "next_slide", label: "Next slide", icon: "next" };

	if (isNavigationOnly(kind)) return next;

	if (kind === "quiz") {
		switch (state) {
			case "waiting":
				return { kind: "advance", action: "start_voting", label: "Start", icon: "start" };
			case "get_ready":
				return { kind: "wait", label: "Get ready…" };
			case "voting":
				return { kind: "advance", action: "reveal", label: "Reveal", icon: "reveal" };
			default:
				return next;
		}
	}

	if (kind === "spin") {
		switch (state) {
			case "waiting":
				return { kind: "advance", action: "start_voting", label: "Spin", icon: "spin" };
			case "get_ready":
			case "voting":
				return { kind: "wait", label: "Spinning…" };
			default:
				return next;
		}
	}

	switch (state) {
		case "waiting":
			return { kind: "advance", action: "start_voting", label: kind === "qa" ? "Open Q&A" : "Start voting", icon: "start" };
		case "get_ready":
			return { kind: "wait", label: "Get ready…" };
		case "voting":
		case "open":
			return { kind: "advance", action: "close_voting", label: kind === "qa" ? "Close Q&A" : "Close voting", icon: "stop" };
		case "closed":
		default:
			return next;
	}
}

/** Short, human state label for chips and the slide list. */
export function stateLabel(kind: RunKind | null, state: RunState | null): string | null {
	if (!kind || !state || isNavigationOnly(kind)) return null;
	if (kind === "quiz") {
		switch (state) {
			case "waiting":
				return "Not started";
			case "get_ready":
				return "Get ready";
			case "voting":
				return "Answering";
			case "reveal":
			case "closed":
				return "Answer revealed";
			default:
				return null;
		}
	}
	if (kind === "spin") {
		switch (state) {
			case "waiting":
				return "Not spun yet";
			case "get_ready":
			case "voting":
				return "Spinning";
			case "reveal":
			case "closed":
				return "Wheel stopped";
			default:
				return null;
		}
	}
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
