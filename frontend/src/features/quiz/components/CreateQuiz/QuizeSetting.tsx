import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui";
import { PencilSquareIcon } from "@/assets/icons";
import InputGroup from "@/components/FormElements/InputGroup";
import { TextAreaGroup } from "@/components/FormElements/InputGroup/text-area";

import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
// import DatePickerOne from '@/components/FormElements/DatePickerOne';
import { useDispatch, useSelector } from "react-redux";
import { Switch } from "@/components/FormElements/switch";
import { Quiz } from "@/types/types";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { useParams } from "next/navigation";
import { toast } from "react-toastify";
import { setQuiz } from "@/features/quiz/store/quizInformationSlice";
import moment from "@/lib/dayjs";
import { DatePicker } from "antd";
import { Pencil, Type } from "lucide-react";
import dayjs from "dayjs";

interface QuizState {
	quiz: Quiz;
}
interface RootState {
	quizInformation: {
		quizInformation: QuizState;
	};
}

interface QuizeSettingProps {
	// isModalOpen: boolean;
	defailtValueUse: string;
	// setIsModalOpen: (value: boolean) => void;
}

function QuizeSetting({ defailtValueUse }: QuizeSettingProps) {
	// console.log(defailtValueUse, "response?.quiz?.title");
	const [isModalOpen, setIsModalOpen] = useState(false);

	const params = useParams();
	const dispatch = useDispatch();
	const response = useSelector(
		(state: RootState) => state.quizInformation.quizInformation
	);
	const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	const quiz = response?.quiz;
	const visibilityStatus = quiz?.visibility === "private" ? false : true;

	const formSchema = z.object({
		title: z.string().min(1, "Title is required"),
		description: z.string().optional(),
		open_datetime: z.date().nullable().optional(),
		close_datetime: z.date().nullable().optional(),
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
			open_datetime: null,
			close_datetime: null,
			is_public: false,
		},
	});

	useEffect(() => {
		if (quiz) {
			reset({
				title: quiz.title === "My Quiz" ? "" : quiz.title,
				description: quiz.description ?? "",
				// The API sends UTC ISO strings ("...Z"), so new Date() already gives the local time that the
				// pickers show and that is sent back with the local timezone. Adding the timezone offset
				// showed UTC wall-clock times and moved the dates by that offset on every save.
				open_datetime: quiz.open_datetime
					? new Date(quiz.open_datetime)
					: new Date(),

				close_datetime: quiz.close_datetime
					? new Date(quiz.close_datetime)
					: new Date(Date.now() + 24 * 60 * 60 * 1000),

				is_public: visibilityStatus,
			});
		}
	}, [quiz, reset, visibilityStatus]);

	const onSubmit = async (data: FormData) => {
		// "Public" shares the quiz as a template (its visibility). It used to set is_published,
		// which unpublished the quiz (players couldn't join) and left it listed as public.
		const { is_public, ...fields } = data;
		const formattedData = {
			...fields,
			visibility: is_public ? "public" : "private",
			open_datetime: moment(data.open_datetime).format(
				"YYYY-MM-DD HH:mm:ss"
			),
			close_datetime: moment(data.close_datetime).format(
				"YYYY-MM-DD HH:mm:ss"
			),
			timezone: `${currentTimeZone}`,
		};

		console.log(
			formattedData,
			"formattedDataformattedDataformattedDataformattedData"
		);

		try {
			const response = await axiosInstance.post(
				`/quizes/update/${params?.quizId}`,
				formattedData
			);
			toast.success(response.data.message);
			setIsModalOpen(false);
			const responseData = await axiosInstance.get(
				`/quizes/show/${params?.quizId}`
			);
			// console.log(responseData?.data, "responseData?.data");
			dispatch(setQuiz(responseData?.data?.data));
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data
				);
				toast.error(
					axiosError.response.data?.message || "Verification failed."
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

	return (
		<div className="w-full">
			{/* One clear control: the quiz's name (or a prompt to name it) that opens its settings. */}
			<button
				type="button"
				onClick={() => setIsModalOpen(true)}
				title="Edit the quiz title and settings"
				className="group flex h-[50px] w-[300px] max-w-full items-center gap-3 rounded-[10px] border border-[#e5e5e5] bg-white pl-4 pr-3 text-left outline-none transition hover:border-primary focus-visible:border-primary dark:border-dark-3 dark:bg-dark-2"
			>
				<span className="min-w-0 flex-1 truncate">
					{defailtValueUse && defailtValueUse !== "My Quiz" ? (
						<span className="font-semibold text-[#222] dark:text-white">{defailtValueUse}</span>
					) : (
						<span className="text-[#999]">Untitled quiz</span>
					)}
				</span>
				<span className="flex flex-shrink-0 items-center gap-1 rounded-md bg-[#f5f5f5] px-2 py-1 text-xs font-medium text-[#555] group-hover:bg-[#fff3e8] group-hover:text-primary">
					<Pencil className="h-3.5 w-3.5" aria-hidden />
					Edit
				</span>
			</button>
			<Modal
				title="Quiz settings"
				open={isModalOpen}
				onClose={() => setIsModalOpen(false)}
			>
				<div className="">
					<form onSubmit={handleSubmit(onSubmit)}>
						<InputGroup
							className="mb-5.5"
							type="text"
							label="Title"
							placeholder="Enter Quiz Name"
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
							<div className="sm:w-1/2">
								<h3 className="text-[14px] pb-[8px]">
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
							<div className="sm:w-1/2">
								<h3 className="text-[14px] pb-[8px]">
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
								Note: Setting this Quiz to <b>Public</b> makes
								it available to all users as a template.
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

export default QuizeSetting;
