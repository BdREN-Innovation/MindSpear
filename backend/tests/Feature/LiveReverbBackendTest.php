<?php

use App\Jobs\Live\BroadcastLiveAggregateSnapshot;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Quest\Quest;
use App\Models\Quest\QuestParticipant;
use App\Models\Quest\QuestSession;
use App\Models\Quest\QuestTask;
use App\Models\Quest\QuestTaskCompletion;
use App\Models\Quiz\Question;
use App\Models\Quiz\Quiz;
use App\Models\Quiz\QuizParticipant;
use App\Models\Quiz\QuizSession;
use App\Models\User;
use App\Services\Live\LiveAggregateService;
use App\Services\Live\LiveSessionService;
use App\Services\Live\ParticipantTokenService;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

beforeEach(function () {
    config([
        'broadcasting.default' => 'null',
        'cache.default' => 'array',
        'queue.default' => 'sync',
    ]);
});

it('allows frontend cors preflights to broadcasting auth without bypassing auth', function () {
    config([
        'cors.allowed_origins' => ['http://localhost:2000'],
    ]);

    $this->withHeaders([
        'Origin' => 'http://localhost:2000',
        'Access-Control-Request-Method' => 'POST',
        'Access-Control-Request-Headers' => 'authorization,content-type',
    ])
        ->options('/broadcasting/auth')
        ->assertNoContent()
        ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:2000')
        ->assertHeader('Access-Control-Allow-Methods', 'POST')
        ->assertHeader('Access-Control-Allow-Headers', 'authorization,content-type');

    $this->withHeader('Origin', 'http://localhost:2000')
        ->postJson('/broadcasting/auth', [
            'socket_id' => '123.456',
            'channel_name' => 'private-host.quiz.1',
        ])
        ->assertUnauthorized()
        ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:2000');
});

