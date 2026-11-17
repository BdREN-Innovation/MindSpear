import type { MockServer } from "./server";

interface MockControls {
	help(): void;
	/** Drop the "network" (API and sockets) for `ms`, then restore it. */
	drop(ms?: number): void;
	offline(): void;
	online(): void;
	end(sessionId: string): void;
	sessions(): void;
}

declare global {
	interface Window {
		__quizMock?: MockControls;
	}
}

/** Console helpers for trying connection and session states by hand. */
export function installMockControls(server: MockServer): void {
	if (typeof window === "undefined" || window.__quizMock) return;
	const run = (fn: () => unknown) => {
		try {
			fn();
		} catch (error) {
			console.warn("[quiz mock]", error instanceof Error ? error.message : error);
		}
	};
	window.__quizMock = {
		help: () =>
			console.info(
				"__quizMock.drop(ms) · offline() · online() · end(sessionId) · sessions()",
			),
		drop: (ms = 6000) => {
			server.setNetworkDown(true);
			setTimeout(() => server.setNetworkDown(false), ms);
		},
		offline: () => server.setNetworkDown(true),
		online: () => server.setNetworkDown(false),
		end: (id) => run(() => server.hostEnd(id)),
		sessions: () => console.table(server.hostListSessions()),
	};
}
