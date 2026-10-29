// In-browser stand-in for the Laravel Fun Games module (app/Modules/FunGame).
// Used only with NEXT_PUBLIC_FUN_GAMES_MOCK=1. It follows the same rules as
// the server: self-paced play in each player's own order, server-owned
// deadlines, a two-minute join window, a hard end, and the same scoring.

import { checkRows } from "../lib/importSchema";
import type {
	AdminLiveStats,
	AdminQuestion,
	AdminQuizDetail,
	AdminSessionSummary,
	AnswerAck,
	AnswerSubmission,
	FinalisationStep,
	HostGameDetail,
	HostGameInput,
	HostGameSummary,
	HostImportDryRun,
	HostImportRequest,
	HostImportRow,
	HostParticipant,
	HostQuestion,
	HostQuestionInput,
	HostSessionDetail,
	Id,
	ImportFileQuestionV1,
	ImportSummary,
	JoinInput,
	JoinLookup,
	JoinResult,
	Leaderboard,
	LeaderboardEntry,
	LibraryPreview,
	LibraryQuiz,
	PersonalResult,
	PlayerProgress,
	Question,
	QuestionSelection,
	QuizServerEventType,
	QuizServerEvents,
	QuizSocketEnvelope,
	QuizStatus,
	ScoringMode,
	SessionState,
	SessionStatus,
	SubmitResult,
	TimerConfig,
	TimerMode,
} from "../types";
import { BOT_NAMES, LIBRARY, seedQuizzes, type LibrarySeed } from "./data";

/** The mock server's clock runs ahead of the device, to exercise offset handling. */
const SERVER_SKEW_MS = 3200;
const TICK_MS = 500;
const JOIN_WINDOW_MS = 120_000;
const END_GRACE_MS = 30_000;
const ANSWER_GRACE_MS = 500;
const FINALISE_MS = 2000;
const POINTS_PER_MARK = 1000;
const OFFLINE_AFTER_MS = 60_000;

export type Audience = "all" | "participant" | "host";
type Listener = (envelope: QuizSocketEnvelope, audience: Audience) => void;

export class MockHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly fields?: Record<string, string[]>,
		/** Becomes the error's `details`, like Laravel's `data` (e.g. `{issues}`). */
		readonly details?: Record<string, unknown>,
	) {
		super(message);
	}
}

interface MockGame {
	id: Id;
	title: string;
	description: string;
	instructions: string;
	published: boolean;
	timerMode: TimerMode;
	totalSeconds: number;
	secondsPerQuestion: number;
	scoringMode: ScoringMode;
	shuffle: boolean;
	/** null = every player answers all questions. */
	perPlayer: number | null;
	selection: QuestionSelection;
	defaultMarks: number;
	defaultNegativeMarks: number;
	questions: HostQuestion[];
	sourceDeckId: Id | null;
	updatedAt: number;
}

/** Settings frozen when a session starts. */
interface Snapshot {
	mode: TimerMode;
	totalSeconds: number;
	secondsPerQuestion: number;
	scoringMode: ScoringMode;
	shuffle: boolean;
	perPlayer: number;
	selection: QuestionSelection;
	/** "same" selection with a pool: the questions everyone gets. */
	drawn: Id[] | null;
	questions: HostQuestion[];
}

interface MockAnswer {
	optionId: Id;
	openedAt: number;
	at: number;
	responseMs: number;
	correct: boolean;
	points: number;
}

interface MockPlayer {
	id: Id;
	name: string;
	email: string;
	bot: boolean;
	/** Bots: chance of a correct answer, and seconds per answer. */
	accuracy: number;
	pace: number;
	joinedAt: number;
	lastSeenAt: number;
	order: Id[] | null;
	index: number | null;
	openedAt: number | null;
	deadline: number | null;
	firstOpenedAt: number | null;
	personalDeadline: number | null;
	finishedAt: number | null;
	answers: Map<Id, MockAnswer>;
	/** Set when scored. */
	score?: number;
	rank?: number;
}

interface MockSession {
	id: Id;
	gameId: Id;
	joinCode: string;
	status: SessionStatus;
	startsAt: number | null;
	startedAt: number | null;
	joinClosesAt: number | null;
	endsAt: number | null;
	finishingAt: number | null;
	finishedAt: number | null;
	endedByHost: boolean;
	snapshot: Snapshot | null;
	players: MockPlayer[];
}

const toParticipantQuestion = (q: AdminQuestion): Question => ({
	id: q.id,
	type: q.type,
	text: q.text,
	imageUrl: q.imageUrl,
	options: q.options,
	marks: q.marks,
	negativeMarks: q.negativeMarks,
});

let idCounter = 100;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

function shuffled<T>(items: T[]): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

function gameFromSeed(seed: AdminQuizDetail): MockGame {
	const timer = seed.timer;
	const overrides = timer.mode === "perQuestion" ? (timer.overrides ?? {}) : {};
	return {
		id: seed.id,
		title: seed.title,
		description: seed.description,
		instructions: seed.instructions,
		published: seed.status !== "draft",
		timerMode: timer.mode,
		totalSeconds: timer.mode === "total" ? timer.totalSeconds : 1200,
		secondsPerQuestion: timer.mode === "perQuestion" ? timer.secondsPerQuestion : 30,
		scoringMode: timer.mode === "perQuestion" ? "speed" : "marks",
		shuffle: true,
		// The networking quiz draws 5 of its 8 questions per player, to show the pool.
		perPlayer: seed.id === "networks-6" ? 5 : null,
		selection: "different",
		defaultMarks: seed.defaultMarks,
		defaultNegativeMarks: seed.defaultNegativeMarks,
		questions: seed.questions.map((q) => ({ ...q, secondsOverride: overrides[q.id] ?? null })),
		sourceDeckId: null,
		updatedAt: Date.parse(seed.updatedAt),
	};
}

export class MockServer {
	private games: MockGame[] = seedQuizzes().map(gameFromSeed);
	private sessions: MockSession[] = [];
	private tokens = new Map<string, [Id, Id]>();
	private imports = new Map<Id, { gameId: Id; before: HostQuestion[]; summary: ImportSummary }>();
	private listeners = new Map<Id, Set<Listener>>();
	private networkListeners = new Set<(down: boolean) => void>();
	networkDown = false;

	constructor() {
		this.seedSessions();
		setInterval(() => this.tick(), TICK_MS);
	}

	now(): number {
		return Date.now() + SERVER_SKEW_MS;
	}

