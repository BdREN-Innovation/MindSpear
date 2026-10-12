import { funGamesConfig } from "../config";
import { createHttpHostApi, type HostApi } from "./hostApi";
import { createHttpParticipantApi, type ParticipantApi } from "./participantApi";

export type { HostApi } from "./hostApi";
export type { ParticipantApi, ParticipantAuth, RequestOptions } from "./participantApi";
export { FunGamesApiError, isAbortError, toFunGamesError } from "./http";

let participantApi: Promise<ParticipantApi> | null = null;
let hostApi: Promise<HostApi> | null = null;

// The mock is only loaded (and bundled into a chunk) when NEXT_PUBLIC_FUN_GAMES_MOCK is on.

export function getParticipantApi(): Promise<ParticipantApi> {
	participantApi ??= funGamesConfig.mock
		? import("../mock/mockApi").then((m) => m.createMockParticipantApi())
		: Promise.resolve(createHttpParticipantApi());
	return participantApi;
}

export function getHostApi(): Promise<HostApi> {
	hostApi ??= funGamesConfig.mock
		? import("../mock/mockApi").then((m) => m.createMockHostApi())
		: Promise.resolve(createHttpHostApi());
	return hostApi;
}
