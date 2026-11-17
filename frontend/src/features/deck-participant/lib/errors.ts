import { toDeckApiError, type DeckApiError } from "@/features/deck/api/errors";

// DeckApiError → copy a participant can act on. The backend messages are
// written for developers; these are written for a phone in a lecture hall.

export type ParticipantErrorContext = "lookup" | "join" | "state" | "answer" | "question" | "review";

function retryHint(error: DeckApiError): string {
	const seconds = Number(error.data.retry_after);
	return Number.isFinite(seconds) && seconds > 0
		? `Please wait ${Math.ceil(seconds)} second${Math.ceil(seconds) === 1 ? "" : "s"} and try again.`
		: "Please wait a moment and try again.";
}

export function friendlyError(reason: unknown, context: ParticipantErrorContext): string {
	const error = toDeckApiError(reason);

	switch (error.code) {
		case "network":
		case "timeout":
			return error.message;
		case "too_many_requests":
			return context === "question"
				? `You're asking questions very quickly. ${retryHint(error)}`
				: `Too many tries. ${retryHint(error)}`;
		case "payload_too_large":
			return "That answer is too long to send. Please shorten it.";
		default:
			break;
	}

	if (error.status === 401) {
		return "Your place in this session has expired.";
	}

	if (error.status === 422) {
		if (context === "join") {
			if (error.fieldError("display_name")) return "Please enter a name between 1 and 40 characters.";
			if (error.fieldError("emoji_avatar")) return "That avatar isn't available any more. Please pick another one.";
			if (error.fieldError("join_code")) return "That code doesn't match this session. Check it and try again.";
		}
		if (context === "question" && error.fieldError("body")) return error.fieldError("body")!;
		return error.message || "Please check your answer and try again.";
	}

	switch (context) {
		case "lookup":
			if (error.status === 404) return "We couldn't find a live session with that code. Check the code and try again.";
			break;
		case "join":
			if (error.status === 404) return "This session isn't available any more. Check the code and try again.";
			if (error.code === "invalid_state" || error.data.session_status === "pending") {
				return "The host hasn't started this session yet. Try again in a moment.";
			}
			if (error.status === 403 || error.data.session_status === "ended") return "This session has already ended.";
			break;
		case "answer":
		case "question":
			switch (error.reason) {
				case "not_voting":
				case "not_open":
					return context === "question" ? "Questions are closed right now." : "Voting isn't open right now.";
				case "time_up":
					return "Time's up! Your answer didn't make it in.";
				case "not_current_slide":
					return "The host has moved on to another slide.";
				case "session_not_live":
					return "This session is no longer live.";
				case "no_answers":
				case "not_qa_slide":
					return "This slide doesn't take answers.";
				default:
					break;
			}
			if (error.status === 404) return "This slide is no longer available.";
			break;
		case "review":
			if (error.reason === "session_not_ended") return "The session is still running.";
			if (error.status === 404) return "This session's results are no longer available.";
			break;
		case "state":
			if (error.status === 404) return "This session is no longer available.";
			break;
	}

	return "Something went wrong. Please try again.";
}
