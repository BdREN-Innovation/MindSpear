<?php

use App\Models\Quiz\Question;
use App\Models\Quiz\Quiz;
use App\Models\Quiz\QuizParticipant;
use App\Models\Quiz\QuizSession;
use App\Models\User;
use App\Services\Live\ParticipantTokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

function timingQuizOwner(): User
{
    return User::create([
        'first_name' => 'Quiz',
        'last_name' => 'Host',
        'email' => 'quiz-timing-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]);
}

it('times a live question by the server clock from when the host opened it', function () {
    $owner = timingQuizOwner();
    $quiz = Quiz::create(['title' => 'Timing', 'user_id' => $owner->id, 'is_published' => true, 'visibility' => 'public']);
    $question = Question::create([
        'quiz_id' => $quiz->id, 'question_text' => 'Pick one', 'question_type' => 'quiz_single_choice',
        'visibility' => 'public', 'options' => ['choices' => ['A', 'B'], 'correct_answer' => 0],
    ]);
    $session = QuizSession::create([
        'quiz_id' => $quiz->id, 'title' => 'Live', 'session_id' => 'QUIZ-TIMING-' . str()->random(6),
        'running_status' => true, 'start_datetime' => now(), 'end_datetime' => now()->addHour(),
        'timezone' => 'UTC', 'is_host_live' => true,
    ]);
    $participant = QuizParticipant::create([
        'quiz_id' => $quiz->id, 'quiz_session_id' => $session->id, 'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Ann'], 'start_time' => now(), 'score' => 0, 'status' => 'In Progress',
    ]);
    $token = app(ParticipantTokenService::class)->issue($participant, $session);

    Sanctum::actingAs($owner);
    // The host's own start time has no AM/PM or timezone.
    $this->postJson("/api/v1/quiz-sessions/{$session->id}/change-question", [
        'question_id' => $question->id,
        'timer_state' => ['status' => 'running', 'start_time' => 'October 19th 2026, 3:16:15', 'duration_seconds' => 30, 'remaining_seconds' => 30],
    ])->assertOk();

    // A player reloading 12 seconds in gets the time actually left.
    $this->travel(12)->seconds();
    $this->getJson("/api/v1/quiz-sessions/{$session->id}/state")
        ->assertOk()
        ->assertJsonPath('data.state.timer_state.remaining_seconds', 18)
        ->assertJsonPath('data.state.timer_state.duration_seconds', 30);

    // The browser's figure was 12 hours off; the answer is timed from the stamp instead.
    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->postJson("/api/v1/quiz-attempts/{$participant->id}/answer", [
            'question_id' => $question->id,
            'answer_data' => ['selected_option' => 0],
            'time_taken_seconds' => 43213,
        ])
        ->assertOk()
        ->assertJsonPath('data.answer.time_taken_seconds', 12);

    // A late save (time ran out with an answer picked) counts as the full time, no more.
    $this->travel(30)->seconds();
    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->postJson("/api/v1/quiz-attempts/{$participant->id}/answer", [
            'question_id' => $question->id,
            'answer_data' => ['selected_option' => 0],
            'time_taken_seconds' => 5,
        ])
        ->assertOk();

    expect(DB::table('user_quiz_answers')->where('quiz_participant_id', $participant->id)->value('time_taken_seconds'))->toBe(30);
});

it('keeps a self-paced link out of the live game', function () {
    $owner = timingQuizOwner();
    $quiz = Quiz::create(['title' => 'Homework', 'user_id' => $owner->id, 'is_published' => true, 'visibility' => 'public']);
    $window = [
        'timezone' => 'UTC',
        'start_datetime' => now()->format('Y-m-d H:i:s'),
        'end_datetime' => now()->addDays(7)->format('Y-m-d H:i:s'),
    ];

    Sanctum::actingAs($owner);
    $selfPaced = $this->postJson("/api/v1/quizes/host-later/{$quiz->id}", ['title' => 'Self-paced', ...$window])
        ->assertOk()
        ->json('data.quizSession');

    expect((bool) QuizSession::find($selfPaced['id'])->is_host_live)->toBeFalse();

    // Hosting live starts its own session rather than taking over the self-paced link.
    $live = $this->postJson("/api/v1/quizes/host-live/{$quiz->id}", ['title' => 'Live', ...$window])
        ->assertOk()
        ->json('data.quizSession');

    expect($live['id'])->not->toBe($selfPaced['id']);

    // Another quiz of the same host can still be shared while this one's link is open.
    $other = Quiz::create(['title' => 'Other homework', 'user_id' => $owner->id, 'is_published' => true, 'visibility' => 'public']);
    $this->postJson("/api/v1/quizes/host-later/{$other->id}", ['title' => 'Self-paced', ...$window])->assertOk();
});
