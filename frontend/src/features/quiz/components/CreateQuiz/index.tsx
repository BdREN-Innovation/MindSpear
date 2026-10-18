"use client";
import React, { useRef, useState } from "react";
import { Modal } from "@/components/ui";
import { FaPlus } from "react-icons/fa6";
import { ImFilesEmpty } from "react-icons/im";
import classNames from "classnames";
import {
	addNewItem,
	clearHoveredItem,
	clearMultipleSelectedItems,
	clearSelectedItem,
} from "@/features/quiz/store/quizItems/quizSlice";
import { clearQuiz, setQuiz } from "@/features/quiz/store/quizInformationSlice";
import { useDispatch } from "react-redux";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Quiz } from "@/types/types";
import { toast } from "react-toastify";
import { Loader2 } from "lucide-react";
import { DocumentToQuestionsModal, type GeneratedContext } from "@/features/ai-generate/components/DocumentToQuestionsWizard";
import { toQuizSlidesBulk } from "@/features/ai-generate/mappers";
import type { GeneratedFor } from "@/features/ai-generate/types";
import { discardSeedOnlyDeck, quizAuthoringApi } from "@/features/deck/api/authoringApi";
import { isDeckApiError } from "@/features/deck/api/errors";
import { clearDeckV2FlagsCache, useDeckV2Enabled } from "@/features/deck/api/featureFlags";
interface QuizApiResponse {
	data: Quiz;
}

