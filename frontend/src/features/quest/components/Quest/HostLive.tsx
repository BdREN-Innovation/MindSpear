/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect } from "react";
import { SiKdenlive } from "react-icons/si";
import { Modal } from "@/components/ui";
import Image from "next/image";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { useParams, useRouter } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { useDispatch } from "react-redux";
import { DatePicker } from "antd";
import dayjs from "dayjs";
import { Switch } from "@/components/FormElements/switch";
import moment from "@/lib/dayjs";
import { setQuest } from "@/features/quest/store/questInformationSlice";

import {
	setQuestSession,
	clearQuestSession,
} from "@/features/quest/store/questSessionSlice";
import { getHostLiveSession } from "@/features/live/services/liveSessionApi";
import {
	armQuestHostMusic,
	startQuestHostMusic,
} from "@/features/live/services/questHostAudio";

import { toast } from "react-toastify";

const quizSchema = z
	.object({
		title: z.string().min(1, "Title is required"),
		is_published: z.boolean(),
		start_datetime: z.date(),
		end_datetime: z.date().refine((date) => date > new Date(), {
			message: "End date cannot be in the past",
		}),
		quiztime_mode: z.boolean(),
		duration: z.number(),
		safe_browser_mode: z.boolean(),
	})
	.refine((data) => data.end_datetime > data.start_datetime, {
		message: "End date must be after start date",
		path: ["end_datetime"],
	})
	.refine(
		() => {
			// if (data.quiztime_mode) {
			//   return typeof data.duration === "number" && data.duration >= 1;
			// }
			return true;
		},
		{
			message:
				"Duration is required and must be at least 1 when Quiz Time is enabled",
			path: ["duration"],
		}
	);

type QuizFormValues = z.infer<typeof quizSchema>;

interface HostLiveProps {
	titleData: string | undefined;
	status?: string;
	questData?: string;
}

