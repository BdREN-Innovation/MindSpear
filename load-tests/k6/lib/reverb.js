// The live connection a phone opens: Laravel Reverb speaks the Pusher protocol over a
// websocket. This is the small part of that protocol the participant app uses: connect,
// subscribe to a public channel, answer pings, and receive app events.
//
//   REVERB_URL  ws(s)://host[:port] of Reverb   dev: ws://127.0.0.1:8080   server: wss://dev.mindspear.app
//   REVERB_KEY  the app key (public: the frontend ships it as NEXT_PUBLIC_REVERB_APP_KEY)
import { fail } from "k6";
import { BASE_URL } from "./config.js";

const REVERB_URL = (__ENV.REVERB_URL || "ws://127.0.0.1:8080").replace(/\/+$/, "");
const REVERB_KEY = __ENV.REVERB_KEY || "";

/** The websocket URL and headers for a connection, as pusher-js builds them. */
export function reverbConnection() {
	if (!REVERB_KEY) fail("REVERB_KEY must be set (load-tests/README.md).");
	return {
		url: `${REVERB_URL}/app/${REVERB_KEY}?protocol=7&client=js&version=8.4.0&flash=false`,
		// Reverb accepts only the site's own origin (allowed_origins). For new WebSocket(url, null, params).
		params: { headers: { Origin: BASE_URL }, tags: { name: "reverb" } },
	};
}

/**
 * Parses one frame. Returns {event, channel, data} with `data` decoded (app events carry
 * it as a JSON string), or null for a frame that is not JSON.
 */
export function parseFrame(raw) {
	let frame;
	try {
		frame = JSON.parse(raw);
	} catch {
		return null;
	}
	let payload = frame.data;
	if (typeof payload === "string") {
		try {
			payload = JSON.parse(payload);
		} catch {
			// Leave it as the string.
		}
	}
	return { event: frame.event, channel: frame.channel, data: payload };
}

export const subscribeFrame = (channel) => JSON.stringify({ event: "pusher:subscribe", data: { auth: "", channel } });
export const pongFrame = () => JSON.stringify({ event: "pusher:pong", data: {} });
