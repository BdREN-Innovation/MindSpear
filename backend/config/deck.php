<?php

/*
|--------------------------------------------------------------------------
| Shared slide engine (Quest v2 and Quiz v2)
|--------------------------------------------------------------------------
*/

return [

    // At most one aggregate broadcast per slide run in this window (leading
    // edge now, one trailing broadcast with the final state).
    'aggregate_debounce_ms' => (int) env('DECK_AGGREGATE_DEBOUNCE_MS', 500),

    // Q&A upvotes burst; coalesce their broadcasts per question.
    'qa_upvote_debounce_ms' => (int) env('DECK_QA_UPVOTE_DEBOUNCE_MS', 200),

    // Countdown before voting opens when a slide turns get_ready on.
    'default_get_ready_seconds' => (int) env('DECK_DEFAULT_GET_READY_SECONDS', 5),

    /*
    | URL prefixes (under /api/v1) per product, used by App\Deck\Http\DeckRoutes.
    | `authoring` holds the deck/slide/option editor routes, `sessions` the live
    | session routes. Quiz v2 adds its own entry (e.g. 'quizzes' /
    | 'quiz-sessions') and reuses every controller with product = 'quiz'.
    */
    'routes' => [
        'quest' => [
            'authoring' => 'quests/v2',
            'sessions' => 'quest-sessions/v2',
        ],
        // Quiz v2 (QUIZ_REDESIGN_PLAN.md §2.1). Sessions live under /v2 because
        // legacy Quiz v1 still owns GET /api/v1/quiz-sessions/{id}/state.
        'quiz' => [
            'authoring' => 'quizzes',
            'sessions' => 'quiz-sessions/v2',
        ],
    ],

    /*
    | Quest v2 rollout (plan §8.3). Authoring and hosting need
    | users.quest_v2_enabled (toggled in the admin panel); true here turns
    | Quest v2 on for every account. Participants never need it.
    */
    'quest_v2_default_enabled' => (bool) env('QUEST_V2_DEFAULT_ENABLED', false),

    // Quiz v2 rollout, the same way: users.quiz_v2_enabled, or everyone when true.
    'quiz_v2_default_enabled' => (bool) env('QUIZ_V2_DEFAULT_ENABLED', false),

    /*
    | Quiz v2 live behaviour (QUIZ_REDESIGN_PLAN.md "Live session state
    | machine", "Scoring model").
    | - get_ready_seconds: the "Get ready" countdown new quiz decks seed into
    |   their answer slides, and the one a quiz slide without its own value
    |   (null) gets at session start. 0 on the slide turns it off.
    | - scoring: per-slide defaults (slides.points_min / points_max /
    |   speed_bonus_enabled), snapshotted into config_snapshot.scoring.
    | - spin_seconds: how long a spinner_wheel spins before it reveals, when
    |   the slide has no spin_duration_ms (its value, rounded up, wins).
    | - leaderboard_size: default top N of GET .../leaderboard (a leaderboard
    |   slide uses its own top_n / show_all_participants).
    | - reveal_leaderboard_limit: most leaderboard_delta rows in slide.revealed
    |   (best new_rank first); participants read their own through my-answer.
    */
    'quiz' => [
        'get_ready_seconds' => (int) env('QUIZ_DEFAULT_GET_READY_SECONDS', 5),
        'scoring' => [
            'points_min' => 50,
            'points_max' => 100,
            'speed_bonus_enabled' => true,
            'max_points' => 1000,
        ],
        'spin_seconds' => (int) env('QUIZ_SPIN_SECONDS', 3),
        'leaderboard_size' => 10,
        'leaderboard_max' => 100,
        'reveal_leaderboard_limit' => 10,
    ],

    // Most live slides one deck may hold (append, bulk, duplicate slide or deck).
    'max_slides_per_deck' => (int) env('DECK_MAX_SLIDES_PER_DECK', 100),

    // Join codes (plan §2.4): no 0/O/1/I so codes read aloud cleanly.
    'join_code_alphabet' => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
    'join_code_length' => 6,

    /*
    | Option counts per slide type (App\Deck\Support\OptionLimits). Caps keep
    | whole-aggregate broadcasts under Reverb's 10,000-byte publish limit (see
    | the measured sizes in QUEST_REDESIGN_PLAN.md). Types not listed fall back
    | to `default_max` / a minimum of 0.
    */
    'option_limits' => [
        'default_max' => 30,
        'max' => [
            'ranking' => 12,
            'scales' => 20,
            // Quiz v2 (QUIZ_REDESIGN_PLAN.md catalog). match_pairs counts cells (2 per pair).
            'pick_answer_single' => 10,
            'pick_answer_multi' => 10,
            'short_answer' => 5,
            'match_pairs' => 16,
            'correct_order' => 8,
            'categorise' => 20,
            'spinner_wheel' => 12,
        ],
        'min' => [
            'poll_single' => 2,
            'poll_multi' => 2,
            'ranking' => 2,
            'scales' => 1,
            'pick_answer_single' => 2,
            'pick_answer_multi' => 2,
            'short_answer' => 1,
            'match_pairs' => 4,
            'correct_order' => 3,
            'categorise' => 4,
            'spinner_wheel' => 2,
        ],
    ],

    // Largest accepted answer_payload, as JSON (KB).
    'max_answer_body_kb' => 32,

    /*
    | Curated participant avatars (plan §3.6, §4.5); joins with any other value
    | are rejected. Single code points only (no variation selectors or ZWJ
    | sequences) so the value a browser sends always matches exactly. Labels
    | are for screen readers. Served by GET /api/v1/meta/emoji-avatars.
    */
    'emoji_avatars' => [
        '🦊', '🐼', '🐙', '🦉', '🐢', '🐶', '🐱', '🐭', '🐹', '🐰',
        '🐻', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧',
        '🐦', '🐤', '🦆', '🦄', '🐝', '🦋', '🐞', '🐬', '🐳', '🦈',
        '🐠', '🦀', '🦒', '🦓', '🐘', '🦔', '🦥', '🦦', '🦩', '🐲',
    ],

    'emoji_avatar_labels' => [
        '🦊' => 'Fox', '🐼' => 'Panda', '🐙' => 'Octopus', '🦉' => 'Owl', '🐢' => 'Turtle',
        '🐶' => 'Dog', '🐱' => 'Cat', '🐭' => 'Mouse', '🐹' => 'Hamster', '🐰' => 'Rabbit',
        '🐻' => 'Bear', '🐨' => 'Koala', '🐯' => 'Tiger', '🦁' => 'Lion', '🐮' => 'Cow',
        '🐷' => 'Pig', '🐸' => 'Frog', '🐵' => 'Monkey', '🐔' => 'Chicken', '🐧' => 'Penguin',
        '🐦' => 'Bird', '🐤' => 'Chick', '🦆' => 'Duck', '🦄' => 'Unicorn', '🐝' => 'Bee',
        '🦋' => 'Butterfly', '🐞' => 'Ladybird', '🐬' => 'Dolphin', '🐳' => 'Whale', '🦈' => 'Shark',
        '🐠' => 'Tropical fish', '🦀' => 'Crab', '🦒' => 'Giraffe', '🦓' => 'Zebra', '🐘' => 'Elephant',
        '🦔' => 'Hedgehog', '🦥' => 'Sloth', '🦦' => 'Otter', '🦩' => 'Flamingo', '🐲' => 'Dragon',
    ],

    /*
    | Words masked by App\Deck\Support\ProfanityFilter when a slide enables
    | `profanity_filter_enabled` (Word Cloud, Q&A, Open Ended). Whole-word,
    | case-insensitive. Keep entries lower case.
    */
    'profanity' => [
        'arse',
        'arsehole',
        'asshole',
        'bastard',
        'bitch',
        'bollocks',
        'bullshit',
        'cock',
        'crap',
        'cunt',
        'damn',
        'dick',
        'dickhead',
        'fuck',
        'fucked',
        'fucker',
        'fucking',
        'motherfucker',
        'piss',
        'prick',
        'pussy',
        'shit',
        'shitty',
        'slut',
        'twat',
        'wanker',
        'whore',
    ],

];