function liveTestUser(): User
{
    return User::create([
        'first_name' => 'Live',
        'last_name' => 'Host',
        'email' => 'live-host-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]);
}

function liveTestQuestParticipant(Quest $quest, QuestSession $session, string $name): QuestParticipant
{
    return QuestParticipant::create([
        'quest_id' => $quest->id,
        'quest_session_id' => $session->id,
        'is_anonymous' => true,
        'anonymous_details' => ['name' => $name],
        'start_time' => now(),
        'status' => 'In Progress',
    ]);
}

function liveTestQuestCompletion(QuestParticipant $participant, QuestTask $task, array $selectedOption): void
{
    QuestTaskCompletion::create([
        'participant_id' => $participant->id,
        'task_id' => $task->id,
        'status' => 'Completed',
        'completed_at' => now(),
        'completion_data' => ['selected_option' => $selectedOption],
    ]);
}

it('issues hashed participant tokens and validates the raw header token', function () {
    $user = liveTestUser();
    $quest = Quest::create([
        'title' => 'Live Quest',
        'creator_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
        'join_link' => 'quest-token-test',
        'join_code' => '123456',
    ]);
    $session = QuestSession::create([
        'quest_id' => $quest->id,
        'title' => 'Token Session',
        'session_id' => 'QUEST-TOKEN-TEST',
        'public_channel_key' => 'questtokenkey',
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
    ]);
    $participant = QuestParticipant::create([
        'quest_id' => $quest->id,
        'quest_session_id' => $session->id,
        'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Ada'],
        'start_time' => now(),
        'status' => 'In Progress',
    ]);

    $tokens = app(ParticipantTokenService::class);
    $rawToken = $tokens->issue($participant, $session);
    $participant->refresh();

    $request = Request::create('/', 'POST', server: ['HTTP_X_PARTICIPANT_TOKEN' => $rawToken]);
    $badRequest = Request::create('/', 'POST', server: ['HTTP_X_PARTICIPANT_TOKEN' => 'wrong']);

    expect($participant->participant_token_hash)->not->toBe($rawToken)
        ->and($participant->participant_token_hash)->toHaveLength(64)
        ->and($tokens->validateRequest($request, $participant))->toBeTrue()
        ->and($tokens->validateRequest($badRequest, $participant))->toBeFalse();
});

it('lets a quest owner read state and change the current task', function () {
    $user = liveTestUser();
    Sanctum::actingAs($user);

    $quest = Quest::create([
        'title' => 'State Quest',
        'creator_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $task = QuestTask::create([
        'quest_id' => $quest->id,
        'title' => 'Task 1',
        'task_type' => 'quick_form',
        'task_data' => ['questions' => []],
    ]);
    $session = QuestSession::create([
        'quest_id' => $quest->id,
        'title' => 'State Session',
        'session_id' => 'QUEST-STATE-TEST',
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
    ]);
    liveTestQuestParticipant($quest, $session, 'Visible Quest Player');

    $this->getJson("/api/v1/quest-sessions/{$session->id}/state")
        ->assertOk()
        ->assertJsonPath('data.state.module', LiveSessionService::MODULE_QUEST)
        ->assertJsonPath('data.state.session_id', $session->id)
        ->assertJsonPath('data.state.participant_count', 1)
        ->assertJsonPath('data.state.active_participants.0.participant_name', 'Visible Quest Player')
        ->assertJsonStructure(['data' => ['state' => ['public_channel_key', 'public_channel']]]);

    $this->postJson("/api/v1/quest-sessions/{$session->id}/change-task", [
        'task_id' => $task->id,
        'timer_state' => ['status' => 'running', 'remaining_seconds' => 30],
    ])
        ->assertOk()
        ->assertJsonPath('data.state.current_task_id', $task->id);

    expect($session->refresh()->current_task_id)->toBe($task->id);
});

it('lets anonymous quest participants read state with their raw participant token', function () {
    $user = liveTestUser();
    $quest = Quest::create([
        'title' => 'Participant State Quest',
        'creator_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $task = QuestTask::create([
        'quest_id' => $quest->id,
        'title' => 'Task 1',
        'task_type' => 'quick_form',
        'task_data' => ['questions' => []],
    ]);
    $session = QuestSession::create([
        'quest_id' => $quest->id,
        'title' => 'Participant State Session',
        'session_id' => 'QUEST-PARTICIPANT-STATE',
        'public_channel_key' => 'questparticipantstatekey',
        'current_task_id' => $task->id,
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
    ]);
    $participant = QuestParticipant::create([
        'quest_id' => $quest->id,
        'quest_session_id' => $session->id,
        'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Reconnect Quest Player'],
        'start_time' => now(),
        'status' => 'In Progress',
    ]);
    $token = app(ParticipantTokenService::class)->issue($participant, $session);

    $this->getJson("/api/v1/quest-sessions/{$session->id}/state")
        ->assertUnauthorized();

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->getJson("/api/v1/quest-sessions/{$session->id}/state")
        ->assertOk()
        ->assertJsonPath('data.state.public_channel_key', 'questparticipantstatekey')
        ->assertJsonPath('data.state.current_task_id', $task->id)
        ->assertJsonMissingPath('data.state.active_participants');
});

it('lets a quest owner read state with a bearer token on the public state route', function () {
    $user = liveTestUser();
    $token = $user->createToken(config('app.name'))->plainTextToken;

    $quest = Quest::create([
        'title' => 'Bearer State Quest',
        'creator_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $session = QuestSession::create([
        'quest_id' => $quest->id,
        'title' => 'Bearer State Session',
        'session_id' => 'QUEST-BEARER-STATE',
        'public_channel_key' => 'questbearerstatekey',
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
    ]);
    liveTestQuestParticipant($quest, $session, 'Bearer Quest Player');

    $this->withHeader('Authorization', "Bearer {$token}")
        ->getJson("/api/v1/quest-sessions/{$session->id}/state")
        ->assertOk()
        ->assertJsonPath('data.state.public_channel_key', 'questbearerstatekey')
        ->assertJsonPath('data.state.active_participants.0.participant_name', 'Bearer Quest Player');
});

