// Smoke test: is the stack up and answering? No sign-in, no data, a few requests. Run it
// first after a deploy, and before a heavier test.
//
//   load-tests/run.sh smoke/health.js
import { sleep } from "k6";
import { AI_URL, BASE_URL, SESSIONS } from "../lib/config.js";
import { call, expectStatus } from "../lib/http.js";

export const options = {
	vus: 1,
	iterations: 5,
	thresholds: {
		http_req_failed: ["rate<0.01"],
		http_req_duration: ["p(95)<500"],
		checks: ["rate>0.99"],
	},
};

export default function () {
	// Laravel's health page.
	expectStatus(call("GET", `${BASE_URL}/up`, { name: "laravel /up", headers: { Accept: "text/html" } }), "laravel up", 200);

	// The AI server answers {"status":"ok"}.
	const ai = call("GET", `${AI_URL}/health`, { name: "ai /health" });
	expectStatus(ai, "ai server up", 200);

	// The public join-code lookup: a code that cannot exist must be a clean 404, not a 500.
	// (Misses are rate-limited per IP, 30 a minute, so this stays a handful of requests.)
	expectStatus(
		call("GET", `${SESSIONS}/by-code/K6NONE`, { name: "by-code miss", expected: [404] }),
		"unknown join code is 404",
		404
	);

	sleep(1);
}
