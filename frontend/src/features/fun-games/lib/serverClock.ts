// Estimates the offset between this device's clock and the server's so the UI
// can render server deadlines. It never produces deadlines of its own.

type Listener = () => void;

/** A device clock this far off from the current estimate is treated as a jump. */
const CLOCK_JUMP_MS = 2000;
/** Request samples within this much of the best round trip still refresh the offset. */
const RTT_TOLERANCE_MS = 100;

class ServerClock {
	private offsetMs = 0;
	private bestRttMs = Number.POSITIVE_INFINITY;
	private hasSample = false;
	private listeners = new Set<Listener>();

	/** serverTime ≈ Date.now() + offset */
	get offset(): number {
		return this.offsetMs;
	}

	now(): number {
		return Date.now() + this.offsetMs;
	}

	/** Milliseconds until `deadline` on the server's clock (negative once passed). */
	remainingMs(deadline: string | null | undefined): number | null {
		if (!deadline) return null;
		const at = Date.parse(deadline);
		return Number.isNaN(at) ? null : at - this.now();
	}

	/**
	 * Sample from a REST response. The round trip is known, so assume the server
	 * stamped the response half-way through and keep the tightest estimate.
	 */
	sampleRequest(serverTime: string, sentAt: number, receivedAt: number): void {
		const server = Date.parse(serverTime);
		if (Number.isNaN(server)) return;
		const rtt = Math.max(0, receivedAt - sentAt);
		const offset = server - (sentAt + rtt / 2);

		const jumped = this.hasSample && Math.abs(offset - this.offsetMs) > CLOCK_JUMP_MS;
		if (jumped) this.bestRttMs = Number.POSITIVE_INFINITY;
		if (rtt > this.bestRttMs + RTT_TOLERANCE_MS) return;

		this.bestRttMs = Math.min(this.bestRttMs, rtt);
		this.set(offset);
	}

	/**
	 * Sample from a pushed event. One-way latency is unknown, so it only seeds the
	 * estimate or corrects a device clock jump (sleep, manual change).
	 */
	sampleEvent(serverTime: string, receivedAt = Date.now()): void {
		const server = Date.parse(serverTime);
		if (Number.isNaN(server)) return;
		const offset = server - receivedAt;
		if (!this.hasSample || Math.abs(offset - this.offsetMs) > CLOCK_JUMP_MS) {
			this.bestRttMs = Number.POSITIVE_INFINITY;
			this.set(offset);
		}
	}

	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = (): number => this.offsetMs;

	private set(offset: number): void {
		this.hasSample = true;
		if (Math.round(offset) === Math.round(this.offsetMs)) return;
		this.offsetMs = offset;
		this.listeners.forEach((listener) => listener());
	}
}

export const serverClock = new ServerClock();
