/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { SiKdenlive } from "react-icons/si";
import { Modal } from "@/components/ui";
import Image from "next/image";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { useParams, useRouter } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { setQuiz } from "@/features/quiz/store/quizInformationSlice";
import { useDispatch } from "react-redux";
import { DatePicker } from "antd";
import dayjs from "dayjs";
import { Switch } from "@/components/FormElements/switch";
import moment from "@/lib/dayjs";

import {
	setQuestSession,
	// clearQuestSession,
} from "@/features/quest/store/questSessionSlice";
import { toast } from "react-toastify";

const quizSchema = z
	.object({
		title: z.string().min(1, "Title is required"),
		is_published: z.boolean(),
		open_datetime: z.date(),
		close_datetime: z.date().refine((date) => date > new Date(), {
			message: "End date cannot be in the past",
		}),
		quiztime_mode: z.boolean(),
		duration: z.number(),
		safe_browser_mode: z.boolean(),
	})
	.refine((data) => data.close_datetime > data.open_datetime, {
		message: "End date must be after start date",
		path: ["close_datetime"],
	})
	.refine(
		(data) => {
			console.log(data.quiztime_mode, "data.quiztime_mode");

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

const HostLater: React.FC = () => {
	const params = useParams();
	const router = useRouter();
	const dispatch = useDispatch();
	const [isModalOpen, setIsModalOpen] = React.useState<boolean>(false);
	const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
			open_datetime: new Date(),
			close_datetime: new Date(),
			quiztime_mode: true,
			duration: 1,
			safe_browser_mode: false,
		},
	});

	const isQuizTime = watch("quiztime_mode");
	const dataFetch = async () => {
		try {
			const response = await axiosInstance.get(
				`/quizes/show/${params?.id}`
			);
			setIsModalOpen(true);
			const quizresponse = response?.data?.data;
			console.log(quizresponse, "quizresponsequizresponse");

			reset({
				title: quizresponse.quiz.title,
				is_published: quizresponse.quiz.is_published,
				// UTC ISO strings from the API: new Date() gives the local time (see QuizeSetting).
				open_datetime: quizresponse.quiz.open_datetime
					? new Date(quizresponse.quiz.open_datetime)
					: new Date(),

				close_datetime: quizresponse.quiz.close_datetime
					? new Date(quizresponse.quiz.close_datetime)
					: new Date(Date.now() + 24 * 60 * 60 * 1000),

				quiztime_mode: Boolean(quizresponse.quiz.quiztime_mode),
				duration: quizresponse.quiz.duration || 10,
				safe_browser_mode: Boolean(quizresponse.quiz.safe_browser_mode),
			});
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data
				);
				toast.error(
					`Error: ${
						axiosError.response.data?.message ||
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
		const obj = {
			...data,
			// Sharing it is publishing it (the old "Private" switch here only flipped this flag).
			is_published: true,
			open_datetime: moment(data.open_datetime).format(
				"YYYY-MM-DD HH:mm:ss"
			),
			close_datetime: moment(data.close_datetime).format(
				"YYYY-MM-DD HH:mm:ss"
			),
			quiztime_mode: data.quiztime_mode ? 1 : 0,
			// The pickers show local time; without it the server read these dates as UTC.
			timezone: currentTimeZone,
		};
		try {
			// Awaited (it wasn't): the quiz is re-read and the session created right after.
			await axiosInstance.post(`/quizes/update/${params?.id}`, obj);
			// console.log(response, "responseData?.data");
			const responseData = await axiosInstance.get(
				`/quizes/show/${params?.id}`
			);
			// console.log(responseData?.data, "responseData?.data");
			dispatch(setQuiz(responseData?.data?.data));

			const endDateTimeString = data.close_datetime;
			const time = moment(endDateTimeString).format(
				"YYYY-MM-DD HH:mm:ss"
			);
			await hostLiveApiCall(time);

			router.push(`/quiz-reports/${params?.id}`);
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data
				);
				toast.error(axiosError.response.data?.message || "The quiz could not be scheduled.");
			} else {
				console.error("Unexpected error:", axiosError.message);
				toast.error("Unexpected error occurred. Please try again.");
			}
		}
	};

	const hostLiveApiCall = async (endDate: any) => {
		// A name the host can recognise in the session list (it was always "Host later").
		const titleList = `Self-paced · ${moment().format("D MMM YYYY, HH:mm")}`;
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
				`/quizes/host-live/${params?.id}`,
				obj
			);
			console.log(
				respnson?.data.data.quizSession,
				"respnsonrespnsonrespnsonrespnsonrespnsonrespnson"
			);

			// Store the quest session data in Redux
			if (respnson?.data.data.quizSession) {
				dispatch(setQuestSession(respnson?.data.data.quizSession));
			}
		} catch (error) {
			console.error("API call failed:", error);
		}
	};

	const onSubmit = (data: QuizFormValues): void => {
		HostLiveSubmith(data);
	};

	return (
		<div>
			<div
				onClick={() => dataFetch()}
				className="flex cursor-pointer items-center gap-4 bg-[#f2f1f0] shadow-1 p-3 rounded-md"
			>
				<SiKdenlive className="text-[30px]" />
				<div className="flex flex-col">
					<h5 className="text-[17px] font-bold"> Host Later </h5>
					<p className="text-[#858585]">
						Share a link players can open any time
					</p>
				</div>
			</div>

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
									Self-paced quiz
								</h3>
								<p className="text-[0.875rem] text-[#fff]">
									Players answer on their own device at their own
									pace. Perfect for homework, or for anyone who
									can&apos;t join a live game.
								</p>
							</div>
						</div>

						<div className="md:col-span-7">
							<h3 className="text-[20px] font-bold pb-[10px] text-[#222]">
								Share a self-paced quiz
							</h3>

							<p className="text-sm text-[#666]">Players can join and finish it between these times.</p>

							<div className="grid relative grid-cols-1 md:grid-cols-12 gap-2 mt-[10px]">
								<div className="md:col-span-6">
									<h3 className="font-bold text-[14px] pb-[8px]">
										{" "}
										Start Date{" "}
									</h3>
									<Controller
										name="open_datetime"
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
									{errors.open_datetime && (
										<p className="text-red-500 text-sm">
											{errors.open_datetime.message}
										</p>
									)}
								</div>

								<div className="md:col-span-6">
									<h3 className="font-bold text-[14px] pb-[8px]">
										{" "}
										End date{" "}
									</h3>
									<Controller
										name="close_datetime"
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
									{errors.close_datetime && (
										<p className="text-red-500 text-sm">
											{errors.close_datetime.message}
										</p>
									)}
								</div>
							</div>

							<div className="pt-[10px]">
								<div className="mb-3">
									<label className="flex items-center justify-between cursor-pointer">
										<span>
											<span className="block text-[#222] font-bold text-sm">
												Time limit for the whole quiz
											</span>
											<span className="block text-xs text-[#888]">
												{isQuizTime
													? "Players get this many minutes in total."
													: "Off: each question uses its own time limit."}
											</span>
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
														className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition ${
															field.value
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
									<div className="relative mb-[15px]">
										<input
											type="number"
											min={1}
											aria-label="Quiz time in minutes"
											{...register("duration", {
												valueAsNumber: true,
												required: isQuizTime
													? true
													: false,
											})}
											placeholder="Minutes"
											className="w-full border pl-3 pr-20 py-2 rounded-md focus:outline-none focus:ring focus:border-[#bc5eb3]"
										/>
										<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#888]">
											minutes
										</span>
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
														className={`dot absolute left-1 top-1 w-6 h-6 bg-white rounded-full transition-transform duration-300 ${
															field.value
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

export default HostLater;
