import { NextResponse } from "next/server";
import { GenerateError, generateQuestions, parseRequest, requireUser } from "@/features/ai-generate/server/generate";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Older quiz-only endpoint, kept for compatibility. Same auth and validation
 * as /api/ai/generate-questions; returns { quiz: "<json string>" } like before.
 */
export async function POST(request: Request) {
	try {
		await requireUser(request);
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		const result = await generateQuestions(
			parseRequest({
				target: "quiz",
				textData: body?.textData,
				topic: body?.topic,
				questionCount: body?.questionCount,
				questionTypes: body?.questionType,
				difficulty: body?.difficulty,
				audienceLevel: body?.audienceLevel,
				focusArea: body?.focusArea ?? "",
			}),
		);
		return NextResponse.json({ quiz: JSON.stringify({ questions: result.questions }) });
	} catch (error) {
		if (error instanceof GenerateError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		console.error("Error generating quiz:", error);
		return NextResponse.json({ error: "Failed to generate quiz" }, { status: 500 });
	}
}
