"use client";

import { getEcho } from "@/lib/echo";

// Ref-counted Echo channel access for the deck hooks. Echo keeps one channel
// object per name, and echo.leave() drops it for every listener, so two
// components on the same channel (presenter shell + Q&A panel, say) must not
// leave it under each other. Each hook acquires, adds its own listeners,
// removes exactly those on cleanup, and the last release leaves the channel.

type Echo = ReturnType<typeof getEcho>;
type PublicChannel = ReturnType<Echo["channel"]>;
type PrivateChannel = ReturnType<Echo["private"]>;
export type DeckEchoChannel = PublicChannel | PrivateChannel;

export type ChannelKind = "public" | "private";

const refs = new Map<string, number>();

const fullName = (kind: ChannelKind, name: string) => (kind === "private" ? `private-${name}` : name);

export interface AcquiredChannel {
	channel: DeckEchoChannel;
	/** Whether the subscription is already confirmed (then no subscription_succeeded will fire for us). */
	isSubscribed(): boolean;
	/** Run `callback` on every subscription success (first subscribe and every resubscribe after a reconnect). */
	onSubscribed(callback: () => void): void;
	/** Run `callback` on subscription errors (e.g. 403 from /broadcasting/auth). */
	onError(callback: (error: unknown) => void): void;
	/** Add an event listener (name without the leading dot). */
	listen<P>(event: string, callback: (payload: P) => void): void;
	/** Removes this holder's listeners; leaves the channel when no holder is left. */
	release(): void;
}

/** Subscribe (or reuse) a channel. Throws when Echo cannot start (e.g. missing Reverb key). */
export function acquireChannel(kind: ChannelKind, name: string): AcquiredChannel {
	const echo = getEcho();
	const key = fullName(kind, name);
	const channel: DeckEchoChannel = kind === "private" ? echo.private(name) : echo.channel(name);
	refs.set(key, (refs.get(key) ?? 0) + 1);

	const listeners: { event: string; callback: CallableFunction }[] = [];
	const bindings: { event: string; callback: (...args: unknown[]) => void }[] = [];
	let released = false;

	const bind = (event: string, callback: (...args: unknown[]) => void) => {
		channel.subscription.bind(event, callback);
		bindings.push({ event, callback });
	};

	return {
		channel,
		isSubscribed: () => Boolean((channel.subscription as { subscribed?: boolean }).subscribed),
		onSubscribed: (callback) => bind("pusher:subscription_succeeded", () => callback()),
		onError: (callback) => bind("pusher:subscription_error", (error) => callback(error)),
		listen: (event, callback) => {
			const dotted = event.startsWith(".") ? event : `.${event}`;
			channel.listen(dotted, callback);
			listeners.push({ event: dotted, callback });
		},
		release: () => {
			if (released) return;
			released = true;
			listeners.forEach(({ event, callback }) => channel.stopListening(event, callback));
			bindings.forEach(({ event, callback }) => channel.subscription.unbind(event, callback));

			const left = (refs.get(key) ?? 1) - 1;
			if (left <= 0) {
				refs.delete(key);
				echo.leaveChannel(key);
			} else {
				refs.set(key, left);
			}
		},
	};
}
