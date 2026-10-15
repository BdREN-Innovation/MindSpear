import { Grid2x2 } from "lucide-react";
import { defineSlideType } from "../types";
import { Matrix2x2Editor } from "./Editor";
import { Matrix2x2Participant } from "./Participant";
import { Matrix2x2Presenter } from "./Presenter";
import { sampleMatrixAggregate } from "./sample";

export const entry = defineSlideType({
	key: "matrix_2x2",
	products: ["quest"],
	category: "poll",
	label: "2×2 matrix",
	description: "Place a dot on a two-axis grid and see the scatter.",
	icon: Grid2x2,
	Editor: Matrix2x2Editor,
	Presenter: Matrix2x2Presenter,
	Participant: Matrix2x2Participant,
	sampleAggregate: sampleMatrixAggregate,
});
