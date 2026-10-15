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
 *   - /play page navigations network-first; the cached copy (or a tiny
 *                            offline page) is only used when the network fails
 * What it never caches: anything cross-origin (the Laravel API, Reverb,
 * uploaded media), any /api/ path, RSC/prefetch requests, non-GET requests.
 * Session data must always come fresh from the server.
 *
 * Bump VERSION to drop every old cache on the next activation.
 */
const VERSION = "v1";
const PREFIX = "mindspear-play-";
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const STATIC_CACHE = `${PREFIX}static-${VERSION}`;
const SHELL_LIMIT = 30;
const STATIC_LIMIT = 150;

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

async function trim(cacheName, limit) {
	const cache = await caches.open(cacheName);
	const keys = await cache.keys();
	for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
	const cache = await caches.open(STATIC_CACHE);
	const hit = await cache.match(request);
	if (hit) return hit;
	const response = await fetch(request);
	if (response.ok && response.type === "basic") {
		cache.put(request, response.clone()).then(() => trim(STATIC_CACHE, STATIC_LIMIT));
	}
	return response;
}

async function staleWhileRevalidate(event) {
	const cache = await caches.open(STATIC_CACHE);
	const hit = (await cache.match(event.request)) || (await caches.match(event.request));
	const network = fetch(event.request)
		.then((response) => {
			if (response.ok && response.type === "basic") cache.put(event.request, response.clone());
			return response;
		})
		.catch(() => undefined);
	if (hit) {
		event.waitUntil(network);
		return hit;
	}
	return (await network) || Response.error();
}

async function networkFirstPage(request, url) {
	const cache = await caches.open(SHELL_CACHE);
	// Query strings (?code=, ?reason=) do not change the shell HTML.
	const key = url.origin + url.pathname;
	try {
		const response = await fetch(request);
		if (response.ok && response.type === "basic") {
			cache.put(key, response.clone()).then(() => trim(SHELL_CACHE, SHELL_LIMIT));
		}
		return response;
	} catch (error) {
		const hit = await cache.match(key);
		if (hit) return hit;
		return new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
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
			event.respondWith(networkFirstPage(request, url));
		}
		return;
	}

	if (url.pathname.startsWith("/_next/static/")) {
		event.respondWith(cacheFirst(request));
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
