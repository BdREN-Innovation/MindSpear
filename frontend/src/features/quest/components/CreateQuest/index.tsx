"use client";

import React, { useRef, useState } from "react";
import classNames from "classnames";
import Image from "next/image";
import axiosInstance from "@/utils/axiosInstance";
import { Quiz } from "@/types/types";
import { useDispatch } from "react-redux";
import { setQuest } from "@/features/quest/store/questInformationSlice";
import { AxiosError } from "axios";
import { useRouter } from "next/navigation";
import moment from "@/lib/dayjs";
import { toast } from "react-toastify";
import { FaPlus } from "react-icons/fa6";
import { ImFilesEmpty } from "react-icons/im";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui";
import { DocumentToQuestionsModal } from "@/features/ai-generate/components/DocumentToQuestionsWizard";
import type { GeneratedContext } from "@/features/ai-generate/components/DocumentToQuestionsWizard";
import { toQuestSlidesBulk, toQuestTasks } from "@/features/ai-generate/mappers";
import type { GeneratedFor } from "@/features/ai-generate/types";
import { discardSeedOnlyDeck, questAuthoringApi } from "@/features/deck/api/authoringApi";
import { isDeckApiError } from "@/features/deck/api/errors";
import { clearQuestV2EnabledCache, useQuestV2Enabled } from "@/features/deck-editor/components/useQuestV2Enabled";

interface QuizApiResponse {
	data: Quiz;
}

