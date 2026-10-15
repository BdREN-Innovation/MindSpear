import { NextResponse } from "next/server";
import { GenerateError, generateQuestions, parseRequest, requireUser } from "@/features/ai-generate/server/generate";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST: { target: quiz|quest|fungame, textData, topic, questionCount, questionTypes, … } → { target, questions } */
export async function POST(request: Request) {
	try {
		await requireUser(request);
		const body = await request.json().catch(() => null);
		const result = await generateQuestions(parseRequest(body));
		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof GenerateError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		console.error("Error generating questions:", error);
		return NextResponse.json({ error: "Failed to generate questions." }, { status: 500 });
	}
}
