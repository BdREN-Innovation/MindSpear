import { createHash } from "crypto";
import { buildPrompt } from "../prompts";
import { funGameQuestionSchema, generateRequestSchema, keepValid, questTaskSchema, quizQuestionSchema } from "../schema";
import { MAX_TEXT_CHARS, type GenerateRequest, type GenerateResponse, type QuestAiTask, type QuizAiQuestion } from "../types";

// Server-only: used by the /api/ai/* route handlers. Never import from client components.

export class GenerateError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message);
	}
}

const AUTH_CACHE_MS = 60_000;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const authCache = new Map<string, number>();
const recentCalls = new Map<string, number[]>();

function tokenKey(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** Only signed-in users may spend AI credits: the token is checked against the backend. */
export async function requireUser(request: Request): Promise<string> {
	const header = request.headers.get("authorization") ?? "";
	const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
	if (!token || token === "null" || token === "undefined") {
		throw new GenerateError("Please sign in again to generate questions.", 401);
	}

	const key = tokenKey(token);
	const cached = authCache.get(key);
	if (!cached || cached < Date.now()) {
		const base = process.env.INTERNAL_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
		if (!base) throw new GenerateError("The API address is not configured.", 500);
		const res = await fetch(`${base.replace(/\/$/, "")}/profile/show`, {
			headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
			cache: "no-store",
		}).catch(() => null);
		if (!res) throw new GenerateError("Can't reach the server to check your sign-in.", 502);
		if (!res.ok) throw new GenerateError("Please sign in again to generate questions.", 401);
		authCache.set(key, Date.now() + AUTH_CACHE_MS);
	}

	const now = Date.now();
	const calls = (recentCalls.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
	if (calls.length >= RATE_LIMIT) {
		throw new GenerateError("You're generating too quickly. Please wait a minute and try again.", 429);
	}
	calls.push(now);
	recentCalls.set(key, calls);

	return key;
}

export function parseRequest(body: unknown): GenerateRequest {
	const parsed = generateRequestSchema.safeParse(body);
	if (!parsed.success) {
		throw new GenerateError(parsed.error.issues[0]?.message ?? "Invalid request.", 422);
	}
	return { ...parsed.data, textData: parsed.data.textData.slice(0, MAX_TEXT_CHARS) };
}

async function callOpenAi(prompt: string): Promise<unknown> {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) throw new GenerateError("AI generation is not configured on this server.", 500);

	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model: process.env.OPENAI_MODEL || "gpt-4o",
			temperature: 0.7,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: "You are a helpful assistant that outputs JSON only." },
				{ role: "user", content: prompt },
			],
		}),
	});
	if (!res.ok) {
		console.error("OpenAI request failed", res.status, await res.text().catch(() => ""));
		throw new GenerateError("The AI service is unavailable right now. Please try again shortly.", 502);
	}
	const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
	const raw = (data.choices?.[0]?.message?.content ?? "").replace(/^```json\s*|```$/g, "").trim();
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function validate(req: GenerateRequest, output: unknown): GenerateResponse {
	const items = (output as { questions?: unknown } | null)?.questions;
	switch (req.target) {
		case "quest":
			// The schemas check the type names against QUESTION_TYPES, so the narrower types hold.
			return { target: "quest", questions: keepValid(items, questTaskSchema) as QuestAiTask[] };
		case "fungame":
			return { target: "fungame", questions: keepValid(items, funGameQuestionSchema) };
		default:
			return { target: "quiz", questions: keepValid(items, quizQuestionSchema) as QuizAiQuestion[] };
	}
}

/** Asks the AI for questions; retries once if the answer is unusable. */
export async function generateQuestions(req: GenerateRequest): Promise<GenerateResponse> {
	const prompt = buildPrompt(req);
	let result = validate(req, await callOpenAi(prompt));
	if (result.questions.length === 0) {
		result = validate(req, await callOpenAi(prompt));
	}
	if (result.questions.length === 0) {
		throw new GenerateError("The AI couldn't write questions from this text. Try other pages or a clearer topic.", 502);
	}
	return { ...result, questions: result.questions.slice(0, req.questionCount) } as GenerateResponse;
}
