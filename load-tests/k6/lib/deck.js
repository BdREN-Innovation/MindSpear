// Quiz authoring and hosting calls used by setup() / teardown() and the host scenario:
// create a deck, fill it with questions, run a session, clean up.
import { AUTHORING, SESSIONS, TEST_PREFIX } from "./config.js";
import { call, data, mustStatus } from "./http.js";

/** Creates an empty deck named for the test; returns its id. */
export function createDeck(token, title) {
	const res = mustStatus(
		call("POST", AUTHORING, { name: "deck create", token, body: { title: `${TEST_PREFIX} ${title}` }, expected: [201] }),
		"create deck",
		201
	);
	const id = data(res)?.deck?.id ?? data(res)?.id;
	if (!id) throw new Error(`create deck: no id in ${res.body.slice(0, 300)}`);
	return id;
}

/**
 * Adds `count` single-answer questions with four options each (one correct), through the
 * bulk endpoint the AI generator also uses. Returns the slides.
 */
export function addPickAnswerQuestions(token, deckId, count) {
	const slides = Array.from({ length: count }, (_, i) => ({
		type: "pick_answer_single",
		title: `Question ${i + 1}: which option is marked correct?`,
		options: ["A", "B", "C", "D"].map((label, j) => ({ label: `Option ${label}`, is_correct: j === i % 4 })),
	}));
	const res = mustStatus(
		call("POST", `${AUTHORING}/${deckId}/slides/bulk`, { name: "slides bulk", token, body: { slides }, expected: [200, 201] }),
		"add questions",
		200,
		201
	);
	return data(res)?.slides ?? [];
}

/** Starts a live session; returns the host state ({session_id, join_code, runs, ...}). */
export function startSession(token, deckId) {
	const res = mustStatus(
		call("POST", `${AUTHORING}/${deckId}/sessions`, { name: "session start", token, expected: [201] }),
		"start session",
		201
	);
	return data(res);
}

/**
 * A host action: start_voting, reveal, next_slide (+ start: true to begin the next question
 * at once), previous_slide, jump_to, insert_leaderboard. 409 means the state moved on by
 * itself (the timer ran out, or everyone answered), which is fine for the test.
 */
export function advance(token, sessionId, body) {
	return call("POST", `${SESSIONS}/${sessionId}/advance`, {
		name: `advance ${body.action}`,
		token,
		body,
		expected: [200, 409],
	});
}

/** Ends the session. 409: it had already ended. */
export function endSession(token, sessionId) {
	return call("POST", `${SESSIONS}/${sessionId}/end`, { name: "session end", token, expected: [200, 409] });
}

/** Deletes the deck: a soft delete, so its sessions stay as history (load-tests/cleanup.sh purges them). 404: already gone. */
export function deleteDeck(token, deckId) {
	return call("DELETE", `${AUTHORING}/${deckId}`, { name: "deck delete", token, expected: [200, 204, 404] });
}
