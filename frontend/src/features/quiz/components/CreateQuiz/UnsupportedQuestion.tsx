import React from "react";
import { CircleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui";

/** A question whose type this editor can't open (e.g. made by an older version of the app). */
export default function UnsupportedQuestion() {
	return (
		<div className="flex min-h-[calc(100vh-140px)] flex-col items-center justify-center rounded-[15px] bg-white px-4 text-center">
			<CircleAlert className="h-12 w-12 text-primary" aria-hidden />
			<h3 className="mt-4 text-lg font-bold text-[#222]">This question can&apos;t be edited here</h3>
			<p className="mt-1 max-w-[420px] text-sm text-[#666]">
				Its question type isn&apos;t supported by the quiz editor. Choose another question from the
				list, or delete this one and add it again.
			</p>
		</div>
	);
}

/** Placeholder while the quiz's questions load. */
export function EditorLoading() {
	return (
		<div className="grid min-h-[calc(100vh-140px)] grid-cols-1 gap-5 md:grid-cols-12" aria-busy="true" aria-label="Loading questions">
			<div className="space-y-4 rounded-[15px] bg-white p-6 md:col-span-9">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="mx-auto h-48 w-1/2" />
				<div className="grid grid-cols-2 gap-4">
					<Skeleton className="h-16" />
					<Skeleton className="h-16" />
					<Skeleton className="h-16" />
					<Skeleton className="h-16" />
				</div>
			</div>
			<div className="space-y-4 rounded-[15px] bg-white p-6 md:col-span-3">
				<Skeleton className="h-10" />
				<Skeleton className="h-10" />
				<Skeleton className="h-10" />
			</div>
		</div>
	);
}