	iso(ms: number | null | undefined): string | null {
		return ms == null ? null : new Date(ms).toISOString();
	}

	// ------------------------------------------------------------------ events

	subscribe(sessionId: Id, listener: Listener): () => void {
		const set = this.listeners.get(sessionId) ?? new Set<Listener>();
		set.add(listener);
		this.listeners.set(sessionId, set);
		return () => {
			set.delete(listener);
		};
	}

	onNetworkChange(listener: (down: boolean) => void): () => void {
		this.networkListeners.add(listener);
		return () => {
			this.networkListeners.delete(listener);
		};
	}

	setNetworkDown(down: boolean): void {
		if (this.networkDown === down) return;
		this.networkDown = down;
		this.networkListeners.forEach((listener) => listener(down));
	}

	private emit<K extends QuizServerEventType>(sessionId: Id, type: K, data: QuizServerEvents[K], audience: Audience = "all"): void {
		if (this.networkDown) return;
		const envelope = { type, data, serverTime: this.iso(this.now())! } as QuizSocketEnvelope;
		this.listeners.get(sessionId)?.forEach((listener) => listener(structuredClone(envelope), audience));
	}

	private emitState(s: MockSession): void {
		this.emit(s.id, "session.state", this.sessionState(s));
	}

	private emitHostBoard(s: MockSession): void {
		this.emit(s.id, "leaderboard.updated", this.leaderboard(s.id, true), "host");
		this.emit(s.id, "admin.stats", this.stats(s), "host");
	}

	// ------------------------------------------------------------------ lookups

	private game(id: Id): MockGame {
		const game = this.games.find((g) => g.id === id);
		if (!game) throw new MockHttpError(404, "Game not found.");
		return game;
	}

	private session(id: Id): MockSession {
		const session = this.sessions.find((s) => s.id === id);
		if (!session) throw new MockHttpError(404, "Session not found.");
		return session;
	}

	private byJoinCode(joinCode: string): MockSession {
		const session = this.sessions.find((s) => s.joinCode === joinCode.trim().toUpperCase());
		if (!session) throw new MockHttpError(404, "No game found for this code. Check it and try again.");
		return session;
	}

	/** Token → player, as the X-Participant-Token check does. */
	resolve(sessionId: Id, token: string): { s: MockSession; p: MockPlayer } {
		const s = this.session(sessionId);
		const entry = this.tokens.get(token);
		const p = entry && entry[0] === sessionId ? s.players.find((x) => x.id === entry[1]) : undefined;
		if (!p) throw new MockHttpError(401, "Invalid or expired participant token.");
		p.lastSeenAt = this.now();
		this.sync(s);
		return { s, p };
	}

	// ------------------------------------------------------------------ seed