it('authorizes private quest host broadcast channels only for the owner', function () {
    config([
        'broadcasting.default' => 'reverb',
        'broadcasting.connections.reverb.key' => 'local',
        'broadcasting.connections.reverb.secret' => 'local-secret',
        'broadcasting.connections.reverb.app_id' => 'local',
    ]);

    $owner = liveTestUser();
    $otherUser = liveTestUser();
    $quest = Quest::create([
        'title' => 'Private Channel Quest',
        'creator_id' => $owner->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $session = QuestSession::create([
        'quest_id' => $quest->id,
        'title' => 'Private Channel Session',
        'session_id' => 'QUEST-PRIVATE-CHANNEL-TEST',
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
    ]);

    Sanctum::actingAs($owner);
    $this->postJson('/broadcasting/auth', [
        'socket_id' => '123.456',
        'channel_name' => "private-host.quest.{$session->id}",
    ])
        ->assertOk()
        ->assertJsonStructure(['auth']);

    Sanctum::actingAs($otherUser);
    $this->postJson('/broadcasting/auth', [
        'socket_id' => '123.456',
        'channel_name' => "private-host.quest.{$session->id}",
    ])->assertForbidden();
});

it('ends a quest live session with a server timestamp and revokes participant tokens', function () {
    $user = liveTestUser();
    Sanctum::actingAs($user);

    $quest = Quest::create([
        'title' => 'Endable Quest',
        'creator_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $task = QuestTask::create([
        'quest_id' => $quest->id,
        'title' => 'Partial Result Task',
        'task_type' => 'single_choice',
        'task_data' => [
            'questions' => [
                ['id' => 0, 'text' => 'Alpha'],
                ['id' => 1, 'text' => 'Beta'],
            ],
        ],
    ]);
    $session = QuestSession::create([
        'quest_id' => $quest->id,
        'title' => 'Endable Quest Session',
        'session_id' => 'QUEST-END-TEST',
        'public_channel_key' => 'questendkey',
        'running_status' => true,
        'start_datetime' => now()->subMinute(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
    ]);
    $participant = liveTestQuestParticipant($quest, $session, 'Ending Player');
    app(ParticipantTokenService::class)->issue($participant, $session);
    liveTestQuestCompletion($participant, $task, [1]);

    $this->postJson("/api/v1/quests/end-host-live/{$session->id}", [])
        ->assertOk()
        ->assertJsonPath('data.questSession.running_status', false);

    $session->refresh();
    $participant->refresh();

    expect($session->running_status)->toBeFalse()
        ->and($session->end_datetime)->not->toBeNull()
        ->and($participant->status)->toBe('Completed')
        ->and($participant->end_time)->not->toBeNull()
        ->and($participant->participant_token_revoked_at)->not->toBeNull();

    $this->getJson("/api/v1/quest-sessions/{$session->id}/state")
        ->assertOk()
        ->assertJsonPath('data.state.running_status', false)
        ->assertJsonPath('data.state.end_datetime', $session->end_datetime->toISOString());

    $this->getJson("/api/v1/quest-attempts/{$participant->id}")
        ->assertOk()
        ->assertJsonPath('data.attempt.status', 'Completed')
        ->assertJsonPath('data.attempt.task_completions.0.task_id', $task->id);

    $this->getJson("/api/v1/quest-leaderboard/session-details-combined-score/{$session->id}")
        ->assertOk()
        ->assertJsonPath('data.questSession.running_status', false)
        ->assertJsonPath('data.questTasks.0.id', $task->id)
        ->assertJsonPath('data.questTasks.0.optionsCount.1.count', 1);
});

it('adds canonical live chart scores for quest ranking sorting and scales snapshots', function () {
    $user = liveTestUser();
    $quest = Quest::create([
        'title' => 'Canonical Chart Quest',
        'creator_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $session = QuestSession::create([
        'quest_id' => $quest->id,
        'title' => 'Canonical Chart Session',
        'session_id' => 'QUEST-CHART-TEST',
        'public_channel_key' => 'questchartkey',
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
    ]);
    $participants = [
        liveTestQuestParticipant($quest, $session, 'Chart Player 1'),
        liveTestQuestParticipant($quest, $session, 'Chart Player 2'),
    ];
    $questions = [
        ['text' => 'Alpha'],
        ['text' => 'Beta'],
        ['text' => 'Gamma'],
    ];
    $rankingTask = QuestTask::create([
        'quest_id' => $quest->id,
        'title' => 'Rank these',
        'task_type' => 'ranking',
        'task_data' => ['questions' => $questions],
    ]);
    $sortingTask = QuestTask::create([
        'quest_id' => $quest->id,
        'title' => 'Sort these',
        'task_type' => 'sorting',
        'task_data' => ['questions' => $questions],
    ]);
    $scalesTask = QuestTask::create([
        'quest_id' => $quest->id,
        'title' => 'Rate these',
        'task_type' => 'scales',
        'task_data' => ['maxNumber' => 5, 'questions' => $questions],
    ]);

    liveTestQuestCompletion($participants[0], $rankingTask, [0, 1, 2]);
    liveTestQuestCompletion($participants[1], $rankingTask, [1, 2, 0]);
    liveTestQuestCompletion($participants[0], $sortingTask, [2, 1, 0]);
    liveTestQuestCompletion($participants[1], $sortingTask, [2, 0, 1]);
    liveTestQuestCompletion($participants[0], $scalesTask, [5, 3, 1]);
    // The third statement is left unrated (0); it doesn't pull the average down.
    liveTestQuestCompletion($participants[1], $scalesTask, [4, 3, 0]);

    $aggregates = app(LiveAggregateService::class);
    $ranking = $aggregates->snapshot(LiveSessionService::MODULE_QUEST, $session->id, $rankingTask->id);
    $sorting = $aggregates->snapshot(LiveSessionService::MODULE_QUEST, $session->id, $sortingTask->id);
    $scales = $aggregates->snapshot(LiveSessionService::MODULE_QUEST, $session->id, $scalesTask->id);

    expect((array) $ranking['chart']['scores'])->toMatchArray(['0' => 80, '1' => 100, '2' => 60])
        ->and($ranking['chart']['order'])->toBe([1, 0, 2])
        ->and((array) $sorting['chart']['scores'])->toMatchArray(['0' => 50, '1' => 50, '2' => 100])
        ->and($sorting['chart']['order'])->toBe([2, 0, 1])
        ->and((array) $scales['chart']['scores'])->toMatchArray(['0' => 90, '1' => 60, '2' => 20])
        ->and((array) $scales['chart']['averages'])->toMatchArray(['0' => 4.5, '1' => 3.0, '2' => 1.0])
        ->and($scales['chart']['scale_max'])->toEqual(5)
        ->and($scales['chart']['order'])->toBe([0, 1, 2]);
});

it('lets a quiz owner read state and change the current question', function () {
    $user = liveTestUser();
    Sanctum::actingAs($user);

    $quiz = Quiz::create([
        'title' => 'State Quiz',
        'user_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $question = Question::create([
        'quiz_id' => $quiz->id,
        'question_text' => 'One?',
        'question_type' => 'quiz_single_choice',
        'visibility' => 'public',
        'options' => ['choices' => ['A', 'B'], 'correct_answer' => 0],
    ]);
    $session = QuizSession::create([
        'quiz_id' => $quiz->id,
        'title' => 'Quiz State Session',
        'session_id' => 'QUIZ-STATE-TEST',
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
        'is_host_live' => true,
    ]);
    QuizParticipant::create([
        'quiz_id' => $quiz->id,
        'quiz_session_id' => $session->id,
        'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Visible Quiz Player'],
        'start_time' => now(),
        'score' => 0,
        'status' => 'In Progress',
    ]);

    $this->getJson("/api/v1/quiz-sessions/{$session->id}/state")
        ->assertOk()
        ->assertJsonPath('data.state.module', LiveSessionService::MODULE_QUIZ)
        ->assertJsonPath('data.state.session_id', $session->id)
        ->assertJsonPath('data.state.participant_count', 1)
        ->assertJsonPath('data.state.active_participants.0.participant_name', 'Visible Quiz Player');

    $this->postJson("/api/v1/quiz-sessions/{$session->id}/change-question", [
        'question_id' => $question->id,
        'timer_state' => ['status' => 'running', 'remaining_seconds' => 20],
    ])
        ->assertOk()
        ->assertJsonPath('data.state.current_question_id', $question->id);

    expect($session->refresh()->current_question_id)->toBe($question->id);
});

it('lets anonymous quiz participants read state with their raw participant token', function () {
    $user = liveTestUser();
    $quiz = Quiz::create([
        'title' => 'Participant State Quiz',
        'user_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $question = Question::create([
        'quiz_id' => $quiz->id,
        'question_text' => 'Reconnect?',
        'question_type' => 'quiz_single_choice',
        'visibility' => 'public',
        'options' => ['choices' => ['A', 'B'], 'correct_answer' => 0],
    ]);
    $session = QuizSession::create([
        'quiz_id' => $quiz->id,
        'title' => 'Participant Quiz State Session',
        'session_id' => 'QUIZ-PARTICIPANT-STATE',
        'public_channel_key' => 'quizparticipantstatekey',
        'current_question_id' => $question->id,
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
        'is_host_live' => true,
    ]);
    $participant = QuizParticipant::create([
        'quiz_id' => $quiz->id,
        'quiz_session_id' => $session->id,
        'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Reconnect Quiz Player'],
        'start_time' => now(),
        'score' => 0,
        'status' => 'In Progress',
    ]);
    $token = app(ParticipantTokenService::class)->issue($participant, $session);

    $this->getJson("/api/v1/quiz-sessions/{$session->id}/state")
        ->assertUnauthorized();

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->getJson("/api/v1/quiz-sessions/{$session->id}/state")
        ->assertOk()
        ->assertJsonPath('data.state.public_channel_key', 'quizparticipantstatekey')
        ->assertJsonPath('data.state.current_question_id', $question->id)
        ->assertJsonMissingPath('data.state.active_participants');
});

it('lets a quiz owner read state with a bearer token on the public state route', function () {
    $user = liveTestUser();
    $token = $user->createToken(config('app.name'))->plainTextToken;

    $quiz = Quiz::create([
        'title' => 'Bearer State Quiz',
        'user_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $question = Question::create([
        'quiz_id' => $quiz->id,
        'question_text' => 'Bearer question?',
        'question_type' => 'quiz_single_choice',
        'visibility' => 'public',
        'options' => ['choices' => ['A', 'B'], 'correct_answer' => 0],
    ]);
    $session = QuizSession::create([
        'quiz_id' => $quiz->id,
        'title' => 'Bearer Quiz State Session',
        'session_id' => 'QUIZ-BEARER-STATE',
        'public_channel_key' => 'quizbearerstatekey',
        'current_question_id' => $question->id,
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
        'is_host_live' => true,
    ]);
    QuizParticipant::create([
        'quiz_id' => $quiz->id,
        'quiz_session_id' => $session->id,
        'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Bearer Quiz Player'],
        'start_time' => now(),
        'score' => 0,
        'status' => 'In Progress',
    ]);

    $this->withHeader('Authorization', "Bearer {$token}")
        ->getJson("/api/v1/quiz-sessions/{$session->id}/state")
        ->assertOk()
        ->assertJsonPath('data.state.public_channel_key', 'quizbearerstatekey')
        ->assertJsonPath('data.state.current_question_id', $question->id)
        ->assertJsonPath('data.state.active_participants.0.participant_name', 'Bearer Quiz Player');
});

