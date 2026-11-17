"use client";

import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useRouter } from "next/navigation";
import type { RootState } from "@/stores/store";
import Image from "next/image";
import HowItWorks from "@/components/Dashboard/HomePages/HowItWorks";
import HpmePagesFooter from "@/components/Dashboard/HomePages/HpmePagesFooter";

export default function HomePage() {
	const [hydrated, setHydrated] = useState(false);
	const isAuthenticated = useSelector(
		(state: RootState) => state.auth.isAuthenticated
	);

	const router = useRouter();

	useEffect(() => {
		setHydrated(true);
		document.body.style.removeProperty("pointer-events");
	}, []);

	if (!hydrated) return null;

	return (
		<div className="bg-[#fff]">
			<div className="relative bg-blue-700 py-36">
				<Image
					src="/images/img-shap.png"
					alt="Quiz visual"
					width={300}
					height={350}
					className="absolute bottom-0 left-0 w-full h-[350px]  pointer-events-none"
				/>

				<div className="container mx-auto px-4">
					<div className="grid grid-cols-1 lg:grid-cols-2 items-center gap-12">
						<div>
							<h2 className="text-white text-4xl font-bold leading-snug shadow-sm">
								Master Knowledge Through Interactive Quests,
								Quizzes, and Surveys
							</h2>

							<blockquote className="border-l-4 border-white/70 pl-5 mt-6 text-white text-base">
								<p>
									MindSpear delivers a comprehensive learning
									platform combining interactive quests,
									engaging quizzes, and insightful surveys.
									Transform your educational journey with
									personalized learning experiences and
									real-time feedback designed for students and
									educators.
								</p>
							</blockquote>

							<div className="mt-8 flex items-center gap-4" 	>
								<div className="flex flex-wrap items-center gap-4">
									{!isAuthenticated ? (
										<button
											onClick={() =>
												router.push("/auth/sign-in")
											}
											className="flex px-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary p-4 font-medium text-white transition hover:bg-opacity-90"
										>
											Login
										</button>
									) : (
										<button
											onClick={() =>
												router.push("/dashboard")
											}
											className="flex px-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary p-4 font-medium text-white transition hover:bg-opacity-90"
										>
											Go to Dashboard
										</button>
									)}
								</div>
								<div>
									{/* A full page load: the participant app (/play) is its own PWA with its own manifest and service worker. */}
									{/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
									<a
										href="/play"
										className="flex px-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-secondary p-4 font-medium text-white transition hover:bg-opacity-90"
									>
										Join a Live
									</a>
								</div>
							</div>
						</div>

						{/* Image Content */}
						<div>
							<Image
								src="/images/hero-image-1.jpg"
								alt="Hero"
								width={600}
								height={350}
								className="rounded-lg shadow-lg w-full h-auto "
							/>
						</div>
					</div>
				</div>
			</div>
			<div className="">
				<HowItWorks />
			</div>
			<div className="">
				<HpmePagesFooter />
			</div>
		</div>
	);
}
