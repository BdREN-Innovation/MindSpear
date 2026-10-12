import { funGamesConfig } from "../config";
import type { Id } from "../types";
import { EchoQuizSocket } from "./echoSocket";
import type { QuizSocket } from "./socketBase";

export type { ConnectionState, QuizSocket, SocketFailure, SocketRole } from "./socketBase";

export type QuizSocketTarget =
	/** Participants: the session's public channel. */
	| { role: "participant"; sessionId: Id; publicChannelKey: string }
	/** The host: the private, owner-only channel. */
	| { role: "host"; sessionId: Id };

/** The returned socket is not connected yet — call `connect()`. */
export async function createQuizSocket(target: QuizSocketTarget): Promise<QuizSocket> {
	if (funGamesConfig.mock) {
		const { createMockQuizSocket } = await import("../mock/mockSocket");
		return createMockQuizSocket(target.sessionId, target.role);
	}
	return new EchoQuizSocket(
		target.sessionId,
		target.role === "host"
			? { kind: "private", name: `host.fungame.${target.sessionId}` }
			: { kind: "public", name: `session.fungame.${target.publicChannelKey}` },
	);
}
