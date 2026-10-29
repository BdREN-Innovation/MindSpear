"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Provider as ReduxProvider } from "react-redux";
import "@ant-design/v5-patch-for-react-19";
import { Header } from "@/components/Layouts/header";
import { Sidebar } from "@/components/Layouts/sidebar";
import { store } from "@/stores/store";
import ProtectedRoute from "../ProtectedRoute";

/** /quests/<id>/edit, /quizzes/<id>/edit and their /present twins (and anything below them). */
const DECK_FULL_SCREEN_PATH = /^\/(quests|quizzes)\/[^/]+\/(edit|present)(\/|$)/;

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
	const [hydrated, setHydrated] = useState(false);
	const pathname = usePathname();

	useEffect(() => {
		setHydrated(true);
	}, []);
	if (!hydrated) return null;

	// The quiz / quest editor and presenter own the whole viewport: no app header, sidebar or padding.
	const page = DECK_FULL_SCREEN_PATH.test(pathname) ? (
		<div className="h-screen w-full overflow-hidden">{children}</div>
	) : (
		<div className="flex h-screen scrollbar-hidden">
			<div className="h-full w-full scrollbar-hidden dark:bg-[#020d1a]">
				<Header />
				<div className="flex h-screen w-full scrollbar-hidden">
					<aside className="min-h-screen scrollbar-hidden md:w-56">
						<Sidebar />
					</aside>
					<main className="mx-auto h-full w-full flex-1 overflow-y-auto bg-white scrollbar-hidden dark:bg-[#020d1a] md:p-4 2xl:p-5">
						{children}
					</main>
				</div>
			</div>
		</div>
	);

	return (
		<ProtectedRoute>
			<ReduxProvider store={store}>{page}</ReduxProvider>
		</ProtectedRoute>
	);
}