function CreateQuiz() {
	const router = useRouter();
	const [isModalOpen, setIsModalOpen] = useState(false);
	const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	const [, setIsSubmitting] = useState(false);

	// Quiz v2 rollout: with users.quiz_v2_enabled the Blank and "From a File"
	// cards create slide-based quiz decks; without it the legacy flows below run as before.
	const quizV2 = useDeckV2Enabled("quiz");
	const [creatingV2, setCreatingV2] = useState(false);
	// Blank card busy from the first click (set before awaiting the flag), so a double click creates one quiz.
	const blankBusyRef = useRef(false);
	const [aiV2Open, setAiV2Open] = useState(false);
	// A deck created for an AI run whose slides failed to save is reused on retry,
	// and deleted when the wizard closes without slides (no orphan "Untitled quiz").
	const aiDeckIdRef = useRef<number | null>(null);

	const dispatch = useDispatch();

	/** Quiz v2: an empty deck (seeded with a QR code slide), opened in the editor; true once the editor is opening. */
	const createV2Quiz = async (): Promise<boolean> => {
		try {
			const deck = await quizAuthoringApi.createDeck();
			router.push(`/quizzes/${deck.id}/edit`);
			return true;
		} catch (error) {
			if (isDeckApiError(error) && error.code === "feature_disabled") clearDeckV2FlagsCache();
			toast.error((error as Error)?.message || "The quiz could not be created. Please try again.");
			return false;
		}
	};

	/** Quiz v2 from AI-generated questions: create the deck (title = topic), add the slides in one bulk call, open the editor. */
	const createV2FromDocument = async (result: GeneratedFor<"quiz_v2">, { options }: GeneratedContext) => {
		const body = toQuizSlidesBulk(result.questions);
		if (body.slides.length === 0) {
			throw new Error("The AI didn't write any usable questions. Try other pages or a clearer topic.");
		}
		try {
			let deckId = aiDeckIdRef.current;
			if (deckId === null) {
				const deck = await quizAuthoringApi.createDeck({ title: options.topic.trim().slice(0, 255) || null });
				deckId = deck.id;
				aiDeckIdRef.current = deckId;
			}
			const { slides } = await quizAuthoringApi.addSlidesBulk(deckId, body);
			aiDeckIdRef.current = null;
			toast.success(`Quiz created with ${slides.length} ${slides.length === 1 ? "question" : "questions"}.`);
			router.push(`/quizzes/${deckId}/edit`);
		} catch (error) {
			if (isDeckApiError(error) && error.code === "feature_disabled") clearDeckV2FlagsCache();
			// The wizard shows the message and stays open for a retry.
			throw error;
		}
	};

	/** Blank card: a v2 deck when quiz_v2_enabled, else the legacy blank quiz. One at a time. */
	const handleBlankClick = async () => {
		if (blankBusyRef.current) return;
		blankBusyRef.current = true;
		setCreatingV2(true);
		let opening = false;
		try {
			opening = (await quizV2.resolve()) ? await createV2Quiz() : await handleItemClick("blank", "false");
		} finally {
			if (!opening) {
				blankBusyRef.current = false;
				setCreatingV2(false);
			}
		}
	};

	/** The AI wizard closed: drop a deck it created whose slides never saved. */
	const closeAiV2 = () => {
		setAiV2Open(false);
		const orphan = aiDeckIdRef.current;
		aiDeckIdRef.current = null;
		if (orphan !== null) void discardSeedOnlyDeck(quizAuthoringApi, orphan);
	};

	const handleFromFileClick = async () => {
		if (await quizV2.resolve()) {
			setIsModalOpen(false);
			setAiV2Open(true);
			return;
		}
		await handleItemClick("pdf", "true");
	};

	/** Legacy (v1) quiz; true once its creator is opening. */
	const handleItemClick = async (quiztypename: string, status: string): Promise<boolean> => {
		try {
			setIsSubmitting(true);

			const quizResponse = await axiosInstance.post("/quizes/store", {
				title: "My Quiz",
				timezone: `${currentTimeZone}`,
				visibility: "public",
				quiztime_mode: true,
			});

			const response = await axiosInstance.get<QuizApiResponse>(
				`/quizes/show/${quizResponse?.data?.data?.quiz?.id}`
			);
			const quizDataWithType = {
				...response?.data?.data,
				qseaneType: `${quiztypename}`,
			};
			dispatch(setQuiz(quizDataWithType));

			const quizId = quizResponse?.data?.data?.quiz?.id;
			if (!quizId) {
				throw new Error("Quiz creation failed: missing quiz ID.");
			}

			if (quiztypename !== "pdf") {
				const questionResponse = await axiosInstance.post(
					`/quiz/questions/store`,
					{
						quiz_id: quizId,
						question_text: ".",
						visibility: "public",
					}
				);

				const questionId = questionResponse?.data?.data?.question?.id;
				if (!questionId) {
					throw new Error(
						"Question creation failed: missing question ID."
					);
				}

				dispatch(
					addNewItem({
						key: "quiz",
						id: `${questionId}`,
						quiz_id: `${quizId}`,
						title: "",
						options: [
							{
								id: "1",
								text: "",
								placeholder: "Add answer 1",
								color: "#F79945",
								isSelected: false,
							},
							{
								id: "2",
								text: "",
								placeholder: "Add answer 2",
								color: "#BC5EB3",
								isSelected: false,
							},
							{
								id: "3",
								text: "",
								placeholder: "Add answer 3 (optional)",
								color: "#5769e7",
								isSelected: false,
							},
							{
								id: "4",
								text: "",
								placeholder: "Add answer 4 (optional)",
								color: "#89c6c7",
								isSelected: false,
							},
						],
						maxOptions: 0,
						minOptions: 0,
						allowDuplicates: false,
						isMultipleSelection: false,
						timeLimit: "",
						quizTypeName: quiztypename,
						quizTypeModalStatus: status,
					})
				);
			}

			router.push(`/quiz-creator/${quizId}`);
			return true;
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error("API error:", axiosError.response.data);
				toast.error(
					`Error: ${
						axiosError.response.data?.message || "Request failed."
					}`
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
				toast.error("Unexpected error occurred. Please try again.");
			}
			return false;
		} finally {
			setIsSubmitting(false);
		}
	};
	const openModal = () => {
		dispatch(clearMultipleSelectedItems());
		// Also the previous quiz's selected / hovered question, which the new quiz's editor would otherwise show.
		dispatch(clearSelectedItem());
		dispatch(clearHoveredItem());
		dispatch(clearQuiz());
		setIsModalOpen(true);
	};

	// Cards are real buttons (keyboard + focus ring). flex-col keeps each card's
	// content at the top: a button centres its content vertically, which would
	// push a card down next to a taller neighbour.
	const cardClass =
		"group flex w-full flex-col rounded-[10px] pt-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:cursor-wait";

	return (
		<div>
			<div
				role="button"
				tabIndex={0}
				aria-haspopup="dialog"
				aria-label="New Quiz"
				onClick={openModal}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						openModal();
					}
				}}
				className="flex-[0_1_calc(33.333%_-_30px)] cursor-pointer mb-[30px] overflow-hidden rounded-[28px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ed3a76] focus-visible:ring-offset-2"
			>
				<div className="group relative block overflow-hidden bg-[#f3f3fe] px-5 py-[30px] transition-all duration-300 ease-in-out hover:no-underline">
					<div
						className={classNames(
							"absolute top-[-75px] right-[-75px] h-[128px] w-[128px] rounded-full transition-transform duration-500 ease-in-out",
							"bg-[#ed3a76]",
							"group-hover:scale-[10]"
						)}
					></div>

					<div className="relative z-10 overflow-hidden text-[0.875rem] font-bold text-[#222] transition-colors duration-500 ease-in-out group-hover:text-white">
						New Quiz
					</div>
					<div className="relative z-20 flex items-center justify-center">
						<Image
							src="/images/icons/quiz.svg"
							alt="quest"
							width={150}
							height={60}
							className="text-[#f79a46] transition-colors duration-500 ease-in-out group-hover:text-white"
						/>
					</div>
					<div className="relative z-10 text-[14px] text-white flex items-center justify-center">
						{/* <Image
							src="/images/icons/quiz.svg"
							alt="quest"
							width={30}
							height={30}
							className="text-[#f79a46] transition-colors duration-500 ease-in-out group-hover:text-white"
						/> */}
						<span className="pl-1 font-bold text-[#ed3a76] transition-colors duration-500 ease-in-out group-hover:text-white">
							Click Here
						</span>
					</div>
				</div>
			</div>

			<Modal
				title="Create a new quiz"
				open={isModalOpen}
				onClose={() => setIsModalOpen(false)}
			>
				<div className="py-4 px-4 sm:px-6 lg:px-8">
					<div className="">
						<h3 className="text-[1rem] sm:text-[1rem] font-semibold pb-2">
							Quizzes
						</h3>
						<p className="w-full sm:w-full lg:w-full text-[.875rem] sm:text-[.875rem] pb-5">
							{`Craft engaging quizzes to boost active
							participation, enhance knowledge retention, and
							elevate your educational impact.`}
						</p>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
						<button
							type="button"
							onClick={handleBlankClick}
							disabled={creatingV2}
							aria-busy={creatingV2 || undefined}
							className={cardClass}
						>
							<div className="w-full transition-all duration-500 ease-in-out group-hover:!border-[#222] border border-[#2222] p-12 sm:p-16 flex items-center justify-center rounded-[10px] cursor-pointer">
								{creatingV2 ? (
									<>
										<Loader2 className="motion-safe:animate-spin text-[#222]" size={40} aria-hidden />
										<span role="status" className="sr-only">
											Creating your quiz…
										</span>
									</>
								) : (
									<FaPlus
										className="transition-all duration-500 ease-in-out group-hover:!text-[#222]"
										size={40}
										color="#2222"
										aria-hidden
									/>
								)}
							</div>
							<h3 className="text-[.875rem] pt-2 font-semibold">
								Empty Slate
							</h3>
							<p className="text-[.875rem] text-[#7b7b7b]">
								Create your own quiz from scratch.
							</p>
						</button>

						<button type="button" onClick={handleFromFileClick} className={cardClass}>
							<div className="w-full bg-[#fda148] transition-all duration-500 ease-in-out group-hover:!border-[#222] relative border border-[#2222] p-12 sm:p-16 flex items-center justify-center rounded-[10px] cursor-pointer">
								<div className="absolute hidden lg:block right-0 top-0 py-[85px] bg-[#fdb774] w-[120px] sm:w-[150px] rounded-tl-[100px] rounded-tr-[10px] rounded-bl-[100px] rounded-br-[10px]"></div>
								<ImFilesEmpty
									className="relative transition-all duration-500 ease-in-out group-hover:!text-[#222] text-[#a35f1d]"
									size={40}
									aria-hidden
								/>
							</div>
							<h3 className="text-[.875rem] pt-2 font-semibold">
								AI Generate (From a File)
							</h3>

							<p className="text-[.875rem] text-[#7b7b7b]">
								Use a PDF, Word, PowerPoint or text file from My Files, or upload a new one.
							</p>
						</button>

						{/* Kept as it was (no action yet); a button like the others so keyboard users reach it. */}
						<button type="button" aria-disabled="true" className={cardClass}>
							<div className="w-full bg-[#BC5EB3] transition-all duration-500 ease-in-out group-hover:!border-[#222] relative border border-[#2222] p-12 sm:p-16 flex items-center justify-center rounded-[10px] cursor-pointer">
								<div className="absolute hidden lg:block right-0 top-0 py-[85px] bg-[#f590eb] w-[120px] sm:w-[150px] rounded-tl-[100px] rounded-tr-[10px] rounded-bl-[100px] rounded-br-[10px]"></div>
								<ImFilesEmpty
									className="relative transition-all duration-500 ease-in-out group-hover:!text-[#222] text-[#743e6e]"
									size={40}
									aria-hidden
								/>
							</div>
							<h3 className="text-[.875rem] pt-2 font-semibold">
								AI Generate (From URL / Prompts)
							</h3>
							<p className="text-[.875rem] text-[#7b7b7b]">
								Let AI build quizzes from your chosen topics.
							</p>
						</button>
					</div>
				</div>
			</Modal>

			{quizV2.enabled ? (
				<DocumentToQuestionsModal
					open={aiV2Open}
					onClose={closeAiV2}
					title="Generate a quiz from a document"
					target="quiz_v2"
					generateLabel="Generate quiz"
					onGenerated={createV2FromDocument}
				/>
			) : null}
		</div>
	);
}

export default CreateQuiz;
