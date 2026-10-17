/*
 * MindSpear participant PWA service worker (plan §4.1). Hand-rolled on
 * purpose: small enough to read in one go.
 *
 * Registered by features/deck-participant/pwa/serviceWorker.ts with scope
 * /play, so it only controls the participant app.
 *
 * What it caches: the app shell only.
 *   - /_next/static/*        cache-first (content-hashed, immutable)
 *   - icons, logo, fonts, manifest   stale-while-revalidate
 *   - /play page navigations network-first with a 3.5 s budget: past it (or
 *                            on a network error) the cached copy of that page
 *                            is shown while the network answer refreshes the
 *                            cache; with no cached copy it keeps waiting, then
 *                            falls back to a tiny offline page
 * What it never caches: anything cross-origin (the Laravel API, Reverb,
 * uploaded media), any /api/ path, RSC/prefetch requests, non-GET requests.
 * Session data must always come fresh from the server.
 *
 * VERSION is the Next build id, passed as /sw.js?v=<build id> at
 * registration: every deploy registers a new script URL, so a new worker
 * installs and its activation drops every older cache.
 *
 * Eviction is least-recently-used: a cache hit re-stores its entry once per
 * worker lifetime (moving it to the end of keys()), and trim() drops from the
 * front.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "v1";
const PREFIX = "mindspear-play-";
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const STATIC_CACHE = `${PREFIX}static-${VERSION}`;
const SHELL_LIMIT = 30;
const STATIC_LIMIT = 150;
const NAVIGATION_TIMEOUT_MS = 3500;

const PRECACHE = [
	"/play",
	"/manifest.webmanifest",
	"/pwa/icon-192.png",
	"/pwa/icon-512.png",
	"/pwa/maskable-192.png",
	"/pwa/apple-touch-icon.png",
	"/images/logo/logo.svg",
	"/images/logo/favicon.svg",
];

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#FFFFFF"><title>Offline · MindSpear</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#111928;text-align:center;padding:24px}
main{max-width:320px}h1{font-size:22px;margin:16px 0 8px}p{color:#4B5563;line-height:1.5}
button{margin-top:20px;min-height:48px;padding:0 28px;border:0;border-radius:999px;background:#F79945;
color:#111928;font-weight:700;font-size:16px}</style></head><body><main>
<img src="/pwa/icon-192.png" width="72" height="72" alt="">
<h1>You're offline</h1><p>Check your connection, then try again. Your place in the session is kept on this device.</p>
<button onclick="location.reload()">Try again</button></main></body></html>`;

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(SHELL_CACHE)
			.then((cache) =>
				// One missing file must not fail the whole install.
				Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => undefined)))
			)
			.then(() => self.skipWaiting())
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key.startsWith(PREFIX) && key !== SHELL_CACHE && key !== STATIC_CACHE)
						.map((key) => caches.delete(key))
				)
			)
			.then(() => self.clients.claim())
	);
});

self.addEventListener("message", (event) => {
	if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function neverCache(request, url) {
	if (request.method !== "GET") return true;
	if (url.origin !== self.location.origin) return true;
	if (url.pathname.startsWith("/api/") || url.pathname.includes("/api/")) return true;
	if (url.pathname.startsWith("/_next/webpack-hmr") || url.pathname.startsWith("/__nextjs")) return true;
	if (url.pathname === "/sw.js") return true;
	if (url.searchParams.has("_rsc")) return true;
	if (request.headers.get("RSC") || request.headers.get("Next-Router-Prefetch")) return true;
	if (request.headers.has("range")) return true;
	return false;
}

/** Drops the oldest entries (front of keys()) beyond `limit`. */
async function trim(cacheName, limit) {
	const cache = await caches.open(cacheName);
	const keys = await cache.keys();
	for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

// Entries re-stored by this worker instance (it is short-lived, so this stays small).
const touched = new Set();

/** LRU bookkeeping for a hit: re-store it once per worker lifetime so trim() keeps it longest. */
function touch(cache, key, hit) {
	const id = typeof key === "string" ? key : key.url;
	if (touched.has(id)) return Promise.resolve();
	touched.add(id);
	return cache.put(key, hit.clone()).catch(() => undefined);
}

function store(cache, key, response, limit, name) {
	return cache
		.put(key, response)
		.then(() => trim(name, limit))
		.catch(() => undefined);
}

async function cacheFirst(event) {
	const request = event.request;
	const cache = await caches.open(STATIC_CACHE);
	const hit = await cache.match(request);
	if (hit) {
		event.waitUntil(touch(cache, request, hit));
		return hit;
	}
	const response = await fetch(request);
	if (response.ok && response.type === "basic") {
		event.waitUntil(store(cache, request, response.clone(), STATIC_LIMIT, STATIC_CACHE));
	}
	return response;
}

async function staleWhileRevalidate(event) {
	const cache = await caches.open(STATIC_CACHE);
	const hit = (await cache.match(event.request)) || (await caches.match(event.request));
	const network = fetch(event.request)
		.then((response) => {
			if (response.ok && response.type === "basic") {
				return store(cache, event.request, response.clone(), STATIC_LIMIT, STATIC_CACHE).then(() => response);
			}
			return response;
		})
		.catch(() => undefined);
	if (hit) {
		event.waitUntil(network);
		return hit;
	}
	return (await network) || Response.error();
}

const TIMED_OUT = Symbol("timed-out");
const FAILED = Symbol("failed");

function offlinePage() {
	return new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function networkFirstPage(event, url) {
	// Query strings (?code=, ?reason=) do not change the shell HTML.
	const key = url.origin + url.pathname;
	const cachePromise = caches.open(SHELL_CACHE);

	// Keep the worker alive until the network answer is stored, even when the
	// cached copy was shown first.
	let settle;
	event.waitUntil(new Promise((resolve) => (settle = resolve)));
	const network = fetch(event.request).then(
		(response) => {
			if (response.ok && response.type === "basic") {
				const copy = response.clone();
				cachePromise.then((cache) => store(cache, key, copy, SHELL_LIMIT, SHELL_CACHE)).finally(settle);
			} else {
				settle();
			}
			return response;
		},
		(error) => {
			settle();
			throw error;
		}
	);

	let timer;
	const first = await Promise.race([
		network.catch(() => FAILED),
		new Promise((resolve) => (timer = setTimeout(() => resolve(TIMED_OUT), NAVIGATION_TIMEOUT_MS))),
	]);
	clearTimeout(timer);
	if (first !== TIMED_OUT && first !== FAILED) return first;

	// Slow (past the budget) or failed: the cached copy of this page, if any.
	const cache = await cachePromise;
	const hit = await cache.match(key);
	if (hit) {
		event.waitUntil(touch(cache, key, hit));
		return hit;
	}
	if (first === FAILED) return offlinePage();
	// Only slow and nothing cached: the network is still the best bet.
	try {
		return await network;
	} catch {
		return offlinePage();
	}
}

self.addEventListener("fetch", (event) => {
	const request = event.request;
	let url;
	try {
		url = new URL(request.url);
	} catch {
		return;
	}
	if (neverCache(request, url)) return;

	if (request.mode === "navigate") {
		if (url.pathname === "/play" || url.pathname.startsWith("/play/")) {
			event.respondWith(networkFirstPage(event, url));
		}
		return;
	}

	if (url.pathname.startsWith("/_next/static/")) {
		event.respondWith(cacheFirst(event));
		return;
	}

	if (
		url.pathname.startsWith("/pwa/") ||
		url.pathname.startsWith("/images/logo/") ||
		url.pathname.startsWith("/fonts/") ||
		url.pathname === "/manifest.webmanifest" ||
		/\.(woff2?|ttf|otf)$/.test(url.pathname)
	) {
		event.respondWith(staleWhileRevalidate(event));
	}
});
