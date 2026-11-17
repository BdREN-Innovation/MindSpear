"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Clock3, ListChecks, Loader2, Mail, Play, UserRound, Users } from "lucide-react";
import { ParticipantStage } from "./ParticipantStage";
import { getParticipantApi, toFunGamesError, type FunGamesApiError } from "../../api";
import { describeTimer } from "../../lib/format";
import { loadLastIdentity, saveCredentials, saveLastIdentity } from "../../lib/participantStorage";
import type { JoinLookup, ParticipantCredentials } from "../../types";

type JoinFormProps = {
	joinCode: string;
	lookup: JoinLookup;
	/** Shown above the form, e.g. after a token expired. */
	notice?: string | null;
	onJoined: (credentials: ParticipantCredentials) => void;
	/** Joining has closed; only players who already joined can continue. */
	rejoinOnly?: boolean;
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** No login: players join with a name and an email address. */
export function JoinForm({ joinCode, lookup, notice, onJoined, rejoinOnly }: JoinFormProps) {
	const nameId = useId();
	const emailId = useId();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [touched, setTouched] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<FunGamesApiError | null>(null);

	useEffect(() => {
		const last = loadLastIdentity();
		if (last) {
			setName(last.name);
			setEmail(last.email);
		}
	}, []);

	const nameError = !name.trim() ? "Enter your name." : name.trim().length > 60 ? "Use at most 60 characters." : null;
	const emailError = !email.trim()
		? "Enter your email address."
		: !EMAIL_PATTERN.test(email.trim())
			? "Enter a valid email address, like name@example.com."
			: null;
	const shownNameError = (touched && nameError) || error?.field("name");
	const shownEmailError = (touched && emailError) || error?.field("email");

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setTouched(true);
		setError(null);
		if (nameError || emailError) return;
		setSubmitting(true);
		try {
			const api = await getParticipantApi();
			const result = await api.join(joinCode, { name: name.trim(), email: email.trim() });
			const credentials: ParticipantCredentials = {
				sessionId: result.session.id,
				joinCode: result.session.joinCode,
				participantId: result.participantId,
				token: result.participantToken,
				publicChannelKey: result.publicChannelKey,
				name: result.session.participantName ?? name.trim(),
				email: email.trim().toLowerCase(),
			};
			saveCredentials(credentials);
			saveLastIdentity(name.trim(), email.trim());
			onJoined(credentials);
		} catch (reason) {
			setError(toFunGamesError(reason));
			setSubmitting(false);
		}
	};

	const { game, session } = lookup;
	const formError = error && !error.fields ? error.message : null;

	return (
		<ParticipantStage size="narrow" className="justify-center px-4 py-6 sm:px-8">
			<form onSubmit={submit} noValidate className="mx-auto w-full max-w-lg">
				<div className="text-center">
					<div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
						<Play className="h-8 w-8 fill-primary text-primary" aria-hidden />
					</div>
					<p className="mt-4 inline-flex rounded-full border border-secondary/20 bg-secondary/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-secondary">
						Fun Games · <span className="ml-1 font-mono">{session.joinCode}</span>
					</p>
					<h1 className="mt-3 break-words text-3xl font-black text-slate-950 sm:text-4xl">{game.title}</h1>
					{game.description ? (
						<p className="mt-2 text-sm font-medium text-slate-600">{game.description}</p>
					) : null}
				</div>

				<dl className="mt-6 grid grid-cols-3 gap-2 text-center">
					<div className="rounded-lg border border-primary/20 bg-primary/10 p-2">
						<dt className="flex items-center justify-center gap-1 text-[11px] font-bold uppercase text-primary-dark">
							<Clock3 className="h-3.5 w-3.5" aria-hidden />
							Timer
						</dt>
						<dd className="mt-1 text-xs font-black text-slate-950 sm:text-sm">{describeTimer(game.timer)}</dd>
					</div>
					<div className="rounded-lg border border-secondary/20 bg-secondary/10 p-2">
						<dt className="flex items-center justify-center gap-1 text-[11px] font-bold uppercase text-secondary-dark">
							<ListChecks className="h-3.5 w-3.5" aria-hidden />
							Questions
						</dt>
						<dd className="mt-1 font-mono text-sm font-black tabular-nums text-slate-950">{game.questionCount}</dd>
					</div>
					<div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
						<dt className="flex items-center justify-center gap-1 text-[11px] font-bold uppercase text-slate-600">
							<Users className="h-3.5 w-3.5" aria-hidden />
							Joined
						</dt>
						<dd className="mt-1 font-mono text-sm font-black tabular-nums text-slate-950">{session.participantCount}</dd>
					</div>
				</dl>

				{notice ? (
					<p role="status" className="mt-5 rounded-lg border border-urgent/30 bg-urgent-bg px-3 py-2 text-sm font-semibold text-urgent-text">
						{notice}
					</p>
				) : null}

				<div className="mt-6 space-y-4">
					<div>
						<label htmlFor={nameId} className="mb-1.5 flex items-center gap-2 text-sm font-black text-slate-800">
							<UserRound className="h-4 w-4 text-primary" aria-hidden />
							Your name
						</label>
						<input
							id={nameId}
							value={name}
							onChange={(e) => setName(e.target.value)}
							onBlur={() => setTouched(true)}
							autoComplete="name"
							maxLength={60}
							required
							aria-invalid={!!shownNameError}
							aria-describedby={shownNameError ? `${nameId}-error` : undefined}
							placeholder="Shown on the leaderboard"
							className="h-12 w-full rounded-lg border border-slate-300 bg-white px-4 text-base font-semibold text-slate-950 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/15 aria-[invalid=true]:border-red-dark"
						/>
						{shownNameError ? (
							<p id={`${nameId}-error`} className="mt-1 text-sm font-semibold text-red-dark">
								{shownNameError}
							</p>
						) : null}
					</div>
					<div>
						<label htmlFor={emailId} className="mb-1.5 flex items-center gap-2 text-sm font-black text-slate-800">
							<Mail className="h-4 w-4 text-primary" aria-hidden />
							Email
						</label>
						<input
							id={emailId}
							type="email"
							inputMode="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							onBlur={() => setTouched(true)}
							autoComplete="email"
							maxLength={190}
							required
							aria-invalid={!!shownEmailError}
							aria-describedby={`${emailId}-hint${shownEmailError ? ` ${emailId}-error` : ""}`}
							placeholder="name@example.com"
							className="h-12 w-full rounded-lg border border-slate-300 bg-white px-4 text-base font-semibold text-slate-950 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/15 aria-[invalid=true]:border-red-dark"
						/>
						{shownEmailError ? (
							<p id={`${emailId}-error`} className="mt-1 text-sm font-semibold text-red-dark">
								{shownEmailError}
							</p>
						) : null}
						<p id={`${emailId}-hint`} className="mt-1 text-xs text-slate-500">
							Only the host sees your email. Use the same one to continue on another device.
						</p>
					</div>
				</div>

				{formError ? (
					<p role="alert" className="mt-4 rounded-lg border border-red-light-3 bg-red-light-5 px-3 py-2 text-sm font-semibold text-red-dark">
						{formError}
					</p>
				) : null}

				<button
					type="submit"
					disabled={submitting}
					className="group relative mt-5 inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-gradient-to-r from-primary via-secondary to-accent px-6 text-base font-bold text-white shadow-lg shadow-primary/25 transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Play className="h-5 w-5 fill-white" aria-hidden />}
					{submitting ? "Joining…" : rejoinOnly ? "Continue" : session.status === "live" ? "Join and play" : "Join the game"}
				</button>
			</form>
		</ParticipantStage>
	);
}