it('authorizes private quiz host broadcast channels only for the owner', function () {
    config([
        'broadcasting.default' => 'reverb',
        'broadcasting.connections.reverb.key' => 'local',
        'broadcasting.connections.reverb.secret' => 'local-secret',
        'broadcasting.connections.reverb.app_id' => 'local',
    ]);

    $owner = liveTestUser();
    $otherUser = liveTestUser();
    $quiz = Quiz::create([
        'title' => 'Private Channel Quiz',
        'user_id' => $owner->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $session = QuizSession::create([
        'quiz_id' => $quiz->id,
        'title' => 'Private Channel Quiz Session',
        'session_id' => 'QUIZ-PRIVATE-CHANNEL-TEST',
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
        'is_host_live' => true,
    ]);

    Sanctum::actingAs($owner);
    $this->postJson('/broadcasting/auth', [
        'socket_id' => '123.456',
        'channel_name' => "private-host.quiz.{$session->id}",
    ])
        ->assertOk()
        ->assertJsonStructure(['auth']);

    Sanctum::actingAs($otherUser);
    $this->postJson('/broadcasting/auth', [
        'socket_id' => '123.456',
        'channel_name' => "private-host.quiz.{$session->id}",
    ])->assertForbidden();
});

it('queues live broadcast events instead of broadcasting synchronously in the request', function () {
    $event = new LiveBroadcastEvent('session.quest.example', 'test.event', ['session_id' => 1]);

    expect($event)->toBeInstanceOf(ShouldBroadcast::class)
        ->and($event)->not->toBeInstanceOf(ShouldBroadcastNow::class);
});

it('requires participant tokens for anonymous quest answers and queues an aggregate job per answer', function () {
    Queue::fake();

    $user = liveTestUser();
    $quest = Quest::create([
        'title' => 'Answer Quest',
        'creator_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $task = QuestTask::create([
        'quest_id' => $quest->id,
        'title' => 'Poll',
        'task_type' => 'quick_form',
        'task_data' => ['questions' => []],
    ]);
    $session = QuestSession::create([
        'quest_id' => $quest->id,
        'title' => 'Answer Session',
        'session_id' => 'QUEST-ANSWER-TEST',
        'public_channel_key' => 'questanswerkey',
        'current_task_id' => $task->id,
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
    ]);
    $participant = QuestParticipant::create([
        'quest_id' => $quest->id,
        'quest_session_id' => $session->id,
        'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Grace'],
        'start_time' => now(),
        'status' => 'In Progress',
    ]);
    $token = app(ParticipantTokenService::class)->issue($participant, $session);

    $payload = [
        'task_id' => $task->id,
        'completion_data' => ['selected_option' => 'A'],
    ];

    $this->postJson("/api/v1/quest-attempts/{$participant->id}/answer", $payload)
        ->assertUnauthorized();

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->postJson("/api/v1/quest-attempts/{$participant->id}/answer", $payload)
        ->assertOk();

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->postJson("/api/v1/quest-attempts/{$participant->id}/answer", $payload)
        ->assertOk();

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->getJson("/api/v1/quest-sessions/{$session->id}/state")
        ->assertOk()
        ->assertJsonPath('data.state.current_aggregate.task_id', $task->id)
        ->assertJsonPath('data.state.current_aggregate.total_answers', 1)
        ->assertJsonPath('data.state.current_aggregate.answers.A', 1);

    // No debounce: it was removed in 8bcb3ab, so every accepted answer queues a fresh snapshot.
    Queue::assertPushed(BroadcastLiveAggregateSnapshot::class, 2);
});

it('requires and revokes participant tokens when anonymous quest attempts complete', function () {
    $user = liveTestUser();
    $quest = Quest::create([
        'title' => 'Complete Quest',
        'creator_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $session = QuestSession::create([
        'quest_id' => $quest->id,
        'title' => 'Complete Quest Session',
        'session_id' => 'QUEST-COMPLETE-TEST',
        'public_channel_key' => 'questcompletekey',
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
    ]);
    $participant = QuestParticipant::create([
        'quest_id' => $quest->id,
        'quest_session_id' => $session->id,
        'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Dorothy'],
        'start_time' => now(),
        'status' => 'In Progress',
    ]);
    $token = app(ParticipantTokenService::class)->issue($participant, $session);

    $payload = ['status' => 'Completed'];

    $this->putJson("/api/v1/quest-attempts/{$participant->id}/status", $payload)
        ->assertUnauthorized();

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->putJson("/api/v1/quest-attempts/{$participant->id}/status", $payload)
        ->assertOk();

    $participant->refresh();

    expect($participant->status)->toBe('Completed')
        ->and($participant->end_time)->not->toBeNull()
        ->and($participant->participant_token_revoked_at)->not->toBeNull();
});

