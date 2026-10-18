/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useDispatch } from "react-redux";
import { MdLiveTv } from "react-icons/md";
import { toast } from "react-toastify";
import axiosInstance from "@/utils/axiosInstance";
import moment from "@/lib/dayjs";
import { setQuiz } from "@/features/quiz/store/quizInformationSlice";
import {
	clearQuestSession,
	setQuestSession,
} from "@/features/quest/store/questSessionSlice";
import { setScope } from "@/features/live/store/leaderboardSlice";

const HostLive: React.FC = () => {
	const params = useParams();
	const router = useRouter();
	const dispatch = useDispatch();
	const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	useEffect(() => {
		dispatch(clearQuestSession());
	}, [dispatch]);

	// A readable session name, e.g. "Science quiz · 18 Oct, 12:15" (it was "Science_quiz_Oct_18_12_15_PM").
	const generateFormattedTitle = (baseTitle = "Live quiz") =>
		`${baseTitle || "Live quiz"} · ${moment().format("D MMM, HH:mm")}`;

	const getLiveEndDatetime = (quiz: any) => {
		const now = moment();
		const close = quiz?.close_datetime ? moment(quiz.close_datetime) : null;

		if (close?.isValid?.() && close.isAfter(now)) {
			return close.format("YYYY-MM-DD HH:mm:ss");
		}

		return now.add(24, "hour").format("YYYY-MM-DD HH:mm:ss");
	};

	const hostLiveApiCall = async (endDate: string, title?: string) => {
		const payload = {
			title: generateFormattedTitle(title),
			timezone: currentTimeZone,
			start_datetime: moment().format("YYYY-MM-DD HH:mm:ss"),
			end_datetime: endDate,
		};

		const response = await axiosInstance.post(
			`/quizes/host-live/${params?.id}`,
			payload
		);
		const quizSession = response?.data?.data?.quizSession;

		if (!quizSession) {
			throw new Error("Quiz session was not returned by the server.");
		}

		dispatch(setQuestSession(quizSession));

		const search = new URLSearchParams({
			sid: String(quizSession.id),
		});
		if (quizSession.public_channel_key) {
			search.set("pck", quizSession.public_channel_key);
		}

		router.push(`/quiz-play/${params?.id}?${search.toString()}`);
	};

	const hostLiveFunction = async () => {
		try {
			const response = await axiosInstance.get(`/quizes/show/${params?.id}`);
			const quiz = response?.data?.data?.quiz;

			if (!quiz) {
				toast.error("Quiz not found.");
				return;
			}

			dispatch(setQuiz(response?.data?.data));
			dispatch(setScope("entire"));

			await hostLiveApiCall(getLiveEndDatetime(quiz), quiz.title);
		} catch (error) {
			console.error("Failed to start live quiz:", error);
			toast.error("Unable to start live quiz. Please try again.");
		}
	};

	return (
		<button
			type="button"
			onClick={hostLiveFunction}
			className="flex w-full cursor-pointer items-center gap-4 rounded-md bg-[#f2f1f0] p-3 text-left shadow-1"
			aria-label="Host Live"
		>
			<MdLiveTv className="text-[30px]" />
			<div className="flex flex-col">
				<h5 className="text-[17px] font-bold">Host Live</h5>
				<p className="text-[#858585]">Run it together, shown on a big screen</p>
			</div>
		</button>
	);
};

export default HostLive;
