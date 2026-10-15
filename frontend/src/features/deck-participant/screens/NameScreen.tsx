"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserRound } from "lucide-react";
import { loadRememberedIdentity } from "@/features/deck/live/participantSession";
import { JoinStepStatus } from "../components/JoinStepStatus";
import { Notice } from "../components/Notice";
import { useJoinDraft } from "../lib/useJoinDraft";
import { AppShell, KeyboardAwareView, PlayButton, TopBar } from "../shell";

// /play/[code] — step 2 (plan §7.1): the display name, 1..40 characters
// (counted like the backend's mb_strlen: code points). Prefilled from the
// name used last time on this device. Stored in the join draft; the join
// itself happens after the emoji step.

export const NAME_MAX = 40;

const length = (value: string) => [...value].length;

export function NameScreen({ code }: { code: string }) {
	const router = useRouter();
	const join = useJoinDraft(code);

	return (
		<AppShell
			theme="default"
			topBar={
				<TopBar
					title="Your name"
					subtitle={join.draft?.deckTitle ?? undefined}
					onBack={() => router.push("/play")}
					backLabel="Back to the code"
				/>
			}
		>
			{join.status === "ready" && join.draft ? <NameForm join={join} /> : <JoinStepStatus join={join} />}
		</AppShell>
	);
}

function NameForm({ join }: { join: ReturnType<typeof useJoinDraft> }) {
	const router = useRouter();
	const inputId = useId();
	const counterId = useId();
	const errorId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const draft = join.draft!;
	const [name, setName] = useState(() => draft.displayName ?? "");
	const [error, setError] = useState<string | null>(null);

	// Prefill from the last join on this device (after mount: localStorage).
	useEffect(() => {
		if (draft.displayName) return;
		const remembered = loadRememberedIdentity();
		if (remembered?.displayName) setName(remembered.displayName);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const trimmed = name.trim();
	const count = length(trimmed);
	const tooLong = count > NAME_MAX;

	const submit = () => {
		if (count === 0) {
			setError("Please enter your name.");
			inputRef.current?.focus();
			return;
		}
		if (tooLong) {
			setError(`Names can be up to ${NAME_MAX} characters.`);
			inputRef.current?.focus();
			return;
		}
		join.update({ displayName: trimmed });
		router.push(`/play/${encodeURIComponent(join.code)}/avatar`);
	};

	return (
		<KeyboardAwareView className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6 pt-8">
			{join.existing && (
				<Notice
					className="mb-6"
					action={
						<PlayButton
							variant="secondary"
							size="md"
							onClick={() => router.replace(`/play/live/${encodeURIComponent(join.existing!.publicChannelKey)}`)}
						>
							Continue as {join.existing.emojiAvatar} {join.existing.displayName}
						</PlayButton>
					}
				>
					You&apos;re already in this session on this device.
				</Notice>
			)}

			<div className="flex flex-col items-center text-center">
				<span className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--deck-surface-muted)] text-[var(--deck-text-muted)]">
					<UserRound className="h-9 w-9" aria-hidden />
				</span>
				<h2 className="mt-5 text-2xl font-bold tracking-tight">What should we call you?</h2>
				{draft.deckTitle && (
					<p className="mt-1 text-[15px] text-[var(--deck-text-muted)]">
						Joining <span className="font-medium text-[var(--deck-text)]">{draft.deckTitle}</span>
					</p>
				)}
			</div>

			<form
				className="mt-8 flex flex-col gap-3"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<label htmlFor={inputId} className="text-sm font-medium">
					Display name
				</label>
				<input
					ref={inputRef}
					id={inputId}
					value={name}
					onChange={(event) => {
						setName(event.target.value);
						setError(null);
					}}
					autoFocus
					autoComplete="nickname"
					autoCapitalize="words"
					enterKeyHint="next"
					maxLength={80}
					placeholder="e.g. Alex"
					aria-invalid={!!error || tooLong || undefined}
					aria-describedby={[counterId, error ? errorId : null].filter(Boolean).join(" ")}
					className="h-14 w-full rounded-2xl border-2 border-[var(--deck-border)] bg-[var(--deck-surface)] px-4 text-lg font-medium text-[var(--deck-text)] outline-none placeholder:text-[var(--deck-text-muted)] placeholder:opacity-70 focus:border-[var(--deck-primary)] aria-[invalid=true]:border-[var(--deck-danger)]"
				/>
				<p
					id={counterId}
					className={`text-right text-xs ${tooLong ? "text-[var(--deck-danger)]" : "text-[var(--deck-text-muted)]"}`}
				>
					{count} / {NAME_MAX}
				</p>
				{error && (
					<Notice tone="error" id={errorId}>
						{error}
					</Notice>
				)}
				<PlayButton type="submit" className="mt-2" disabled={count === 0 || tooLong}>
					Continue
				</PlayButton>
			</form>
		</KeyboardAwareView>
	);
}