it('requires participant tokens for anonymous quiz answers and queues an aggregate job per answer', function () {
    Queue::fake();

    $user = liveTestUser();
    $quiz = Quiz::create([
        'title' => 'Answer Quiz',
        'user_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $question = Question::create([
        'quiz_id' => $quiz->id,
        'question_text' => 'Pick one',
        'question_type' => 'quiz_single_choice',
        'visibility' => 'public',
        'options' => ['choices' => ['A', 'B'], 'correct_answer' => 0],
    ]);
    $session = QuizSession::create([
        'quiz_id' => $quiz->id,
        'title' => 'Answer Quiz Session',
        'session_id' => 'QUIZ-ANSWER-TEST',
        'public_channel_key' => 'quizanswerkey',
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
        'is_host_live' => true,
    ]);
    $participant = QuizParticipant::create([
        'quiz_id' => $quiz->id,
        'quiz_session_id' => $session->id,
        'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Katherine'],
        'start_time' => now(),
        'score' => 0,
        'status' => 'In Progress',
    ]);
    $token = app(ParticipantTokenService::class)->issue($participant, $session);

    $payload = [
        'question_id' => $question->id,
        'answer_data' => ['selected_option' => 'A'],
        'time_taken_seconds' => 3,
    ];

    $this->postJson("/api/v1/quiz-attempts/{$participant->id}/answer", $payload)
        ->assertUnauthorized();

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->postJson("/api/v1/quiz-attempts/{$participant->id}/answer", $payload)
        ->assertOk();

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->postJson("/api/v1/quiz-attempts/{$participant->id}/answer", $payload)
        ->assertOk();

    // No debounce: it was removed in 8bcb3ab, so every accepted answer queues a fresh snapshot.
    Queue::assertPushed(BroadcastLiveAggregateSnapshot::class, 2);
});

