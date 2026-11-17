// A live quiz with a room full of real-behaving phones: how many people can join one quiz
// and play it without the server falling behind.
//
//   load-tests/run.sh live/quiz-session.js                                         # 30 participants, 5 questions
//   PARTICIPANTS=300 load-tests/run.sh live/quiz-session.js
//   ENV_FILE=.env.server PARTICIPANTS=300 load-tests/run.sh live/quiz-session.js   # dev.mindspear.app
//
// Each participant does what the participant app (frontend/src/features/deck-participant)
// does, so the load has the same shape as a real classroom:
//   1. look the join code up, join, read the session state once
//   2. open a Reverb websocket and subscribe to the session's public channel; from then on
//      everything arrives as events, nothing is polled
//   3. slide.state.changed → voting: read its own state within 0–0.4 s (a quiz hides the
//      options until answering opens, so every phone fetches them at the same moment: the
//      sharpest burst of the whole quiz), then answer after "thinking" for a while
//   4. slide.revealed: read its state once within 0–2 s (its own result and rank)
//   5. session.ended: disconnect
//
// The host (one VU) creates a quiz with QUESTIONS single-answer questions, starts a session,
// waits on the Join QR code slide while everyone joins, then for each question: open it
// (5 s get-ready countdown), wait ANSWER_SECONDS, reveal, wait REVEAL_SECONDS, next.
// teardown() ends the session and deletes the quiz; load-tests/cleanup.sh purges the rest.
//
// Settings: PARTICIPANTS (30), QUESTIONS (5), JOIN_RATE joins a second (4), ANSWER_SECONDS (15),
// REVEAL_SECONDS (5). From one machine (one IP) the backend allows 300 joins a minute, so keep
// JOIN_RATE at 4 or below (300 participants take 75 s to join; 1,000 take about 4 minutes).
import exec from "k6/execution";
import { WebSocket } from "k6/experimental/websockets";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { PRODUCT, SESSIONS, TEST_PREFIX, envInt } from "../lib/config.js";
import { login } from "../lib/auth.js";
import { addPickAnswerQuestions, advance, createDeck, deleteDeck, endSession, startSession } from "../lib/deck.js";
import { call, callAsync, data, expectStatus, mustStatus } from "../lib/http.js";
import { parseFrame, pongFrame, reverbConnection, subscribeFrame } from "../lib/reverb.js";

const PARTICIPANTS = envInt("PARTICIPANTS", 30);
const QUESTIONS = envInt("QUESTIONS", 5);
const JOIN_RATE = Math.max(1, envInt("JOIN_RATE", 4));
const ANSWER_SECONDS = envInt("ANSWER_SECONDS", 15);
const REVEAL_SECONDS = envInt("REVEAL_SECONDS", 5);
const GET_READY_SECONDS = 5; // a new quiz's default countdown (backend config deck.quiz)

const JOIN_WINDOW = Math.ceil(PARTICIPANTS / JOIN_RATE) + 10;
const PER_QUESTION = GET_READY_SECONDS + ANSWER_SECONDS + REVEAL_SECONDS + 2;
const QUIZ_SECONDS = QUESTIONS * PER_QUESTION;
/** How long a phone stays connected at most, in case session.ended never arrives. */
const MAX_CONNECTED_MS = (JOIN_WINDOW + QUIZ_SECONDS + 60) * 1000;

const AVATARS = ["🦊", "🐼", "🐙", "🦉", "🐢", "🐶", "🐱", "🐭", "🐹", "🐰", "🐻", "🐨", "🐯", "🦁", "🐮"];

// What the room experienced.
const connected = new Counter("quiz_participants_connected");
const finished = new Counter("quiz_participants_finished");
const answered = new Counter("quiz_answers_submitted");
/** Answers that reached the server after answering closed: lost answers, from the person's side. */
const answersTooLate = new Counter("quiz_answers_too_late");
const missed = new Counter("quiz_questions_missed");
const wsErrors = new Counter("quiz_ws_errors");
const rateLimited = new Counter("quiz_rate_limited");
/** Server event → this phone: the delay a person sees (server_time vs. arrival; needs synced clocks). */
const broadcastDelay = new Trend("quiz_broadcast_delay", true);

