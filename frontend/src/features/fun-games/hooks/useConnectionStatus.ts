"use client";

import { useSyncExternalStore } from "react";
import type { ConnectionState, QuizSocket } from "../realtime";

const noSubscribe = () => () => {};

export function useConnectionStatus(socket: QuizSocket | null): ConnectionState {
	return useSyncExternalStore(
		socket ? socket.onStateChange : noSubscribe,
		() => socket?.getState() ?? "idle",
		() => "idle",
	);
}
