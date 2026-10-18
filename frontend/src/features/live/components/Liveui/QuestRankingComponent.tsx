/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, {
	useEffect,
	useMemo,
	useRef,
	useState,
	useCallback,
} from "react";
import clsx from "clsx";
import { useSearchParams } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { upsertAnswer } from "@/features/live/store/leaderboardAnswersSlice";
import { useDispatch } from "react-redux";
import moment from "@/lib/dayjs";
import { AxiosError } from "axios";
import { TimerCacheManager } from "@/utils/timerCacheUtils";
import {
	DndContext,
	useDraggable,
	useDroppable,
	PointerSensor,
	useSensor,
	useSensors,
	DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import SharedQuestTimer from "@/components/SharedQuestTimer";
import {
	ParticipantStage,
	ParticipantTimerPanel,
	StickySubmitBar,
	WaitingStage,
	markAnswered,
	wasAnswered,
} from "./participant-ui";
type TaskQuestion = {
	id: number | string;
	text?: string;
	label?: string;
	color?: string;
};
type TaskItem = {
	id?: number | string;
	quiz_id?: number | string;
	serial_number?: number;
	title?: string;
	question_type?: string;
	task_type?: string;
	description?: string | null;
	questions?: TaskQuestion[];
	time_limit_seconds?: number | string;
	source_content_url?: string | null;
};
type Props = {
	task?: TaskItem;
	value?: string | null;
	onChange?: (val: string) => void;
};

/** --------------------------
 *  Small Draggable Item
 *  --------------------------
 */
function DraggableOption({
	id,
	label,
	from,
	optIdx,
	className,
}: {
	id: string;
	label: any;
	from: "options" | "ranking";
	optIdx: number;
	className?: string;
}) {
	const { attributes, listeners, setNodeRef, transform, isDragging } =
		useDraggable({
			id,
			data: {
				from,
				optIdx,
			},
		});
	const style: React.CSSProperties = {
		transform: transform ? CSS.Translate.toString(transform) : undefined,
		opacity: isDragging ? 0.75 : 1,
	};
	return (
		<div
			ref={setNodeRef}
			style={style}
			className={clsx(
				"select-none cursor-grab active:cursor-grabbing",
				className,
			)}
			{...attributes}
			{...listeners}
		>
			{label}
		</div>
	);
}

/** --------------------------
 *  Droppable Zones
 *  --------------------------
 */
function Droppable({
	id,
	children,
	className,
}: {
	id: string;
	children: React.ReactNode;
	className?: string;
}) {
	const { setNodeRef, isOver } = useDroppable({
		id,
	});
	return (
		<div
			ref={setNodeRef}
			className={clsx(
				className,
				isOver ? "ring-2 ring-primary ring-offset-2" : "",
			)}
		>
			{children}
		</div>
	);
}
const QuestChoiceComponent: React.FC<Props> = ({ task }) => {
	const dispatch = useDispatch();
	const dataNew: any = task;
	const searchParams = useSearchParams();
	const joinid = searchParams.get("jid");
	const attempId = searchParams.get("aid");
	const [watingData, setwatingData] = useState(true);
	const [chalangeData, setchalangeData] = useState<any>({});
	const [currentTimeGet, setcurrentTimeGet] = useState<number>(0);
	useEffect(() => {
		if (typeof window !== "undefined" && !navigator.onLine) {
			console.warn("Offline — skipping API call");
			return;
		}
		const dataFetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quest-attempts-url/show-by-link/${joinid}`,
				);
				setchalangeData(response?.data?.data?.quest);
			} catch (error) {
				const axiosError = error as AxiosError<{
					message?: string;
				}>;
				console.error("Unexpected error:", axiosError.message);
			}
		};
		dataFetch();
	}, [joinid]);

	// Build options and remember original mapping
	const optionNodes = task?.questions ?? [];
	const options = useMemo(
		() => optionNodes.map((q) => q.text ?? q.label ?? "").filter(Boolean),
		[optionNodes],
	);

	// Ranking state = array of original option indices
	const [ranked, setRanked] = useState<number[]>([]);
	useEffect(() => {
		setRanked([]);
		setwatingData(true);
	}, [task?.id]);

	// Available = all indices not present in ranked
	const available = useMemo(
		() => options.map((_, i) => i).filter((i) => !ranked.includes(i)),
		[options, ranked],
	);

	// Persist to Redux whenever ranking changes
	const persistRedux = useCallback(
		(rankOrder: number[]) => {
			const selectedAnswer =
				rankOrder.map((optIdx, i) => {
					const picked = optionNodes[optIdx];
					return {
						id: picked?.id ?? optIdx,
						text: options[optIdx],
						color: picked?.color ?? null,
						rank: i + 1,
					};
				}) ?? [];
			dispatch(
				upsertAnswer({
					id: (task?.id as number | string) ?? "ranking",
					quiz_id: (task as any)?.quiz_id ?? null,
					serial_number: (task as any)?.serial_number ?? null,
					title: task?.title ?? null,
					question_type:
						(task as any)?.question_type ??
						task?.task_type ??
						"ranking",
					selected_time: 0,
					source_content_url:
						(task as any)?.source_content_url ?? null,
					questions: selectedAnswer,
				}),
			);
		},
		[dispatch, optionNodes, options, task],
	);
	const insertAt = (arr: number[], value: number, index: number) => {
		const next = [...arr];
		next.splice(index, 0, value);
		return next;
	};
	const moveItem = (arr: number[], fromIndex: number, toIndex: number) => {
		const next = [...arr];
		const [moved] = next.splice(fromIndex, 1);
		next.splice(toIndex, 0, moved);
		return next;
	};

	// Click to add (still supported)
	const addToRanking = (optIdx: number, pos?: number) => {
		if (ranked.includes(optIdx)) return;
		const next =
			typeof pos === "number"
				? insertAt(ranked, optIdx, pos)
				: [...ranked, optIdx];
		setRanked(next);
		persistRedux(next);
	};

	// Remove from ranking (used when dropping back into options)
	const removeFromRanking = (optIdx: number) => {
		if (!ranked.includes(optIdx)) return;
		const next = ranked.filter((v) => v !== optIdx);
		setRanked(next);
		persistRedux(next);
	};

	// Up/Down (kept)
	const moveUp = (pos: number) => {
		if (pos <= 0) return;
		const next = moveItem(ranked, pos, pos - 1);
		setRanked(next);
		persistRedux(next);
	};
	const moveDown = (pos: number) => {
		if (pos >= ranked.length - 1) return;
		const next = moveItem(ranked, pos, pos + 1);
		setRanked(next);
		persistRedux(next);
	};

	// Timer + socket
	const startRef = useRef<number>(Date.now());
	useEffect(() => {
		startRef.current = Date.now();
	}, [task?.id]);
	const handleExpire = () => {
		if (!task?.id) return;
		const saved = setTaskExpired(task.id);
		const ok =
			saved?.status === "completed" &&
			String(saved?.taskId ?? task.id) === String(task.id);
		if (ok) {
			setwatingData(false);
		}
	};
	const setTaskExpired = (taskId: string | number) => {
		const key = `timeExpired_${taskId}`;
		const payload = {
			status: "completed",
			submitStatus: "complited",
			taskId,
			ts: Date.now(),
		};
		localStorage.setItem(key, JSON.stringify(payload));
		setwatingData(false);
		return payload;
	};
	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key === `timeExpired_${task?.id}`) {
				// re-run your same logic
				try {
					const parsed = e.newValue ? JSON.parse(e.newValue) : null;
					const ok =
						parsed?.status === "completed" &&
						String(parsed?.taskId ?? task?.id) === String(task?.id);
					setwatingData(!!ok);
				} catch {
					setwatingData(e.newValue === "completed");
				}
			}
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [task?.id]);

	// 4) Build timerData only when ready

	const handleTimeUpdate = (
		remaining: number,
		elapsed: number,
		total: number,
	) => {
		setcurrentTimeGet(remaining);
	};
	useEffect(() => {
		if (!task?.id) return;
		const key = `timeExpired_${task.id}`;
		const userStatus: any = localStorage.getItem(key);
		if (userStatus !== null) {
			const savedState = JSON.parse(userStatus);
			if (
				savedState?.status === "completed" ||
				(savedState?.submitStatus === "completed" &&
					task.id === savedState?.taskId)
			) {
				setwatingData(false);
			}
		} else {
			setwatingData(true);
		}
	}, [dataNew?.id]);

	// Submit
	const dataSubmit = async () => {
		markAnswered(task?.id);
		await saveAnswer();
		if (task?.id) setTaskExpired(task.id);
		setwatingData(false);
		if (typeof window !== "undefined") {
			localStorage.setItem("currentId", `${task?.id}`);
		}
	};
	const saveAnswer = async () => {
		try {
			const currentTime = moment().format("YYYY-MM-DD HH:mm:ss");
			const payload = {
				task_id: task?.id,
				completion_data: {
					start_time: currentTime,
					selected_option: ranked,
				},
				time_taken_seconds: currentTimeGet,
			};
			await axiosInstance.post(
				`/quest-attempts/${attempId}/answer`,
				payload,
			);
		} catch (error) {
			console.error("Error saving answer:", error);
		}
	};
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 6,
			},
		}),
	);
	const OPTIONS_ZONE_ID = "options-zone";
	const RANKING_ZONE_ID = "ranking-zone";
	const rankItemId = (pos: number) => `rank-item-${pos}`;
	const optItemId = (optIdx: number) => `opt-item-${optIdx}`;
	const onDragOver = (_evt: any) => {};
	const onDragEnd = (evt: DragEndEvent) => {
		const { active, over } = evt;
		if (!over) return;
		const optIdx: number | undefined = active.data?.current?.optIdx;
		if (optIdx === undefined) return;
		const overId = String(over.id);
		if (overId === OPTIONS_ZONE_ID || overId.startsWith("opt-item-")) {
			removeFromRanking(optIdx);
			return;
		}
		if (overId === RANKING_ZONE_ID) {
			if (!ranked.includes(optIdx)) addToRanking(optIdx);
			return;
		}
		if (overId.startsWith("rank-item-")) {
			const targetPos = parseInt(overId.replace("rank-item-", ""), 10);
			const currentPos = ranked.indexOf(optIdx);
			if (currentPos === -1) {
				const next = insertAt(ranked, optIdx, targetPos);
				setRanked(next);
				persistRedux(next);
			} else if (currentPos !== targetPos) {
				const next = moveItem(ranked, currentPos, targetPos);
				setRanked(next);
				persistRedux(next);
			}
			return;
		}
	};
	const htmlToText = (html?: string) => {
		if (!html) return "";
		const stripped = html.replace(/<[^>]*>/g, " ");
		if (typeof window !== "undefined") {
			const div = document.createElement("div");
			div.innerHTML = stripped;
			const text = div.textContent || div.innerText || "";
			return text
				.replace(/\u00a0/g, " ")
				.replace(/\s+/g, " ")
				.trim();
		}
		return stripped
			.replace(/\u00a0/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	};
	return (
		<>
			{watingData ? (
				<ParticipantStage size="wide">
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
							<div className="grid gap-4 lg:grid-cols-[1fr_18rem] lg:items-start">
								<div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-secondary/10 p-4">
									<p className="text-xs font-black uppercase tracking-wide text-primary">
										Build your ranking
									</p>
									<h2 className="mt-2 break-words text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
										{htmlToText(task?.title)}
									</h2>
								</div>

								<ParticipantTimerPanel>
									<SharedQuestTimer
										attemptId={`attempt-${dataNew?.id}`}
										onTimeUpdate={handleTimeUpdate}
										onExpire={handleExpire}
									/>
								</ParticipantTimerPanel>
							</div>

							<DndContext
								sensors={sensors}
								onDragOver={onDragOver}
								onDragEnd={onDragEnd}
							>
								<div className="mt-5 grid gap-4 lg:grid-cols-2">
									<div className="space-y-3">
										<h3 className="text-sm font-black uppercase tracking-wide text-slate-700">
											Options
										</h3>

										<Droppable
											id={OPTIONS_ZONE_ID}
											className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
										>
											{available.length > 0 ? (
												available.map((i) => (
													<DraggableOption
														key={optItemId(i)}
														id={optItemId(i)}
														from="options"
														optIdx={i}
														label={
															<button
																type="button"
																onClick={() => addToRanking(i)}
																className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left font-bold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10"
																title="Click or drag into your ranking"
															>
																{options[i]}
															</button>
														}
														className="w-full"
													/>
												))
											) : (
												<div className="rounded-md bg-white p-4 text-sm font-semibold text-slate-500">
													All options are ranked.
												</div>
											)}
										</Droppable>
									</div>

									<div className="space-y-3">
										<h3 className="text-sm font-black uppercase tracking-wide text-slate-700">
											Your ranking
										</h3>

										<Droppable
											id={RANKING_ZONE_ID}
											className="flex min-h-[180px] flex-col gap-3 rounded-lg border border-slate-300 bg-slate-950 p-3"
										>
											{ranked.length === 0 ? (
												<div className="grid min-h-32 place-items-center rounded-md border border-dashed border-white/25 text-center text-sm font-bold text-white/70">
													Click or drop options here
												</div>
											) : (
												ranked.map((optIdx, pos) => (
													<Droppable key={rankItemId(pos)} id={rankItemId(pos)}>
														<div className="flex items-center justify-between rounded-lg border border-white/10 bg-white px-3 py-3 shadow-sm">
															<div className="flex w-full items-center gap-3">
																<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-black text-white">
																	{pos + 1}
																</div>

																<DraggableOption
																	id={`rank-draggable-${optIdx}`}
																	from="ranking"
																	optIdx={optIdx}
																	label={
																		<div className="font-bold text-slate-800">
																			{options[optIdx]}
																		</div>
																	}
																	className="flex-1"
																/>
															</div>

															<div className="flex shrink-0 items-center gap-2 pl-3">
																<button
																	type="button"
																	onClick={() => moveUp(pos)}
																	className={clsx(
																		"rounded-md border px-2 py-1 text-sm font-black",
																		pos === 0
																			? "cursor-not-allowed opacity-40"
																			: "hover:border-primary/40",
																	)}
																	disabled={pos === 0}
																	title="Move up"
																>
																	▲
																</button>
																<button
																	type="button"
																	onClick={() => moveDown(pos)}
																	className={clsx(
																		"rounded-md border px-2 py-1 text-sm font-black",
																		pos === ranked.length - 1
																			? "cursor-not-allowed opacity-40"
																			: "hover:border-primary/40",
																	)}
																	disabled={pos === ranked.length - 1}
																	title="Move down"
																>
																	▼
																</button>
															</div>
														</div>
													</Droppable>
												))
											)}
										</Droppable>
									</div>
								</div>
							</DndContext>
						</div>

						<StickySubmitBar
							onSubmit={dataSubmit}
							disabled={ranked.length === 0}
							selectedText={
								ranked.length > 0
									? `${ranked.length} ranked ${ranked.length === 1 ? "item" : "items"}`
									: undefined
							}
							helperText="Rank at least one item to unlock submit."
						/>
					</div>
				</ParticipantStage>
			) : (
				<WaitingStage mode={wasAnswered(task?.id) ? "host" : "timeup"} />
			)}
		</>
	);
};
export default QuestChoiceComponent;
