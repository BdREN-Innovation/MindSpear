// Shapes shared with the Quiz (Django) backend. Field names follow
// docs/design/quize/DESIGN_HANDOFF.md §6 — keep them in step with the API spec.
// All timestamps are ISO-8601 strings produced by the server.

export type IsoDateTime = string;
export type Id = string;

// ---------------------------------------------------------------------------
// Quiz & questions
// ---------------------------------------------------------------------------

/** Card-level status. Each value has its own dot shape in StatusTag. */
export type QuizStatus = "draft" | "upcoming" | "lobby" | "live" | "completed";

export type TimerConfig =
	| { mode: "total"; totalSeconds: number }
	| {
			mode: "perQuestion";
			secondsPerQuestion: number;
			/** questionId → seconds */
			overrides?: Record<Id, number>;
	  };

export type TimerMode = TimerConfig["mode"];

export interface Quiz {
	id: Id;
	title: string;
	description: string;
	instructions: string;
	status: QuizStatus;
	questionCount: number;
	totalMarks?: number;
	timer: TimerConfig;
	startsAt?: IsoDateTime | null;
}

export type QuestionType = "single_choice";

export interface QuestionOption {
	id: Id;
	text: string;
}

/** Participant view of a question — never carries the correct answer. */
export interface Question {
	id: Id;
	type: QuestionType;
	text: string;
	imageUrl?: string | null;
	options: QuestionOption[];
	marks: number;
	negativeMarks: number;
}