it('requires and revokes participant tokens when anonymous quiz attempts complete', function () {
    $user = liveTestUser();
    $quiz = Quiz::create([
        'title' => 'Complete Quiz',
        'user_id' => $user->id,
        'is_published' => true,
        'visibility' => 'public',
    ]);
    $session = QuizSession::create([
        'quiz_id' => $quiz->id,
        'title' => 'Complete Quiz Session',
        'session_id' => 'QUIZ-COMPLETE-TEST',
        'public_channel_key' => 'quizcompletekey',
        'running_status' => true,
        'start_datetime' => now(),
        'end_datetime' => now()->addHour(),
        'timezone' => 'UTC',
        'is_host_live' => true,
    ]);
    $participant = QuizParticipant::create([
        'quiz_id' => $quiz->id,
        'quiz_session_id' => $session->id,
        'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Mary'],
        'start_time' => now(),
        'score' => 0,
        'status' => 'In Progress',
    ]);
    $token = app(ParticipantTokenService::class)->issue($participant, $session);

    $payload = ['status' => 'Completed'];

    $this->putJson("/api/v1/quiz-attempts/{$participant->id}/status", $payload)
        ->assertUnauthorized();

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->putJson("/api/v1/quiz-attempts/{$participant->id}/status", $payload)
        ->assertOk();

    $participant->refresh();

    expect($participant->status)->toBe('Completed')
        ->and($participant->end_time)->not->toBeNull()
        ->and($participant->participant_token_revoked_at)->not->toBeNull();
});
