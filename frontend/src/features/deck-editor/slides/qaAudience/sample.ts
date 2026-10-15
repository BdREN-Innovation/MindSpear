import type { QaAudienceAggregate, QaHostItem, QaParticipantItem, SlideOf } from "@/features/deck/types";

// Q&A results are the moderated feed, not an aggregate. The editor canvas and
// the phone preview have no session, so they show these sample questions.

export function sampleQaAggregate(slide: SlideOf<"qa_audience">): QaAudienceAggregate {
	return {
		total_responses: 0,
		feed_source: "live_qa",
		sort: slide.config.sort ?? "top",
		show_feed_to_participants: slide.config.show_feed_to_participants ?? true,
		allow_anonymous: slide.config.allow_anonymous ?? true,
	};
}

const SAMPLES: Array<Pick<QaHostItem, "body" | "participant_emoji" | "upvote_count" | "is_answered" | "is_starred">> = [
	{ body: "How will this change affect the customers we already have?", participant_emoji: "🦊", upvote_count: 14, is_answered: false, is_starred: true },
	{ body: "What's the timeline for the first release?", participant_emoji: "🐼", upvote_count: 9, is_answered: false, is_starred: false },
	{ body: "Which teams are part of the pilot?", participant_emoji: "🦉", upvote_count: 5, is_answered: false, is_starred: false },
	{ body: "Can you share the slides afterwards?", participant_emoji: "🐙", upvote_count: 7, is_answered: true, is_starred: false },
];

export function sampleHostQuestions(): QaHostItem[] {
	return SAMPLES.map((sample, index) => ({
		...sample,
		question_id: -(index + 1),
		slide_run_id: 0,
		submitted_at: null,
		participant_id: null,
		is_hidden: false,
	}));
}

export function sampleParticipantQuestions(): QaParticipantItem[] {
	return SAMPLES.map((sample, index) => ({
		...sample,
		question_id: -(index + 1),
		slide_run_id: 0,
		submitted_at: null,
		is_hidden: false,
		has_upvoted: index === 1,
		is_mine: index === 2,
	}));
}
