// Join details shown on the big screen. The presenter runs on the same
// frontend participants use, so the browser origin is the address to show
// (the backend's join_url depends on FRONTEND_URL, which may differ in dev).

/** "mindspear.app/play" — what people type. */
export function joinDisplayUrl(): string {
	if (typeof window === "undefined") return "/play";
	return `${window.location.host}/play`;
}

/** Full link the QR code encodes: straight to the name step with the code filled in. */
export function joinQrUrl(code: string): string {
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	return `${origin}/play/${encodeURIComponent(code)}`;
}

/** "ABC123" → "ABC 123" (lookups ignore spaces, and groups of three read better from the back row). */
export function formatJoinCode(code: string): string {
	const clean = code.replace(/[\s-]/g, "").toUpperCase();
	if (clean.length < 6) return clean;
	return clean.match(/.{1,3}/g)?.join(" ") ?? clean;
}
