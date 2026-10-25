/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useCallback, useEffect, useState, useRef } from "react";

import Summary from "@/features/quest/components/QuestReports/Summary";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { useDispatch, useSelector } from "react-redux";
import { setQuest } from "@/features/quest/store/questInformationSlice";
import { RootState } from "@/stores/store";

import { clearCache } from "@/features/live/store/leaderboardSlice";
import { clearAppStorage } from "@/utils/storageCleaner";
import {
	changeQuestTask,
	getHostLiveSession,
} from "@/features/live/services/liveSessionApi";
import {
	isQuestHostMusicArmed,
	startQuestHostMusic,
} from "@/features/live/services/questHostAudio";
import { useLiveSession } from "@/features/live/hooks/useLiveSession";
import { setQuestSession } from "@/features/quest/store/questSessionSlice";

import {
	setQuestData,
	// clearQuestData,
} from "@/features/quest/store/questQuestionTimeSlice";

import {
	CirclePlay,
	ClipboardList,
	Radio,
	UserRoundPlus,
	Users,
} from "lucide-react";
import moment from "@/lib/dayjs";
import { deadlineOf } from "@/features/live/services/liveTimer";
import { toast } from "react-toastify";
import {
	QuestHostConnectionPill,
	QuestHostLiveShell,
	QuestHostMetricCard,
} from "@/features/live/components/quest-host-ui";
import type {
	HostLiveSessionBootstrap,
	HostParticipantPayload,
	LiveParticipant,
	SessionSnapshot,
	TimerState,
} from "@/features/live/types";

interface ActiveUser {
	userName: string;
	userId: string;
}

const participantToActiveUser = (
	participant: LiveParticipant | HostParticipantPayload,
): ActiveUser | null => {
	const participantId = participant.participant_id;
	if (!participantId) return null;

	return {
		userId: `${participantId}`,
		userName:
			participant.participant_name?.trim() ||
			`Participant ${participantId}`,
	};
};

const mergeActiveUser = (
	previous: ActiveUser[],
	nextUser: ActiveUser | null,
): ActiveUser[] => {
	if (!nextUser) return previous;
	if (previous.some((item) => item.userId === nextUser.userId)) return previous;

	return [...previous, nextUser];
};

