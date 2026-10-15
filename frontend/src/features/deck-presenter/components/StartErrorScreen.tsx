"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, ImageOff, Lock, RefreshCw } from "lucide-react";
import type { DeckApiError } from "@/features/deck/api/errors";
import type { Deck } from "@/features/deck/types";
import { getSlideType } from "@/features/deck-editor/slideRegistry";

// Why a session could not start, with a way out:
// - 403 feature_disabled: Quest v2 is off for this account;
// - 422 slides.{pos}.media*: a slide (pin on image) needs an image;
// - 422 unsupported_type / slides.{pos}.type: a slide type this product lacks;
// - 409 conflict without session_id: the deck has no slides;
// - 404: not this user's deck; anything else: retry.

interface SlideProblem {
	position: number;
	messages: string[];
	slideId: number | null;
	title: string;
}

/** Group 422 keys `slides.{position}.*` by slide, with the deck's titles when known. */
function slideProblems(error: DeckApiError, deck: Deck | null): SlideProblem[] {
	const byPosition = new Map<number, string[]>();
	for (const [key, messages] of Object.entries(error.validationErrors)) {
		const match = /^slides\.(\d+)\./.exec(key);
		if (!match) continue;
		const position = Number(match[1]);
		byPosition.set(position, [...(byPosition.get(position) ?? []), ...messages]);
	}
	if (typeof error.data.position === "number" && !byPosition.size) byPosition.set(error.data.position, [error.message]);

	return [...byPosition.entries()]
		.sort(([a], [b]) => a - b)
		.map(([position, messages]) => {
			const slide = deck?.slides.find((s) => s.position === position) ?? null;
			const typeLabel = slide ? (getSlideType(slide.type)?.label ?? slide.type) : null;
			return {
				position,
				// "Slide 3: Pin on image slides need…" → keep unique messages, the first is the summary.
				messages: [...new Set(messages)],
				slideId: slide?.id ?? null,
				title: slide?.title?.trim() || typeLabel || `Slide ${position}`,
			};
		});
}

export interface StartErrorScreenProps {
	deckId: number;
	deck: Deck | null;
	error: DeckApiError;
	onRetry: () => void;
}

export function StartErrorScreen({ deckId, deck, error, onRetry }: StartErrorScreenProps) {
	const editorHref = `/quests/${deckId}/edit`;
	const problems = error.status === 422 ? slideProblems(error, deck) : [];
	const mediaMissing = problems.length > 0 && Object.keys(error.validationErrors).some((key) => /\.media/.test(key));

	let Icon = AlertTriangle;
	let title = "The session couldn't start";
	let message: string = error.message;
	let canRetry = false;
	let showEditor = true;

	if (error.code === "feature_disabled") {
		Icon = Lock;
		title = "Quest v2 isn't enabled for your account";
		showEditor = false;
	} else if (mediaMissing) {
		Icon = ImageOff;
		title = problems.length === 1 ? "One slide needs an image" : "Some slides need an image";
		message = "Add the image in the editor, then start presenting again.";
	} else if (problems.length > 0) {
		title = "Some slides can't be presented";
		message = "Fix or remove them in the editor, then start presenting again.";
	} else if (error.status === 409) {
		title = "Nothing to present yet";
	} else if (error.status === 404) {
		title = "Quest not found";
		message = "It may have been deleted, or it belongs to another account.";
		showEditor = false;
	} else {
		canRetry = true;
	}

	return (
		<main className="flex h-full w-full items-center justify-center overflow-y-auto bg-gray-2 p-6 text-dark dark:bg-dark dark:text-white">
			<div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-lg dark:bg-dark-2">
				<Icon className="h-10 w-10 text-primary" aria-hidden />
				<h1 className="mt-4 text-2xl font-bold">{title}</h1>
				<p className="mt-2 text-base text-dark-4 dark:text-dark-7" role="alert">
					{message}
				</p>

				{problems.length > 0 && (
					<ul className="mt-5 flex flex-col gap-2">
						{problems.map((problem) => (
							<li key={problem.position} className="rounded-xl border border-stroke p-4 dark:border-stroke-dark">
								<p className="font-semibold">
									Slide {problem.position} · {problem.title}
								</p>
								{problem.messages.map((text, index) => (
									<p key={index} className="mt-1 text-sm text-dark-4 dark:text-dark-7">
										{text.replace(/^Slide \d+:\s*/, "")}
									</p>
								))}
								<Link
									href={problem.slideId ? `${editorHref}?slide=${problem.slideId}` : editorHref}
									className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-dark underline decoration-primary decoration-2 underline-offset-4 hover:decoration-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-white"
								>
									Open slide {problem.position} in the editor
								</Link>
							</li>
						))}
					</ul>
				)}

				<div className="mt-6 flex flex-wrap gap-3">
					{canRetry && (
						<button
							type="button"
							onClick={onRetry}
							className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-dark hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
						>
							<RefreshCw className="h-5 w-5" aria-hidden /> Try again
						</button>
					)}
					{showEditor && (
						<Link
							href={editorHref}
							className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-stroke px-5 font-semibold hover:bg-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-stroke-dark dark:hover:bg-dark-3"
						>
							<ArrowLeft className="h-5 w-5" aria-hidden /> Back to the editor
						</Link>
					)}
					<Link
						href="/my-library/quest-page"
						className="inline-flex min-h-12 items-center rounded-xl px-5 font-semibold text-dark-4 hover:bg-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-dark-7 dark:hover:bg-dark-3"
					>
						My Library
					</Link>
				</div>
			</div>
		</main>
	);
}

/** Full-screen "starting…" state. */
export function StartingScreen({ title }: { title?: string | null }) {
	return (
		<main className="flex h-full w-full flex-col items-center justify-center gap-4 bg-dark text-white" aria-busy="true">
			<span
				className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-primary motion-reduce:animate-none"
				aria-hidden
			/>
			<p className="text-xl font-semibold" role="status">
				{title ? `Starting “${title}”…` : "Starting the session…"}
			</p>
		</main>
	);
}