export const options = {
	scenarios: {
		host: {
			executor: "per-vu-iterations",
			vus: 1,
			iterations: 1,
			maxDuration: `${JOIN_WINDOW + QUIZ_SECONDS + 120}s`,
			exec: "host",
		},
		participants: {
			executor: "shared-iterations",
			vus: PARTICIPANTS,
			iterations: PARTICIPANTS,
			maxDuration: `${JOIN_WINDOW + QUIZ_SECONDS + 120}s`,
			exec: "participant",
		},
	},
	thresholds: {
		// Everyone joined, stayed connected to the end and played the questions.
		quiz_participants_connected: [`count>=${PARTICIPANTS}`],
		quiz_participants_finished: [`count>=${Math.floor(PARTICIPANTS * 0.98)}`],
		// A question is missed when the phone's answer was not accepted (late, failed, never sent).
		quiz_questions_missed: [`count<=${Math.floor(PARTICIPANTS * QUESTIONS * 0.02)}`],
		quiz_rate_limited: ["count==0"],
		quiz_ws_errors: ["count==0"],
		http_req_failed: ["rate<0.02"],
		checks: ["rate>0.98"],
		"http_req_duration{name:join}": ["p(95)<1500"],
		"http_req_duration{name:options read}": ["p(95)<1500"],
		"http_req_duration{name:answer}": ["p(95)<1000"],
		"http_req_duration{name:result read}": ["p(95)<1500"],
		ws_connecting: ["p(95)<2000"],
		quiz_broadcast_delay: ["p(95)<1000"],
	},
};

export function setup() {
	const token = login();
	const deckId = createDeck(token, `live quiz ${PARTICIPANTS}p ${new Date().toISOString()}`);
	addPickAnswerQuestions(token, deckId, QUESTIONS);
	const session = startSession(token, deckId);
	const firstQuestion = (session.runs || []).find((run) => run.accepts_answers);
	if (!firstQuestion) throw new Error("setup: the session has no question runs");
	console.log(
		`k6: session ${session.session_id}, code ${session.join_code}: ${PARTICIPANTS} participants joining at ${JOIN_RATE}/s ` +
			`(~${JOIN_WINDOW} s), then ${QUESTIONS} questions (~${QUIZ_SECONDS} s)`
	);
	return {
		token,
		deckId,
		sessionId: session.session_id,
		joinCode: session.join_code,
		channel: `session.${PRODUCT}.${session.public_channel_key}`,
		firstRunId: firstQuestion.id,
	};
}

/** The host: paces the quiz over HTTP, like the presenter's buttons. */
export function host({ token, sessionId, firstRunId }) {
	sleep(JOIN_WINDOW);
	expectStatus(advance(token, sessionId, { action: "jump_to", target_run_id: firstRunId, start: true }), "host: open first question", 200);
	for (let i = 0; i < QUESTIONS; i++) {
		sleep(GET_READY_SECONDS + ANSWER_SECONDS);
		// 409: it revealed itself (everyone answered, or the time limit ran out).
		expectStatus(advance(token, sessionId, { action: "reveal" }), "host: reveal", 200, 409);
		sleep(REVEAL_SECONDS);
		if (i < QUESTIONS - 1) {
			expectStatus(advance(token, sessionId, { action: "next_slide", start: true }), "host: next question", 200);
		}
	}
	sleep(2);
	expectStatus(endSession(token, sessionId), "host: end session", 200, 409);
}

/** Counts a 429 on its own: above the per-IP limits the test measures the limiter, not the server. */
function track(res) {
	if (res.status === 429) rateLimited.add(1);
	return res;
}

/**
 * One phone, from entering the code to the end of the quiz. Like a browser, it never blocks:
 * its requests run while the websocket keeps delivering events, so a slow response does not
 * also make the broadcasts look slow.
 */
