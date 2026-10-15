"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Pencil } from "lucide-react";
import { questParticipantApi } from "@/features/deck/api/participantApi";
import { toDeckApiError } from "@/features/deck/api/errors";
import { emojiLabel, useEmojiAvatars } from "@/features/deck/api/metaApi";
import {
	clearJoinDraft,
	loadRememberedIdentity,
	saveParticipantSession,
	saveRememberedIdentity,
} from "@/features/deck/live/participantSession";
import { EmojiGrid } from "../components/EmojiGrid";
import { JoinStepStatus } from "../components/JoinStepStatus";
import { Notice } from "../components/Notice";
import { friendlyError } from "../lib/errors";
import { PARTICIPANT_PRODUCT } from "../lib/joinCode";
import { useJoinDraft, type JoinDraftResult } from "../lib/useJoinDraft";
import { markInstallEligible } from "../pwa/installPrompt";
import { AppShell, LoadingDots, PlayButton, SheetModal, TapFeedback, TopBar, pulse, useAnnounce } from "../shell";

// /play/[code]/avatar — step 3 (plan §4.5 / §7.1): pick an emoji in a bottom
// sheet (opens by itself), then join: POST .../participants/join, store the
// token (saveParticipantSession) and replace this page with the live screen
// so Back never lands on a finished join step.

type JoinFailure = { message: string; kind: "name" | "emoji" | "gone" | "other" };

export function AvatarScreen({ code }: { code: string }) {
	const router = useRouter();
	const join = useJoinDraft(code);
	const needsName = join.status === "ready" && !join.draft?.displayName;

	useEffect(() => {
		if (needsName) router.replace(`/play/${encodeURIComponent(join.code)}`);
	}, [needsName, join.code, router]);

	return (
		<AppShell
			theme="default"
			topBar={
				<TopBar
					title="Pick an avatar"
					subtitle={join.draft?.deckTitle ?? undefined}
					onBack={() => router.push(`/play/${encodeURIComponent(join.code)}`)}
					backLabel="Back to your name"
				/>
			}
		>
			{join.status === "ready" && join.draft?.displayName ? (
				<AvatarForm join={join} />
			) : needsName ? (
				<div className="flex flex-1 items-center justify-center text-[var(--deck-text-muted)]">
					<LoadingDots size="lg" />
				</div>
			) : (
				<JoinStepStatus join={join} />
			)}
		</AppShell>
	);
}

