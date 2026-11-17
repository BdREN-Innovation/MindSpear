// Where the tests point. Everything comes from the environment (load-tests/run.sh passes it
// through), so the same script runs against the local stack and against a server.
//
//   BASE_URL  the app, as the browser sees it      dev: http://127.0.0.1:8000   prod: https://dev.mindspear.app
//   AI_URL    the AI server                         dev: http://127.0.0.1:8001   prod: https://dev.mindspear.app/ai-api
//   PRODUCT   quiz (default) or quest: picks the /quizzes or /quests routes

const trim = (url) => url.replace(/\/+$/, "");

export const BASE_URL = trim(__ENV.BASE_URL || "http://127.0.0.1:8000");
export const AI_URL = trim(__ENV.AI_URL || "http://127.0.0.1:8001");
export const API = `${BASE_URL}/api/v1`;

export const PRODUCT = __ENV.PRODUCT === "quest" ? "quest" : "quiz";
/** Authoring routes: /quizzes or /quests (backend/config/deck.php `routes`). */
export const AUTHORING = `${API}/${PRODUCT === "quest" ? "quests" : "quizzes"}`;
/** Live session routes: /quiz-sessions or /quest-sessions. */
export const SESSIONS = `${API}/${PRODUCT === "quest" ? "quest-sessions" : "quiz-sessions"}`;

export const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

/** Test data is named so it is easy to spot (and to clean up) in the database. */
export const TEST_PREFIX = "k6";

/** A number from the environment, with a default. */
export function envInt(name, fallback) {
	const value = parseInt(__ENV[name] ?? "", 10);
	return Number.isFinite(value) ? value : fallback;
}
