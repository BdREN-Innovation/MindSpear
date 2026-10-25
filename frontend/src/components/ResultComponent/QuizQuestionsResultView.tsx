/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useState, useMemo } from "react";
import { PiWarningCircle } from "react-icons/pi";
import { FaSpinner } from "react-icons/fa6";
import { FaRegFileWord, FaFileExcel } from "react-icons/fa";
import moment from "@/lib/dayjs";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { Modal } from "@/components/ui";
// import AllQuestResult from "./AllQuestResult";
import {
	BarChart3,
	Calendar,
	Clock,
	Eye,
	MessageSquare,
	Users,
	Search,
	ChevronDown,
	ChevronUp,
	DownloadIcon,
	TableIcon,
	LayoutGrid,
} from "lucide-react";
import QuizMode from "../Dashboard/QuizMode";
import { toast } from "react-toastify";
// import Link from "next/link";

function QuizQuestionsResultView({ list }: any) {
	const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const [resultShowAttemId, setResultShowAttemId] = useState(0);
	const [isModalStatus, setIsModalStatus] = useState(false);
	const [isDownloading, setIsDownloading] = useState(false);
	const [isDownloadingExcl, setIsDownloadingExel] = useState(false);
	const [activeId, setActiveId] = useState("");
	const [viewMode, setViewMode] = useState<"grid" | "table">("table");
	const [searchTerm, setSearchTerm] = useState("");
	const [sortBy, setSortBy] = useState<"date" | "participants" | "title">(
		"date",
	);
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

	// Filter and sort sessions
	const filteredAndSortedSessions = useMemo(() => {
		const filtered = list.filter((session: any) =>
			session?.title?.toLowerCase().includes(searchTerm.toLowerCase()),
		);

		filtered.sort((a: any, b: any) => {
			let aValue, bValue;

			switch (sortBy) {
				case "date":
					aValue = new Date(a.start_datetime).getTime();
					bValue = new Date(b.start_datetime).getTime();
					break;
				case "participants":
					aValue = a.participants_count || 0;
					bValue = b.participants_count || 0;
					break;
				case "title":
					aValue = a.title?.toLowerCase() || "";
					bValue = b.title?.toLowerCase() || "";
					break;
				default:
					return 0;
			}

			if (sortOrder === "asc") {
				return aValue > bValue ? 1 : -1;
			} else {
				return aValue < bValue ? 1 : -1;
			}
		});

		return filtered;
	}, [list, searchTerm, sortBy, sortOrder]);

	const downloadCsv = async (data: any) => {
		try {
			setIsDownloading(true);
			setActiveId(data?.id);
			// This session's players and answers (it called the quest export with a quest id a quiz
			// session doesn't have, so every download failed).
			const response = await axiosInstance.get(
				`/quiz-leaderboard/download-session-attempts/${data?.id}/export/csv`,
				{ responseType: "blob" },
			);
			const blob = new Blob([response.data], { type: "text/csv" });
			downloadFile(blob, `quiz-session-${data?.id}-answers.csv`, response);
		} catch (error) {
			handleDownloadError(error, "CSV");
		} finally {
			setIsDownloading(false);
		}
	};

	const downloadExcel = async (data: any) => {
		try {
			setIsDownloadingExel(true);
			setActiveId(data?.id);
			const response = await axiosInstance.get(
				`/quiz-leaderboard/download-session-attempts/${data?.id}/export/excel`,
				{ responseType: "blob" },
			);
			const blob = new Blob([response.data], {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			});
			downloadFile(blob, `quiz-session-${data?.id}-answers.xlsx`, response);
		} catch (error) {
			handleDownloadError(error, "Excel");
		} finally {
			setIsDownloadingExel(false);
		}
	};

	const downloadFile = (
		blob: Blob,
		defaultFilename: string,
		response?: any,
	) => {
		const url = window.URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;

		let filename = defaultFilename;
		if (response?.headers) {
			const contentDisposition = response.headers["content-disposition"];
			if (contentDisposition) {
				// Without the closing quote (the old pattern kept it in the name).
				const filenameMatch =
					contentDisposition.match(/filename="?([^";]+)"?/);
				if (filenameMatch && filenameMatch[1]) {
					filename = filenameMatch[1];
				}
			}
		}

		link.setAttribute("download", filename);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		window.URL.revokeObjectURL(url);
	};

	const handleDownloadError = async (error: any, fileType: string) => {
		const axiosError = error as AxiosError<any>;
		if (axiosError.response) {
			// A blob was asked for, so the server's error message arrives as a blob too.
			let message: string | undefined = axiosError.response.data?.message;
			if (axiosError.response.data instanceof Blob) {
				try {
					message = JSON.parse(await axiosError.response.data.text())?.message;
				} catch {
					message = undefined;
				}
			}
			toast.error(message || `${fileType} download failed.`);
		} else {
			toast.error("Unexpected error occurred. Please try again.");
		}
	};

	const openDetails = (session: any) => {
		setIsModalStatus(true);
		console.log(session, "session?.idsession?.id");

		setResultShowAttemId(session?.id);
	};

	const toggleSort = (field: "date" | "participants" | "title") => {
		if (sortBy === field) {
			setSortOrder(sortOrder === "asc" ? "desc" : "asc");
		} else {
			setSortBy(field);
			setSortOrder("desc");
		}
	};

	const SortButton = ({
		field,
		children,
	}: {
		field: "date" | "participants" | "title";
		children: React.ReactNode;
	}) => (
		<button
			onClick={() => toggleSort(field)}
			className="flex items-center gap-1 hover:text-primary transition-colors font-medium"
		>
			{children}
			{sortBy === field &&
				(sortOrder === "asc" ? (
					<ChevronUp className="w-4 h-4" />
				) : (
					<ChevronDown className="w-4 h-4" />
				))}
		</button>
	);

	// Function to shorten long titles
	const shortenTitle = (title: string, maxLength: number = 40) => {
		if (title.length <= maxLength) return title;
		return title.substring(0, maxLength) + "...";
	};

	return (
		<div className="bg-white p-6 rounded-xl">
			{/* Header with Controls */}
			<div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
				<div className="flex items-center gap-4">
					<div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center">
						<BarChart3 className="w-7 h-7 text-white" />
					</div>
					<div>
						<h1 className="text-2xl font-bold text-gray-900">
							Session Analytics
						</h1>
						<p className="text-gray-600 mt-1 flex items-center gap-2">
							<span>
								{filteredAndSortedSessions.length} session
								{filteredAndSortedSessions.length !== 1
									? "s"
									: ""}
							</span>
							<span className="w-1 h-1 bg-gray-400 rounded-full"></span>
							<span>Real-time results & insights</span>
						</p>
					</div>
				</div>

				<div className="flex flex-col sm:flex-row gap-3">
					{/* View Toggle with Icons */}
					<div className="bg-gray-100 rounded-lg p-1 flex">
						<button
							onClick={() => setViewMode("table")}
							className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
								viewMode === "table"
									? "bg-white text-primary"
									: "text-gray-600 hover:text-gray-900"
							}`}
						>
							<TableIcon className="w-4 h-4" />
							Table
						</button>
						<button
							onClick={() => setViewMode("grid")}
							className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
								viewMode === "grid"
									? "bg-white text-primary"
									: "text-gray-600 hover:text-gray-900"
							}`}
						>
							<LayoutGrid className="w-4 h-4" />
							Grid
						</button>
					</div>

					{/* Search */}
					<div className="relative">
						<Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
						<input
							type="text"
							placeholder="Search sessions..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-none focus:outline-none w-full sm:w-64"
						/>
					</div>
				</div>
			</div>

			{/* Content */}
			{filteredAndSortedSessions.length > 0 ? (
				viewMode === "grid" ? (
					/* Grid View */
					<div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
						{filteredAndSortedSessions.map(
							(session: any, i: number) => (
								<div
									key={i}
									className="bg-white rounded-2xl border border-gray-200 hover:border-primary/50 transition-all duration-300 p-6 group"
								>
									{/* Session Header */}
									<div className="flex items-start justify-between mb-4">
										<div className="flex-1 min-w-0">
											<h3
												className="font-semibold text-gray-900 text-lg mb-2 line-clamp-2 group-hover:text-primary transition-colors"
												title={session?.title}
											>
												{shortenTitle(session?.title)}
											</h3>
											<div className="flex items-center gap-2 text-sm text-gray-500">
												<Calendar className="w-4 h-4" />
												<span>
													{moment
														.utc(
															session?.start_datetime,
														)
														.tz(currentTimeZone)
														.format("MMM D, YYYY")}
												</span>
												<span>•</span>
												<Clock className="w-4 h-4" />
												<span>
													{moment
														.utc(
															session?.start_datetime,
														)
														.tz(currentTimeZone)
														.format("h:mm A")}
												</span>
											</div>
										</div>
									</div>

									{/* Stats */}
									<div className="grid grid-cols-2 gap-3 mb-4">
										<div className="bg-primary/5 rounded-xl p-3 text-center border border-primary/10">
											<div className="flex items-center justify-center gap-2 mb-1">
												<Users className="w-4 h-4 text-primary" />
												<span className="text-xl font-bold text-primary">
													{session?.participants_count ||
														"0"}
												</span>
											</div>
											<p className="text-xs text-primary font-medium">
												Participants
											</p>
										</div>

										<div className="bg-primary/5 rounded-xl p-3 text-center border border-primary/10">
											<div className="flex items-center justify-center gap-2 mb-1">
												<MessageSquare className="w-4 h-4 text-primary" />
												<span className="text-xl font-bold text-primary">
													{session?.responses_count ||
														"0"}
												</span>
											</div>
											<p className="text-xs text-primary font-medium">
												Responses
											</p>
										</div>
									</div>

									{/* Actions */}
									<div className="space-y-3">
										<div className="flex gap-2">
											<button
												onClick={() =>
													openDetails(session)
												}
												className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white py-2.5 px-3 rounded-xl transition-all duration-200 font-medium text-sm"
											>
												<Eye className="w-4 h-4" />
												Result
											</button>
											{/* <Link
											href={`/my-library/quest/${session?.quest_id}/result-details/${session?.id}`}
											className="flex-1 flex items-center justify-center gap-2 bg-gray-600 hover:bg-gray-700 text-white py-2.5 px-3 rounded-xl transition-all duration-200 font-medium text-sm"
										>
											<Eye className="w-4 h-4" />
											Individual
										</Link> */}
										</div>

										<div className="flex gap-2">
											<button
												onClick={() =>
													!isDownloading &&
													downloadCsv(session)
												}
												disabled={
													isDownloading &&
													Number(activeId) ===
														Number(session?.id)
												}
												className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl transition-all duration-200 font-medium text-sm border ${
													isDownloading &&
													Number(activeId) ===
														Number(session?.id)
														? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
														: "bg-white text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300"
												}`}
											>
												{isDownloading &&
												Number(activeId) ===
													Number(session?.id) ? (
													<FaSpinner className="w-4 h-4 animate-spin" />
												) : (
													<>
														<FaRegFileWord className="w-4 h-4" />
														CSV
													</>
												)}
											</button>

											<button
												onClick={() =>
													!isDownloadingExcl &&
													downloadExcel(session)
												}
												disabled={
													isDownloadingExcl &&
													Number(activeId) ===
														Number(session?.id)
												}
												className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl transition-all duration-200 font-medium text-sm border ${
													isDownloadingExcl &&
													Number(activeId) ===
														Number(session?.id)
														? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
														: "bg-white text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300"
												}`}
											>
												{isDownloadingExcl &&
												Number(activeId) ===
													Number(session?.id) ? (
													<FaSpinner className="w-4 h-4 animate-spin" />
												) : (
													<>
														<FaFileExcel className="w-4 h-4" />
														Excel
													</>
												)}
											</button>
										</div>
									</div>
								</div>
							),
						)}
					</div>
				) : (
					/* Table View */
					<div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
						<div className="overflow-x-auto">
							<table className="w-full min-w-[800px]">
								<thead className="bg-primary/5 border-b border-primary/10">
									<tr>
										<th className="px-6 py-4 text-left">
											<SortButton field="title">
												<div className="flex items-center gap-2">
													<BarChart3 className="w-4 h-4" />
													Session Title
												</div>
											</SortButton>
										</th>
										<th className="px-6 py-4 text-center">
											<SortButton field="participants">
												<div className="flex items-center gap-2 justify-center">
													<Users className="w-4 h-4" />
													Participants
												</div>
											</SortButton>
										</th>
										{/* <th className="px-6 py-4 text-center">
											<div className="flex items-center gap-2 justify-center">
												<MessageSquare className="w-4 h-4" />
												Responses
											</div>
										</th> */}
										<th className="px-6 py-4 text-left">
											<SortButton field="date">
												<div className="flex items-center gap-2">
													<Calendar className="w-4 h-4" />
													Session Date
												</div>
											</SortButton>
										</th>
										<th className="px-6 py-4 text-center">
											<div className="flex items-center gap-2 justify-center">
												<DownloadIcon className="w-4 h-4" />
												Actions
											</div>
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100">
									{filteredAndSortedSessions.map(
										(session: any, i: number) => (
											<tr
												key={i}
												className="hover:bg-primary/5 transition-colors group"
											>
												<td className="px-6 py-4">
													<div className="flex items-center gap-3">
														<div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
															<BarChart3 className="w-5 h-5 text-white" />
														</div>
														<div className="min-w-0">
															<p
																className="font-semibold text-gray-900 group-hover:text-primary transition-colors truncate"
																title={
																	session?.title
																}
															>
																{shortenTitle(
																	session?.title,
																	40,
																)}
															</p>
															<p className="text-sm text-gray-500 flex items-center gap-1">
																<Clock className="w-3 h-3" />
																{moment
																	.utc(
																		session?.start_datetime,
																	)
																	.tz(
																		currentTimeZone,
																	)
																	.format(
																		"h:mm A",
																	)}
															</p>
														</div>
													</div>
												</td>
												<td className="px-6 py-4 text-center">
													<div className="flex items-center justify-center gap-2">
														<Users className="w-4 h-4 text-primary" />
														<span className="font-semibold text-primary">
															{session?.participants_count ||
																"0"}
														</span>
													</div>
												</td>
												{/* <td className="px-6 py-4 text-center">
												<div className="flex items-center justify-center gap-2">
													<MessageSquare className="w-4 h-4 text-primary" />
													<span className="font-semibold text-primary">
														{session?.responses_count || "0"}
													</span>
												</div>
											</td> */}
												<td className="px-6 py-4">
													<div className="text-sm text-gray-600">
														{moment
															.utc(
																session?.start_datetime,
															)
															.tz(currentTimeZone)
															.format(
																"MMM D, YYYY",
															)}
													</div>
													<div className="text-xs text-gray-500">
														{currentTimeZone}
													</div>
												</td>
												<td className="px-6 py-4">
													<div className="flex items-center justify-center gap-3">
														<button
															onClick={() =>
																openDetails(
																	session,
																)
															}
															className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
														>
															<Eye className="w-4 h-4" />
															Result
														</button>
														{/* <Link
														href={`/my-library/quest/${session?.quest_id}/result-details/${session?.id}`}
														className="flex items-center gap-2 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
													>
														<Eye className="w-4 h-4" />
														Individual
													</Link> */}
														<div className="flex gap-1">
															<button
																onClick={() =>
																	!isDownloading &&
																	downloadCsv(
																		session,
																	)
																}
																disabled={
																	isDownloading &&
																	Number(
																		activeId,
																	) ===
																		Number(
																			session?.id,
																		)
																}
																className={`p-2 rounded-lg transition-all ${
																	isDownloading &&
																	Number(
																		activeId,
																	) ===
																		Number(
																			session?.id,
																		)
																		? "bg-gray-100 text-gray-400 cursor-not-allowed"
																		: "bg-green-50 text-green-600 hover:bg-green-100"
																}`}
																title="Download CSV"
															>
																{isDownloading &&
																Number(
																	activeId,
																) ===
																	Number(
																		session?.id,
																	) ? (
																	<FaSpinner className="w-4 h-4 animate-spin" />
																) : (
																	<FaRegFileWord className="w-4 h-4" />
																)}
															</button>
															<button
																onClick={() =>
																	!isDownloadingExcl &&
																	downloadExcel(
																		session,
																	)
																}
																disabled={
																	isDownloadingExcl &&
																	Number(
																		activeId,
																	) ===
																		Number(
																			session?.id,
																		)
																}
																className={`p-2 rounded-lg transition-all ${
																	isDownloadingExcl &&
																	Number(
																		activeId,
																	) ===
																		Number(
																			session?.id,
																		)
																		? "bg-gray-100 text-gray-400 cursor-not-allowed"
																		: "bg-blue-50 text-blue-600 hover:bg-blue-100"
																}`}
																title="Download Excel"
															>
																{isDownloadingExcl &&
																Number(
																	activeId,
																) ===
																	Number(
																		session?.id,
																	) ? (
																	<FaSpinner className="w-4 h-4 animate-spin" />
																) : (
																	<FaFileExcel className="w-4 h-4" />
																)}
															</button>
														</div>
													</div>
												</td>
											</tr>
										),
									)}
								</tbody>
							</table>
						</div>
					</div>
				)
			) : (
				/* Empty State */
				<div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
					<div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
						<PiWarningCircle className="w-12 h-12 text-primary" />
					</div>
					<h3 className="text-2xl font-bold text-gray-900 mb-3">
						No Session Results Available
					</h3>
					<p className="text-gray-600 max-w-md mx-auto mb-8 text-lg">
						Session analytics will appear here once participants
						complete your interactive sessions. Start engaging with
						your audience to gather valuable insights.
					</p>
					<div className="flex items-center justify-center gap-3 text-primary font-semibold text-lg">
						<Users className="w-6 h-6" />
						<span>
							Host your quiz to start collecting responses
						</span>
					</div>
				</div>
			)}

			{/* Analytics Modal */}
			<Modal size="xl"
				title="Session Analytics Dashboard"
				open={isModalStatus}
				onClose={() => setIsModalStatus(false)}
			>
				<div className="p-1">
					{/* <AllQuestResult attemId={resultShowAttemId} /> */}
					<QuizMode
						scope={"entire"}
						sessionData={resultShowAttemId}
					/>
				</div>
			</Modal>
		</div>
	);
}

export default QuizQuestionsResultView;
