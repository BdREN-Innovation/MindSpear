import { createLucideIcon } from "lucide-react";

/** The leaderboard sign: a 1-2-3 podium with a star over first place. Drawn like the lucide icons (24 × 24, stroke). */
export const Podium = createLucideIcon("Podium", [
	["path", { d: "M9 21V11h6v10", key: "first" }],
	["path", { d: "M9 21v-6H3v6", key: "second" }],
	["path", { d: "M15 21v-4h6v4", key: "third" }],
	["path", { d: "M2 21h20", key: "floor" }],
	["path", { d: "m12 3 .9 1.8 2 .3-1.45 1.4.35 2L12 7.55l-1.8.95.35-2L9.1 5.1l2-.3Z", key: "star" }],
]);
