export type LiveModule = "quest" | "quiz";

export type LiveSessionStatus = "pending" | "started" | "ended";

export type LiveSubscriptionStatus =
	| "unavailable"
	| "connecting"
	| "subscribed"
	| "error";

export type TimerState = {
	status?: string;
	remaining_seconds?: number;
	start_time?: string;
	duration_seconds?: number;
	/** Set by the server when the host opens the question (ISO). */
	started_at?: string;
	/** Exact time left when the server answered. */
	remaining_ms?: number;
	/** When the question's time runs out, by this device's clock (see withDeadline). */
	deadline_ms?: number;
	[key: string]: unknown;
} | null;

export type SessionSnapshot = {
	module: LiveModule;
	session_id: number;
	session_code?: string | null;
	public_channel_key: string;
	public_channel?: string;
	host_channel?: string;
	running_status: boolean;
	current_question_id: number | null;
	current_task_id: number | null;
	timer_state: TimerState;
	participant_count: number;
	active_participants?: LiveParticipant[];
	current_aggregate?: AnswerAggregatePayload | null;
	start_datetime?: string | null;
	end_datetime?: string | null;
	updated_at?: string | null;
};

export type HostLiveSessionBootstrap = {
	id: number;
	session_id: string;
	title?: string | null;
	quest_id?: number | null;
	quiz_id?: number | null;
	public_channel_key: string | null;
	running_status: boolean;
	current_question_id: number | null;
	current_task_id: number | null;
	timer_state: TimerState;
	participant_count: number;
	active_participants: LiveParticipant[];
	start_datetime?: string | null;
	end_datetime?: string | null;
	timezone?: string | null;
	updated_at?: string | null;
	created_at?: string | null;
	join_link?: string | null;
	join_code?: string | null;
};

export type ParticipantTokenBundle = {
	module: LiveModule;
	sessionId: number;
	attemptId: number;
	participantToken: string;
	publicChannelKey: string;
};

export type SessionEventPayload = {
	module?: LiveModule;
	event?: string;
	session_id?: number;
	running_status?: boolean;
	public_channel_key?: string;
	current_question_id?: number | null;
	current_task_id?: number | null;
	question_id?: number | null;
	task_id?: number | null;
	timer_state?: TimerState;
	timer?: TimerState;
	participant_count?: number;
	count?: number;
	updated_at?: string | null;
	broadcasted_at?: string;
	[key: string]: unknown;
};

export type AnswerAggregatePayload = SessionEventPayload & {
	total_answers?: number;
	answers?: Record<string, number>;
	statuses?: Record<string, number>;
	chart?: {
		type?: string;
		value_type?: "count" | "percentage" | string;
		total_answers?: number;
		scores?: Record<string, number> | number[];
		/** Scales: each statement's average rating, and the top of the scale. */
		averages?: Record<string, number> | number[];
		scale_max?: number;
		order?: number[];
		highest_value?: number;
	} | null;
};

export type HostAnswerPayload = SessionEventPayload & {
	participant_id?: number;
	question_id?: number;
	task_id?: number;
};

export type HostParticipantPayload = SessionEventPayload & {
	participant_id?: number;
	participant_count?: number;
	participant_name?: string | null;
	participant_user_id?: number | null;
	is_anonymous?: boolean | null;
	status?: string | null;
	joined_at?: string | null;
};

export type LiveParticipant = {
	participant_id: number;
	participant_name: string | null;
	participant_user_id?: number | null;
	is_anonymous?: boolean | null;
	status?: string | null;
	joined_at?: string | null;
};

export type LiveChannelState = {
	participantCount: number;
	currentQuestionId: number | null;
	currentTaskId: number | null;
	timerState: TimerState;
	sessionStatus: LiveSessionStatus;
	answerAggregate: AnswerAggregatePayload | null;
	leaderboard: unknown;
	connectionStatus: LiveSubscriptionStatus;
	publicSubscriptionStatus: LiveSubscriptionStatus;
	hostSubscriptionStatus: LiveSubscriptionStatus;
	isConnected: boolean;
	lastEvent: SessionEventPayload | null;
};

export type ApiEnvelope<T> = {
	status?: boolean;
	success?: boolean;
	message?: string;
	data: T;
};