export async function participant({ sessionId, joinCode, channel }) {
	const n = exec.scenario.iterationInTest;
	// Spread the joins: participant n starts n / JOIN_RATE seconds in.
	sleep(n / JOIN_RATE);

	// 1. Look the code up, join, read the state once (nothing to listen to yet).
	expectStatus(track(call("GET", `${SESSIONS}/by-code/${joinCode}`, { name: "join code lookup" })), "join code lookup", 200);
	const joined = mustStatus(
		track(
			call("POST", `${SESSIONS}/${sessionId}/participants/join`, {
				name: "join",
				body: { join_code: joinCode, display_name: `${TEST_PREFIX}-${n + 1}`, emoji_avatar: AVATARS[n % AVATARS.length] },
				expected: [201],
			})
		),
		"join",
		201
	);
	const headers = { "X-Participant-Token": data(joined)?.participant_token };
	expectStatus(track(call("GET", `${SESSIONS}/${sessionId}/participant-state`, { name: "initial state", headers })), "initial state", 200);
	const readState = async (name) => track(await callAsync("GET", `${SESSIONS}/${sessionId}/participant-state`, { name, headers }));

	// 2. The live connection; everything after this is driven by its events.
	const answeredRuns = new Set();
	let accepted = 0;
	let ended = false;
	const timers = new Set();
	/** setTimeout that is cancelled when the socket closes, so a finished phone does not linger. */
	const later = (ms, task) => {
		const id = setTimeout(() => {
			timers.delete(id);
			task().catch((e) => console.warn(`participant ${n + 1}: ${e}`));
		}, ms);
		timers.add(id);
	};

	async function answerWhenOpen() {
		const stateRes = await readState("options read");
		if (!expectStatus(stateRes, "options read", 200)) return;
		const run = data(stateRes)?.current_run;
		if (!run || run.state !== "voting" || !(run.options || []).length || answeredRuns.has(run.id)) return;
		answeredRuns.add(run.id);
		// A person reads the question and picks: from 1 s to 70 % of the answer window.
		const thinkMs = 1000 + Math.random() * Math.max(0, ANSWER_SECONDS * 700 - 1000);
		later(thinkMs, async () => {
			const option = run.options[Math.floor(Math.random() * run.options.length)];
			const answer = track(
				await callAsync("POST", `${SESSIONS}/${sessionId}/slide-runs/${run.id}/answers`, {
					name: "answer",
					headers,
					body: { answer_payload: { option_id: option.id } },
					// 409: answering had closed when it arrived (a lost answer for the person; counted below).
					expected: [204, 409],
				})
			);
			expectStatus(answer, "answer accepted", 204, 409);
			if (answer.status === 204) {
				accepted++;
				answered.add(1);
			} else if (answer.status === 409) {
				answersTooLate.add(1);
			}
		});
	}

	const { url, params } = reverbConnection();
	const socket = new WebSocket(url, null, params);
	const guard = setTimeout(() => socket.close(), MAX_CONNECTED_MS);

	socket.onmessage = (message) => {
		const frame = parseFrame(message.data);
		if (!frame) return;
		const payload = frame.data || {};
		if (payload.server_time) broadcastDelay.add(Date.now() - Date.parse(payload.server_time));

		switch (frame.event) {
			case "pusher:connection_established":
				socket.send(subscribeFrame(channel));
				break;
			case "pusher_internal:subscription_succeeded":
				connected.add(1);
				break;
			case "pusher:ping":
				socket.send(pongFrame());
				break;
			case "pusher:error":
				wsErrors.add(1);
				console.warn(`participant ${n + 1}: reverb error ${JSON.stringify(payload)}`);
				break;
			// 3. Answering opened: fetch the options within 0–0.4 s, as the app does, then answer.
			case "slide.state.changed":
				if (payload.state === "voting" && !answeredRuns.has(payload.slide_run_id)) later(Math.random() * 400, answerWhenOpen);
				break;
			// 4. The reveal: one read for this phone's own result, within 0–2 s.
			case "slide.revealed":
				later(Math.random() * 2000, async () => expectStatus(await readState("result read"), "result read", 200));
				break;
			// A slide too large for the socket arrives slim: read it over HTTP.
			case "slide.changed":
				if (payload.slide?.refetch) later(Math.random() * 2000, () => readState("refetch"));
				break;
			// 5. The end.
			case "session.ended":
				ended = true;
				finished.add(1);
				socket.close();
				break;
		}
	};
	socket.onerror = (e) => {
		wsErrors.add(1);
		console.warn(`participant ${n + 1}: websocket error ${e.error}`);
	};
	socket.onclose = () => {
		clearTimeout(guard);
		timers.forEach((id) => clearTimeout(id));
		timers.clear();
		// A question counts as played only when the server accepted the answer.
		missed.add(Math.max(0, QUESTIONS - accepted));
		if (!ended) console.warn(`participant ${n + 1}: disconnected before the session ended`);
	};
}

export function teardown({ token, deckId, sessionId }) {
	endSession(token, sessionId);
	deleteDeck(token, deckId);
}
