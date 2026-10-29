"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Hourglass } from "lucide-react";
import { ParticipantShell, type ShellSessionStatus } from "./ParticipantShell";
import { getParticipantApi } from "../../api";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { useParticipantSession } from "../../hooks/useParticipantSession";
import { useServerCountdown } from "../../hooks/useServerCountdown";
import { formatCountdown } from "../../lib/format";
import { clearCredentials, loadCredentials } from "../../lib/participantStorage";
import type { ParticipantCredentials, SessionStatus } from "../../types";
import { ConnectionBanner } from "../shared/ConnectionBanner";
import { JoinForm } from "./JoinForm";
import { LobbyStage } from "./LobbyStage";
import { ResultsStage } from "./ResultsStage";
import { SequentialPlayer } from "./SequentialPlayer";
import { StageMessage } from "./StageMessage";

const SHELL_STATUS: Record<SessionStatus, ShellSessionStatus> = {
	waiting: "pending",
	live: "started",
	finishing: "started",
	finished: "ended",
};

/** After the player's last question: wait for the others, then results. */
function DoneStage({ finished, total, endsAt }: { finished: number; total: number; endsAt: string | null | undefined }) {
	const remaining = useServerCountdown(endsAt, 1000);
	return (
		<StageMessage
			title="You're done!"
			icon={<CheckCircle2 className="h-7 w-7" />}
			body={
				<>
					<span className="block">Your answers are in. Results appear here when the game ends.</span>
					<span className="mt-2 block font-semibold text-slate-800" aria-live="polite">
						<span className="font-mono tabular-nums">{finished}</span> of{" "}
						<span className="font-mono tabular-nums">{total}</span> players finished
					</span>
					{remaining != null && remaining > 0 ? (
						<span className="mt-1 block text-sm">
							The game closes in at most{" "}
							<span className="font-mono font-semibold tabular-nums" role="timer">
								{formatCountdown(remaining)}
							</span>
							.
						</span>
					) : null}
				</>
			}
		/>
	);
}

/** A joined player: follows the server's session state through every stage. */
function JoinedGame({
	credentials,
	onSignedOut,
	onLeave,
}: {
	credentials: ParticipantCredentials;
	onSignedOut: (notice: string) => void;
	onLeave: () => void;
}) {
	const session = useParticipantSession(credentials);
	const { data: state, error, reload } = session;
	const [doneHere, setDoneHere] = useState(false);
	const onFinished = useCallback(() => {
		setDoneHere(true);
		reload();
	}, [reload]);

	useEffect(() => {
		if (error?.code === "unauthorized") {
			onSignedOut("Your place in this game expired on this device. Join again with the same email to continue.");
		}
	}, [error, onSignedOut]);

	const name = state?.participantName ?? credentials.name;
	let body: React.ReactNode;

	if (!state) {
		body =
			error && error.code !== "unauthorized" ? (
				<StageMessage
					tone="error"
					title={error.code === "notFound" ? "This game no longer exists" : "Couldn't load the game"}
					body={error.message}
					action={error.code === "notFound" ? undefined : { label: "Try again", onClick: session.reload }}
				/>
			) : (
				<StageMessage busy title="Loading the game…" />
			);
	} else if (state.status === "waiting") {
		body = <LobbyStage state={state} name={name} onLeave={onLeave} />;
	} else if (state.status === "live" && (doneHere || state.participation === "submitted")) {
		body = <DoneStage finished={state.finishedCount} total={state.participantCount} endsAt={state.endsAt} />;
	} else if (state.status === "live") {
		body = <SequentialPlayer auth={session.auth} timerMode={state.quiz.timer.mode} onFinished={onFinished} />;
	} else if (state.status === "finishing") {
		body = (
			<StageMessage
				busy
				title="Time's up"
				icon={<Hourglass className="h-7 w-7" />}
				body="The game has ended. Scoring answers now — your marks appear here in a moment."
			/>
		);
	} else {
		body = <ResultsStage auth={session.auth} state={state} />;
	}

	return (
		<ParticipantShell
			variant="quiz"
			label="Fun Games"
			title={state?.quiz.title ?? null}
			participantName={name}
			sessionStatus={state ? SHELL_STATUS[state.status] : "pending"}
		>
			{state?.status !== "finished" ? (
				<ConnectionBanner
					connection={session.connection}
					failure={session.failure}
					requestFailed={!!error?.isRetryable && !!state}
				/>
			) : null}
			{body}
		</ParticipantShell>
	);
}

/**
 * Public page behind the QR code: /attempt/fun-games/[joinCode].
 * No login: join with name and email; the device remembers the player.
 */
export function FunGamePlay({ joinCode }: { joinCode: string }) {
	// undefined: not read yet (avoids a server/client mismatch); null: not joined.
	const [credentials, setCredentials] = useState<ParticipantCredentials | null | undefined>(undefined);
	const [notice, setNotice] = useState<string | null>(null);

	useEffect(() => {
		setCredentials(loadCredentials(joinCode));
	}, [joinCode]);

	const lookup = useAsyncResource(
		async (signal) => (await getParticipantApi()).lookup(joinCode, { signal }),
		[joinCode],
		{ enabled: credentials === null },
	);

	const signOut = useCallback(
		(message: string | null) => {
			clearCredentials(joinCode);
			setNotice(message);
			setCredentials(null);
		},
		[joinCode],
	);
	const onSignedOut = useCallback((message: string) => signOut(message), [signOut]);
	const onLeave = useCallback(() => signOut(null), [signOut]);

	if (credentials) {
		return <JoinedGame credentials={credentials} onSignedOut={onSignedOut} onLeave={onLeave} />;
	}

	let body: React.ReactNode;
	if (credentials === undefined || lookup.loading) {
		body = <StageMessage busy title="Finding the game…" />;
	} else if (lookup.error || !lookup.data) {
		body = (
			<StageMessage
				tone="error"
				title={lookup.error?.code === "notFound" ? "Game not found" : "Couldn't open the game"}
				body={
					lookup.error?.code === "notFound"
						? `There's no game with the code ${joinCode.toUpperCase()}. Check the code or scan the QR again.`
						: lookup.error?.message
				}
				action={lookup.error?.code === "notFound" ? undefined : { label: "Try again", onClick: lookup.reload }}
			/>
		);
	} else if (lookup.data.session.status === "live" && lookup.data.session.joinOpen === false) {
		body = (
			<JoinForm
				joinCode={joinCode}
				lookup={lookup.data}
				notice={
					notice ??
					"This game started more than two minutes ago, so new players can't join. If you already joined, enter the same name and email to continue."
				}
				onJoined={setCredentials}
				rejoinOnly
			/>
		);
	} else if (lookup.data.session.status === "finishing" || lookup.data.session.status === "finished") {
		body = (
			<StageMessage
				title="This game has ended"
				icon={<CheckCircle2 className="h-7 w-7" />}
				body="It's no longer open for new players. If you played on this device, your results show here automatically."
			/>
		);
	} else {
		body = <JoinForm joinCode={joinCode} lookup={lookup.data} notice={notice} onJoined={setCredentials} />;
	}

	return (
		<ParticipantShell
			variant="quiz"
			label="Fun Games"
			title={lookup.data?.game.title ?? null}
			sessionStatus={lookup.data ? SHELL_STATUS[lookup.data.session.status] : "pending"}
			rightSlot={<span className="hidden" />}
		>
			{body}
		</ParticipantShell>
	);
}
