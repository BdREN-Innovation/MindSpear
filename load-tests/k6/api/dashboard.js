// A signed-in user opening the app: profile, dashboard numbers, the quiz and quest libraries
// and My Files. Measures the read side of the API under a steady request rate.
//
//   load-tests/run.sh api/dashboard.js                 # 2 users' worth of page loads per second for 1 minute
//   RATE=5 DURATION=3m load-tests/run.sh api/dashboard.js
//
// The whole run signs in once and shares the token, and the quiz / quest list routes allow
// 300 requests a minute per user (deck-author throttle), so RATE above about 2 starts to
// see 429s from those two calls. That is the product's own limit, not a bug.
import { sleep } from "k6";
import { API, envInt } from "../lib/config.js";
import { login } from "../lib/auth.js";
import { call, expectStatus } from "../lib/http.js";

const RATE = envInt("RATE", 2);
const DURATION = __ENV.DURATION || "1m";

export const options = {
	scenarios: {
		readers: {
			executor: "constant-arrival-rate",
			rate: RATE,
			timeUnit: "1s",
			duration: DURATION,
			preAllocatedVUs: Math.max(5, RATE * 3),
			maxVUs: Math.max(20, RATE * 10),
		},
	},
	thresholds: {
		http_req_failed: ["rate<0.01"],
		"http_req_duration{name:profile}": ["p(95)<400"],
		"http_req_duration{name:dashboard}": ["p(95)<800"],
		"http_req_duration{name:quizzes list}": ["p(95)<600"],
		"http_req_duration{name:files list}": ["p(95)<600"],
		checks: ["rate>0.99"],
	},
};

export function setup() {
	return { token: login() };
}

export default function ({ token }) {
	expectStatus(call("GET", `${API}/profile/show`, { name: "profile", token }), "profile", 200);
	expectStatus(call("GET", `${API}/dashboard-statistics/dashboard`, { name: "dashboard", token }), "dashboard", 200);
	expectStatus(call("GET", `${API}/quizzes`, { name: "quizzes list", token }), "quizzes", 200);
	expectStatus(call("GET", `${API}/quests`, { name: "quests list", token }), "quests", 200);
	expectStatus(call("GET", `${API}/library/files?per_page=24`, { name: "files list", token }), "files", 200);
	sleep(1);
}
