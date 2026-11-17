// Signing in as the load-test user. The account is made for load tests (see
// load-tests/README.md); its email and password come from K6_USER_EMAIL / K6_USER_PASSWORD.
import { fail } from "k6";
import { API } from "./config.js";
import { call, data, mustStatus } from "./http.js";

/** Logs in and returns the Sanctum bearer token. Call it from setup(), once per run. */
export function login() {
	const email = __ENV.K6_USER_EMAIL;
	const password = __ENV.K6_USER_PASSWORD;
	if (!email || !password) {
		fail("K6_USER_EMAIL and K6_USER_PASSWORD must be set (load-tests/README.md).");
	}
	const res = mustStatus(call("POST", `${API}/login`, { name: "login", body: { email, password } }), "login", 200);
	const token = data(res)?.token;
	if (!token) fail(`login: no token in the response: ${res.body.slice(0, 300)}`);
	return token;
}
