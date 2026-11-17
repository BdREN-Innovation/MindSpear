/* eslint-disable @next/next/no-img-element -- My Files URLs on arbitrary hosts; the box must match the image's own aspect. */
"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ImageOff, X } from "lucide-react";
import type { PinOnImageAggregate, Point, RunMedia } from "@/features/deck/types";
import { cn } from "@/lib/utils";
import type { ParticipantProps } from "../types";
import { haptic, SubmitBar, SubmittedState } from "../shared";
import { useAnswer } from "../shared/answer";
import { displayTitle } from "../shared/labels";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, ResultsSection, countLabel, isReadOnlyView, notVotingMessage, resultsTitle } from "../shared/participantKit";
import { clampPercent, describePoint, isPoint, pointKeys, roundPercent } from "../shared/pointMath";

// pin_on_image participant (plan §7.3): full-width image, tap to drop
// pulsing pins (up to max_pins_per_participant), tap a pin to remove it,
// Submit. Coordinates are percentages of the image, origin top-left, 2 dp
// (exactly what PinOnImageSlideType validates). Keyboard: arrows move a
// crosshair, Enter / Space drops a pin, Backspace removes the last one.
// Public results (aggregate passed) show everyone's pins in every view.

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

function storedPins(value: unknown): Point[] {
	const pins = (value as { pins?: unknown } | null)?.pins;
	if (Array.isArray(pins)) return pins.filter(isPoint);
	return isPoint(value) ? [value] : [];
}

function imageAspect(media: RunMedia | null): number {
	return media?.width && media?.height ? media.width / media.height : 4 / 3;
}

interface PinBoardProps {
	media: RunMedia | null;
	pins: Point[];
	/** Other participants' pins (public results), drawn faintly. */
	otherPins?: Point[];
	interactive?: boolean;
	cursor?: Point | null;
	onPlace?: (point: Point) => void;
	onRemove?: (index: number) => void;
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	onPointerDown?: () => void;
	label?: string;
	describedBy?: string;
	compact?: boolean;
}

function PinBoard({
	media,
	pins,
	otherPins,
	interactive = false,
	cursor,
	onPlace,
	onRemove,
	onKeyDown,
	onPointerDown,
	label,
	describedBy,
	compact = false,
}: PinBoardProps) {
	const ref = useRef<HTMLDivElement>(null);
	const aspect = imageAspect(media);
	const keys = useMemo(() => pointKeys(pins), [pins]);

	const handleClick = (event: MouseEvent<HTMLDivElement>) => {
		if (!interactive || !onPlace || !ref.current) return;
		const rect = ref.current.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		onPlace({
			x: roundPercent(((event.clientX - rect.left) / rect.width) * 100),
			y: roundPercent(((event.clientY - rect.top) / rect.height) * 100),
		});
	};

	return (
		<div
			ref={ref}
			role={interactive ? "application" : "img"}
			aria-roledescription={interactive ? "pin board" : undefined}
			aria-label={label}
			aria-describedby={describedBy}
			tabIndex={interactive ? 0 : undefined}
			onClick={handleClick}
			onKeyDown={interactive ? onKeyDown : undefined}
			onPointerDown={interactive ? onPointerDown : undefined}
			className={cn(
				"relative mx-auto touch-manipulation select-none overflow-hidden rounded-xl",
				interactive && "cursor-crosshair",
				FOCUS_RING
			)}
			style={{
				width: `min(100%, calc(${compact ? 40 : 62}vh * ${aspect}))`,
				aspectRatio: `${aspect}`,
				background: "var(--deck-surface-muted, #F3F4F6)",
				WebkitTouchCallout: "none",
			}}
		>
			{media ? (
				<img src={media.url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-fill" />
			) : (
				<span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					<ImageOff className="h-8 w-8" aria-hidden />
					The image for this slide is missing.
				</span>
			)}

			{otherPins?.map((pin, index) => (
				<span
					key={`other-${index}`}
					aria-hidden
					className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
					style={{ left: `${pin.x}%`, top: `${pin.y}%`, background: "var(--deck-accent, #BC5EB3)", opacity: 0.55 }}
				/>
			))}

			{cursor ? (
				<span
					aria-hidden
					className="pointer-events-none absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2"
					style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}
				>
					<span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" />
					<span className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" />
				</span>
			) : null}

			{pins.map((pin, index) => {
				const dot = (
					<>
						<span
							aria-hidden
							className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 motion-safe:animate-ping"
							style={{ background: "var(--deck-primary, #F79945)" }}
						/>
						<span
							aria-hidden
							className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-md"
							style={{ background: "var(--deck-primary, #F79945)" }}
						/>
					</>
				);
				const style = { left: `${pin.x}%`, top: `${pin.y}%` };
				return interactive && onRemove ? (
					<button
						key={keys[index]}
						type="button"
						aria-label={`Remove pin ${index + 1} (${describePoint(pin)})`}
						onClick={(event) => {
							event.stopPropagation();
							onRemove(index);
						}}
						className={cn("absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full", FOCUS_RING)}
						style={style}
					>
						{dot}
					</button>
				) : (
					<span key={keys[index]} aria-hidden className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2" style={style}>
						{dot}
					</span>
				);
			})}
		</div>
	);
}

