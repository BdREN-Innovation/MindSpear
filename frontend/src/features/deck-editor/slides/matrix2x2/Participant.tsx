"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { AxisLabels, Point } from "@/features/deck/types";
import { cn } from "@/lib/utils";
import type { ParticipantProps } from "../types";
import { haptic, SubmitBar, SubmittedState } from "../shared";
import { useAnswerFlow, useDraft } from "../pinOnImage/answerFlow";
import { clampPercent, describePoint, isPoint, roundPercent } from "../pinOnImage/pointMath";
import { describeAxes, MatrixPlane } from "./MatrixPlane";

// matrix_2x2 participant (plan §7.3): a 2D plane, tap or drag the dot
// (pointer capture, no page scroll while dragging), or focus the plane and
// use the arrow keys (Shift = bigger steps). Coordinates are 0..100 percent,
// 2 dp, x 0 = left, y 0 = bottom (Matrix2x2SlideType).

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

/** "toward Expensive" style wording for one axis value. */
function towards(value: number, labels: AxisLabels | undefined, lowWord: string, highWord: string): string {
	const low = labels?.low?.trim() || lowWord;
	const high = labels?.high?.trim() || highWord;
	if (Math.abs(value - 50) < 5) return "middle";
	return value > 50 ? `toward ${high}` : `toward ${low}`;
}

function Dot({ point, mine = true, faint = false }: { point: Point; mine?: boolean; faint?: boolean }) {
	return (
		<span
			aria-hidden
			className={cn("pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full", mine ? "h-7 w-7 border-[3px] border-white shadow-lg" : "h-2.5 w-2.5")}
			style={{
				left: `${point.x}%`,
				top: `${100 - point.y}%`,
				background: mine ? "var(--deck-primary, #F79945)" : "var(--deck-accent, #BC5EB3)",
				opacity: faint ? 0.5 : 1,
			}}
		/>
	);
}

export function Matrix2x2Participant({ run, mySubmission, onSubmit, disabled, aggregate, mode }: ParticipantProps<"matrix_2x2">) {
	const { x_axis: xAxis, y_axis: yAxis } = run.config;
	const stored = isPoint(mySubmission) ? mySubmission : null;
	const [point, setPoint, markClean] = useDraft<Point | null>(stored, stored ? `${stored.x}:${stored.y}` : "");
	const flow = useAnswerFlow(onSubmit, !!stored, markClean);
	const [announcement, setAnnouncement] = useState("");
	const planeRef = useRef<HTMLDivElement>(null);
	const dragging = useRef(false);
	const review = mode === "review";
	const locked = disabled || flow.busy || review;
	const axes = describeAxes(xAxis, yAxis);
	const helpId = `matrix-help-${run.id}`;

	const describe = (p: Point) => `Dot ${towards(p.x, xAxis, "left", "right")} and ${towards(p.y, yAxis, "bottom", "top")} (${describePoint(p)}).`;

	const fromPointer = (event: PointerEvent<HTMLDivElement>): Point | null => {
		const rect = planeRef.current?.getBoundingClientRect();
		if (!rect || rect.width === 0 || rect.height === 0) return null;
		return {
			x: roundPercent(((event.clientX - rect.left) / rect.width) * 100),
			y: roundPercent(100 - ((event.clientY - rect.top) / rect.height) * 100),
		};
	};

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (locked || (event.pointerType === "mouse" && event.button !== 0)) return;
		const next = fromPointer(event);
		if (!next) return;
		dragging.current = true;
		event.currentTarget.setPointerCapture?.(event.pointerId);
		setPoint(next);
		haptic(10);
	};

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		if (!dragging.current || locked) return;
		const next = fromPointer(event);
		if (next) setPoint(next);
	};

	const endDrag = (event: PointerEvent<HTMLDivElement>) => {
		if (!dragging.current) return;
		dragging.current = false;
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		if (point) setAnnouncement(describe(point));
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (locked) return;
		const step = event.shiftKey ? 10 : 1;
		const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
		let next: Point | null = null;
		if (moves[event.key]) {
			const from = point ?? { x: 50, y: 50 };
			next = { x: roundPercent(clampPercent(from.x + moves[event.key][0])), y: roundPercent(clampPercent(from.y + moves[event.key][1])) };
		} else if ((event.key === "Enter" || event.key === " ") && !point) {
			next = { x: 50, y: 50 };
		}
		if (!next) return;
		event.preventDefault();
		setPoint(next);
		setAnnouncement(describe(next));
	};

	const others = aggregate?.points;

	if (flow.showSubmitted || review) {
		const shown = flow.showSubmitted ? point : stored;
		return (
			<SubmittedState
				title={review ? "Your dot" : "Your dot is placed"}
				message={review ? (shown ? null : "You didn't place a dot on this slide.") : "Waiting for the host to continue."}
				onEdit={!review && !disabled ? flow.edit : undefined}
				editLabel="Move my dot"
				editHint={!review && !disabled ? "You can move it until voting closes." : undefined}
			>
				{shown || others?.length ? (
					<div role="img" aria-label={shown ? describe(shown) : "Everyone's dots"}>
						<MatrixPlane xAxis={xAxis} yAxis={yAxis} size="phone" className="mx-auto w-full max-w-xs" style={{ aspectRatio: "1" }}>
							{others?.map((other, index) => <Dot key={index} point={other} mine={false} faint />)}
							{shown ? <Dot point={shown} /> : null}
						</MatrixPlane>
					</div>
				) : null}
			</SubmittedState>
		);
	}

	return (
		<div className="flex min-h-full w-full flex-col" style={{ color: "var(--deck-text, #111928)" }}>
			<div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-5">
				<div className="flex flex-col gap-1">
					<h2 className="m-0 break-words text-xl font-bold leading-snug">{run.title || "Place your dot"}</h2>
					<p id={helpId} className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						Tap or drag to place your dot.{axes ? ` ${axes}.` : ""}
					</p>
				</div>

				<div
					ref={planeRef}
					role="application"
					aria-roledescription="2D grid"
					aria-label="Answer grid. Use the arrow keys to move your dot, Shift for bigger steps."
					aria-describedby={helpId}
					tabIndex={locked ? -1 : 0}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={endDrag}
					onPointerCancel={endDrag}
					onKeyDown={onKeyDown}
					className={cn("mx-auto w-full max-w-[min(100%,62vh)] select-none rounded-xl", !locked && "cursor-crosshair", FOCUS_RING)}
					style={{ touchAction: "none", WebkitTouchCallout: "none", aspectRatio: "1" }}
				>
					<MatrixPlane xAxis={xAxis} yAxis={yAxis} size="phone" className="h-full w-full">
						{point ? <Dot point={point} /> : null}
					</MatrixPlane>
				</div>

				<p className="sr-only" aria-live="polite">
					{announcement}
				</p>
			</div>

			<SubmitBar
				label={flow.editing ? "Update" : "Submit"}
				onClick={() => point && void flow.submit({ x: roundPercent(point.x), y: roundPercent(point.y) })}
				loading={flow.busy}
				disabled={disabled || review || !point}
				hint={point ? "Happy with the spot? Submit it." : "Place your dot to submit."}
				error={flow.errorMessage}
			/>
		</div>
	);
}
