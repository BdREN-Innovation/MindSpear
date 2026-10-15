/* eslint-disable @next/next/no-img-element -- My Files URLs on arbitrary hosts; the box must match the image's own aspect. */
"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ImageOff, X } from "lucide-react";
import type { Point, RunMedia } from "@/features/deck/types";
import { cn } from "@/lib/utils";
import type { ParticipantProps } from "../types";
import { haptic, SubmitBar, SubmittedState } from "../shared";
import { useAnswerFlow, useDraft } from "./answerFlow";
import { clampPercent, describePoint, isPoint, pointKeys, roundPercent } from "./pointMath";

// pin_on_image participant (plan §7.3): full-width image, tap to drop
// pulsing pins (up to max_pins_per_participant), tap a pin to remove it,
// Submit. Coordinates are percentages of the image, origin top-left, 2 dp
// (exactly what PinOnImageSlideType validates). Keyboard: arrows move a
// crosshair, Enter / Space drops a pin, Backspace removes the last one.

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

export function PinOnImageParticipant({ run, mySubmission, onSubmit, disabled, aggregate, mode }: ParticipantProps<"pin_on_image">) {
	const max = Math.max(1, run.config.max_pins_per_participant ?? 1);
	const media = run.config.media ?? null;
	const stored = useMemo(() => storedPins(mySubmission), [mySubmission]);
	const [pins, setPins, markClean] = useDraft<Point[]>(stored, JSON.stringify(stored));
	const flow = useAnswerFlow(onSubmit, stored.length > 0, markClean);
	const [cursor, setCursor] = useState<Point | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const review = mode === "review";
	const locked = disabled || flow.busy || review;

	const place = (point: Point) => {
		if (locked) return;
		if (pins.length >= max && max > 1) {
			setAnnouncement(`All ${max} pins are placed. Tap a pin to remove it first.`);
			haptic([10, 40, 10]);
			return;
		}
		// One pin: tapping again moves it.
		setPins((current) => (max === 1 ? [point] : [...current, point]));
		setAnnouncement(max === 1 ? `Pin placed at ${describePoint(point)}.` : `Pin ${pins.length + 1} of ${max} placed.`);
		haptic(10);
	};

	const remove = (index: number) => {
		if (locked) return;
		setPins((current) => current.filter((_, i) => i !== index));
		setAnnouncement(`Pin ${index + 1} removed.`);
		haptic(10);
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

	const otherPins = aggregate?.pins;
	const helpId = `pin-help-${run.id}`;

	if (flow.showSubmitted || review) {
		const shown = flow.showSubmitted ? pins : stored;
		return (
			<SubmittedState
				title={review ? "Your pins" : shown.length === 1 ? "Your pin is in" : "Your pins are in"}
				message={review ? (shown.length ? null : "You didn't drop a pin on this slide.") : "Waiting for the host to continue."}
				onEdit={!review && !disabled ? flow.edit : undefined}
				editLabel="Move my pins"
				editHint={!review && !disabled ? "You can change your pins until voting closes." : undefined}
			>
				{shown.length || otherPins?.length ? (
					<PinBoard
						media={media}
						pins={shown}
						otherPins={otherPins}
						compact
						label={`Your ${shown.length === 1 ? "pin" : `${shown.length} pins`} on the image${otherPins?.length ? `, with ${otherPins.length} pins from others` : ""}.`}
					/>
				) : null}
			</SubmittedState>
		);
	}

	return (
		<div className="flex min-h-full w-full flex-col" style={{ color: "var(--deck-text, #111928)" }}>
			<div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-5">
				<div className="flex flex-col gap-1">
					<h2 className="m-0 break-words text-xl font-bold leading-snug">{run.title || "Drop a pin on the image"}</h2>
					<p id={helpId} className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						{max === 1 ? "Tap the image to drop your pin. Tap again to move it." : `Tap the image to drop up to ${max} pins. Tap a pin to remove it.`}
					</p>
				</div>

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
			</div>

			<SubmitBar
				label={flow.editing ? "Update pins" : "Submit"}
				onClick={() => void flow.submit({ pins: pins.map((pin) => ({ x: roundPercent(pin.x), y: roundPercent(pin.y) })) })}
				loading={flow.busy}
				disabled={disabled || review || pins.length === 0}
				hint={`${pins.length} / ${max} ${max === 1 ? "pin" : "pins"} placed`}
				error={flow.errorMessage}
			/>
		</div>
	);
}