function CreateQuest() {
	const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const dispatch = useDispatch();
	const router = useRouter();
	const [aiOpen, setAiOpen] = useState(false);
	// "Create a new quest" modal (same cards as "Create a new quiz"): Blank or AI from a file.
	const [isModalOpen, setIsModalOpen] = useState(false);
	// Blank card busy until the new quest's editor opens (stops double-creates; the ref
	// guards synchronously, before the first await).
	const [creatingBlank, setCreatingBlank] = useState(false);
	const blankBusyRef = useRef(false);
	// Quest v2 rollout: users with the flag get the slide-based editor; everyone else the legacy flow.
	const questV2 = useQuestV2Enabled();
	const [creatingV2, setCreatingV2] = useState(false);
	// A deck created for an AI run whose slides failed to save is reused on retry,
	// and deleted when the wizard closes without slides (no orphan "Untitled quest").
	const aiDeckIdRef = useRef<number | null>(null);

	/** Quest v2: an empty deck (seeded with a QR code slide), opened in the editor; true once the editor is opening. */
	const createV2Quest = async (): Promise<boolean> => {
		setCreatingV2(true);
		try {
			const deck = await questAuthoringApi.createDeck();
			router.push(`/quests/${deck.id}/edit`);
			return true;
		} catch (error) {
			if (isDeckApiError(error) && error.code === "feature_disabled") clearQuestV2EnabledCache();
			toast.error((error as Error)?.message || "The quest could not be created. Please try again.");
			setCreatingV2(false);
			return false;
		}
	};

	/** Quest v2 from AI-generated slides: create the deck, add the slides in one bulk call, open the editor. */
	const createV2FromDocument = async (
		result: GeneratedFor<"quest_v2">,
		{ options }: GeneratedContext
	) => {
		const body = toQuestSlidesBulk(result.questions);
		if (body.slides.length === 0) {
			throw new Error("The AI didn't write any usable slides. Try other pages or a clearer topic.");
		}
		let deckId = aiDeckIdRef.current;
		if (deckId === null) {
			const deck = await questAuthoringApi.createDeck({ title: options.topic.trim().slice(0, 255) || null });
			deckId = deck.id;
			aiDeckIdRef.current = deckId;
		}
		const { slides } = await questAuthoringApi.addSlidesBulk(deckId, body);
		aiDeckIdRef.current = null;
		toast.success(`Quest created with ${slides.length} slides.`);
		router.push(`/quests/${deckId}/edit`);
	};

	/** New quest from AI-generated tasks; opens it in the editor, which loads tasks from the server. */
	const createFromDocument = async (
		result: GeneratedFor<"quest">,
		{ options }: GeneratedContext
	) => {
		const endTime = new Date(
			new Date().setFullYear(new Date().getFullYear() + 5)
		);
		try {
			const questResponse = await axiosInstance.post("/quests/store", {
				title: options.topic.slice(0, 255) || "Untitled Quest",
				timezone: `${currentTimeZone}`,
				visibility: "public",
				quiztime_mode: true,
				start_datetime: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
				end_datetime: moment(endTime)
					.add(24, "hours")
					.format("YYYY-MM-DD HH:mm:ss"),
			});
			const questId = questResponse?.data?.data?.quest?.id;
			if (!questId) throw new Error("Quest creation failed: missing quest ID.");

			await axiosInstance.post(
				"/quest-tasks/store-multiple",
				{ tasks: toQuestTasks(result.questions, questId) },
				{ timeout: 60_000 }
			);
			toast.success(`Quest created with ${result.questions.length} tasks.`);
			router.push(`/quest/edit/${questId}`);
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;
			throw new Error(
				axiosError.response?.data?.message ||
					axiosError.message ||
					"The tasks were generated but couldn't be saved. Please try again."
			);
		}
	};

	/** Legacy (v1) blank quest; true once the editor is opening. */
	const handleItemClick = async (quiztypename: string, status: string): Promise<boolean> => {
		console.log(quiztypename, status);
		const endTime = new Date(
			new Date().setFullYear(new Date().getFullYear() + 5)
		);

		try {
			const quizResponse = await axiosInstance.post("/quests/store", {
				title: "Untitled Quest",
				timezone: `${currentTimeZone}`,
				visibility: "public",
				quiztime_mode: true,
				start_datetime: moment(new Date()).format(
					"YYYY-MM-DD HH:mm:ss"
				),
				end_datetime: moment(endTime)
					.add(24, "hours")
					.format("YYYY-MM-DD HH:mm:ss"),
			});

			console.log(
				quizResponse,
				"quizResponsequizResponsequizResponsequizResponse"
			);

			const response = await axiosInstance.get<QuizApiResponse>(
				`/quests/show/${quizResponse?.data?.data?.quest?.id}`
			);
			const quizDataWithType = {
				...response?.data?.data,
				qseaneType: `${quiztypename}`,
			};
			dispatch(setQuest(quizDataWithType));

			const quizId = quizResponse?.data?.data?.quest?.id;
			if (!quizId) {
				throw new Error("Quiz creation failed: missing quiz ID.");
			}

			// A blank quest opens on the question-type picker. It used to start with a multiple-choice
			// question (and selected it by the quest's id, so the editor showed an empty card).

			// const questionResponse = await axiosInstance.post(
			// 	`/quest-tasks/store`,
			// 	{
			// 		quest_id: quizId,
			// 		title: ".",
			// 		task_type: "qsenchoice",
			// 		serial_number: "1",
			// 	}
			// );

			// const questionId = questionResponse?.data?.data?.questTask?.id;

			// dispatch(
			// 	addNewQuestItem({
			// 		key: "qsenchoice",
			// 		id: `${questionId}`,
			// 		quiz_id: `${quizId}`,
			// 		title: "",
			// 		options: [],
			// 		maxOptions: 0,
			// 		minOptions: 0,
			// 		allowDuplicates: false,
			// 		isMultipleSelection: false,
			// 		timeLimit: "",
			// 		quizTypeName: quiztypename,
			// 		quizTypeModalStatus: status,
			// 	})
			// );

			router.push(`/quest/create/${quizId}`);
			return true;
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error("API error:", axiosError.response.data);
				toast.error(
					`Error: ${axiosError.response.data?.message || "Request failed."
					}`
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
				toast.error("Unexpected error occurred. Please try again.");
			}
			return false;
		}
	};

	/** Blank card: a v2 deck when quest_v2_enabled, else the legacy blank quest. */
	const handleBlankClick = async () => {
		if (blankBusyRef.current) return;
		blankBusyRef.current = true;
		setCreatingBlank(true);
		let opening = false;
		try {
			opening = (await questV2.resolve()) ? await createV2Quest() : await handleItemClick("blank", "false");
		} finally {
			if (!opening) {
				blankBusyRef.current = false;
				setCreatingBlank(false);
			}
		}
	};

	/** The AI wizard closed: drop a v2 deck it created whose slides never saved. */
	const closeAi = () => {
		setAiOpen(false);
		const orphan = aiDeckIdRef.current;
		aiDeckIdRef.current = null;
		if (orphan !== null) void discardSeedOnlyDeck(questAuthoringApi, orphan);
	};

	/** AI card: pick the v2 or legacy wizard before it opens. */
	const handleFromFileClick = async () => {
		await questV2.resolve();
		setIsModalOpen(false);
		setAiOpen(true);
	};

	const blankBusy = creatingBlank || creatingV2;
	// flex-col keeps each card's content at the top: a button centres its content
	// vertically, which pushed Blank ~11 px down next to the taller AI card.
	const cardClass =
		"group flex w-full flex-col rounded-[10px] pt-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:cursor-wait";

	return (
		<div>
			<div
				role="button"
				tabIndex={0}
				aria-haspopup="dialog"
				aria-label="New Quest"
				onClick={() => setIsModalOpen(true)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setIsModalOpen(true);
					}
				}}
				className="flex-[0_1_calc(33.333%_-_30px)] cursor-pointer mb-[30px] overflow-hidden rounded-[28px] focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2"
			>
				<div className="group relative block overflow-hidden bg-[#f3f3fe] px-5 py-[30px] transition-all duration-300 ease-in-out hover:no-underline">
					{/* Circle background with lower z-index */}
					<div
						className={classNames(
							"absolute top-[-75px] right-[-75px] h-[128px] w-[128px] rounded-full",
							"bg-secondary",
							"group-hover:scale-[10]",
							"transition-transform duration-500 ease-in-out",
							"z-0"
						)}
					></div>

					{/* Title */}
					<div className="relative z-10 text-[0.875rem] font-bold text-[#222] group-hover:text-white transition-colors duration-500 ease-in-out">
						New Quest
					</div>

					{/* Image with higher z-index and transparent background */}
					<div className="relative z-20 flex items-center justify-center">
						<Image
							src="/images/icons/quest.svg"
							alt="quest"
							width={150}
							height={60}
							className="transition-all duration-500 ease-in-out"
						/>
					</div>

					{/* Click Here */}
					<div className="relative z-10 text-[14px] text-[#f79a46] flex items-center justify-center">
						<span className="pl-1 font-bold text-center group-hover:text-white transition-colors duration-500 ease-in-out">
							Click Here
						</span>
					</div>
				</div>
			</div>

			<Modal title="Create a new quest" open={isModalOpen} onClose={() => setIsModalOpen(false)}>
				<div className="py-4 px-4 sm:px-6 lg:px-8">
					<div>
						<h3 className="text-[1rem] font-semibold pb-2">Quests</h3>
						<p className="w-full text-[.875rem] pb-5">
							Run live polls, word clouds and open questions to hear every voice in the room, with results that appear as people answer.
						</p>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<button type="button" onClick={handleBlankClick} disabled={blankBusy} aria-busy={blankBusy} className={cardClass}>
							<div className="w-full transition-all duration-500 ease-in-out group-hover:!border-[#222] border border-[#2222] p-12 sm:p-16 flex items-center justify-center rounded-[10px] cursor-pointer">
								{blankBusy ? (
									<>
										<Loader2 className="motion-safe:animate-spin text-[#222]" size={40} aria-hidden />
										<span role="status" className="sr-only">
											Creating your quest…
										</span>
									</>
								) : (
									<FaPlus className="transition-all duration-500 ease-in-out group-hover:!text-[#222]" size={40} color="#2222" aria-hidden />
								)}
							</div>
							<h3 className="text-[.875rem] pt-2 font-semibold text-[#222] dark:text-white">Blank Quest</h3>
							<p className="text-[.875rem] text-[#7b7b7b]">Create your own quest from scratch.</p>
						</button>

						<button type="button" onClick={handleFromFileClick} className={cardClass}>
							<div className="w-full bg-[#fda148] transition-all duration-500 ease-in-out group-hover:!border-[#222] relative overflow-hidden border border-[#2222] p-12 sm:p-16 flex items-center justify-center rounded-[10px] cursor-pointer">
								<div className="absolute hidden lg:block right-0 top-0 py-[85px] bg-[#fdb774] w-[120px] sm:w-[150px] rounded-tl-[100px] rounded-tr-[10px] rounded-bl-[100px] rounded-br-[10px]"></div>
								<ImFilesEmpty
									className="relative transition-all duration-500 ease-in-out group-hover:!text-[#222] text-[#a35f1d]"
									size={40}
									aria-hidden
								/>
							</div>
							<h3 className="text-[.875rem] pt-2 font-semibold text-[#222] dark:text-white">AI Generate (From a File)</h3>
							<p className="text-[.875rem] text-[#7b7b7b]">Use a PDF, Word, PowerPoint or text file from My Files, or upload a new one.</p>
						</button>
					</div>
				</div>
			</Modal>

			{questV2.enabled ? (
				<DocumentToQuestionsModal
					open={aiOpen}
					onClose={closeAi}
					title="Generate a quest from a document"
					target="quest_v2"
					generateLabel="Generate quest"
					onGenerated={createV2FromDocument}
				/>
			) : (
				<DocumentToQuestionsModal
					open={aiOpen}
					onClose={() => setAiOpen(false)}
					title="Generate a quest from a document"
					target="quest"
					generateLabel="Generate quest"
					onGenerated={createFromDocument}
				/>
			)}
		</div>
	);
}

export default CreateQuest;
