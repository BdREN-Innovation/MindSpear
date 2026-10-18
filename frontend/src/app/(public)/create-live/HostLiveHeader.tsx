"use client";
import QuestHostLiveHeader from "../live/quests/HostLiveHeader";

interface HeaderProps {
	onClose?: () => void;
	joinCode?: string | null;
	label?: string;
}

/** The quiz host's top bar: the same as the quest one (it was a 20px close dot). */
export default function HostLiveHeader({ onClose, joinCode, label = "Quiz live" }: HeaderProps) {
	const clearAllTimerStorage = () => {
		Object.keys(localStorage).forEach((key) => {
			if (key.startsWith("timer_")) localStorage.removeItem(key);
		});
	};

	return (
		<QuestHostLiveHeader
			joinCode={joinCode}
			label={label}
			onClose={() => {
				localStorage.removeItem("leaderboardState");
				clearAllTimerStorage();
				onClose?.();
			}}
		/>
	);
}
