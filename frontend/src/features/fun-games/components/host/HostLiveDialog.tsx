"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Radio } from "lucide-react";
import { getHostApi, toFunGamesError } from "../../api";
import type { HostGameSummary } from "../../types";
import { btnPrimary, btnSecondary, inputClass, labelClass } from "../shared/hostStyles";

type HostLiveDialogProps = {
	game: HostGameSummary | null;
	onClose: () => void;
};

/** "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">. */
function localInputValue(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Opens a lobby for a game (publishing it first if needed): players can join
 * right away; the game starts when the host presses Start, or at the scheduled time.
 */
export function HostLiveDialog({ game, onClose }: HostLiveDialogProps) {
	const router = useRouter();
	const ref = useRef<HTMLDialogElement>(null);
	const [when, setWhen] = useState<"now" | "schedule">("now");
	const [startsAt, setStartsAt] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [issues, setIssues] = useState<string[]>([]);

	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		if (game && !dialog.open) {
			setWhen("now");
			setStartsAt(localInputValue(new Date(Date.now() + 10 * 60_000)));
			setError(null);
			setIssues([]);
			dialog.showModal();
		}
		if (!game && dialog.open) dialog.close();
	}, [game]);

	const submit = async () => {
		if (!game) return;
		setBusy(true);
		setError(null);
		setIssues([]);
		try {
			const api = await getHostApi();
			if (!game.published) await api.publishGame(game.id);
			let iso: string | null = null;
			if (when === "schedule") {
				const at = new Date(startsAt);
				if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
					setError("Pick a start time in the future.");
					setBusy(false);
					return;
				}
				iso = at.toISOString();
			}
			const session = await api.createSession(game.id, { startsAt: iso });
			router.push(`/fun-games/sessions/${session.id}`);
		} catch (reason) {
			const err = toFunGamesError(reason);
			setError(err.message);
			const found = err.details?.issues;
			if (Array.isArray(found)) setIssues(found.map(String));
			setBusy(false);
		}
	};

	return (
		<dialog
			ref={ref}
			onClose={onClose}
			aria-labelledby="fg-host-title"
			className="w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-stroke bg-white p-0 text-dark shadow-2xl backdrop:bg-dark/50 dark:border-stroke-dark dark:bg-gray-dark dark:text-white"
		>
			{game ? (
				<form
					method="dialog"
					className="p-6"
					onSubmit={(e) => {
						e.preventDefault();
						submit();
					}}
				>
					<h2 id="fg-host-title" className="flex items-center gap-2 text-lg font-bold">
						<Radio className="h-5 w-5 text-urgent" aria-hidden />
						Host “{game.title}” live
					</h2>
					<p className="mt-1 text-sm text-dark-5">
						A lobby opens with a QR code and join code. Players join with their name and email — no login.
					</p>
					{!game.published ? (
						<p className="mt-3 rounded-lg border border-blue-light-4 bg-blue-light-5 px-3 py-2 text-sm text-blue-dark">
							This game is a draft. It will be published first; that checks every question has a correct answer.
						</p>
					) : null}

					<fieldset className="mt-4 space-y-2">
						<legend className={labelClass}>When does it start?</legend>
						<label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stroke p-3 has-[:checked]:border-blue-dark has-[:checked]:bg-blue-light-5 dark:border-stroke-dark dark:has-[:checked]:bg-dark-2">
							<input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} className="mt-1" />
							<span>
								<span className="block text-sm font-semibold">Open the lobby now</span>
								<span className="block text-xs text-dark-5">You press Start when everyone has joined.</span>
							</span>
						</label>
						<label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stroke p-3 has-[:checked]:border-blue-dark has-[:checked]:bg-blue-light-5 dark:border-stroke-dark dark:has-[:checked]:bg-dark-2">
							<input
								type="radio"
								name="when"
								checked={when === "schedule"}
								onChange={() => setWhen("schedule")}
								className="mt-1"
							/>
							<span className="flex-1">
								<span className="block text-sm font-semibold">Start at a set time</span>
								<span className="block text-xs text-dark-5">The lobby opens now; the server starts the game on time.</span>
								{when === "schedule" ? (
									<input
										type="datetime-local"
										value={startsAt}
										onChange={(e) => setStartsAt(e.target.value)}
										aria-label="Start time"
										className={`${inputClass} mt-2`}
									/>
								) : null}
							</span>
						</label>
					</fieldset>

					{error ? (
						<div role="alert" className="mt-3 text-sm font-semibold text-red-dark">
							{error}
							{issues.length ? (
								<ul className="mt-1 list-disc pl-5 font-normal">
									{issues.map((issue) => (
										<li key={issue}>{issue}</li>
									))}
								</ul>
							) : null}
						</div>
					) : null}

					<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<button type="button" onClick={onClose} className={btnSecondary}>
							Cancel
						</button>
						<button type="submit" disabled={busy} className={btnPrimary}>
							{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
							{game.published ? "Open lobby" : "Publish and open lobby"}
						</button>
					</div>
				</form>
			) : null}
		</dialog>
	);
}
