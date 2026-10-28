"use client";

import DiscoverProductTab from "@/features/dashboard/discover/DiscoverProductTab";
import Title from "../../../../components/ui/Title";

export default function Discover() {
	return (
		<div className="min-h-screen">
			<Title as="h2">Discover Quizzes</Title>
			<DiscoverProductTab product="quiz" />
		</div>
	);
}
