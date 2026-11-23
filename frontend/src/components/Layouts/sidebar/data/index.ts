import { FolderOpen, LayoutList, ListChecks, Radio } from "lucide-react";

import * as Icons from "../icons";

export const NAV_DATA = [
	{
		label: "MAIN MENU",
		items: [
			{
				title: "Dashboard",
				url: "/dashboard",
				icon: Icons.FourCircle,
				items: [],
			},
			{
				title: "My Library",
				url: "/my-library",
				icon: Icons.HomeIcon,
				items: [
					{ title: "Quiz", url: "/my-library/quiz-page", icon: "/images/icons/quiz.svg" },
					{ title: "Quest", url: "/my-library/quest-page", icon: "/images/icons/quest.svg" },
				],
			},
			{
				title: "Discover",
				url: "/discover",
				icon: Icons.Calendar,
				items: [
					{ title: "Quiz", url: "/discover/discover-quiz", icon: "/images/icons/quiz.svg" },
					{ title: "Quest", url: "/discover/discover-quest", icon: "/images/icons/quest.svg" },
				],
			},
			{
				title: "Question Bank",
				url: "/bank",
				icon: Icons.User,
				items: [
					{ title: "My Bank", url: "/bank/my-question-bank", icon: "/images/icons/mybank.svg" },
					{ title: "Public Bank", url: "/bank/public-question-bank", icon: "/images/icons/publicbank.svg" },
					{ title: "Categories", url: "/bank/categories", icon: "/images/icons/categories.svg" },
				],
			},
			{
				title: "My Files",
				url: "/my-files",
				icon: FolderOpen,
				items: [],
			},
			{
				title: "Fun Games",
				url: "/fun-games",
				icon: ListChecks,
				items: [
					{ title: "My games", url: "/fun-games", icon: LayoutList },
					{ title: "Live sessions", url: "/fun-games/sessions", icon: Radio },
				],
			},
		],
	},
];
