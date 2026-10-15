"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { IsoDateTime } from "../types";

// Server-time offset for countdowns. Every state payload and most events carry
// `server_time`; the server owns deadlines (`ends_at`), so the client counts
// down against "server now" = Date.now() + offset instead of its own clock.
//
// Each sample is server_time - arrival time, i.e. the true offset minus the
// network latency, so the largest recent sample is the best estimate. Samples
// older than SAMPLE_TTL_MS are dropped so a corrected device clock heals.

const MAX_SAMPLES = 8;
const SAMPLE_TTL_MS = 5 * 60_000;

let samples: { offset: number; at: number }[] = [];
let offsetMs = 0;
const listeners = new Set<() => void>();

function recompute(): void {
	const now = Date.now();
	samples = samples.filter((sample) => now - sample.at < SAMPLE_TTL_MS).slice(-MAX_SAMPLES);
	const next = samples.length ? Math.max(...samples.map((sample) => sample.offset)) : 0;
	if (next !== offsetMs) {
		offsetMs = next;
		listeners.forEach((listener) => listener());
	}
}

/** Feed a `server_time` from a response or event. Ignores missing / unparseable values. */
export function noteServerTime(serverTime: IsoDateTime | null | undefined): void {
	if (!serverTime) return;
	const parsed = Date.parse(serverTime);
	if (!Number.isFinite(parsed)) return;
	samples.push({ offset: parsed - Date.now(), at: Date.now() });
	recompute();
}

/** Current estimate of server clock minus device clock (ms). */
export function getServerOffsetMs(): number {
	return offsetMs;
}

/** "Now" on the server's clock (epoch ms). */
export function serverNow(): number {
	return Date.now() + offsetMs;
}

/** Milliseconds until an ISO deadline on the server clock (negative when past), or null. */
export function msUntil(deadline: IsoDateTime | null | undefined): number | null {
	if (!deadline) return null;
	const parsed = Date.parse(deadline);
	return Number.isFinite(parsed) ? parsed - serverNow() : null;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export interface UseServerClockOptions {
	/** The deadline (state/event `ends_at`); null = untimed (nothing ticks). */
	endsAt: IsoDateTime | null | undefined;
	/** Full length of the timed state, for `progress`. */
	durationSeconds?: number | null;
	/** A `server_time` to fold into the offset when it changes. */
	serverTime?: IsoDateTime | null;
	/** Tick interval (default 250 ms). */
	tickMs?: number;
	/** Called once per deadline when it passes (e.g. resync to apply the server's transition). */
	onExpire?: () => void;
}

export interface ServerClock {
	/** ms left (≥ 0), null when untimed. */
	msRemaining: number | null;
	/** Whole seconds left, rounded up like the server's seconds_remaining; null when untimed. */
	secondsRemaining: number | null;
	/** 1 → 0 as time runs out (needs durationSeconds); null when unknown. */
	progress: number | null;
	expired: boolean;
	offsetMs: number;
}

/** Ticking countdown to `endsAt` on the server clock. */
export function useServerClock({
	endsAt,
	durationSeconds = null,
	serverTime,
	tickMs = 250,
	onExpire,
}: UseServerClockOptions): ServerClock {
	const offset = useSyncExternalStore(subscribe, getServerOffsetMs, () => 0);
	const [, setTick] = useState(0);
	const onExpireRef = useRef(onExpire);
	onExpireRef.current = onExpire;
	const firedFor = useRef<string | null>(null);

	useEffect(() => {
		noteServerTime(serverTime);
	}, [serverTime]);

	const remaining = msUntil(endsAt);

	useEffect(() => {
		if (!endsAt) return;
		const timer = window.setInterval(() => setTick((n) => n + 1), tickMs);
		return () => window.clearInterval(timer);
	}, [endsAt, tickMs]);

	useEffect(() => {
		if (!endsAt || remaining === null || remaining > 0) return;
		if (firedFor.current === endsAt) return;
		firedFor.current = endsAt;
		onExpireRef.current?.();
	}, [endsAt, remaining]);

	if (remaining === null) {
		return { msRemaining: null, secondsRemaining: null, progress: null, expired: false, offsetMs: offset };
	}

	const msRemaining = Math.max(0, remaining);
	const totalMs = durationSeconds ? durationSeconds * 1000 : null;
	return {
		msRemaining,
		secondsRemaining: Math.ceil(msRemaining / 1000),
		progress: totalMs ? Math.min(1, Math.max(0, msRemaining / totalMs)) : null,
		expired: remaining <= 0,
		offsetMs: offset,
	};
}
