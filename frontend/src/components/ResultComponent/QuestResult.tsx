/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useParams } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import React, { useEffect, useState } from "react";
import { FaUser } from "react-icons/fa6";
import ResultShowModal from "./ResultShowModal";
import { Modal } from "@/components/ui";
import { Skeleton } from "antd";
import { toast } from "react-toastify";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

function QuestResult() {
	const params = useParams();
	const [questResultList, setQuestResultList] = useState([]);
	const [isModalStatus, setIsModalStatus] = useState(false);
	const [resultShowAttemId, setResultShowAttemId] = useState(0);
	const [activeUser, setActiveUser] = useState("");
	const [loading, setLoading] = useState(true);
	const [questTitle, setQuestTitle] = useState("");

	useEffect(() => {
		const quizFetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quest-leaderboard/session-details/${params?.sid}`
				);
				const responseList = await axiosInstance.get(
					`/quests/show/${params?.id}`
				);

				setQuestResultList(response?.data?.data?.leaderboard);
				setQuestTitle(responseList?.data?.data?.quest?.title ?? "");
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;

				if (axiosError.response) {
					console.error(
						"Error verifying token:",
						axiosError.response.data
					);
					toast.error(
						`Error: ${axiosError.response.data?.message ||
						"Verification failed."
						}`
					);
				} else {
					console.error("Unexpected error:", axiosError);
					console.error("Unexpected error:", axiosError.message);
					toast.error("Unexpected error occurred. Please try again.");
				}
			} finally {
				setLoading(false);
			}
		};
		quizFetch();
	}, []);

	const openDetails = (u: any) => {
		setIsModalStatus(true);
		setResultShowAttemId(u?.id);

		setActiveUser(u?.user === null ? u?.anonymous_details?.name : u?.name);
	};

	// Skeleton loader component
	const renderSkeletonCards = () => {
		return Array.from({ length: 5 }).map((_, index) => (
			<div
				key={`skeleton-${index}`}
				className="w-full group relative bg-white border dark:bg-gray-800 border-gray-200 rounded-lg dark:border-gray-700 flex flex-col justify-center items-center p-5"
			>
				<Skeleton.Avatar
					size={40}
					shape="circle"
					className="mb-4"
					active={true}
				/>
				<Skeleton.Input
					size="small"
					style={{ width: 100, marginBottom: 10 }}
					active={true}
				/>
				<Skeleton.Button
					style={{ width: 100, height: 30 }}
					active={true}
				/>
			</div>
		));
	};

	// quicFromData
	return (
		<div>
			{/* The page had only a bare "Individual Results" heading: no quest name and no way back. */}
			<div className="mb-[20px]">
				<Link
					href={`/my-library/quest/${params?.id}`}
					className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-primary"
				>
					<ChevronLeft className="h-4 w-4" />
					Back to {questTitle || "quest"}
				</Link>
				<h1 className="text-[20px] font-semibold tracking-tight">
					Individual Results
				</h1>
				{!loading && questResultList?.length > 0 && (
					<p className="text-sm text-slate-500">
						{questResultList.length} participant{questResultList.length === 1 ? "" : "s"} · open one to see their answers
					</p>
				)}
			</div>

			{loading ? (
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
					{renderSkeletonCards()}
				</div>
			) : questResultList?.length === 0 ? (
				<div className="text-center py-12">
					<div className="mx-auto max-w-md">
						<div className="bg-gray-100 dark:bg-gray-700 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
							<FaUser className="w-8 h-8 text-gray-400" />
						</div>
						<h3 className="text-xl font-semibold mb-2">
							No results found
						</h3>
						<p className="text-gray-600 dark:text-gray-400">
							There are no results available for this quest session yet.
						</p>
					</div>
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
					{questResultList?.map((u: any, i: number) => {
						return (
							<div
								key={i}
								className="w-full group relative bg-white border dark:bg-gray-800 border-gray-200 rounded-lg dark:border-gray-700 hover:border-primary transition-all duration-300 flex flex-col justify-center items-center p-5 cursor-pointer"
							>
								<div className="w-[40px] h-[40px] bg-primary text-white rounded-full flex flex-col justify-center items-center shadow-sm mb-2">
									<FaUser />
								</div>
								<h3 className="font-bold py-[4px] capitalize text-center">
									{u?.user === null
										? u?.anonymous_details?.name
										: u?.name}
								</h3>
								<button
									onClick={() => openDetails(u)}
									className="bg-primary hover:bg-white hover:text-primary border border-primary text-[16px] py-[5px] px-[20px] text-white rounded-[10px] mt-[10px] transition-colors duration-300"
								>
									View Details
								</button>
							</div>
						);
					})}
				</div>
			)}

			<Modal size="xl"
				title={`${activeUser}'s answers`}
				open={isModalStatus}
				onClose={() => setIsModalStatus(false)}
			>
				{/* Keyed so each participant opens on their first answer (it kept the last one's tab). */}
				<ResultShowModal key={resultShowAttemId} attemId={resultShowAttemId} />
			</Modal>
		</div>
	);
}

export default QuestResult;