	private bot(i: number): MockPlayer {
		const name = BOT_NAMES[i % BOT_NAMES.length];
		const t = this.now();
		return {
			id: `bot-${i + 1}-${Math.random().toString(36).slice(2, 6)}`,
			name,
			email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`,
			bot: true,
			accuracy: 0.45 + ((i * 37) % 50) / 100,
			pace: 3 + ((i * 7) % 9),
			joinedAt: t,
			lastSeenAt: t,
			order: null,
			index: null,
			openedAt: null,
			deadline: null,
			firstOpenedAt: null,
			personalDeadline: null,
			finishedAt: null,
			answers: new Map(),
		};
	}

	private blankSession(gameId: Id, joinCode: string): MockSession {
		return {
			id: nextId("sess"),
			gameId,
			joinCode,
			status: "waiting",
			startsAt: null,
			startedAt: null,
			joinClosesAt: null,
			endsAt: null,
			finishingAt: null,
			finishedAt: null,
			endedByHost: false,
			snapshot: null,
			players: [],
		};
	}

	/** Seeded join codes: open /attempt/fun-games/<code>. */
	private seedSessions(): void {
		const now = this.now();
		// Per-question, speed points, live (joinable for two minutes).
		const net = this.blankSession("networks-6", "GNETWK6");
		net.players = Array.from({ length: 12 }, (_, i) => this.bot(i));
		this.startLive(net, now);
		// Total timer, marks, live.
		const os = this.blankSession("os-sched", "GSCHED7");
		os.players = Array.from({ length: 15 }, (_, i) => this.bot(i + 3));
		this.startLive(os, now);
		// Lobby, starts in a minute.
		const se = this.blankSession("se-agile", "GAGLE25");
		se.startsAt = now + 60_000;
		se.players = Array.from({ length: 5 }, (_, i) => this.bot(i + 6));
		// Scheduled for tomorrow.
		const db = this.blankSession("db-norm", "GDBNRM4");
		db.startsAt = now + 26 * 3600_000;
		this.sessions.push(net, os, se, db);
	}

	// ------------------------------------------------------------------ session lifecycle

	/** Longest a player can need: their slowest possible set of questions, or the total timer. */
	private playMs(snapshot: Snapshot): number {
		if (snapshot.mode !== "perQuestion") return snapshot.totalSeconds * 1000;
		const pool = snapshot.drawn ? snapshot.questions.filter((q) => snapshot.drawn!.includes(q.id)) : snapshot.questions;
		return pool
			.map((q) => (q.secondsOverride ?? snapshot.secondsPerQuestion) * 1000)
			.sort((a, b) => b - a)
			.slice(0, snapshot.perPlayer)
			.reduce((sum, ms) => sum + ms, 0);
	}

	private startLive(s: MockSession, at: number): void {
		const game = this.game(s.gameId);
		s.snapshot = {
			mode: game.timerMode,
			totalSeconds: game.totalSeconds,
			secondsPerQuestion: game.secondsPerQuestion,
			scoringMode: game.scoringMode,
			shuffle: game.shuffle,
			perPlayer: game.perPlayer ? Math.min(game.perPlayer, game.questions.length) : game.questions.length,
			selection: game.selection,
			drawn: null,
			questions: structuredClone(game.questions),
		};
		const snap = s.snapshot;
		if (snap.selection === "same" && snap.perPlayer < snap.questions.length) {
			const picked = new Set(shuffled(snap.questions.map((q) => q.id)).slice(0, snap.perPlayer));
			snap.drawn = snap.questions.map((q) => q.id).filter((id) => picked.has(id));
		}
		s.status = "live";
		s.startedAt = at;
		s.joinClosesAt = at + JOIN_WINDOW_MS;
		s.endsAt = s.joinClosesAt + this.playMs(s.snapshot) + END_GRACE_MS;
	}

	private beginFinishing(s: MockSession, at: number, byHost = false): void {
		const end = Math.min(at, this.now());
		s.players.forEach((p) => {
			this.catchUp(s, p, end);
			this.finishPlayer(s, p, end);
		});
		s.status = "finishing";
		s.finishingAt = this.now();
		s.endedByHost = byHost;
		this.emitState(s);
	}

	private finalise(s: MockSession): void {
		this.standings(s).forEach((row) => {
			row.p.score = row.score;
			row.p.rank = row.rank;
		});
		s.status = "finished";
		s.finishedAt = this.now();
		this.emit(s.id, "session.finished", { finishedAt: this.iso(s.finishedAt)! });
		this.emitState(s);
		this.emit(s.id, "leaderboard.published", this.leaderboard(s.id, false), "participant");
		this.emit(s.id, "leaderboard.published", this.leaderboard(s.id, true), "host");
	}

	/** Applies whatever is due, like SessionEngine::sync. */
	private sync(s: MockSession): void {
		const now = this.now();
		if (s.status === "waiting" && s.startsAt && now >= s.startsAt) {
			this.startLive(s, s.startsAt);
			this.emitState(s);
		}
		if (s.status === "live") {
			if (s.endsAt && now >= s.endsAt) {
				this.beginFinishing(s, s.endsAt);
			} else {
				s.players.forEach((p) => this.catchUp(s, p, now - ANSWER_GRACE_MS));
				if (s.joinClosesAt && now >= s.joinClosesAt && s.players.every((p) => p.finishedAt)) {
					this.beginFinishing(s, now);
				}
			}
		}
		if (s.status === "finishing" && s.finishingAt && now - s.finishingAt >= FINALISE_MS) {
			this.finalise(s);
		}
	}

	private tick(): void {
		for (const s of this.sessions) {
			if (s.status === "live") this.tickBots(s);
			const before = s.status;
			this.sync(s);
			if (s.status === "live" && before === "live") this.emitHostBoard(s);
		}
	}

	private tickBots(s: MockSession): void {
		const now = this.now();
		s.players
			.filter((p) => p.bot && !p.finishedAt)
			.forEach((bot) => {
				bot.lastSeenAt = now;
				if (bot.openedAt === null) {
					this.open(s, bot, bot.index ?? 0, now);
					return;
				}
				if (now - bot.openedAt < bot.pace * 1000) return;
				const question = this.currentQuestion(s, bot);
				if (!question) return;
				const correct = Math.random() < bot.accuracy;
				const wrong = question.options.filter((o) => o.id !== question.correctOptionId);
				const optionId = correct ? question.correctOptionId : wrong[Math.floor(Math.random() * wrong.length)].id;
				this.answer(s, bot, question, optionId, now);
			});
	}

	// ------------------------------------------------------------------ players (PlayerEngine)

	private secondsFor(s: MockSession, question: HostQuestion): number {
		return question.secondsOverride ?? s.snapshot!.secondsPerQuestion;
	}

	private currentQuestion(s: MockSession, p: MockPlayer): HostQuestion | null {
		if (p.finishedAt || p.openedAt === null || p.index === null || !p.order) return null;
		return s.snapshot!.questions.find((q) => q.id === p.order![p.index!]) ?? null;
	}

	private open(s: MockSession, p: MockPlayer, index: number, at: number): void {
		const snap = s.snapshot!;
		if (!p.order) {
			const all = snap.questions.map((q) => q.id);
			let ids = snap.drawn ?? all;
			if (!snap.drawn && snap.perPlayer < all.length) {
				const picked = new Set(shuffled(all).slice(0, snap.perPlayer));
				ids = all.filter((id) => picked.has(id));
			}
			p.order = snap.shuffle ? shuffled(ids) : ids;
		}
		p.index = index;
		p.openedAt = at;
		if (p.firstOpenedAt === null) {
			p.firstOpenedAt = at;
			if (snap.mode === "total") p.personalDeadline = Math.min(at + snap.totalSeconds * 1000, s.endsAt ?? Infinity);
		}
		if (snap.mode === "perQuestion") {
			const q = snap.questions.find((x) => x.id === p.order![index])!;
			p.deadline = Math.min(at + this.secondsFor(s, q) * 1000, s.endsAt ?? Infinity);
		}
	}

	private moveOn(s: MockSession, p: MockPlayer, at: number): void {
		const next = (p.index ?? 0) + 1;
		if (next >= (p.order?.length ?? 0)) this.finishPlayer(s, p, at);
		else this.open(s, p, next, at);
	}

	private finishPlayer(s: MockSession, p: MockPlayer, at: number): void {
		if (p.finishedAt) return;
		p.finishedAt = at;
		p.openedAt = null;
		p.deadline = null;
		this.emitState(s);
	}

	private catchUp(s: MockSession, p: MockPlayer, now: number): void {
		if (p.finishedAt || p.openedAt === null || !s.snapshot) return;
		if (s.snapshot.mode === "total") {
			if (p.personalDeadline && now >= p.personalDeadline) this.finishPlayer(s, p, p.personalDeadline);
			return;
		}
		for (let guard = 0; guard <= (p.order?.length ?? 0) && !p.finishedAt; guard++) {
			if (!p.deadline || now < p.deadline) return;
			this.moveOn(s, p, p.deadline);
		}
	}

	private answerPoints(s: MockSession, q: HostQuestion, correct: boolean, responseMs: number): number {
		const snap = s.snapshot!;
		if (snap.scoringMode !== "speed") return correct ? q.marks : -q.negativeMarks;
		if (!correct) return 0;
		const base = POINTS_PER_MARK * q.marks;
		if (snap.mode !== "perQuestion") return base;
		const limit = this.secondsFor(s, q) * 1000;
		return Math.round(base * (1 - Math.min(responseMs, limit) / (2 * limit)));
	}

	private answer(s: MockSession, p: MockPlayer, q: HostQuestion, optionId: Id, at: number): void {
		const limit = s.snapshot!.mode === "perQuestion" ? this.secondsFor(s, q) * 1000 : Infinity;
		const responseMs = Math.min(at - (p.openedAt ?? at), limit);
		const correct = optionId === q.correctOptionId;
		p.answers.set(q.id, {
			optionId,
			openedAt: p.openedAt ?? at,
			at,
			responseMs,
			correct,
			points: this.answerPoints(s, q, correct, responseMs),
		});
		this.moveOn(s, p, at);
	}

	private progress(s: MockSession, p: MockPlayer): PlayerProgress {
		const snap = s.snapshot;
		const question = snap ? this.currentQuestion(s, p) : null;
		const perQuestion = snap?.mode === "perQuestion";
		return {
			status: s.status,
			finished: !!p.finishedAt,
			finishedAt: this.iso(p.finishedAt),
			index: p.index,
			total: p.order?.length ?? snap?.perPlayer ?? 0,
			question: question ? toParticipantQuestion(question) : null,
			openedAt: this.iso(question ? p.openedAt : null),
			deadline: this.iso(perQuestion ? p.deadline : p.personalDeadline),
			windowSeconds: question && perQuestion ? this.secondsFor(s, question) : (snap?.totalSeconds ?? 0),
			startedAt: this.iso(p.firstOpenedAt),
			serverTime: this.iso(this.now())!,
		};
	}

	// ------------------------------------------------------------------ views

	private quizInfo(s: MockSession) {
		const game = this.game(s.gameId);
		const snap = s.snapshot;
		const questions = snap?.questions ?? game.questions;
		const mode = snap?.mode ?? game.timerMode;
		const timer: TimerConfig =
			mode === "perQuestion"
				? { mode, secondsPerQuestion: snap?.secondsPerQuestion ?? game.secondsPerQuestion }
				: { mode, totalSeconds: snap?.totalSeconds ?? game.totalSeconds };
		const perPlayer = snap?.perPlayer ?? (game.perPlayer ? Math.min(game.perPlayer, questions.length) : questions.length);
		return {
			id: game.id,
			title: game.title,
			description: game.description,
			instructions: game.instructions,
			questionCount: perPlayer,
			poolSize: questions.length,
			totalMarks: questions.reduce((sum, q) => sum + q.marks, 0),
			timer,
			scoringMode: snap?.scoringMode ?? game.scoringMode,
		};
	}

	sessionState(s: MockSession, p?: MockPlayer): SessionState {
		const state: SessionState = {
			id: s.id,
			status: s.status,
			joinCode: s.joinCode,
			quiz: this.quizInfo(s),
			startsAt: this.iso(s.startsAt),
			startedAt: this.iso(s.startedAt),
			joinClosesAt: this.iso(s.joinClosesAt),
			endsAt: this.iso(s.endsAt),
			finishedAt: this.iso(s.finishedAt),
			serverTime: this.iso(this.now())!,
			participantCount: s.players.length,
			finishedCount: s.players.filter((x) => x.finishedAt).length,
		};
		if (p) {
			state.participantId = p.id;
			state.participantName = p.name;
			state.participation = p.finishedAt || s.status === "finished" ? "submitted" : "joined";
		}
		return state;
	}

	private isJoinOpen(s: MockSession): boolean {
		return s.status === "waiting" || (s.status === "live" && (!s.joinClosesAt || this.now() < s.joinClosesAt));
	}

	private timeTaken(s: MockSession, p: MockPlayer): number | null {
		if (p.firstOpenedAt === null) return null;
		const ms = (p.finishedAt ?? this.now()) - p.firstOpenedAt;
		return s.snapshot?.mode === "total" && s.snapshot.scoringMode === "speed" ? Math.min(ms, s.snapshot.totalSeconds * 1000) : ms;
	}

	private standings(s: MockSession) {
		const snap = s.snapshot;
		const speedTotal = snap?.scoringMode === "speed" && snap.mode === "total";
		const totalMs = (snap?.totalSeconds ?? 1) * 1000;
		const rows = s.players.map((p) => {
			const answers = [...p.answers.values()];
			const correct = answers.filter((a) => a.correct).length;
			const timeMs = this.timeTaken(s, p);
			const points = answers.reduce((sum, a) => sum + a.points, 0);
			const score = speedTotal
				? Math.round(points * (1 - Math.min(timeMs ?? totalMs, totalMs) / (2 * totalMs)))
				: Math.round(points * 100) / 100;
			return { p, score, correct, incorrect: answers.length - correct, timeMs };
		});
		rows.sort(
			(a, b) =>
				b.score - a.score ||
				b.correct - a.correct ||
				(a.timeMs ?? Infinity) - (b.timeMs ?? Infinity) ||
				a.p.name.localeCompare(b.p.name),
		);
		let rank = 0;
		return rows.map((row, i) => {
			const prev = rows[i - 1];
			if (!prev || prev.score !== row.score || prev.correct !== row.correct || prev.timeMs !== row.timeMs) rank = i + 1;
			return { ...row, rank };
		});
	}

	leaderboard(id: Id, forHost: boolean, meId?: Id): Leaderboard {
		const s = this.session(id);
		const base = {
			scoringMode: s.snapshot?.scoringMode ?? this.game(s.gameId).scoringMode,
			totalParticipants: s.players.length,
			updatedAt: this.iso(this.now())!,
			scoredThroughIndex: null,
		};
		if (!forHost && s.status !== "finished") return { ...base, status: "pending", entries: [] };
		const perPlayer = s.snapshot?.perPlayer ?? 0;
		const live = forHost && s.status !== "finished";
		const entries: LeaderboardEntry[] = this.standings(s).map((row) => {
			const entry: LeaderboardEntry = {
				rank: row.rank,
				participantId: row.p.id,
				name: row.p.name,
				score: row.score,
				correct: row.correct,
				accuracy: row.correct + row.incorrect ? row.correct / (row.correct + row.incorrect) : 0,
				timeMs: row.timeMs,
				isMe: row.p.id === meId,
				email: forHost ? row.p.email : undefined,
			};
			if (live) {
				const total = row.p.order?.length ?? perPlayer;
				entry.progress = { done: row.p.finishedAt ? total : (row.p.index ?? 0), total, finished: !!row.p.finishedAt };
				entry.currentQuestionStatus = row.p.finishedAt
					? "finished"
					: row.p.openedAt === null
						? "waiting"
						: this.now() - row.p.lastSeenAt > OFFLINE_AFTER_MS
							? "offline"
							: "answering";
			}
			return entry;
		});
		return { ...base, status: s.status === "finished" ? "published" : "live", entries };
	}

	private stats(s: MockSession): AdminLiveStats {
		return {
			participantCount: s.players.length,
			finishedCount: s.players.filter((p) => p.finishedAt).length,
			offlineCount: s.players.filter((p) => !p.finishedAt && this.now() - p.lastSeenAt > OFFLINE_AFTER_MS).length,
			answeredCount: s.players.reduce((sum, p) => sum + p.answers.size, 0),
			distribution: [],
		};
	}

	// ------------------------------------------------------------------ participant API

	lookup(joinCode: string): JoinLookup {
		const s = this.byJoinCode(joinCode);
		this.sync(s);
		const info = this.quizInfo(s);
		return {
			session: {
				id: s.id,
				status: s.status,
				joinCode: s.joinCode,
				startsAt: this.iso(s.startsAt),
				participantCount: s.players.length,
				joinOpen: this.isJoinOpen(s),
				serverTime: this.iso(this.now())!,
			},
			game: {
				title: info.title,
				description: info.description,
				instructions: info.instructions,
				questionCount: info.questionCount,
				timer: info.timer,
			},
		};
	}

	join(joinCode: string, input: JoinInput): JoinResult {
		const s = this.byJoinCode(joinCode);
		this.sync(s);
		const name = input.name.trim().replace(/\s+/g, " ");
		const email = input.email.trim().toLowerCase();
		const fields: Record<string, string[]> = {};
		if (!name) fields.name = ["The name field is required."];
		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = ["The email field must be a valid email address."];
		if (Object.keys(fields).length) throw new MockHttpError(422, "Validation Error", fields);
		if (s.status === "finished" || s.status === "finishing") throw new MockHttpError(409, "This game has ended.");

		let p = s.players.find((x) => x.email === email);
		const rejoined = !!p;
		if (!p && !this.isJoinOpen(s)) throw new MockHttpError(409, "This game has already started, and joining has closed.");
		if (p) {
			p.name = name;
		} else {
			const t = this.now();
			p = {
				id: nextId("p"),
				name,
				email,
				bot: false,
				accuracy: 0,
				pace: 0,
				joinedAt: t,
				lastSeenAt: t,
				order: null,
				index: null,
				openedAt: null,
				deadline: null,
				firstOpenedAt: null,
				personalDeadline: null,
				finishedAt: null,
				answers: new Map(),
			};
			s.players.push(p);
			this.emit(s.id, "participant.joined", { id: p.id, name, email, joinedAt: this.iso(t)!, online: true }, "host");
			this.emitState(s);
		}
		// Not crypto.randomUUID(): it only exists on HTTPS/localhost, and the dev site is plain http.
		const token = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
		this.tokens.set(token, [s.id, p.id]);
		return {
			participantToken: token,
			participantId: p.id,
			rejoined,
			publicChannelKey: `mock-${s.id}`,
			session: this.sessionState(s, p),
		};
	}

	state(sessionId: Id, token: string): SessionState {
		const { s, p } = this.resolve(sessionId, token);
		return this.sessionState(s, p);
	}

	current(sessionId: Id, token: string): PlayerProgress {
		const { s, p } = this.resolve(sessionId, token);
		if (s.status === "live") {
			this.catchUp(s, p, this.now());
			if (!p.finishedAt && p.openedAt === null) this.open(s, p, p.index ?? 0, this.now());
		}
		return this.progress(s, p);
	}

	submit(sessionId: Id, token: string, sub: AnswerSubmission): SubmitResult {
		const { s, p } = this.resolve(sessionId, token);
		const now = this.now();
		const ack = (accepted: boolean, reason?: AnswerAck["reason"]): SubmitResult => {
			if (!accepted) this.catchUp(s, p, now);
			return {
				ack: { accepted, reason: reason ?? null, questionId: sub.questionId, optionId: sub.optionId, serverTime: this.iso(now)! },
				progress: this.progress(s, p),
			};
		};
		if (s.status !== "live") return ack(false, s.status === "waiting" ? "locked" : "finished");
		if (p.finishedAt) return ack(false, "finished");
		const question = this.currentQuestion(s, p);
		if (!question || question.id !== sub.questionId) {
			const position = p.order?.indexOf(sub.questionId) ?? -1;
			const passed = position >= 0 && position < (p.index ?? 0) && !p.answers.has(sub.questionId);
			return ack(false, passed ? "late" : "locked");
		}
		const deadline = s.snapshot!.mode === "perQuestion" ? p.deadline : p.personalDeadline;
		if (deadline && now > deadline + ANSWER_GRACE_MS) return ack(false, "late");
		if (sub.optionId && !question.options.some((o) => o.id === sub.optionId)) return ack(false, "invalid");

		if (sub.optionId) this.answer(s, p, question, sub.optionId, now);
		else this.moveOn(s, p, now);
		this.sync(s);
		this.emitHostBoard(s);
		return ack(true);
	}

	myResult(sessionId: Id, token: string): PersonalResult {
		const { s, p } = this.resolve(sessionId, token);
		const pool = s.snapshot?.questions ?? this.game(s.gameId).questions;
		// This player's own questions (a draw from the pool, or all of them).
		const mine = p.order ?? s.snapshot?.drawn ?? pool.slice(0, s.snapshot?.perPlayer ?? pool.length).map((q) => q.id);
		const questions = pool.filter((q) => mine.includes(q.id));
		const scoringMode: ScoringMode = s.snapshot?.scoringMode ?? "marks";
		const maxMarks = questions.reduce((sum, q) => sum + q.marks, 0);
		const answered = p.answers.size;
		const common = {
			scoringMode,
			answered,
			maxMarks: scoringMode === "speed" ? maxMarks * POINTS_PER_MARK : maxMarks,
		};
		if (s.status !== "finished") {
			return {
				...common,
				status: "pending",
				marks: 0,
				correct: 0,
				incorrect: 0,
				unanswered: questions.length - answered,
				accuracy: 0,
				rank: null,
				totalParticipants: null,
				timeMs: null,
				averageAnswerMs: null,
			};
		}
		const answers = [...p.answers.values()];
		const correct = answers.filter((a) => a.correct).length;
		const order = p.order ?? questions.map((q) => q.id);
		return {
			...common,
			status: "final",
			marks: p.score ?? 0,
			correct,
			incorrect: answered - correct,
			unanswered: questions.length - answered,
			accuracy: answered ? correct / answered : 0,
			rank: p.rank ?? null,
			totalParticipants: s.players.length,
			timeMs: this.timeTaken(s, p),
			averageAnswerMs: answers.length ? Math.round(answers.reduce((sum, a) => sum + a.responseMs, 0) / answers.length) : null,
			answerSheet: order.map((questionId, index) => {
				const a = p.answers.get(questionId);
				return {
					questionId,
					index,
					outcome: !a ? "unanswered" : a.correct ? "correct" : "incorrect",
					points: a?.points ?? null,
					responseMs: a?.responseMs ?? null,
				};
			}),
		};
	}

	// ------------------------------------------------------------------ host: games

	private running(gameId: Id): boolean {
		return this.sessions.some((x) => x.gameId === gameId && (x.status === "live" || x.status === "finishing"));
	}

	private assertEditable(gameId: Id): void {
		if (this.running(gameId)) throw new MockHttpError(409, "Questions and timer can't change while a session is running.");
	}

	private latestSession(gameId: Id): MockSession | undefined {
		return [...this.sessions].reverse().find((s) => s.gameId === gameId);
	}

	private timerOf(game: MockGame): TimerConfig {
		return game.timerMode === "perQuestion"
			? { mode: "perQuestion", secondsPerQuestion: game.secondsPerQuestion }
			: { mode: "total", totalSeconds: game.totalSeconds };
	}

	private hostSummary(game: MockGame): HostGameSummary {
		const latest = this.latestSession(game.id);
		const status: QuizStatus = !game.published
			? "draft"
			: !latest
				? "upcoming"
				: latest.status === "finished"
					? "completed"
					: latest.status === "waiting"
						? latest.startsAt && latest.startsAt > this.now()
							? "upcoming"
							: "lobby"
						: "live";
		return {
			id: game.id,
			title: game.title,
			description: game.description,
			instructions: game.instructions,
			status,
			published: game.published,
			questionCount: game.questions.length,
			totalMarks: game.questions.reduce((sum, q) => sum + q.marks, 0),
			timer: this.timerOf(game),
			scoringMode: game.scoringMode,
			shuffleQuestions: game.shuffle,
			questionsPerPlayer: game.perPlayer,
			questionSelection: game.selection,
			startsAt: this.iso(latest?.startsAt),
			latestSessionId: latest?.id ?? null,
			latestSessionStatus: latest?.status ?? null,
			sourceDeckId: game.sourceDeckId,
			updatedAt: this.iso(game.updatedAt)!,
			sessionCount: this.sessions.filter((s) => s.gameId === game.id).length,
		};
	}

	hostGames(): HostGameSummary[] {
		return this.games.map((g) => this.hostSummary(g));
	}

	hostGame(id: Id): HostGameDetail {
		const game = this.game(id);
		return {
			...this.hostSummary(game),
			defaultMarks: game.defaultMarks,
			defaultNegativeMarks: game.defaultNegativeMarks,
			timerSettings: { mode: game.timerMode, totalSeconds: game.totalSeconds, secondsPerQuestion: game.secondsPerQuestion },
			locked: this.running(id),
			questions: game.questions,
		};
	}

	private applyInput(game: MockGame, input: HostGameInput): void {
		if (input.title !== undefined) game.title = input.title;
		if (input.description !== undefined) game.description = input.description;
		if (input.instructions !== undefined) game.instructions = input.instructions;
		if (input.defaultMarks !== undefined) game.defaultMarks = input.defaultMarks;
		if (input.defaultNegativeMarks !== undefined) game.defaultNegativeMarks = input.defaultNegativeMarks;
		if (input.scoringMode !== undefined) game.scoringMode = input.scoringMode;
		if (input.shuffleQuestions !== undefined) game.shuffle = input.shuffleQuestions;
		if (input.questionsPerPlayer !== undefined) game.perPlayer = input.questionsPerPlayer;
		if (input.questionSelection !== undefined) game.selection = input.questionSelection;
		if (input.timer) {
			game.timerMode = input.timer.mode;
			if (input.timer.mode === "perQuestion") game.secondsPerQuestion = input.timer.secondsPerQuestion;
			else game.totalSeconds = input.timer.totalSeconds;
		}
		game.updatedAt = this.now();
	}

	hostCreateGame(input: HostGameInput): HostGameDetail {
		const game: MockGame = {
			id: nextId("game"),
			title: "Untitled game",
			description: "",
			instructions: "",
			published: false,
			timerMode: "total",
			totalSeconds: 1200,
			secondsPerQuestion: 30,
			scoringMode: "marks",
			shuffle: true,
			perPlayer: null,
			selection: "same",
			defaultMarks: 1,
			defaultNegativeMarks: 0,
			questions: [],
			sourceDeckId: null,
			updatedAt: this.now(),
		};
		this.applyInput(game, input);
		this.games.unshift(game);
		return this.hostGame(game.id);
	}

	hostUpdateGame(id: Id, input: HostGameInput): HostGameDetail {
		const game = this.game(id);
		if (input.timer) this.assertEditable(id);
		this.applyInput(game, input);
		return this.hostGame(id);
	}

	hostDeleteGame(id: Id): void {
		this.game(id);
		if (this.sessions.some((s) => s.gameId === id && s.status !== "finished")) {
			throw new MockHttpError(409, "End this game's session before deleting it.");
		}
		this.games = this.games.filter((g) => g.id !== id);
	}

	hostDuplicate(id: Id): HostGameDetail {
		const source = this.game(id);
		const copy: MockGame = {
			...structuredClone(source),
			id: nextId("game"),
			title: `${source.title} (copy)`.slice(0, 200),
			published: false,
			updatedAt: this.now(),
		};
		copy.questions = copy.questions.map((q) => ({ ...q, id: nextId("q") }));
		this.games.unshift(copy);
		return this.hostGame(copy.id);
	}

	hostPublish(id: Id): HostGameDetail {
		const game = this.game(id);
		const issues: string[] = [];
		if (!game.questions.length) issues.push("Add at least one question.");
		if (game.perPlayer && game.perPlayer > game.questions.length) {
			issues.push(`Each player should answer ${game.perPlayer} questions, but the game has only ${game.questions.length}.`);
		}
		game.questions.forEach((q, i) => {
			if (q.options.length < 2 || !q.options.some((o) => o.id === q.correctOptionId)) {
				issues.push(`Question ${i + 1} needs at least two options and a correct answer.`);
			}
		});
		if (issues.length) throw new MockHttpError(422, "Fix these before publishing.", undefined, { issues });
		game.published = true;
		game.updatedAt = this.now();
		return this.hostGame(id);
	}

	private toQuestion(game: MockGame, input: HostQuestionInput, id: Id): HostQuestion {
		if (input.options.length < 2) throw new MockHttpError(422, "A question needs at least two options.");
		if (!input.options.some((o) => o.id === input.correctOptionId)) {
			throw new MockHttpError(422, "Pick the correct answer from the options.");
		}
		return {
			id,
			type: "single_choice",
			text: input.text,
			imageUrl: input.imageUrl ?? null,
			options: input.options,
			correctOptionId: input.correctOptionId,
			marks: input.marks ?? game.defaultMarks,
			negativeMarks: input.negativeMarks ?? game.defaultNegativeMarks,
			secondsOverride: input.secondsOverride ?? null,
		};
	}

	hostCreateQuestion(gameId: Id, input: HostQuestionInput): HostQuestion {
		this.assertEditable(gameId);
		const game = this.game(gameId);
		const question = this.toQuestion(game, input, nextId("q"));
		game.questions.push(question);
		game.updatedAt = this.now();
		return question;
	}

	hostUpdateQuestion(gameId: Id, questionId: Id, input: HostQuestionInput): HostQuestion {
		this.assertEditable(gameId);
		const game = this.game(gameId);
		const index = game.questions.findIndex((q) => q.id === questionId);
		if (index < 0) throw new MockHttpError(404, "Question not found.");
		const question = this.toQuestion(game, input, questionId);
		game.questions[index] = question;
		game.updatedAt = this.now();
		return question;
	}

	hostDeleteQuestion(gameId: Id, questionId: Id): void {
		this.assertEditable(gameId);
		const game = this.game(gameId);
		game.questions = game.questions.filter((q) => q.id !== questionId);
		game.updatedAt = this.now();
	}

	hostReorder(gameId: Id, ids: Id[]): void {
		this.assertEditable(gameId);
		const game = this.game(gameId);
		const byId = new Map(game.questions.map((q) => [q.id, q]));
		if (ids.length !== game.questions.length || ids.some((id) => !byId.has(id))) {
			throw new MockHttpError(409, "The question list changed. Reload and try again.");
		}
		game.questions = ids.map((id) => byId.get(id)!);
	}

	// ------------------------------------------------------------------ host: My Library and import

	libraryQuizzes(): LibraryQuiz[] {
		return LIBRARY.map((lib) => ({
			id: lib.id,
			title: lib.title,
			description: lib.description,
			questionCount: lib.questions.length,
			updatedAt: this.iso(this.now() - 86400_000),
		}));
	}

	private library(quizId: Id): LibrarySeed {
		const lib = LIBRARY.find((l) => l.id === quizId);
		if (!lib) throw new MockHttpError(404, "Quiz not found in your library.");
		return lib;
	}

	private convertLibrary(lib: LibrarySeed, defaultMarks: number) {
		const rows: HostImportRow[] = [];
		const questions: HostQuestion[] = [];
		lib.questions.forEach((q, index) => {
			const row: HostImportRow = {
				index,
				position: index + 1,
				text: q.text,
				type: q.typeLabel,
				status: "ready",
				messages: [],
				optionCount: q.choices.length,
			};
			const correct = Array.isArray(q.correct) ? q.correct : [q.correct];
			if (!q.supported) {
				row.status = "skipped";
				row.messages.push(`${q.typeLabel} questions can't be played in Fun Games.`);
			} else if (correct.length !== 1) {
				row.status = "skipped";
				row.messages.push(`Has ${correct.length} correct answers — Fun Games questions have exactly one.`);
			} else {
				if (q.typeLabel !== "Single choice" && q.typeLabel !== "True / false") {
					row.status = "check";
					row.messages.push("Imported as single choice.");
				}
				const options = q.choices.map((text, i) => ({ id: `o${i + 1}`, text }));
				questions.push({
					id: nextId("q"),
					type: "single_choice",
					text: q.text,
					imageUrl: null,
					options,
					correctOptionId: options[correct[0]].id,
					marks: q.points || defaultMarks,
					negativeMarks: 0,
					secondsOverride: null,
				});
			}
			rows.push(row);
		});
		return { rows, questions };
	}

	libraryPreview(quizId: Id): LibraryPreview {
		const lib = this.library(quizId);
		const { rows, questions } = this.convertLibrary(lib, 1);
		return {
			quiz: { id: lib.id, title: lib.title },
			rows,
			importable: questions.length,
			suggestedTimer: {
				mode: "perQuestion",
				secondsPerQuestion: lib.secondsPerQuestion,
				totalSeconds: Math.max(60, Math.ceil((questions.length * lib.secondsPerQuestion) / 60) * 60),
			},
		};
	}

	private skippedOf(rows: HostImportRow[]) {
		return rows
			.filter((r) => r.status === "skipped")
			.map((r) => ({ position: r.position, text: r.text, reason: r.messages[0] ?? "" }));
	}

	private recordImport(
		gameId: Id,
		before: HostQuestion[],
		source: ImportSummary["source"],
		mode: ImportSummary["mode"],
		added: number,
		removed: number,
		skipped: ImportSummary["skipped"],
	): ImportSummary {
		const summary: ImportSummary = {
			id: nextId("import"),
			source,
			mode,
			added,
			removed,
			skipped,
			undoneAt: null,
			createdAt: this.iso(this.now())!,
		};
		this.imports.set(summary.id, { gameId, before, summary });
		return summary;
	}

	createFromLibrary(quizId: Id, mode: TimerMode): { game: HostGameDetail; import: ImportSummary } {
		const lib = this.library(quizId);
		const { rows, questions } = this.convertLibrary(lib, 1);
		if (!questions.length) throw new MockHttpError(422, "None of this quiz's questions can be played in Fun Games.");
		const preview = this.libraryPreview(quizId);
		const created = this.hostCreateGame({
			title: lib.title,
			description: lib.description,
			timer:
				mode === "perQuestion"
					? { mode: "perQuestion", secondsPerQuestion: preview.suggestedTimer.secondsPerQuestion }
					: { mode: "total", totalSeconds: preview.suggestedTimer.totalSeconds },
		});
		const game = this.game(created.id);
		game.questions = questions;
		game.sourceDeckId = lib.id;
		const summary = this.recordImport(game.id, [], "library_quiz", "append", questions.length, 0, this.skippedOf(rows));
		return { game: this.hostGame(game.id), import: summary };
	}

	private importRows(game: MockGame, request: HostImportRequest) {
		if (request.source === "library_quiz") return this.convertLibrary(this.library(request.quizId ?? ""), game.defaultMarks);
		const items = request.questions ?? [];
		const checks = checkRows(items, request.mode === "append" ? game.questions.map((q) => q.text) : [], game.defaultMarks);
		const rows: HostImportRow[] = checks.map((c, index) => ({
			index,
			position: index + 1,
			text: String((items[index] as ImportFileQuestionV1 | undefined)?.text ?? "").slice(0, 160),
			type: "Single choice",
			status: c.status,
			messages: c.messages,
			optionCount: Array.isArray(items[index]?.options) ? items[index].options.length : 0,
		}));
		const questions: HostQuestion[] = items
			.filter((_, i) => checks[i].status !== "error")
			.map((item) => {
				const options = item.options.map((text, i) => ({ id: `o${i + 1}`, text: text.trim() }));
				return {
					id: nextId("q"),
					type: "single_choice",
					text: item.text.trim(),
					imageUrl: item.image ?? null,
					options,
					correctOptionId: options[item.answer].id,
					marks: item.marks ?? game.defaultMarks,
					negativeMarks: item.negative ?? game.defaultNegativeMarks,
					secondsOverride: null,
				};
			});
		return { rows, questions };
	}

	hostImportDryRun(gameId: Id, request: HostImportRequest): HostImportDryRun {
		const { rows, questions } = this.importRows(this.game(gameId), request);
		return { rows, importable: questions.length, errors: rows.filter((r) => r.status === "error").length };
	}

	hostImport(gameId: Id, request: HostImportRequest): { game: HostGameDetail; import: ImportSummary } {
		this.assertEditable(gameId);
		const game = this.game(gameId);
		const { rows, questions } = this.importRows(game, request);
		const errors = rows.filter((r) => r.status === "error").length;
		if (errors) {
			throw new MockHttpError(422, `${errors} questions have errors. Fix or leave them out, then import.`, undefined, { rows, errors });
		}
		if (!questions.length) throw new MockHttpError(422, "There are no questions to import.");
		const before = game.questions;
		game.questions = request.mode === "replace" ? questions : [...game.questions, ...questions];
		if (request.timer) this.applyInput(game, { timer: request.timer });
		game.updatedAt = this.now();
		const summary = this.recordImport(
			gameId,
			before,
			request.source,
			request.mode,
			questions.length,
			request.mode === "replace" ? before.length : 0,
			[...this.skippedOf(rows), ...(request.skipped ?? [])],
		);
		return { game: this.hostGame(gameId), import: summary };
	}

	hostUndoImport(importId: Id): { game: HostGameDetail; import: ImportSummary } {
		const record = this.imports.get(importId);
		if (!record) throw new MockHttpError(404, "Import not found.");
		if (record.summary.undoneAt) throw new MockHttpError(409, "This import was already undone.");
		this.assertEditable(record.gameId);
		this.game(record.gameId).questions = record.before;
		record.summary = { ...record.summary, undoneAt: this.iso(this.now()) };
		return { game: this.hostGame(record.gameId), import: record.summary };
	}

	// ------------------------------------------------------------------ host: sessions

	private finalisation(s: MockSession): FinalisationStep[] {
		const statuses: FinalisationStep["status"][] =
			s.status === "finished"
				? ["done", "done", "done", "done"]
				: s.status === "finishing"
					? ["done", "running", "pending", "pending"]
					: ["pending", "pending", "pending", "pending"];
		const labels: Array<[FinalisationStep["key"], string]> = [
			["lockAnswers", "Lock answers"],
			["score", "Score answers"],
			["rank", "Rank players"],
			["publish", "Publish leaderboard"],
		];
		return labels.map(([key, label], i) => ({ key, label, status: statuses[i], note: null }));
	}

	hostSession(id: Id): HostSessionDetail {
		const s = this.session(id);
		this.sync(s);
		return {
			...this.sessionState(s),
			quizId: s.gameId,
			publicChannelKey: `mock-${s.id}`,
			joinUrl: "",
			endedByHost: s.endedByHost,
			stats: this.stats(s),
			finalisation: this.finalisation(s),
		};
	}

	hostListSessions(statuses?: SessionStatus[]): AdminSessionSummary[] {
		return this.sessions
			.filter((s) => {
				this.sync(s);
				return !statuses?.length || statuses.includes(s.status);
			})
			.map((s) => {
				const info = this.quizInfo(s);
				return {
					id: s.id,
					quizId: s.gameId,
					quizTitle: info.title,
					status: s.status,
					joinCode: s.joinCode,
					startedAt: this.iso(s.startedAt),
					finishedAt: this.iso(s.finishedAt),
					startsAt: this.iso(s.startsAt),
					participantCount: s.players.length,
					timer: info.timer,
				};
			});
	}

	hostCreateSession(gameId: Id, startsAt: string | null | undefined): HostSessionDetail {
		const game = this.game(gameId);
		if (!game.published) throw new MockHttpError(409, "Publish the game before hosting it.");
		if (!game.questions.length) throw new MockHttpError(409, "Add at least one question before hosting.");
		if (this.sessions.some((s) => s.gameId === gameId && s.status !== "finished")) {
			throw new MockHttpError(409, "This game already has a session that hasn't finished.");
		}
		const code = `G${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "X")}`;
		const s = this.blankSession(gameId, code);
		s.startsAt = startsAt ? Date.parse(startsAt) : null;
		this.sessions.push(s);
		return this.hostSession(s.id);
	}

	hostStart(id: Id): HostSessionDetail {
		const s = this.session(id);
		if (s.status !== "waiting") throw new MockHttpError(409, "This session has already started.");
		this.startLive(s, this.now());
		this.emitState(s);
		return this.hostSession(id);
	}

	hostEnd(id: Id): HostSessionDetail {
		const s = this.session(id);
		this.sync(s);
		if (s.status !== "waiting" && s.status !== "live") throw new MockHttpError(409, "This session has already ended.");
		this.beginFinishing(s, this.now(), true);
		return this.hostSession(id);
	}

	hostParticipants(id: Id): HostParticipant[] {
		const s = this.session(id);
		return s.players.map((p) => ({
			id: p.id,
			name: p.name,
			email: p.email,
			joinedAt: this.iso(p.joinedAt)!,
			lastSeenAt: this.iso(p.lastSeenAt),
			finishedAt: this.iso(p.finishedAt),
			online: this.now() - p.lastSeenAt <= OFFLINE_AFTER_MS,
		}));
	}
}

let server: MockServer | null = null;

export function getMockServer(): MockServer {
	server ??= new MockServer();
	return server;
}
