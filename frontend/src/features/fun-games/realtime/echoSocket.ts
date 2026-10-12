import { getEcho } from "@/lib/echo";
import type { Id, QuizServerEventType, QuizSocketEnvelope } from "../types";
import { QuizSocketBase } from "./socketBase";

/** Every event the Laravel module broadcasts (FunGameBroadcaster). */
const EVENT_TYPES: QuizServerEventType[] = [
	"session.state",
	"leaderboard.updated",
	"session.finished",
	"leaderboard.published",
	"admin.stats",
	"participant.joined",
];

/** Laravel sends `{type, data, server_time}`. */
interface BroadcastPayload {
	type?: QuizServerEventType;
	data?: unknown;
	server_time?: string;
}

type PusherConnection = {
	state: string;
	bind(event: string, callback: (...args: unknown[]) => void): void;
	unbind(event: string, callback: (...args: unknown[]) => void): void;
};

export type EchoChannelSpec =
	| { kind: "public"; name: string }
	| { kind: "private"; name: string };

/**
 * A session channel on the app's shared Reverb connection (lib/echo.ts).
 * "connected" means the channel subscription succeeded (Pusher re-subscribes
 * after every reconnect), and each time it does we emit a resync, because
 * Reverb doesn't replay events sent while we weren't subscribed.
 * If Reverb isn't configured the socket reports `notConfigured` and screens
 * fall back to polling.
 */
export class EchoQuizSocket extends QuizSocketBase {
	private connection: PusherConnection | null = null;
	private hasSubscribed = false;
	private open = false;

	constructor(
		sessionId: Id,
		private readonly channel: EchoChannelSpec,
	) {
		super(sessionId);
	}

	connect(): void {
		if (this.open) return;
		this.open = true;
		this.failure = null;
		window.addEventListener("online", this.handleOnline);
		window.addEventListener("offline", this.handleOffline);

		let echo: ReturnType<typeof getEcho>;
		try {
			echo = getEcho();
		} catch {
			this.failure = "notConfigured";
			this.setState("offline");
			return;
		}

		const channel =
			this.channel.kind === "private" ? echo.private(this.channel.name) : echo.channel(this.channel.name);
		for (const type of EVENT_TYPES) {
			channel.listen(`.${type}`, (payload: BroadcastPayload) => this.receive(type, payload));
		}
		channel.subscribed(() => {
			if (!this.open || this.failure === "unauthorized") return;
			this.hasSubscribed = true;
			this.setState("connected");
			this.emitResync();
		});
		channel.error((error: unknown) => {
			const status = (error as { status?: number } | null)?.status;
			if (status === 401 || status === 403) {
				console.warn(`[fun-games] Not allowed to listen on ${this.channel.name} (${status}).`);
				this.failure = "unauthorized";
				this.setState("offline");
			}
		});

		this.connection = echo.connector.pusher.connection as unknown as PusherConnection;
		this.connection.bind("state_change", this.handleStateChange);
		this.applyPusherState(this.connection.state);
	}

	close(): void {
		if (!this.open) return;
		this.open = false;
		window.removeEventListener("online", this.handleOnline);
		window.removeEventListener("offline", this.handleOffline);
		this.connection?.unbind("state_change", this.handleStateChange);
		this.connection = null;
		try {
			getEcho().leave(this.channel.name);
		} catch {
			// Echo was never available; nothing to leave.
		}
		this.setState("idle");
	}

	private receive(type: QuizServerEventType, payload: BroadcastPayload): void {
		if (!this.open || !payload || typeof payload !== "object") return;
		this.dispatch({
			type: payload.type ?? type,
			data: payload.data,
			serverTime: payload.server_time,
		} as QuizSocketEnvelope);
	}

	private handleStateChange = (...args: unknown[]) => {
		const change = args[0] as { current?: string } | undefined;
		if (change?.current) this.applyPusherState(change.current);
	};

	private handleOnline = () => {
		if (this.open && this.state === "offline" && !this.failure) this.setState("reconnecting");
	};

	private handleOffline = () => {
		if (this.open && !this.failure) this.setState("offline");
	};

	/** "connected" itself is reported by the channel's `subscribed` callback. */
	private applyPusherState(state: string): void {
		if (!this.open || this.failure === "unauthorized") return;
		switch (state) {
			case "connected":
				// Subscription follows; until then we're not receiving events yet.
				if (this.state !== "connected") this.setState(this.hasSubscribed ? "reconnecting" : "connecting");
				return;
			case "initialized":
			case "connecting":
				this.setState(this.hasSubscribed ? "reconnecting" : "connecting");
				return;
			case "unavailable":
			case "disconnected":
				this.setState(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "reconnecting");
				return;
			case "failed":
				this.failure = "notConfigured";
				this.setState("offline");
				return;
		}
	}
}
