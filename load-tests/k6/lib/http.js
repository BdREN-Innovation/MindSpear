// Thin helpers over k6/http for this API: JSON in and out, the {status, message, data}
// envelope, and a check that names the call in the results.
import http from "k6/http";
import { check, fail } from "k6";
import { JSON_HEADERS } from "./config.js";

/**
 * Sends a JSON request. `name` becomes the request's `name` tag, so the dashboards group
 * every call to the same endpoint even when the URL carries ids. `expected` lists the
 * status codes that count as success (others mark the request as failed).
 */
export function call(method, url, options = {}) {
	const [payload, params] = requestArgs(url, options);
	return http.request(method, url, payload, params);
}

/**
 * Like call(), but returns a Promise and does not block the virtual user: a phone keeps
 * receiving websocket events while its request is in flight (use with k6/experimental/websockets).
 */
export function callAsync(method, url, options = {}) {
	const [payload, params] = requestArgs(url, options);
	return http.asyncRequest(method, url, payload, params);
}

function requestArgs(url, { name, body, headers = {}, expected = [200], token } = {}) {
	const params = {
		headers: { ...JSON_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
		tags: { name: name || url },
		responseCallback: http.expectedStatuses(...expected),
	};
	return [body === undefined ? null : JSON.stringify(body), params];
}

/** The `data` part of a {status, message, data} response, or null. */
export function data(res) {
	try {
		return res.json("data") ?? null;
	} catch {
		return null;
	}
}

/** One named check on the status code; returns whether it passed. */
export function expectStatus(res, label, ...codes) {
	const ok = codes.includes(res.status);
	check(res, { [`${label}: ${codes.join("/")}`]: () => ok });
	return ok;
}

/** Like expectStatus, but stops the iteration when it fails (for calls later steps depend on). */
export function mustStatus(res, label, ...codes) {
	if (!expectStatus(res, label, ...codes)) {
		fail(`${label}: expected ${codes.join("/")}, got ${res.status}: ${(res.body || "").slice(0, 300)}`);
	}
	return res;
}
