"use client";

import { useEffect, useState } from "react";

import { Sidebar } from "@/components/Layouts/sidebar";
import { Header } from "@/components/Layouts/header";
import ProtectedRoute from "../ProtectedRoute";
import { usePathname } from "next/navigation";
import { CreateQuizHeader } from "@/components/Layouts/header/CreateQuizHeader";
import "@ant-design/v5-patch-for-react-19";
import { Provider as ReduxProvider } from "react-redux";
import { store } from "@/stores/store";
import { SurveyProvider } from "@/contexts/SurveyContext";
import SurveyDataInitializer from "@/features/survey/components/Survey/SurveyDataInitializer";

/** /quests/<id>/edit and /quests/<id>/present (and anything below them). */
const DECK_FULL_SCREEN_PATH = /^\/quests\/[^/]+\/(edit|present)(\/|$)/;

function isDeckFullScreenPath(pathname: string | null): boolean {
	return !!pathname && DECK_FULL_SCREEN_PATH.test(pathname);
}

export default function ProtectedLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const [hydrated, setHydrated] = useState(false);
	const pathname = usePathname();
	const isQuizCreator =
		pathname.includes("quiz-creator") ||
		pathname.includes("quiz-edit") ||
		pathname.includes("quest/create") ||
		pathname.includes("survey/create") ||
		pathname.includes("survey/eit") ||
		pathname.includes("quest/edit");

	const isQuestCreatorPageStatus =
		pathname === "/quest" || pathname.startsWith("/quest/");
	const isSurveyCreatorPageStatus =
		pathname.startsWith("/survey/create") ||
		pathname.startsWith("/survey/edit");

	// console.log(pathname, "isQuestionBankPageStatus");

	useEffect(() => {
		setHydrated(true);
	}, []);
	if (!hydrated) return null;

	// Quest v2 editor and presenter own the whole viewport: no app header,
	// sidebar or padding (still signed-in only, still inside Redux).
	if (isDeckFullScreenPath(pathname)) {
		return (
			<ProtectedRoute>
				<ReduxProvider store={store}>
					<div className="h-screen w-full overflow-hidden">{children}</div>
				</ReduxProvider>
			</ProtectedRoute>
		);
	}

	const content = (
		<div className="flex h-screen scrollbar-hidden">
			<div className="w-full h-full dark:bg-[#020d1a] scrollbar-hidden">
				{isSurveyCreatorPageStatus && <SurveyDataInitializer />}
				{isQuizCreator ? <CreateQuizHeader /> : <Header />}

				{/* <main className="isolate mx-auto w-full  overflow-hidden p-4 md:p-6 2xl:p-10 bg-white dark:bg-[#020d1a]"> */}
				<div
					className={` ${
						isQuestCreatorPageStatus || isSurveyCreatorPageStatus
							? "w-full"
							: "w-full h-screen flex scrollbar-hidden"
					} `}
				>
					<aside
						className={`md:w-56 scrollbar-hidden min-h-screen ${
							isQuestCreatorPageStatus ||
							isSurveyCreatorPageStatus
								? "hidden"
								: "block"
						}`}
					>
						<Sidebar />
					</aside>
					<main
						className={` mx-auto w-full scrollbar-hidden h-full flex-1 overflow-y-auto scrollbar-hidden" md:p-4 2xl:p-5  dark:bg-[#020d1a] ${
							isQuizCreator
								? ""
								: isQuestCreatorPageStatus ||
									  isSurveyCreatorPageStatus
									? "bg-[#f2f1f0]"
									: "bg-white"
						}`}
					>
						{children}
					</main>
				</div>
			</div>
		</div>
	);

	const contentWithProviders = isSurveyCreatorPageStatus ? (
		<SurveyProvider>{content}</SurveyProvider>
	) : (
		content
	);

	return (
		<ProtectedRoute>
			<ReduxProvider store={store}>{contentWithProviders}</ReduxProvider>
		</ProtectedRoute>
	);
}
