"use client";

import QuizDateClose from "@/components/ErrorComponent/QuizDateClose";
import InputGroup from "@/components/FormElements/InputGroup";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import moment from "@/lib/dayjs";
import { useSearchParams, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { HiUserGroup } from "react-icons/hi";
import { toast } from "react-toastify";
import { storeParticipantTokenBundle } from "@/features/live/services/liveStorage";
interface QuizOption {
    color: string[];
    choices: (string | null)[];
    correct_answer: number;
}

interface Question {
    id: number;
    quiz_id: number;
    serial_number: number | null;
    question_text: string;
    question_type: string | null;
    time_limit_seconds: number | null;
    points: number | null;
    is_ai_generated: boolean;
    source_content_url: string | null;
    options: QuizOption | null;
    visibility: string;
    deleted_at: string | null;
    deleted_by: number | null;
    created_at: string;
    updated_at: string;
}

interface User {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    email_verified_at: string;
    email_verification_token: string | null;
    is_verified: boolean;
    profile_picture: string;
    account_type: string;
    institution_id: number | null;
    institution_name: string;
    designation: string;
    department: string;
    provider: string | null;
    provider_id: string | null;
    created_at: string;
    updated_at: string;
    full_name: string;
    institution: string | null;
}

interface Quiz {
    id: number;
    title: string;
    description: string | null;
    category_id: number | null;
    is_published: boolean;
    open_datetime: string;
    close_datetime: string;
    quiztime_mode: boolean;
    duration: number;
    logged_in_users_only: boolean;
    safe_browser_mode: boolean;
    visibility: string;
    quiz_mode: string;
    timezone: string;
    join_link: string;
    join_code: string;
    deleted_at: string | null;
    user_id: number;
    deleted_by: number | null;
    created_at: string;
    updated_at: string;
    questions: Question[];
    user: User;
}

interface QuizResponse {
    quiz: Quiz;
}

function GlobalAttempFrom() {
    const searchParams = useSearchParams();
    const router = useRouter();
    // const id = params?.id;
    const joinid = searchParams.get("jid");
    // const qid = searchParams.get('qid');
    const [currentUserName, setCurrentUserName] = useState("");
    const [joining, setJoining] = useState(false);
    const [quizData, setQuizData] = useState<QuizResponse | null>(null);

    const [quizErrorMessage, setQuizErrorMessage] = useState<
        string | undefined
    >();
    const [quizErrorStatus, setQuizErrorStatus] = useState<boolean>(false);

    useEffect(() => {
        const handleClearQuizData = async () => {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith("quiz")) {
                    localStorage.removeItem(key);
                    i = -1;
                }
            }
        };
        handleClearQuizData();
    }, []);

    useEffect(() => {
        const dataFetch = async () => {
            try {
                const response = await axiosInstance.get<{
                    data: QuizResponse;
                }>(`/quiz-attempts-url/show/${joinid}`);
                setQuizData(response?.data.data);
                console.log(
                    response?.data.data,
                    "response?.data.dataresponse?.data.data"
                );
            } catch (error) {
                const axiosError = error as AxiosError<{ message?: string }>;

                if (axiosError.response) {
                    const msg =
                        axiosError.response.data?.message ||
                        "Verification failed.";
                    console.error("Error verifying token:", msg);
                    setQuizErrorMessage(msg);
                    setQuizErrorStatus(true);
                } else {
                    console.error("Unexpected error:", axiosError.message);
                    setQuizErrorMessage(
                        "Unexpected error occurred. Please try again."
                    );
                    setQuizErrorStatus(true);
                }
            } finally {
            }
        };
        dataFetch();
    }, []);

    console.log(quizData?.quiz, "quizData");
    const open = moment.utc(quizData?.quiz?.open_datetime);
    const close = moment.utc(quizData?.quiz?.close_datetime);

    const duration = moment.duration(close.diff(open));

    const days = Math.floor(duration.asDays());
    const hours = duration.hours();
    const minutes = duration.minutes();

    const timeParts = [];

    if (days > 0) timeParts.push(`${days} day${days > 1 ? "s" : ""}`);
    if (hours > 0) timeParts.push(`${hours} hour${hours > 1 ? "s" : ""}`);
    if (minutes > 0)
        timeParts.push(`${minutes} minute${minutes > 1 ? "s" : ""}`);

    const result = timeParts.join(", ") || "0 minute";

    const dataSubmit = async () => {
        if (joining) return;
        if (!currentUserName.trim()) {
            toast.info("Enter your name to join.");
            return;
        }
        setJoining(true);
        try {
            const formattedDate = quizData?.quiz?.open_datetime
                ? moment
                        .utc(quizData?.quiz?.open_datetime)
                        .format("YYYY-MM-DD HH:mm:ss")
                : null;
            const obj = {
                anonymous_name: currentUserName.trim(),
                start_time: `${formattedDate}`,
            };
            const response = await axiosInstance.post(
                `/quiz-attempts-url/join/${joinid}`,
                obj
            );
            const joined = response?.data?.data;
            const sessionId = joined?.session?.id;
            // Anonymous answers need this token (X-Participant-Token, looked up by the sid in the URL);
            // it was never kept, so every answer and the final submit came back 401 and no score was saved.
            if (joined?.participant_token && sessionId) {
                storeParticipantTokenBundle({
                    module: "quiz",
                    sessionId: Number(sessionId),
                    attemptId: Number(joined?.attempt?.id),
                    participantToken: joined.participant_token,
                    publicChannelKey: joined?.public_channel_key ?? "",
                });
            }
            router.push(
                `/attempt/play/${joined?.session?.join_code}?jid=${joined?.session?.join_link}&qid=${joined?.quiz.id}&aid=${joined?.attempt.id}&sid=${sessionId}`
            );
        } catch (error) {
            const axiosError = error as AxiosError<{ message?: string }>;

            if (axiosError.response) {
                console.error(
                    "Error verifying token:",
                    axiosError.response.data
                );
                toast.error(
                    axiosError.response.data?.message ||
                        "You couldn't join this quiz. Please try again."
                );
            } else {
                console.error("Unexpected error:", axiosError.message);
                toast.error("Unexpected error occurred. Please try again.");
            }
            setJoining(false);
        }
    };
    

    if (quizErrorStatus) {
        return (
            <div className="container mx-auto p-4 max-w-3xl text-center">
                {quizErrorStatus && (
                    <QuizDateClose
                        errorTest={quizErrorMessage}
                        errorStatus={quizErrorStatus}
                    />
                )}
            </div>
        );
    }
    if (quizData === null) return;
    const qsenList = quizData.quiz.questions.filter(
        (question) => question.options !== null
    );

    return (
        <div className="quiz_play_bg ">
            <div className="flex flex-col justify-center items-center h-screen w-full">
                <div className=" flex flex-col justify-center items-center bg-[#fff] w-full md:w-[500px] rounded-[5px] ">
                    <div className="w-[80px] h-[80px] rounded-full bg-[#fff] items-center flex justify-center mt-[-40px] shadow-2">
                        <HiUserGroup className="text-[30px] text-[#222]" />
                    </div>
                    <h3 className="text-[24px] font-bold py-[10px] text-[#222]">
                        {" "}
                        {quizData?.quiz?.title}{" "}
                    </h3>
                    <h3 className="bg-[#123396] text-[#fff] px-[30px] py-[10px] rounded-[5px] font-bold my-[10px]">
                        {" "}
                        Open for: {result}{" "}
                    </h3>

                    <div className="flex justify-between w-full bg-[#2222] mt-[10px] px-[10px] py-[10px]">
                        <h3>
                            {quizData?.quiz?.questions?.length
                                ? `${qsenList.length} Questions`
                                : ""}
                        </h3>

                        {/* <h3> Host Name : <span className='font-bold'> {quizData?.quiz?.user.full_name} </span> </h3> */}
                    </div>
                </div>

                <div className="md:h-[200px]"></div>

                <div className=" flex  bg-[#fff] w-full md:w-[500px] rounded-[5px] mt-[30px] ">
                    {/* A form, so Enter joins too. */}
                    <form
                        className="flex gap-3 justify-between items-end w-full p-[15px]"
                        onSubmit={(e) => {
                            e.preventDefault();
                            dataSubmit();
                        }}
                    >
                        {/* <input
                        type="text"
                        // onChange={(e) => setUserName(e.target.value)}
                        onChange={(e) => setCurrentUserName(e.target.value)}
                        placeholder="Enter nickname"
                        className="flex-1 px-3 py-3 border rounded-lg w-[60%]"
                    /> */}

                        <InputGroup
                            onChange={(e) => setCurrentUserName(e.target.value)}
                            className=" font-bold text-[#333] w-[90%] "
                            type="text"
                            label=""
                            placeholder="Enter your name"
                            iconPosition="left"
                            height="sm"
                        />

                        {/* It was white text on a white button ("Okay" was invisible). */}
                        <button
                            type="submit"
                            disabled={joining}
                            className="h-[46px] flex-shrink-0 inline-flex items-center gap-2 bg-primary px-6 font-bold rounded-[10px] text-white shadow-3 transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
                        >
                            {joining && (
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            )}
                            Join
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default GlobalAttempFrom;