/** Admin responses only. */
export interface AdminQuestion extends Question {
	correctOptionId: Id;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionStatus = "waiting" | "live" | "finishing" | "finished";

/** The participant's relationship to a session, as decided by the server. */
export type ParticipationStatus = "joined" | "submitted";

/** marks: correct earns the question's marks, wrong loses its penalty. speed: Kahoot-style points. */
export type ScoringMode = "marks" | "speed";

/** With a question pool: everyone gets the same drawn questions, or each player their own. */
export type QuestionSelection = "same" | "different";

export interface SessionQuizInfo {
	id: Id;
	title: string;
	description: string;
	instructions: string;
	/** Questions each player answers. */
	questionCount: number;
	/** Questions in the game; larger than questionCount when players get N from a pool. */
	poolSize?: number;
	totalMarks?: number;
	timer: TimerConfig;
	scoringMode: ScoringMode;
}

export interface SessionState {
	id: Id;
	status: SessionStatus;
	joinCode: string;
	quiz: SessionQuizInfo;
	/** Scheduled start, for the lobby countdown. Null: the host starts it. */
	startsAt?: IsoDateTime | null;
	startedAt?: IsoDateTime | null;
	/** New players can't join after this (players who joined can always come back). */
	joinClosesAt?: IsoDateTime | null;
	/** Hard end: the game is over for everyone by then. */
	endsAt?: IsoDateTime | null;
	finishedAt?: IsoDateTime | null;
	serverTime: IsoDateTime;
	participantCount: number;
	/** Players who have finished all their questions (or run out of time). */
	finishedCount: number;
	// Only in responses to an authenticated participant (not in broadcasts):
	participantId?: Id;
	participantName?: string;
	participation?: ParticipationStatus;
}

/**
 * Where one player is. Each player gets the questions one at a time in their own
 * order; only the question on screen is ever sent.
 */
export interface PlayerProgress {
	status: SessionStatus;
	finished: boolean;
	finishedAt: IsoDateTime | null;
	/** 0-based position in this player's order; null before the first question. */
	index: number | null;
	total: number;
	question: Question | null;
	openedAt: IsoDateTime | null;
	/** Per-question timer: this question's deadline. Total timer: the player's own deadline. */
	deadline: IsoDateTime | null;
	/** Length of the deadline's window in seconds (for the "running out" warning). */
	windowSeconds: number;
	/** When this player's first question appeared. */
	startedAt: IsoDateTime | null;
	serverTime: IsoDateTime;
}

/** Public lookup by join code, before joining. */
export interface JoinLookup {
	session: {
		id: Id;
		status: SessionStatus;
		joinCode: string;
		startsAt: IsoDateTime | null;
		participantCount: number;
		/** False once the join window has closed (players who joined can still come back). */
		joinOpen: boolean;
		serverTime: IsoDateTime;
	};
	game: {
		title: string;
		description: string;
		instructions: string;
		questionCount: number;
		timer: TimerConfig;
	};
}

export interface JoinInput {
	name: string;
	email: string;
}

export interface JoinResult {
	participantToken: string;
	participantId: Id;
	/** True when this email had already joined; the same player continues. */
	rejoined: boolean;
	publicChannelKey: string;
	session: SessionState;
}

/** What a participant's device keeps to continue after a reload. */
export interface ParticipantCredentials {
	sessionId: Id;
	joinCode: string;
	participantId: Id;
	token: string;
	publicChannelKey: string;
	name: string;
	email: string;
}

export interface AnswerSubmission {
	questionId: Id;
	/** null skips the question. */
	optionId: Id | null;
	clientSubmittedAt: IsoDateTime;
}

export type AnswerRejectReason =
	| "late"
	| "locked"
	| "finished"
	| "invalid";

export interface AnswerAck {
	accepted: boolean;
	reason?: AnswerRejectReason | null;
	questionId: Id;
	optionId: Id | null;
	serverTime: IsoDateTime;
}

export interface SubmitResult {
	ack: AnswerAck;
	/** The player's next question, or that they've finished. */
	progress: PlayerProgress;
}

// ---------------------------------------------------------------------------
// Results & leaderboard
// ---------------------------------------------------------------------------

export type AnswerOutcome = "correct" | "incorrect" | "unanswered";

export interface AnswerSheetItem {
	questionId: Id;
	/** Position in the order this player saw the questions. */
	index: number;
	outcome: AnswerOutcome;
	points?: number | null;
	responseMs?: number | null;
}

export interface PersonalResult {
	/** "pending" until the server finishes scoring the session. */
	status: "pending" | "final";
	scoringMode: ScoringMode;
	/** First question shown → finished. */
	timeMs?: number | null;
	averageAnswerMs?: number | null;
	/** Questions with an accepted answer. Safe to show before scoring. */
	answered: number;
	/** Scored fields are only meaningful once status is "final". */
	marks: number;
	maxMarks: number;
	correct: number;
	incorrect: number;
	unanswered: number;
	/** 0–1 */
	accuracy: number;
	rank?: number | null;
	totalParticipants?: number | null;
	answerSheet?: AnswerSheetItem[];
}

/** Host view of a player during the game. */
export type CurrentQuestionStatus = "waiting" | "answering" | "finished" | "offline";

export interface LeaderboardEntry {
	rank: number;
	participantId: Id;
	name: string;
	score: number;
	correct: number;
	/** 0–1 */
	accuracy?: number;
	currentQuestionStatus?: CurrentQuestionStatus;
	/** First question shown → finished (or until now while playing). */
	timeMs?: number | null;
	/** Host's live table: questions done so far. */
	progress?: { done: number; total: number; finished: boolean };
	isMe?: boolean;
	/** Host views only. */
	email?: string;
}

export interface Leaderboard {
	status: "pending" | "live" | "published";
	scoringMode: ScoringMode;
	entries: LeaderboardEntry[];
	totalParticipants: number;
	updatedAt: IsoDateTime;
	/** Live boards: the score reflects answers up to this question index. */
	scoredThroughIndex?: number | null;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AdminQuiz extends Quiz {
	updatedAt: IsoDateTime;
	sessionCount: number;
}

export interface AdminQuizDetail extends AdminQuiz {
	defaultMarks: number;
	defaultNegativeMarks: number;
	questions: AdminQuestion[];
}

export type AdminQuizInput = Pick<
	AdminQuizDetail,
	| "title"
	| "description"
	| "instructions"
	| "timer"
	| "defaultMarks"
	| "defaultNegativeMarks"
>;

export type AdminQuestionInput = Omit<AdminQuestion, "id"> & { id?: Id };

export interface AdminSessionSummary {
	id: Id;
	quizId: Id;
	quizTitle: string;
	status: SessionStatus;
	joinCode: string;
	startedAt?: IsoDateTime | null;
	finishedAt?: IsoDateTime | null;
	startsAt?: IsoDateTime | null;
	participantCount: number;
	timer: TimerConfig;
}

export interface OptionDistribution {
	optionId: Id;
	count: number;
}

export type FinalisationStepStatus = "pending" | "running" | "done" | "failed";

export interface FinalisationStep {
	key: "lockAnswers" | "score" | "rank" | "publish";
	label: string;
	status: FinalisationStepStatus;
	note?: string | null;
}

export interface AdminLiveStats {
	participantCount: number;
	finishedCount: number;
	offlineCount: number;
	/** Answers given so far, across all players. */
	answeredCount: number;
	distribution: OptionDistribution[];
}

export interface AdminSessionDetail extends SessionState {
	quizId: Id;
	stats: AdminLiveStats;
	currentQuestion?: AdminQuestion | null;
	nextQuestion?: AdminQuestion | null;
	finalisation: FinalisationStep[];
}

export interface StartSessionInput {
	/** Omit to open the lobby now. */
	startsAt?: IsoDateTime | null;
}

// ---------------------------------------------------------------------------
// Import (v1 file format, handoff §5)
// ---------------------------------------------------------------------------

export interface ImportFileQuestionV1 {
	type: string;
	text: string;
	options: string[];
	answer: number;
	marks?: number;
	negative?: number;
	image?: string | null;
}

export interface ImportFileV1 {
	version: 1;
	title?: string;
	settings?: { timer?: { mode: "total" | "perQuestion"; seconds: number } };
	questions: ImportFileQuestionV1[];
}

export type ImportRowStatus = "ready" | "check" | "error";

export interface ImportRowReport {
	index: number;
	status: ImportRowStatus;
	messages: string[];
}

export interface ImportRequest {
	questions: ImportFileQuestionV1[];
	mode: "append" | "replace";
	/** Only sent when the admin ticks "apply the file's timer". */
	timer?: TimerConfig | null;
}

export interface ImportDryRunResult {
	rows: ImportRowReport[];
}

export interface ImportResult {
	importId: Id;
	added: number;
	removed: number;
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

export interface ParticipantJoinedEvent {
	id: Id;
	name: string;
	email: string;
	joinedAt: IsoDateTime;
	online: boolean;
}

export interface SessionFinishedEvent {
	finishedAt: IsoDateTime;
}

/** Server → client WebSocket events, keyed by envelope `type`. */
export interface QuizServerEvents {
	"session.state": SessionState;
	"leaderboard.updated": Leaderboard;
	"session.finished": SessionFinishedEvent;
	"leaderboard.published": Leaderboard;
	"admin.stats": AdminLiveStats;
	"participant.joined": ParticipantJoinedEvent;
}

export type QuizServerEventType = keyof QuizServerEvents;

export interface QuizSocketEnvelope<
	K extends QuizServerEventType = QuizServerEventType,
> {
	type: K;
	data: QuizServerEvents[K];
	serverTime: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Host (Laravel /fun-games/host/*)
// ---------------------------------------------------------------------------

/** Both modes' values; the editor keeps the unused one so switching never loses it. */
export interface HostTimerSettings {
	mode: TimerMode;
	totalSeconds: number;
	secondsPerQuestion: number;
}

export interface HostQuestion extends AdminQuestion {
	/** Per-question mode: this question's own time, overriding the default. */
	secondsOverride: number | null;
}

export interface HostGameSummary {
	id: Id;
	title: string;
	description: string;
	instructions: string;
	/** draft | upcoming | lobby | live | completed, from the latest session. */
	status: QuizStatus;
	published: boolean;
	questionCount: number;
	totalMarks: number;
	timer: TimerConfig;
	scoringMode: ScoringMode;
	/** Each player gets the questions in their own random order. */
	shuffleQuestions: boolean;
	/** Each player answers this many questions drawn from the game's; null = all. */
	questionsPerPlayer: number | null;
	questionSelection: QuestionSelection;
	startsAt: IsoDateTime | null;
	latestSessionId: Id | null;
	latestSessionStatus: SessionStatus | null;
	sourceQuizId: Id | null;
	updatedAt: IsoDateTime;
	sessionCount: number;
}

export interface HostGameDetail extends HostGameSummary {
	defaultMarks: number;
	defaultNegativeMarks: number;
	timerSettings: HostTimerSettings;
	/** A session is running: questions and timer can't change. */
	locked: boolean;
	questions: HostQuestion[];
}

export interface HostGameInput {
	title?: string;
	description?: string;
	instructions?: string;
	timer?: TimerConfig;
	scoringMode?: ScoringMode;
	shuffleQuestions?: boolean;
	questionsPerPlayer?: number | null;
	questionSelection?: QuestionSelection;
	defaultMarks?: number;
	defaultNegativeMarks?: number;
}

export interface HostQuestionInput {
	type?: QuestionType;
	text: string;
	imageUrl?: string | null;
	options: QuestionOption[];
	correctOptionId: Id;
	marks?: number | null;
	negativeMarks?: number | null;
	secondsOverride?: number | null;
}

export interface LibraryQuiz {
	id: Id;
	title: string;
	description: string;
	questionCount: number;
	updatedAt: IsoDateTime | null;
}

/** "skipped": a library question Fun Games can't play; it never blocks an import. */
export type HostImportRowStatus = "ready" | "check" | "error" | "skipped";

export interface HostImportRow {
	index: number;
	position: number;
	text: string;
	type: string;
	status: HostImportRowStatus;
	messages: string[];
	optionCount: number;
}

export interface LibraryPreview {
	quiz: { id: Id; title: string };
	rows: HostImportRow[];
	importable: number;
	suggestedTimer: { mode: TimerMode; secondsPerQuestion: number; totalSeconds: number };
}

export interface SkippedQuestion {
	position: number;
	text: string;
	reason: string;
}

export interface ImportSummary {
	id: Id;
	source: "json" | "library_quiz";
	mode: "append" | "replace";
	added: number;
	removed: number;
	skipped: SkippedQuestion[];
	undoneAt: IsoDateTime | null;
	createdAt: IsoDateTime;
}

export interface HostImportRequest {
	source: "json" | "library_quiz";
	quizId?: Id;
	questions?: ImportFileQuestionV1[];
	mode: "append" | "replace";
	/** Only when the host ticked "use the file's timer". */
	timer?: TimerConfig | null;
	dryRun?: boolean;
	/** Rows the host left out, for the summary. */
	skipped?: SkippedQuestion[];
}

export interface HostImportDryRun {
	rows: HostImportRow[];
	importable: number;
	errors: number;
}

export interface HostSessionDetail extends SessionState {
	quizId: Id;
	publicChannelKey: string;
	joinUrl: string;
	endedByHost: boolean;
	stats: AdminLiveStats;
	finalisation: FinalisationStep[];
}

export interface HostParticipant {
	id: Id;
	name: string;
	email: string;
	joinedAt: IsoDateTime;
	lastSeenAt: IsoDateTime | null;
	finishedAt: IsoDateTime | null;
	online: boolean;
}