export function PinOnImageParticipant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode }: ParticipantProps<"pin_on_image">) {
	const review = mode === "review";
	const readOnly = isReadOnlyView(mode, run.state);
	const max = Math.max(1, run.config.max_pins_per_participant ?? 1);
	const media = run.config.media ?? null;
	const answer = useAnswer(run.id, mySubmission, onSubmit);
	const stored = useMemo(() => storedPins(answer.latest), [answer.latest]);
	const [pins, setPins] = useState<Point[]>([]);
	const [cursor, setCursor] = useState<Point | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const locked = disabled || answer.busy || readOnly;
	const title = displayTitle(run.title, "pin_on_image");

	const place = (point: Point) => {
		if (locked) return;
		if (pins.length >= max && max > 1) {
			setAnnouncement(`All ${max} pins are placed. Tap a pin to remove it first.`);
			haptic("error");
			return;
		}
		// One pin: tapping again moves it.
		setPins((current) => (max === 1 ? [point] : [...current, point]));
		setAnnouncement(max === 1 ? `Pin placed at ${describePoint(point)}.` : `Pin ${pins.length + 1} of ${max} placed.`);
		haptic("tap");
	};

	const remove = (index: number) => {
		if (locked) return;
		setPins((current) => current.filter((_, i) => i !== index));
		setAnnouncement(`Pin ${index + 1} removed.`);
		haptic("tap");
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const step = event.shiftKey ? 10 : 2;
		const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
		const move = moves[event.key];
		if (move) {
			event.preventDefault();
			const from = cursor ?? { x: 50, y: 50 };
			const next = { x: roundPercent(clampPercent(from.x + move[0])), y: roundPercent(clampPercent(from.y + move[1])) };
			setCursor(next);
			setAnnouncement(`Crosshair at ${describePoint(next)}.`);
		} else if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			place(cursor ?? { x: 50, y: 50 });
			if (!cursor) setCursor({ x: 50, y: 50 });
		} else if ((event.key === "Backspace" || event.key === "Delete") && pins.length > 0) {
			event.preventDefault();
			remove(pins.length - 1);
		}
	};

	const helpId = `pin-help-${run.id}`;
	const results = aggregate ? <PinResults aggregate={aggregate} media={media} mine={stored} title={resultsTitle(mode, run.state)} /> : null;
	const summary =
		stored.length > 0 ? (
			<AnswerSummary label={stored.length === 1 ? "Your pin" : "Your pins"}>
				<PinBoard media={media} pins={stored} compact label={`Your ${stored.length === 1 ? "pin" : `${stored.length} pins`} on the image.`} />
			</AnswerSummary>
		) : null;

	if (readOnly) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				{/* With results, the image below already shows your pins. */}
				{stored.length > 0 ? (results ? null : summary) : review ? <ParticipantNotice>You didn&apos;t drop a pin on this slide.</ParticipantNotice> : null}
				{results}
			</ParticipantLayout>
		);
	}

	if (stored.length > 0 && !answer.editing) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				<SubmittedState
					title={stored.length === 1 ? "Your pin is in" : "Your pins are in"}
					onEdit={
						disabled
							? undefined
							: () => {
									setPins(stored);
									setCursor(null);
									answer.edit();
								}
					}
					editLabel="Move my pins"
					editHint={!disabled ? "You can change your pins until voting closes." : undefined}
					className="px-0 py-6"
				>
					{results ?? summary}
				</SubmittedState>
			</ParticipantLayout>
		);
	}

	const lockedMessage = disabled ? notVotingMessage(run.state) : null;

	return (
		<ParticipantLayout
			theme={theme}
			title={title}
			subtitle={max === 1 ? "Tap the image to drop your pin. Tap again to move it." : `Tap the image to drop up to ${max} pins. Tap a pin to remove it.`}
			subtitleId={helpId}
			footer={
				<SubmitBar
					label={answer.editing ? "Update pins" : "Submit"}
					onClick={() => {
						const next = pins.map((pin) => ({ x: roundPercent(pin.x), y: roundPercent(pin.y) }));
						void answer.submit({ pins: next }, { pins: next });
					}}
					loading={answer.busy}
					disabled={disabled || pins.length === 0}
					hint={`${pins.length} / ${max} ${max === 1 ? "pin" : "pins"} placed`}
					error={answer.fieldError}
				/>
			}
		>
			{lockedMessage ? <ParticipantNotice>{lockedMessage}</ParticipantNotice> : null}

			<PinBoard
				media={media}
				pins={pins}
				interactive={!locked}
				cursor={cursor}
				onPlace={place}
				onRemove={remove}
				onKeyDown={onKeyDown}
				onPointerDown={() => setCursor(null)}
				label="Image to drop pins on. Arrow keys move the crosshair, Enter drops a pin, Backspace removes the last pin."
				describedBy={helpId}
			/>

			{pins.length > 1 && !locked ? (
				<button
					type="button"
					onClick={() => {
						setPins([]);
						setAnnouncement("All pins removed.");
					}}
					className={cn("mx-auto flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold", FOCUS_RING)}
					style={{ color: "var(--deck-text-muted, #4B5563)", background: "var(--deck-surface-muted, #F3F4F6)" }}
				>
					<X className="h-4 w-4" aria-hidden />
					Clear all pins
				</button>
			) : null}

			<p className="sr-only" aria-live="polite">
				{announcement}
			</p>

			{answer.editing ? (
				<button
					type="button"
					onClick={answer.cancelEdit}
					disabled={answer.busy}
					className={cn("min-h-11 self-center rounded-lg px-4 text-sm font-semibold underline-offset-4 hover:underline", FOCUS_RING)}
					style={{ color: "var(--deck-text-muted, #4B5563)" }}
				>
					Keep my pins
				</button>
			) : null}

			{results}
		</ParticipantLayout>
	);
}

/** Everyone's pins (latest 150) on the image, with your own on top. */
function PinResults({ aggregate, media, mine, title }: { aggregate: PinOnImageAggregate; media: RunMedia | null; mine: Point[]; title: string }) {
	const label = `${aggregate.total_pins} ${aggregate.total_pins === 1 ? "pin" : "pins"} from everyone${mine.length ? `, with your ${mine.length === 1 ? "pin" : `${mine.length} pins`}` : ""}.`;
	return (
		<ResultsSection title={title} summary={countLabel(aggregate.total_responses, "response", "responses")}>
			<PinBoard media={media} pins={mine} otherPins={aggregate.pins} compact label={label} />
		</ResultsSection>
	);
}
