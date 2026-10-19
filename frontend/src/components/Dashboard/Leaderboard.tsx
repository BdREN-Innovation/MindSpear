/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import "./Leaderboard.css";

import { useSelector } from "react-redux";
import GameMode from "./GameMode";
import QuizMode from "./QuizMode";
interface LeaderboardProps {
	scope: "entire" | "slide";
	/** The quiz is over: the final standings, in either mode (game mode showed its between-questions board). */
	ended?: boolean;
}

const Leaderboard: React.FC<LeaderboardProps> = ({ ended = false }) => {
	const scopeType = useSelector((state: any) => state?.leaderboard);
	return (
		<>
			{scopeType.scope === "slide" && !ended ? (
				<GameMode scope={"slide"} />
			) : (
				<QuizMode scope={"entire"} sessionData="" />
			)}
		</>
	);
};

export default Leaderboard;
