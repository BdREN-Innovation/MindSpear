import { QuizSocketBase, type SocketRole } from "../realtime/socketBase";
import type { Id } from "../types";
import { installMockControls } from "./controls";
import { getMockServer, type Audience } from "./server";

const CONNECT_DELAY_MS = 300;

/** Delivers mock server events with the same connection states as the real socket. */
class MockQuizSocket extends QuizSocketBase {
	private unsubscribe: (() => void) | null = null;
	private unwatchNetwork: (() => void) | null = null;
	private connectTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		sessionId: Id,
		private readonly role: SocketRole,
	) {
		super(sessionId);
	}

	connect(): void {
		if (this.unwatchNetwork) return;
		const server = getMockServer();
		this.unwatchNetwork = server.onNetworkChange((down) => {
			if (down) {
				this.detach();
				this.setState("reconnecting");
			} else {
				this.attach("reconnecting");
			}
		});
		this.attach("connecting");
	}

	close(): void {
		this.unwatchNetwork?.();
		this.unwatchNetwork = null;
		this.detach();
		this.setState("idle");
	}

	private attach(pending: "connecting" | "reconnecting"): void {
		const server = getMockServer();
		this.setState(pending);
		if (server.networkDown) return;
		if (this.connectTimer) clearTimeout(this.connectTimer);
		this.connectTimer = setTimeout(() => {
			this.connectTimer = null;
			if (server.networkDown || this.unsubscribe) return;
			this.unsubscribe = server.subscribe(this.sessionId, (envelope, audience: Audience) => {
				if (audience === "all" || audience === this.role) this.dispatch(envelope);
			});
			this.lastMessageAt = Date.now();
			this.setState("connected");
			this.emitResync();
		}, CONNECT_DELAY_MS);
	}

	private detach(): void {
		if (this.connectTimer) clearTimeout(this.connectTimer);
		this.connectTimer = null;
		this.unsubscribe?.();
		this.unsubscribe = null;
	}
}

export function createMockQuizSocket(sessionId: Id, role: SocketRole): MockQuizSocket {
	installMockControls(getMockServer());
	return new MockQuizSocket(sessionId, role);
}