function AvatarForm({ join }: { join: JoinDraftResult }) {
	const router = useRouter();
	const announce = useAnnounce();
	const reduceMotion = useReducedMotion();
	const gridLabelId = useId();
	const draft = join.draft!;
	const { meta, loading: emojisLoading, error: emojiError, reload } = useEmojiAvatars();
	const [emoji, setEmoji] = useState<string | null>(draft.emojiAvatar ?? null);
	const [sheetOpen, setSheetOpen] = useState(true);
	const [joining, setJoining] = useState(false);
	const [failure, setFailure] = useState<JoinFailure | null>(null);

	// Default pick once the list is known: last time's emoji, else a random one.
	useEffect(() => {
		if (!meta || meta.emojis.length === 0) return;
		if (emoji && meta.emojis.includes(emoji)) return;
		const remembered = loadRememberedIdentity()?.emojiAvatar;
		setEmoji(
			remembered && meta.emojis.includes(remembered)
				? remembered
				: meta.emojis[Math.floor(Math.random() * meta.emojis.length)]
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [meta]);

	const choose = (next: string) => {
		setEmoji(next);
		setFailure((current) => (current?.kind === "emoji" ? null : current));
		join.update({ emojiAvatar: next });
	};

	const submit = async () => {
		if (!emoji || joining) return;
		setJoining(true);
		setFailure(null);
		try {
			const result = await questParticipantApi.join(draft.sessionId, {
				join_code: draft.joinCode,
				display_name: draft.displayName!,
				emoji_avatar: emoji,
			});
			saveParticipantSession(PARTICIPANT_PRODUCT, result, { joinCode: draft.joinCode, deckTitle: draft.deckTitle });
			saveRememberedIdentity({ displayName: draft.displayName!, emojiAvatar: emoji });
			clearJoinDraft(PARTICIPANT_PRODUCT, draft.joinCode);
			markInstallEligible();
			pulse("success");
			announce("You're in!");
			setSheetOpen(false);
			router.replace(`/play/live/${encodeURIComponent(result.public_channel_key)}`);
		} catch (reason) {
			const error = toDeckApiError(reason);
			const message = friendlyError(error, "join");
			const kind: JoinFailure["kind"] = error.fieldError("display_name")
				? "name"
				: error.fieldError("emoji_avatar")
					? "emoji"
					: error.status === 404 || error.status === 403
						? "gone"
						: "other";
			setFailure({ message, kind });
			pulse("warning");
			setJoining(false);
			if (kind === "emoji") {
				reload();
				setSheetOpen(true);
			} else {
				setSheetOpen(false);
			}
		}
	};

	const label = meta && emoji ? emojiLabel(meta, emoji) : "No avatar picked";

	const preview = (size: "lg" | "md") => (
		<motion.span
			key={emoji ?? "none"}
			initial={reduceMotion ? false : { scale: 0.6, opacity: 0.4 }}
			animate={{ scale: 1, opacity: 1 }}
			transition={{ type: "spring", stiffness: 520, damping: 24 }}
			className={
				size === "lg"
					? "flex h-36 w-36 items-center justify-center rounded-full border-4 border-[var(--deck-primary)] bg-[var(--deck-surface)] text-[80px] leading-none shadow-sm"
					: "flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-[var(--deck-primary)] bg-[var(--deck-bg)] text-[44px] leading-none"
			}
			role="img"
			aria-label={label}
		>
			{emoji ?? ""}
		</motion.span>
	);

	const failureAction =
		failure?.kind === "name" ? (
			<PlayButton variant="secondary" size="md" onClick={() => router.push(`/play/${encodeURIComponent(join.code)}`)}>
				Change name
			</PlayButton>
		) : failure?.kind === "gone" ? (
			<PlayButton variant="secondary" size="md" onClick={() => router.replace("/play")}>
				Enter a different code
			</PlayButton>
		) : null;

	return (
		<div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-5 pb-6 pt-10 text-center">
			<TapFeedback
				onClick={() => setSheetOpen(true)}
				aria-label={`Avatar: ${label}. Change avatar`}
				className="relative rounded-full"
				pressScale={0.95}
			>
				{preview("lg")}
				<span className="absolute bottom-1 right-1 flex h-11 w-11 items-center justify-center rounded-full border-2 border-[var(--deck-bg)] bg-[var(--deck-primary)] text-[var(--deck-on-primary)]">
					<Pencil className="h-4 w-4" aria-hidden />
				</span>
			</TapFeedback>
			<p className="mt-5 text-2xl font-bold tracking-tight">{draft.displayName}</p>
			{draft.deckTitle && <p className="mt-1 text-[15px] text-[var(--deck-text-muted)]">{draft.deckTitle}</p>}

			<div className="mt-8 flex w-full flex-col gap-3">
				{failure && (
					<Notice tone="error" action={failureAction} className="text-left">
						{failure.message}
					</Notice>
				)}
				<PlayButton onClick={() => void submit()} disabled={!emoji} loading={joining} loadingLabel="Joining">
					Join session
				</PlayButton>
				<PlayButton variant="ghost" onClick={() => setSheetOpen(true)}>
					Change avatar
				</PlayButton>
			</div>

			<SheetModal
				open={sheetOpen}
				onClose={() => setSheetOpen(false)}
				title={<span id={gridLabelId}>Pick your avatar</span>}
				description="Your emoji is how others see you in this session."
				header={<div className="flex justify-center pb-3 pt-1">{preview("md")}</div>}
				footer={
					<PlayButton onClick={() => void submit()} disabled={!emoji} loading={joining} loadingLabel="Joining">
						Done
					</PlayButton>
				}
			>
				{failure?.kind === "emoji" && (
					<Notice tone="error" className="mb-3 text-left">
						{failure.message}
					</Notice>
				)}
				{meta && meta.emojis.length > 0 ? (
					<EmojiGrid meta={meta} value={emoji} onChange={choose} labelledBy={gridLabelId} />
				) : emojisLoading ? (
					<div className="flex justify-center py-10 text-[var(--deck-text-muted)]">
						<LoadingDots size="lg" label="Loading avatars" />
					</div>
				) : (
					<Notice
						tone="error"
						className="text-left"
						action={
							<PlayButton variant="secondary" size="md" onClick={reload}>
								Try again
							</PlayButton>
						}
					>
						{emojiError ? friendlyError(emojiError, "state") : "Avatars couldn't be loaded."}
					</Notice>
				)}
			</SheetModal>
		</div>
	);
}