function QuizReport() {
	const params = useParams();
	const router = useRouter();
	const searchParams = useSearchParams();
	const dispatch = useDispatch();
	const questSession = useSelector(
		(state: RootState) => state.questSession.questSession,
	);

	const [response, setresponse] = useState<any | null>(null);
	const [activeUsersData, setActiveUsersData] = useState<ActiveUser[]>([]);
	const [participantsActive, setparticipantsActive] = useState(0);
	const [titleInput, setTitleInput] = useState("");
	const [bootstrapSession, setBootstrapSession] =
		useState<HostLiveSessionBootstrap | null>(null);
	const [bootstrapStatus, setBootstrapStatus] = useState<
		"checking" | "ready" | "missing" | "error"
	>("checking");
	const [bootstrapError, setBootstrapError] = useState<string | null>(null);

	const questId = `${params?.id}`;
	const sessionIdFromUrl = searchParams.get("sid");
	const publicChannelKeyFromUrl = searchParams.get("pck");
	const hasCurrentQuestSession =
		Boolean(questSession?.id) &&
		Number(questSession?.quest_id) === Number(params?.id) &&
		questSession?.running_status !== false;
	const activeSessionId =
		sessionIdFromUrl ??
		bootstrapSession?.id ??
		(hasCurrentQuestSession ? questSession?.id : null);
	const activePublicChannelKey =
		publicChannelKeyFromUrl ??
		bootstrapSession?.public_channel_key ??
		(hasCurrentQuestSession ? questSession?.public_channel_key ?? null : null);

	useEffect(() => {
		if (typeof window !== "undefined") {
			dispatch(clearCache());
			// Clear Local stores
			clearAppStorage();
		}
	}, [params?.id]);

	const syncParticipantsFromSnapshot = useCallback((snapshot: SessionSnapshot) => {
		setparticipantsActive(snapshot.participant_count ?? 0);
		setActiveUsersData(
			(snapshot.active_participants ?? [])
				.map(participantToActiveUser)
				.filter((participant): participant is ActiveUser => Boolean(participant)),
		);
	}, []);

	useEffect(() => {
		if (hasCurrentQuestSession) {
			setBootstrapStatus("ready");
			return;
		}

		let cancelled = false;

		const loadHostSession = async () => {
			try {
				setBootstrapStatus("checking");
				const session = await getHostLiveSession("quest", questId);
				if (cancelled) return;

				setBootstrapSession(session);
				setBootstrapError(null);
				setBootstrapStatus("ready");
				setparticipantsActive(session.participant_count ?? 0);
				setActiveUsersData(
					(session.active_participants ?? [])
						.map(participantToActiveUser)
						.filter(
							(participant): participant is ActiveUser =>
								Boolean(participant),
						),
				);
				dispatch(setQuestSession(session));
			} catch (error) {
				if (cancelled) return;

				const axiosError = error as AxiosError<{ message?: string }>;
				if (axiosError.response?.status === 404) {
					setBootstrapSession(null);
					setBootstrapError(null);
					setBootstrapStatus("missing");
					return;
				}

				setBootstrapSession(null);
				setBootstrapStatus("error");
				setBootstrapError(
					axiosError.response?.data?.message ??
						axiosError.message ??
						"Unable to load the active live session.",
				);
			}
		};

		void loadHostSession();

		return () => {
			cancelled = true;
		};
	}, [dispatch, hasCurrentQuestSession, questId]);

	const {
		channelState,
		hostSubscriptionStatus,
		publicSubscriptionStatus,
		error: liveConnectionError,
	} = useLiveSession({
		module: "quest",
		sessionId: activeSessionId,
		publicChannelKey: activePublicChannelKey,
		role: "host",
		onSnapshot: syncParticipantsFromSnapshot,
		onHostParticipantJoined: (payload) => {
			setparticipantsActive(payload?.participant_count ?? 0);
			setActiveUsersData((previous) =>
				mergeActiveUser(previous, participantToActiveUser(payload)),
			);
		},
		onHostParticipantCountUpdated: (payload) => {
			setparticipantsActive(payload?.participant_count ?? 0);
		},
	});

	useEffect(() => {
		if (isQuestHostMusicArmed()) void startQuestHostMusic();

		const resumeMusic = () => {
			if (isQuestHostMusicArmed()) void startQuestHostMusic();
		};

		window.addEventListener("pointerdown", resumeMusic, { once: true });
		return () => window.removeEventListener("pointerdown", resumeMusic);
	}, []);

	const connected =
		hostSubscriptionStatus === "subscribed" &&
		publicSubscriptionStatus === "subscribed";
	const hasActiveSession = Boolean(activeSessionId);
	const connectionFailed =
		hasActiveSession &&
		(hostSubscriptionStatus === "error" ||
			publicSubscriptionStatus === "error" ||
			Boolean(liveConnectionError));
	const connectionLabel =
		bootstrapStatus === "checking"
			? "Loading live session"
			: bootstrapStatus === "missing"
				? "No active live session"
				: bootstrapStatus === "error"
					? "Live session lookup failed"
					: connectionFailed
						? "Live connection error"
						: connected
							? "Live - Ready to start"
							: hasActiveSession
								? "Connecting to live session"
								: "No active live session";

	useEffect(() => {
		setparticipantsActive(channelState.participantCount);
	}, [channelState.participantCount]);

	useEffect(() => {
		const dataFetch = async () => {
			const responseData = await axiosInstance.get(
				`/quests/show/${params?.id}`,
			);
			setresponse(responseData?.data?.data?.quest);
			dispatch(setQuest(responseData?.data?.data?.quest));
		};
		dataFetch();
	}, [params?.id]);

	const quizeStartFunction = async () => {
		void startQuestHostMusic();
		if (!hasActiveSession) {
			toast.error("No active live quest session was found.");
			return;
		}

		try {
			await updateHostLiveSession();
			await handleChangeQuestion();
		} catch (e) {
			console.error("Failed to start quest:", e);
			toast.error("Quest start failed");
		}
	};

	const handleChangeQuestion = async () => {
		if (!activeSessionId) {
			toast.error("No live quest session was found.");
			return;
		}

		const orderedTasks = [...(response?.tasks ?? [])].sort(
			(
				a: { serial_number?: number; id?: number },
				b: { serial_number?: number; id?: number },
			) =>
				Number(a.serial_number ?? 0) - Number(b.serial_number ?? 0) ||
				Number(a.id ?? 0) - Number(b.id ?? 0),
		);
		const question =
			orderedTasks.find(
				(item: { serial_number?: number }) =>
					Number(item.serial_number) === 1,
			) ?? orderedTasks[0];

		if (!question?.id) {
			toast.error("This quest has no task to start.");
			throw new Error("Quest start failed: no task was found.");
		}

		const questionId = question.id;

		const questiQsenStartTime = moment().format("MMMM Do YYYY, h:mm:ss");
		const timeLimit = Number(
			question?.task_data?.time_limit ??
				question?.time_limit_seconds ??
				question?.time_limit ??
				0,
		);
		const timerState: TimerState = {
			status: "running",
			start_time: questiQsenStartTime,
			duration_seconds: Number.isFinite(timeLimit) ? timeLimit : 0,
			remaining_seconds: Number.isFinite(timeLimit) ? timeLimit : 0,
		};

		const liveState = await changeQuestTask(
			activeSessionId,
			questionId,
			timerState,
		);

		dispatch(
			setQuestData({
				questId,
				questionId: `${liveState.current_task_id ?? questionId}`,
				questiQsenStartTime,
				questiQsenTime: `${timeLimit || ""}`,
				questiQsenLateStartTime: false,
				questiQsenDeadline: deadlineOf(liveState.timer_state),
			}),
		);

		router.push(
			`/live/quests?jlk=${response?.join_link}&qid=${questId}&sid=${activeSessionId}&pck=${liveState.public_channel_key}`,
		);
	};

	useEffect(() => {
		if (questSession?.title) {
			setTitleInput(questSession.title);
		}
	}, [questSession?.title]);

	const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setTitleInput(e.target.value);
	};

	// Keep track of last-saved title to avoid calling API on initial set
	const lastSavedTitleRef = useRef<string | null>(null);

	useEffect(() => {
		if (lastSavedTitleRef.current === null) {
			lastSavedTitleRef.current = questSession?.title || "";
		}
	}, [questSession?.title]);

	// Debounce title updates: wait 3s after user stops typing, then call API
	useEffect(() => {
		if (titleInput === undefined) return;
		if (titleInput === lastSavedTitleRef.current) return;

		const timer = setTimeout(async () => {
			try {
				await updateHostLiveSession();
				lastSavedTitleRef.current = titleInput;
			} catch (err) {
				console.error("Failed to auto-update title:", err);
			}
		}, 3000);

		return () => clearTimeout(timer);
	}, [titleInput]);

	const updateHostLiveSession = async () => {
		if (!activeSessionId) {
			throw new Error("No live quest session was found.");
		}

		try {
			const payload = {
				title: titleInput,
			};
			const response = await axiosInstance.post(
				`/quests/update-host-live/${activeSessionId}`,
				payload,
			);
			return response.data;
		} catch (error) {
			console.error("Update failed:", error);
			throw error;
		}
	};

	return (
		<QuestHostLiveShell>
			<main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-5 px-3 py-4 sm:px-5 lg:px-8">
				<section className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,.75fr)]">
					<div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0f19] text-white shadow-[0_26px_80px_rgba(15,23,42,.18)] backdrop-blur">
						<div className="relative p-6 sm:p-8 lg:p-10">
							<div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px)] bg-[size:40px_40px]" />
							<div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(247,153,69,.22),transparent_28%),radial-gradient(circle_at_85%_82%,rgba(188,94,179,.22),transparent_30%),radial-gradient(circle_at_60%_10%,rgba(237,58,118,.14),transparent_24%)]" />
							<div className="relative">
								<div className="mb-6 flex flex-wrap items-center gap-3">
									<QuestHostConnectionPill
										connected={connected}
										label={connectionLabel}
									/>
									<span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-white/80">
										<Users className="h-4 w-4 text-primary" />
										{participantsActive} joined
									</span>
								</div>

								<div className="max-w-3xl">
									<h1 className="text-3xl font-black leading-tight sm:text-5xl">
										Prepare the room, then launch the live quest.
									</h1>
									<p className="mt-4 max-w-2xl text-base font-medium text-white/72">
										Participants can join while you confirm the session title.
										When ready, start the first question and the host stage will open.
									</p>
								</div>

								<div className="mt-8 grid gap-4 md:grid-cols-[1fr_auto]">
									<input
										type="text"
										value={titleInput}
										onChange={handleTitleChange}
										placeholder="Session title..."
										className="min-h-14 w-full rounded border border-white/15 bg-white/10 px-5 text-base font-bold text-white outline-none transition placeholder:text-white/40 focus:border-primary focus:bg-white/14 focus:ring-4 focus:ring-primary/20 disabled:bg-white/5"
										disabled={!hasActiveSession}
									/>

									<button
										onClick={quizeStartFunction}
										disabled={!hasActiveSession}
										className="group relative inline-flex min-h-14 items-center justify-center gap-3 overflow-hidden rounded bg-gradient-to-r from-primary via-secondary to-accent px-7 text-base font-bold text-white shadow-lg shadow-primary/25 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 disabled:cursor-not-allowed disabled:opacity-55"
									>
										<span className="absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-18deg] bg-white/25 transition duration-700 group-hover:left-[120%]" />
										<CirclePlay size={20} />
										{hasActiveSession ? "Start Session" : "Waiting..."}
									</button>
								</div>
								{bootstrapError && (
									<p className="mt-4 rounded-xl bg-accent/10 px-4 py-3 text-sm font-semibold text-accent">
										{bootstrapError}
									</p>
								)}
							</div>
						</div>
					</div>

					<aside className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_26px_80px_rgba(15,23,42,.12)] backdrop-blur">
						<div className="mb-5 flex items-center justify-between gap-3">
							<div>
								<p className="text-xs font-black uppercase tracking-wide text-slate-500">
									Ready queue
								</p>
								<h2 className="text-2xl font-black text-slate-950">
									Active Participants
								</h2>
							</div>
							<span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-black text-primary">
								{participantsActive} Online
							</span>
						</div>

						<div className="max-h-[360px] space-y-3 overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none]">
							{activeUsersData?.map((item, index) => (
								<div
									key={item.userId || index}
									className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"
								>
									<div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-sm font-black text-white shadow-sm">
										{item?.userName?.charAt(0).toUpperCase()}
									</div>
									<div className="min-w-0 flex-1">
										<p className="truncate font-black text-slate-950">
											{item.userName}
										</p>
										<p className="truncate text-xs font-semibold text-slate-500">
											ID: {item.userId}
										</p>
									</div>
									<span className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_0_5px_rgba(247,153,69,.14)]" />
								</div>
							))}

							{(!activeUsersData || activeUsersData.length === 0) && (
								<div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-slate-500">
									<div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
										<UserRoundPlus className="h-7 w-7" />
									</div>
									<p className="font-black text-slate-800">
										No active participants
									</p>
									<p className="mt-1 text-sm font-medium">
										Share the join code below and the queue will fill here.
									</p>
								</div>
							)}
						</div>
					</aside>
				</section>

				<section className="grid gap-4 sm:grid-cols-3">
					<QuestHostMetricCard
						label="Participants"
						value={participantsActive}
						icon={<Users />}
						tone="success"
					/>
					<QuestHostMetricCard
						label="Quest Tasks"
						value={response?.tasks?.length ?? 0}
						icon={<ClipboardList />}
						tone="primary"
					/>
					<QuestHostMetricCard
						label="Session"
						value={hasActiveSession ? "Ready" : "Waiting"}
						icon={<Radio />}
						tone={hasActiveSession ? "secondary" : "slate"}
					/>
				</section>

				<section className="rounded-[28px] border border-white/80 bg-white/95 p-4 shadow-[0_26px_80px_rgba(15,23,42,.1)] backdrop-blur">
					<Summary
						participantsNumber={participantsActive}
						urlnamelive="quest-live/"
					/>
				</section>
			</main>
		</QuestHostLiveShell>
	);
}

export default QuizReport;
