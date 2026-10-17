"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { questParticipantApi } from "@/features/deck/api/participantApi";
import { toDeckApiError } from "@/features/deck/api/errors";
import { saveJoinDraft } from "@/features/deck/live/participantSession";
import { CodeInput } from "../components/CodeInput";
import { Notice } from "../components/Notice";
import { friendlyError } from "../lib/errors";
import { JOIN_CODE_LENGTH, PARTICIPANT_PRODUCT, rejectedCharactersHint, sanitizeJoinCode } from "../lib/joinCode";
import { AppShell, LoadingDots, PlayButton, markNavigation, pulse, useAnnounce } from "../shell";

// /play — step 1 of joining (plan §7.1): the 6-character code. Auto-submits
// at 6 characters: GET by-code, keep the lookup as a join draft (so the next
// step needs no second lookup) and go to /play/[code].

// A Map, not an object literal: ?reason= is user input, and a plain lookup
// would hand back Object.prototype members for "__proto__" / "constructor".
const REASONS = new Map<string, string>([
	["no-session", "We couldn't find your place in that session on this device. Enter the code to join again."],
	["expired", "Your place in that session has ended or expired. Enter a code to join a session."],
	["left", "You left the session. Enter a code to join again."],
	["ended", "That session has ended. Enter a code to join another one."],
]);

export interface JoinCodeScreenProps {
	initialCode?: string | null;
	reason?: string | null;
}

export function JoinCodeScreen(props: JoinCodeScreenProps) {
	return (
		<AppShell theme="default">
			<JoinCodeForm {...props} />
		</AppShell>
	);
}

function JoinCodeForm({ initialCode, reason }: JoinCodeScreenProps) {
	const router = useRouter();
	const announce = useAnnounce();
	const hintId = useId();
	const errorId = useId();
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [code, setCode] = useState(() => sanitizeJoinCode(initialCode ?? "").code);
	const [hint, setHint] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const reasonText = typeof reason === "string" ? (REASONS.get(reason) ?? null) : null;

	const lookup = useCallback(
		async (value: string) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setLoading(true);
			setError(null);
			try {
				const session = await questParticipantApi.lookupByCode(value, controller.signal);
				if (controller.signal.aborted) return;
				saveJoinDraft(PARTICIPANT_PRODUCT, {
					sessionId: session.session_id,
					joinCode: session.join_code || value,
					deckTitle: session.deck_title,
					publicChannelKey: session.public_channel_key,
				});
				pulse("success");
				announce(session.deck_title ? `Found ${session.deck_title}` : "Session found");
				markNavigation(1);
				router.push(`/play/${encodeURIComponent(value)}`);
			} catch (reasonError) {
				const deckError = toDeckApiError(reasonError);
				if (deckError.code === "cancelled" || controller.signal.aborted) return;
				const message = friendlyError(deckError, "lookup");
				setError(message);
				pulse("error");
				setLoading(false);
				// Keep the keyboard up so the code can be fixed straight away.
				requestAnimationFrame(() => inputRef.current?.focus());
			}
		},
		[announce, router]
	);

	useEffect(() => () => abortRef.current?.abort(), []);

	// A ?code= link (QR, legacy /join redirect) looks up at once.
	const autoLooked = useRef(false);
	useEffect(() => {
		if (autoLooked.current || code.length !== JOIN_CODE_LENGTH) return;
		autoLooked.current = true;
		void lookup(code);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const onChange = (next: string, rejected: string[]) => {
		setHint(rejectedCharactersHint(rejected));
		setError(null);
		const changed = next !== code;
		setCode(next);
		if (!changed) return;
		if (next.length === JOIN_CODE_LENGTH) void lookup(next);
		else {
			abortRef.current?.abort();
			setLoading(false);
		}
	};

	return (
		<div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6 pt-10">
			<div className="flex flex-col items-center text-center">
				{/* eslint-disable-next-line @next/next/no-img-element -- small static SVG logo */}
				<img src="/images/logo/logo.svg" alt="MindSpear" width={176} height={33} className="h-8 w-auto" />
				<h1 className="mt-10 text-[28px] font-bold leading-tight tracking-tight">Join a session</h1>
				<p id={hintId} className="mt-2 text-[15px] text-[var(--deck-text-muted)]">
					Enter the 6-character code shown on the host&apos;s screen.
				</p>
			</div>

			{reasonText && (
				<Notice className="mt-6" tone="info">
					{reasonText}
				</Notice>
			)}

			<form
				className="mt-8 flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (code.length === JOIN_CODE_LENGTH && !loading) void lookup(code);
				}}
			>
				<CodeInput
					ref={inputRef}
					value={code}
					onChange={onChange}
					invalid={!!error}
					describedBy={[hintId, error ? errorId : null].filter(Boolean).join(" ")}
					autoFocus
				/>

				<div className="min-h-6 text-center text-sm" aria-live="polite">
					{loading ? (
						<span className="inline-flex items-center gap-2 text-[var(--deck-text-muted)]">
							<LoadingDots label={null} size="sm" /> Looking for the session…
						</span>
					) : hint ? (
						<span className="text-[var(--deck-text-muted)]">{hint}</span>
					) : null}
				</div>

				{error && (
					<Notice tone="error" id={errorId}>
						{error}
					</Notice>
				)}

				<PlayButton type="submit" disabled={code.length !== JOIN_CODE_LENGTH} loading={loading} loadingLabel="Looking for the session">
					Join
				</PlayButton>
			</form>

			<p className="mt-auto pt-10 text-center text-xs text-[var(--deck-text-muted)]">
				No account or app download needed.
			</p>
		</div>
	);
}
