"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { AxisLabels, Matrix2x2Aggregate, Point } from "@/features/deck/types";
import { cn } from "@/lib/utils";
import type { ParticipantProps } from "../types";
import { haptic, SubmitBar, SubmittedState } from "../shared";
import { useAnswer } from "../shared/answer";
import { displayTitle } from "../shared/labels";
import { AnswerSummary, ParticipantLayout, ParticipantNotice, ResultsSection, countLabel, isReadOnlyView, notVotingMessage, resultsTitle } from "../shared/participantKit";
import { clampPercent, describePoint, isPoint, roundPercent } from "../shared/pointMath";
import { describeAxes, MatrixPlane } from "./MatrixPlane";

// matrix_2x2 participant (plan §7.3): a 2D plane, tap or drag the dot
// (pointer capture, no page scroll while dragging), or focus the plane and
// use the arrow keys (Shift = bigger steps). Coordinates are 0..100 percent,
// 2 dp, x 0 = left, y 0 = bottom (Matrix2x2SlideType). Public results
// (aggregate passed) show everyone's dots and the average in every view.

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

export function Matrix2x2Participant({ run, mySubmission, onSubmit, disabled, theme, aggregate, mode }: ParticipantProps<"matrix_2x2">) {
	const review = mode === "review";
	const readOnly = isReadOnlyView(mode, run.state);
	const { x_axis: xAxis, y_axis: yAxis } = run.config;
	const answer = useAnswer(run.id, mySubmission, onSubmit);
	const stored = isPoint(answer.latest) ? answer.latest : null;
	const [point, setPoint] = useState<Point | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const planeRef = useRef<HTMLDivElement>(null);
	const dragging = useRef(false);
	const locked = disabled || answer.busy || readOnly;
	const axes = describeAxes(xAxis, yAxis);
	const helpId = `matrix-help-${run.id}`;
	const title = displayTitle(run.title, "matrix_2x2");

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
		haptic("tap");
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

	const results = aggregate ? (
		<MatrixResults aggregate={aggregate} xAxis={xAxis} yAxis={yAxis} mine={stored} title={resultsTitle(mode, run.state)} />
	) : null;

	const summary = stored ? (
		<AnswerSummary label="Your dot">
			<div role="img" aria-label={describe(stored)}>
				<MatrixPlane xAxis={xAxis} yAxis={yAxis} size="phone" className="mx-auto w-full max-w-[14rem]" style={{ aspectRatio: "1" }}>
					<Dot point={stored} />
				</MatrixPlane>
			</div>
		</AnswerSummary>
	) : null;

	if (readOnly) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				{/* With results, the plane below already shows your dot. */}
				{stored ? (results ? null : summary) : review ? <ParticipantNotice>You didn&apos;t place a dot on this slide.</ParticipantNotice> : null}
				{results}
			</ParticipantLayout>
		);
	}

	if (stored && !answer.editing) {
		return (
			<ParticipantLayout theme={theme} title={title}>
				<SubmittedState
					title="Your dot is placed"
					onEdit={
						disabled
							? undefined
							: () => {
									setPoint(stored);
									answer.edit();
								}
					}
					editLabel="Move my dot"
					editHint={!disabled ? "You can move it until voting closes." : undefined}
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
			subtitle={`Tap or drag to place your dot.${axes ? ` ${axes}.` : ""}`}
			subtitleId={helpId}
			footer={
				<SubmitBar
					label={answer.editing ? "Update" : "Submit"}
					onClick={() => {
						if (!point) return;
						const next = { x: roundPercent(point.x), y: roundPercent(point.y) };
						void answer.submit(next, next);
					}}
					loading={answer.busy}
					disabled={disabled || !point}
					hint={point ? "Happy with the spot? Submit it." : "Place your dot to submit."}
					error={answer.fieldError}
				/>
			}
		>
			{lockedMessage ? <ParticipantNotice>{lockedMessage}</ParticipantNotice> : null}

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

			{answer.editing ? (
				<button
					type="button"
					onClick={answer.cancelEdit}
					disabled={answer.busy}
					className={cn("min-h-11 self-center rounded-lg px-4 text-sm font-semibold underline-offset-4 hover:underline", FOCUS_RING)}
					style={{ color: "var(--deck-text-muted, #4B5563)" }}
				>
					Keep my dot
				</button>
			) : null}

			{results}
		</ParticipantLayout>
	);
}

/** Everyone's dots (latest 150) on a small plane, the average position, and your own dot on top. */
function MatrixResults({
	aggregate,
	xAxis,
	yAxis,
	mine,
	title,
}: {
	aggregate: Matrix2x2Aggregate;
	xAxis: AxisLabels | undefined;
	yAxis: AxisLabels | undefined;
	mine: Point | null;
	title: string;
}) {
	const centroid = aggregate.centroid;
	const label = [
		`${aggregate.total_points} ${aggregate.total_points === 1 ? "dot" : "dots"} placed`,
		centroid ? `average ${describePoint(centroid)}` : null,
		mine ? `yours ${describePoint(mine)}` : null,
	]
		.filter(Boolean)
		.join(", ");
	return (
		<ResultsSection title={title} summary={countLabel(aggregate.total_responses, "response", "responses")}>
			<div role="img" aria-label={`${label}.`}>
				<MatrixPlane xAxis={xAxis} yAxis={yAxis} size="phone" className="mx-auto w-full max-w-xs" style={{ aspectRatio: "1" }}>
					{aggregate.points.map((other, index) => (
						<Dot key={index} point={other} mine={false} faint />
					))}
					{centroid ? (
						<span
							aria-hidden
							className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px]"
							style={{ left: `${centroid.x}%`, top: `${100 - centroid.y}%`, borderColor: "var(--deck-accent, #BC5EB3)" }}
						/>
					) : null}
					{mine ? <Dot point={mine} /> : null}
				</MatrixPlane>
			</div>
			{centroid ? (
				<p className="m-0 flex items-center gap-1.5 text-xs" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					<span aria-hidden className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: "var(--deck-accent, #BC5EB3)" }} />
					Average position
				</p>
			) : null}
		</ResultsSection>
	);
}
