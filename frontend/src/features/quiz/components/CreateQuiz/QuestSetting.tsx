import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui";
import { PencilSquareIcon } from "@/assets/icons";
import { Pencil, Type } from "lucide-react";
import InputGroup from "@/components/FormElements/InputGroup";
import { TextAreaGroup } from "@/components/FormElements/InputGroup/text-area";

import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDispatch, useSelector } from "react-redux";
import { Switch } from "@/components/FormElements/switch";
import { Quiz } from "@/types/types";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { useParams } from "next/navigation";
import { toast } from "react-toastify";
import { setQuest } from "@/features/quest/store/questInformationSlice";
import moment from "@/lib/dayjs";
import { DatePicker } from "antd";
import dayjs from "dayjs";

interface QuizState {
	quest: Quiz;
}
interface RootState {
	questInformation: {
		questInformation: QuizState;
	};
}

interface QuizeSettingProps {
	// isModalOpen: boolean;
	defailtValueUse: string;
	// setIsModalOpen: (value: boolean) => void;
}

function QuestSetting({ defailtValueUse }: QuizeSettingProps) {
	// console.log(defailtValueUse, "response?.quiz?.title");
	const [isModalOpen, setIsModalOpen] = useState(false);

	const params = useParams();
	const dispatch = useDispatch();
	const response = useSelector(
		(state: RootState) => state.questInformation.questInformation
	);
	const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	const quiz = response?.quest || response;

	const visibilityStatus = quiz?.visibility === "private" ? false : true;
	const [sessionList, setSessionList] = useState<number>();

	const formSchema = z.object({
		title: z.string().min(1, "Title is required"),
		description: z.string().optional(),
		start_datetime: z.date().nullable().optional(),
		end_datetime: z.date().nullable().optional(),
		is_public: z.boolean(),
	});

	type FormData = z.infer<typeof formSchema>;

	const {
		register,
		control,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<FormData>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			title: "",
			description: "",
			start_datetime: null,
			end_datetime: new Date(
				new Date().setFullYear(new Date().getFullYear() + 5)
			),
			is_public: false,
		},
	});
	// A new quest is created with a placeholder name; the field starts empty for it.
	const isPlaceholderTitle = (title?: string) => !title || title === "My Quest" || title === "Untitled Quest";
	useEffect(() => {
		if (quiz) {
			reset({
				title: isPlaceholderTitle(quiz.title) ? "" : quiz.title,
				description: quiz.description ?? "",
				// The API sends UTC; new Date() shows it in local time. Adding the UTC offset showed the
				// UTC time as if local, and saving it back moved the start by that offset each time.
				start_datetime: quiz.start_datetime ? new Date(quiz.start_datetime) : new Date(),
				is_public: visibilityStatus,
			});
		}
	}, [quiz, reset, visibilityStatus]);

	useEffect(() => {
		const quizFetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quest-leaderboard/session-list/${params?.id}`
				);
				setSessionList(response?.data?.data?.questSessions?.total);
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
				}
			} finally {
			}
		};
		quizFetch();
	}, [params?.id]);

	const onSubmit = async (data: FormData) => {
		const endTime = new Date(
			new Date().setFullYear(new Date().getFullYear() + 5)
		);
		// "Public" shares the quest as a template (its visibility); it used to set is_published instead.
		const { is_public, ...fields } = data;
		const formattedData = {
			...fields,
			visibility: is_public ? "public" : "private",
			start_datetime: moment(data.start_datetime).format(
				"YYYY-MM-DD HH:mm:ss"
			),
			end_datetime: moment(endTime).format("YYYY-MM-DD HH:mm:ss"),
			timezone: `${currentTimeZone}`,
		};
		try {
			const response = await axiosInstance.post(
				`/quests/update/${params?.id}`,
				formattedData
			);
			toast.success(response.data.message);
			setIsModalOpen(false);
			const responseData = await axiosInstance.get(
				`/quests/show/${params?.id}`
			);
			// console.log(responseData?.data, "responseData?.data");
			dispatch(setQuest(responseData?.data.data));
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data
				);
				toast.error(
					axiosError.response.data?.message || "The quest settings could not be saved."
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
				toast.error(
					axiosError.message ||
						"Unexpected error occurred. Please try again."
				);
			}
		}
	};

	const isDisabled = (sessionList ?? 0) > 0;

	return (
		<div className="w-full">
			{/* One clear control: the quest's name (or a prompt to name it) that opens its settings. */}
			<button
				type="button"
				disabled={isDisabled}
				onClick={() => setIsModalOpen(true)}
				title={
					isDisabled
						? "Settings can't be changed after the quest has been hosted"
						: "Edit the quest title and settings"
				}
				className="group flex h-[50px] w-[300px] max-w-full items-center gap-3 rounded-[10px] border border-[#e5e5e5] bg-white pl-4 pr-3 text-left outline-none transition hover:border-primary focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-[#e5e5e5] dark:border-dark-3 dark:bg-dark-2"
			>
				<span className="min-w-0 flex-1 truncate">
					{isPlaceholderTitle(defailtValueUse) ? (
						<span className="text-[#999]">Untitled quest</span>
					) : (
						<span className="font-semibold text-[#222] dark:text-white">{defailtValueUse}</span>
					)}
				</span>
				<span className="flex flex-shrink-0 items-center gap-1 rounded-md bg-[#f5f5f5] px-2 py-1 text-xs font-medium text-[#555] group-hover:bg-[#fff3e8] group-hover:text-primary">
					<Pencil className="h-3.5 w-3.5" aria-hidden />
					Edit
				</span>
			</button>
			<Modal
				title="Quest settings"
				open={isModalOpen}
				onClose={() => setIsModalOpen(false)}
			>
				<div className="">
					<form onSubmit={handleSubmit(onSubmit)}>
						<InputGroup
							className="mb-5.5"
							type="text"
							label="Title"
							placeholder="Enter Quest Name"
							icon={<Type className="h-5 w-5" aria-hidden />}
							iconPosition="left"
							height="sm"
							{...register("title")}
						/>
						{errors.title && (
							<p className="text-sm text-red-500 mt-[-18px] mb-4">
								{errors.title.message}
							</p>
						)}

						<div className="mb-5.5 flex flex-col gap-5.5 sm:flex-row">
							<div className="w-full">
								<h3 className="text-[14px] pb-[8px]">
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
											className="w-full mb-2 h-[45px]"
											onChange={(date) =>
												field.onChange(
													date ? date.toDate() : null
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
							</div>
							<div className="sm:w-1/2 hidden">
								<h3 className="text-[14px] pb-[8px]">
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
											className="w-full mb-2 h-[45px]"
											onChange={(date) =>
												field.onChange(
													date ? date.toDate() : null
												)
											}
											value={
												field.value
													? dayjs(field.value)
													: dayjs(
															new Date(
																new Date().setFullYear(
																	new Date().getFullYear() +
																		5
																)
															)
													  )
											}
										/>
									)}
								/>
							</div>
						</div>

						<TextAreaGroup
							className="mb-5.5"
							label="Description"
							placeholder="Write your description here"
							icon={<PencilSquareIcon />}
							{...register("description")}
						/>

						<div className="mb-5.5 flex items-center gap-4">
							<Controller
								name="is_public"
								control={control}
								render={({ field }) => (
									<>
										<Switch
											checked={field.value}
											onChange={field.onChange}
										/>
										<span className="text-sm text-dark dark:text-white">
											{field.value ? "Public" : "Private"}
										</span>
									</>
								)}
							/>
						</div>
						<div className="my-2 border border-gray-200 dark:border-gray-700 rounded-md p-3 bg-gray-50 dark:bg-dark-2">
							<p className="text-sm text-gray-600 dark:text-gray-300">
								Note: Setting this Quest to{" "}
								<strong>Public</strong> makes it available to
								all users as a template.
							</p>
						</div>
						<div className="flex justify-end gap-3">
							<button
								className="rounded-lg bg-primary px-6 py-[7px] font-medium text-gray-2 hover:bg-opacity-90"
								type="submit"
							>
								Update
							</button>
						</div>
					</form>
				</div>
			</Modal>
		</div>
	);
}

export default QuestSetting;