const HostLive: React.FC<HostLiveProps> = ({
	titleData,
	status,
	questData,
}: any) => {
	// console.log(title, "titletitletitletitle");

	const params = useParams();
	const router = useRouter();
	const dispatch = useDispatch();
	const [isModalOpen, setIsModalOpen] = React.useState<boolean>(false);

	const questId = `${params?.id}`;
	const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	useEffect(() => {
		dispatch(clearQuestSession());
	}, [dispatch]);

	const beginHostMusic = () => {
		armQuestHostMusic();
		void startQuestHostMusic();
	};

	const {
		control,
		register,
		handleSubmit,
		watch,
		reset,
		formState: { errors },
	} = useForm<QuizFormValues>({
		resolver: zodResolver(quizSchema),
		defaultValues: {
			title: "",
			is_published: false,
			start_datetime: new Date(),
			end_datetime: new Date(),
			quiztime_mode: true,
			duration: 1,
			safe_browser_mode: false,
		},
	});

	const isQuizTime = watch("quiztime_mode");
	const dataFetch = async () => {
		try {
			const response = await axiosInstance.get(
				`/quests/show/${params?.id}`
			);
			setIsModalOpen(true);
			const quizresponse = response?.data?.data.quest;

			// const time = quizresponse.end_datetime.format(
			// 	"YYYY-MM-DD HH:mm:ss"
			// );
			// hostLiveApiCall(time);
			// console.log(status, "quizresponse quizresponse");

			reset({
				title: quizresponse.title,
				is_published: quizresponse.is_published,
				start_datetime: quizresponse.start_datetime
					? new Date(
						new Date(quizresponse.start_datetime).getTime() +
						new Date().getTimezoneOffset() * 60000
					)
					: new Date(),

				end_datetime: quizresponse.end_datetime
					? new Date(
						new Date(quizresponse.end_datetime).getTime() +
						new Date().getTimezoneOffset() * 60000
					)
					: new Date(Date.now() + 24 * 60 * 60 * 1000),

				quiztime_mode: Boolean(quizresponse.quiztime_mode),
				duration: quizresponse.duration || 10,
				safe_browser_mode: Boolean(quizresponse.safe_browser_mode),
			});
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data
				);
				toast.error(
					`Error: ${axiosError.response.data?.message ||
					"Verification failed."
					}`
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
				toast.error("Unexpected error occurred. Please try again.");
			}
		} finally {
		}
	};

	const HostLiveSubmith = async (data: QuizFormValues) => {
		beginHostMusic();
		const obj = {
			...data,
			start_datetime: moment(data.start_datetime).format(
				"YYYY-MM-DD HH:mm:ss"
			),
			end_datetime: moment(data.end_datetime).format(
				"YYYY-MM-DD HH:mm:ss"
			),
			quiztime_mode: data.quiztime_mode ? 1 : 0,
		};
		try {
			await axiosInstance.post(
				`/quests/update/${params?.id}`,
				obj
			);
			// console.log(response, "responseData?.data");
			const responseData = await axiosInstance.get(
				`/quests/show/${params?.id}`
			);
			// console.log(responseData?.data, "responseData?.data");
			dispatch(setQuest(responseData?.data?.data.quest));

			const endDateTimeString =
				responseData?.data?.data.quest.end_datetime;
			const time = moment(endDateTimeString).format(
				"YYYY-MM-DD HH:mm:ss"
			);
			await hostLiveApiCall(time);
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
			}
		}
	};

	// Start the QUEST
	const quizeStartFunction = async () => {
		beginHostMusic();
		try {
			const session = await getHostLiveSession("quest", questId);
			dispatch(setQuestSession(session));

			// A session that hasn't started a task yet goes back to its lobby (Start sends the first
			// task to players); the live screen showed task 1 while players waited in the lobby.
			if (!(session as { current_task_id?: number | null }).current_task_id) {
				const lobby = new URLSearchParams({ sid: String(session.id) });
				if (session.public_channel_key) lobby.set("pck", session.public_channel_key);
				router.push(`/quests-session/${questId}?${lobby.toString()}`);
				return;
			}

			const search = new URLSearchParams({
				jlk: questData,
				qid: questId,
				sid: String(session.id),
			});
			if (session.public_channel_key) {
				search.set("pck", session.public_channel_key);
			}

			router.push(`/live/quests?${search.toString()}`);
		} catch (error) {
			console.error("Failed to continue live quest:", error);
			toast.error("Unable to continue the live quest right now.");
		}
	};

	const onSubmit = (data: QuizFormValues): void => {
		HostLiveSubmith(data);
	};

	function shouldFetch(quest: any) {
		const now = new Date(); // current time (your local tz)
		const start = new Date(quest.start_datetime); // UTC ISO parsed correctly
		const end = new Date(quest.end_datetime);

		// fetch only while the quest is active (between start and end, inclusive)
		return now >= start && now <= end;
	}

	const hostLiveFunction = async () => {
		beginHostMusic();
		const response = await axiosInstance.get(`/quests/show/${params?.id}`);
		const data_quest = response?.data?.data?.quest;
		if (shouldFetch(data_quest)) {
			const responseData = await axiosInstance.get(
				`/quests/show/${params?.id}`
			);
			dispatch(setQuest(responseData?.data?.data.quest));
			const endDateTimeString =
				responseData?.data?.data.quest.end_datetime;
			const time = moment(endDateTimeString).format(
				"YYYY-MM-DD HH:mm:ss"
			);
			await hostLiveApiCall(time);
		} else {
			dataFetch();
		}
	};

	const currentDate = new Date();

	// A readable session name, e.g. "Team check-in · 18 Oct, 13:09" (it was "Team_check-in_Oct_18_13_09_PM").
	function generateFormattedTitle(baseTitle = titleData) {
		return `${baseTitle || "Live quest"} · ${moment(currentDate).format("D MMM, HH:mm")}`;
	}

	const hostLiveApiCall = async (endDate: any) => {
		const titleList = generateFormattedTitle(titleData);
		const now = moment();
		const formatted = now.format("YYYY-MM-DD HH:mm:ss");
		const obj = {
			title: `${titleList}`,
			timezone: `${currentTimeZone}`,
			start_datetime: `${formatted}`,
			end_datetime: `${endDate}`,
		};

		try {
			const respnson = await axiosInstance.post(
				`/quests/host-live/${params?.id}`,
				obj
			);

			// Store the quest session data in Redux
			if (respnson?.data.data.questSession) {
				const questSession = respnson?.data.data.questSession;
				dispatch(setQuestSession(questSession));

				const search = new URLSearchParams({
					sid: String(questSession.id),
				});
				if (questSession.public_channel_key) {
					search.set("pck", questSession.public_channel_key);
				}

				router.push(`/quests-session/${params?.id}?${search.toString()}`);
			}
		} catch (error) {
			console.error("API call failed:", error);
		}
	};

	return (
		<div>
			<button
				type="button"
				onClick={() =>
					status === "Running"
						? quizeStartFunction()
						: hostLiveFunction()
				}
				className="flex w-full items-center gap-4 bg-green-100 hover:bg-green-200 p-3 rounded-md transform hover:-translate-y-0.5 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-300 border border-green-200"
				aria-label="Host Live"
			>
				<SiKdenlive className="text-[30px] text-green-700" />
				<div className="flex flex-col text-left">
					<h5 className="text-[17px] font-bold text-green-800">
						{status === "Running"
							? "Continue Live Session"
							: "Host Live"}
					</h5>
					<p className="text-green-700">
						{status === "Running"
							? "This quest is currently running — continue the live session."
							: "Display from a big screen"}
					</p>
				</div>
			</button>

			<Modal
				title=""
				open={isModalOpen}
				onClose={() => setIsModalOpen(false)}
			>
				<form onSubmit={handleSubmit(onSubmit)}>
					<div className="grid relative grid-cols-1 md:grid-cols-12 gap-5 md:h-[410px]">
						<div className="md:col-span-5 p-4 hidden md:block">
							<div className="h-[475px] absolute top-[-45px] left-[-25px] w-[40%] p-[20px] bg-[#bc5eb3] rounded-tl-[13px] rounded-bl-[5px] flex flex-col justify-center items-center text-center">
								<Image
									src="/images/challenge.svg"
									alt="challenge"
									width={176}
									height={32}
									className="mb-6"
								/>
								<h3 className="text-[20px] font-bold pb-[10px] text-[#fff]">
									{" "}
									Assigning MindSpear{" "}
								</h3>
								<p className="text-[0.875rem] text-[#fff]">
									Create a self-paced MindSpear with questions
									and answers displayed on the participant s
									device. Perfect for on the go, or for those
									who can t join the live game.
								</p>
							</div>
						</div>

						<div className="md:col-span-7">
							<h3 className="text-[20px] font-bold pb-[10px] text-[#222]">
								{" "}
								Create an assigned MindSpear
							</h3>

							<p> Participants should complete it before: </p>

							<div className="grid relative grid-cols-1 md:grid-cols-12 gap-2 mt-[10px]">
								<div className="md:col-span-6">
									<h3 className="font-bold text-[14px] pb-[8px]">
										{" "}
										Start Date{" "}
									</h3>
									<Controller
										name="start_datetime"
										control={control}
										render={({ field }) => (
											<DatePicker
												showTime={{ format: "HH:mm" }}
												format="YYYY-MM-DD HH:mm"
												className="w-full mb-2 h-[45px] font-bold"
												onChange={(date) =>
													field.onChange(
														date
															? date.toDate()
															: null
													)
												}
												value={
													field.value
														? dayjs(field.value)
														: null
												}
											/>
										)}
									/>
									{errors.start_datetime && (
										<p className="text-red-500 text-sm">
											{errors.start_datetime.message}
										</p>
									)}
								</div>

								<div className="md:col-span-6">
									<h3 className="font-bold text-[14px] pb-[8px]">
										{" "}
										End date{" "}
									</h3>
									<Controller
										name="end_datetime"
										control={control}
										render={({ field }) => (
											<DatePicker
												showTime={{ format: "HH:mm" }}
												format="YYYY-MM-DD HH:mm"
												className="w-full mb-2 h-[45px] font-bold"
												onChange={(date) =>
													field.onChange(
														date
															? date.toDate()
															: null
													)
												}
												value={
													field.value
														? dayjs(field.value)
														: null
												}
											/>
										)}
									/>
									{errors.end_datetime && (
										<p className="text-red-500 text-sm">
											{errors.end_datetime.message}
										</p>
									)}
								</div>
							</div>

							<div className="pt-[10px]">
								<div className="mb-3">
									<label className="flex items-center justify-between cursor-pointer">
										<span className="text-[#222] font-bold text-sm">
											{isQuizTime
												? "Quiz Time"
												: "Question Time"}
										</span>
										<Controller
											name="quiztime_mode"
											control={control}
											render={({ field }) => (
												<div className="relative">
													<input
														type="checkbox"
														checked={field.value}
														onChange={(e) =>
															field.onChange(
																e.target.checked
															)
														}
														className="sr-only w-[200px]"
													/>
													<div
														className="block w-14 h-8 rounded-full transition-all"
														style={{
															backgroundColor:
																field.value
																	? "#bc5eb3"
																	: "#d1d5db",
														}}
													/>
													<div
														className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition ${field.value
															? "translate-x-6"
															: ""
															}`}
													/>
												</div>
											)}
										/>
									</label>
								</div>

								{isQuizTime && (
									<div>
										<input
											type="number"
											{...register("duration", {
												valueAsNumber: true,
												required: isQuizTime
													? true
													: false,
											})}
											placeholder="Enter quiz time (min)"
											className="w-full border mb-[15px] px-3 py-2 rounded-md focus:outline-none focus:ring focus:border-[#bc5eb3]"
										/>
										{/* {errors.duration && (
                        <p className="text-red-500 text-sm mt-[-10px] mb-2">
                          {errors.duration.message}
                        </p>
                      )} */}
									</div>
								)}
							</div>

							<div className="pt-[5px]">
								<div className="mb-3">
									<label className="flex items-center justify-between cursor-pointer w-full">
										<span className="text-[#222] font-bold text-sm">
											Safe browser mode
										</span>
										<Controller
											name="safe_browser_mode"
											control={control}
											render={({ field }) => (
												<div className="relative">
													<input
														type="checkbox"
														checked={field.value}
														onChange={(e) =>
															field.onChange(
																e.target.checked
															)
														}
														className="sr-only"
													/>
													<div
														className="block w-14 h-8 rounded-full transition-colors duration-300"
														style={{
															backgroundColor:
																field.value
																	? "#bc5eb3"
																	: "#d1d5db",
														}}
													/>
													<div
														className={`dot absolute left-1 top-1 w-6 h-6 bg-white rounded-full transition-transform duration-300 ${field.value
															? "translate-x-6"
															: ""
															}`}
													/>
												</div>
											)}
										/>
									</label>
								</div>
							</div>

							<div className="pt-[5px]">
								<div className="mb-3">
									<Controller
										name="is_published"
										control={control}
										render={({ field }) => (
											<div className="flex gap-3 items-center font-bold">
												<Switch
													checked={field.value}
													onChange={field.onChange}
												/>
												<span className="text-sm text-dark dark:text-white">
													{field.value
														? "Published"
														: "Private"}
												</span>
											</div>
										)}
									/>
								</div>
							</div>

							<div className="flex gap-2 justify-center items-center">
								<button
									type="button"
									onClick={() => setIsModalOpen(false)}
									className="bg-[#bc5eb3] hover:bg-[#fff] hover:text-[#222] border border-[#2222] text-[16px] py-[5px] px-[20px] text-white rounded-[10px]"
								>
									Cancel
								</button>
								<button
									type="submit"
									className="bg-[#ffa602] hover:bg-[#fff] hover:text-[#222] border border-[#2222] text-[16px] py-[5px] px-[20px] text-white rounded-[10px]"
								>
									Create
								</button>
							</div>
						</div>
					</div>
				</form>
			</Modal>
		</div>
	);
};

export default HostLive;
