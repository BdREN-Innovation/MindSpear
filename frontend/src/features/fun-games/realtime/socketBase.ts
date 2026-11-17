import { serverClock } from "../lib/serverClock";
import type {
	Id,
	QuizServerEventType,
	QuizServerEvents,
	QuizSocketEnvelope,
} from "../types";

export type ConnectionState =
	| "idle"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "offline";

/**
 * Why realtime isn't available, when retrying won't fix it. Screens keep
 * working by polling; this only changes the wording of the status banner.
 */
export type SocketFailure = "notConfigured" | "unauthorized" | null;

export type SocketRole = "participant" | "host";

export interface QuizSocket {
	readonly sessionId: Id;
	getState(): ConnectionState;
	getFailure(): SocketFailure;
	/** Device time of the last message from the server, for "updated hh:mm:ss". */
	getLastMessageAt(): number | null;
	connect(): void;
	close(): void;
	on<K extends QuizServerEventType>(
		type: K,
		listener: (data: QuizServerEvents[K]) => void,
	): () => void;
	onStateChange(listener: (state: ConnectionState) => void): () => void;
	/**
	 * Fires each time the socket (re)connects. Events sent while disconnected
	 * aren't replayed, so screens re-fetch session state here.
	 */
	onResync(listener: () => void): () => void;
}

type AnyListener = (data: unknown) => void;

/** Listener bookkeeping shared by the real and mock sockets. */
export abstract class QuizSocketBase implements QuizSocket {
	protected state: ConnectionState = "idle";
	protected failure: SocketFailure = null;
	protected lastMessageAt: number | null = null;
	private eventListeners = new Map<QuizServerEventType, Set<AnyListener>>();
	private stateListeners = new Set<(state: ConnectionState) => void>();
	private resyncListeners = new Set<() => void>();

	constructor(readonly sessionId: Id) {}

	abstract connect(): void;
	abstract close(): void;

	getState = (): ConnectionState => this.state;
	getFailure = (): SocketFailure => this.failure;
	getLastMessageAt = (): number | null => this.lastMessageAt;

	on<K extends QuizServerEventType>(
		type: K,
		listener: (data: QuizServerEvents[K]) => void,
	): () => void {
		const set = this.eventListeners.get(type) ?? new Set<AnyListener>();
		set.add(listener as AnyListener);
		this.eventListeners.set(type, set);
		return () => {
			set.delete(listener as AnyListener);
		};
	}

	onStateChange = (listener: (state: ConnectionState) => void): (() => void) => {
		this.stateListeners.add(listener);
		return () => {
			this.stateListeners.delete(listener);
		};
	};

	onResync(listener: () => void): () => void {
		this.resyncListeners.add(listener);
		return () => {
			this.resyncListeners.delete(listener);
		};
	}

	protected setState(next: ConnectionState): void {
		if (next === this.state) return;
		this.state = next;
		this.stateListeners.forEach((listener) => listener(next));
	}

	protected dispatch(envelope: QuizSocketEnvelope): void {
		this.lastMessageAt = Date.now();
		if (envelope.serverTime) serverClock.sampleEvent(envelope.serverTime);
		this.eventListeners
			.get(envelope.type)
			?.forEach((listener) => listener(envelope.data));
	}

	protected emitResync(): void {
		this.resyncListeners.forEach((listener) => listener());
	}
}
