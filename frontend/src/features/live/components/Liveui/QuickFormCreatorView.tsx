/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import QuickFormAnswerView from "./QuickFormAnswerView";
import { ClipboardList } from "lucide-react";
import axiosInstance from "@/utils/axiosInstance";

type QuickFormCreatorViewProps = {
	answerData?: any[];
	quickFromId?: number | string | null;
	/** Changes when another response arrives, so the list is fetched again. */
	refreshKey?: number;
};

type FormResponse = { id: number; participant: string | null; answer_data: any[] };

/**
 * The host's list of quick form submissions. They hold personal details, so they come from an
 * owner-only endpoint rather than the public live aggregate (which never carried them: the host
 * saw "No form responses yet" while the counter said 2).
 */
function QuickFormCreatorView({ answerData = [], quickFromId, refreshKey = 0 }: QuickFormCreatorViewProps) {
	const searchParams = useSearchParams();
	const questId = searchParams.get("qid");
	const sessionId = searchParams.get("sid");
	const [responses, setResponses] = useState<FormResponse[]>([]);

	useEffect(() => {
		if (!questId || !sessionId || !quickFromId) return;
		let cancelled = false;
		axiosInstance
			.get(`/quests/${questId}/sessions/${sessionId}/tasks/${quickFromId}/form-responses`)
			.then((response) => {
				if (!cancelled) setResponses(response?.data?.data?.responses ?? []);
			})
			.catch((error) => console.error("Could not load form responses:", error));
		return () => {
			cancelled = true;
		};
	}, [questId, sessionId, quickFromId, refreshKey]);

	const items: FormResponse[] = responses.length
		? responses
		: answerData.map((answer, index) => ({ id: index, participant: null, answer_data: answer?.answer_data ?? [] }));

	if (!items.length) {
		return (
			<div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
				<div>
					<div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
						<ClipboardList className="h-7 w-7" />
					</div>
					<h3 className="text-lg font-black text-slate-900">
						No form responses yet
					</h3>
					<p className="mt-2 text-sm font-medium text-slate-500">
						Responses will appear here as participants submit them.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="grid gap-4">
			{items.map((response) => (
				<div key={response.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
					{response.participant && (
						<p className="mb-3 text-sm font-bold text-slate-700">{response.participant}</p>
					)}
					<QuickFormAnswerView data={response} />
				</div>
			))}
		</div>
	);
}

export default QuickFormCreatorView;
