<?php

use App\Models\Quiz\Question;
use App\Models\Quiz\Quiz;
use App\Models\Quiz\QuizParticipant;
use App\Models\Quiz\QuizSession;
use App\Models\Quiz\UserQuizAnswer;
use App\Models\User;
use App\Services\Live\ParticipantTokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

function legacyResultsUser(): User
{
    return User::create([
        'first_name' => 'Quiz',
        'last_name' => 'Owner',
        'email' => 'quiz-results-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]);
}

/** @return array{0: Quiz, 1: QuizSession, 2: QuizParticipant} */
function legacyResultsAttempt(User $owner, string $name): array
{
    $quiz = Quiz::create(['title' => 'Results Quiz', 'user_id' => $owner->id, 'is_published' => true, 'visibility' => 'public']);
    $session = QuizSession::create([
        'quiz_id' => $quiz->id,
        'title' => 'Host later',
        'session_id' => 'QUIZ-RESULTS-' . str()->random(8),
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
        'anonymous_details' => ['name' => $name],
        'start_time' => now(),
        'score' => 0,
        'status' => 'In Progress',
    ]);

    return [$quiz, $session, $participant];
}

it('scores multiple-answer questions saved by the quiz editor', function () {
    [$quiz, $session, $participant] = legacyResultsAttempt(legacyResultsUser(), 'Ann');
    $question = Question::create([
        'quiz_id' => $quiz->id,
        'question_text' => 'Pick the even numbers',
        'question_type' => 'quiz_multiple_choice',
        'points' => 2,
        'visibility' => 'private',
        // The editor's shape: correct indexes under "correct_answer".
        'options' => ['choices' => ['2', '3', '4'], 'correct_answer' => [0, 2], 'color' => ['#F79945', '#BC5EB3', '#5769e7']],
    ]);
    UserQuizAnswer::create([
        'quiz_participant_id' => $participant->id,
        'question_id' => $question->id,
        'answer_data' => ['selected_option' => '0,2'],
        'time_taken_seconds' => 5,
    ]);
    $token = app(ParticipantTokenService::class)->issue($participant, $session);

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->putJson("/api/v1/quiz-attempts/{$participant->id}/status", ['status' => 'Completed'])
        ->assertOk();

    expect($participant->refresh()->score)->toBe(2);
});

it('lists only the participants of the caller\'s own quizzes', function () {
    $owner = legacyResultsUser();
    [$quiz, , $mine] = legacyResultsAttempt($owner, 'Mine');
    [, , $theirs] = legacyResultsAttempt(legacyResultsUser(), 'Theirs');

    Sanctum::actingAs($owner);

    $ids = collect($this->getJson('/api/v1/quiz-participants?per_page=100')->assertOk()->json('data.quiz_participants.data'))->pluck('id');
    expect($ids)->toContain($mine->id)->not->toContain($theirs->id);

    $ids = collect($this->getJson("/api/v1/quiz-participants?quiz_id={$quiz->id}")->assertOk()->json('data.quiz_participants.data'))->pluck('id');
    expect($ids->all())->toBe([$mine->id]);
});

it('only lets the quiz owner bulk-update its questions', function () {
    $owner = legacyResultsUser();
    $other = legacyResultsUser();
    $quiz = Quiz::create(['title' => 'Mine', 'user_id' => $owner->id, 'is_published' => false, 'visibility' => 'private']);
    $otherQuiz = Quiz::create(['title' => 'Theirs', 'user_id' => $other->id, 'is_published' => false, 'visibility' => 'private']);
    $question = Question::create([
        'quiz_id' => $quiz->id,
        'question_text' => 'Original',
        'question_type' => 'quiz_single_choice',
        'serial_number' => 1,
        'visibility' => 'private',
        'points' => 1,
        'time_limit_seconds' => 30,
        'options' => [['text' => 'A', 'is_correct' => true], ['text' => 'B', 'is_correct' => false]],
    ]);

    // Someone else can't edit it.
    Sanctum::actingAs($other);
    $this->postJson('/api/v1/quiz/questions/update-multiple', [
        'questions' => [['id' => $question->id, 'question_text' => 'Hijacked']],
    ])->assertForbidden();
    expect($question->fresh()->question_text)->toBe('Original');

    // The owner can't move it into someone else's quiz.
    Sanctum::actingAs($owner);
    $this->postJson('/api/v1/quiz/questions/update-multiple', [
        'questions' => [['id' => $question->id, 'quiz_id' => $otherQuiz->id]],
    ])->assertForbidden();
    expect($question->fresh()->quiz_id)->toBe($quiz->id);

    // The owner can edit it.
    $this->postJson('/api/v1/quiz/questions/update-multiple', [
        'questions' => [['id' => $question->id, 'quiz_id' => $quiz->id, 'question_text' => 'Edited']],
    ])->assertOk();
    expect($question->fresh()->question_text)->toBe('Edited');
});

it('keeps the question image file when the quiz is saved', function () {
    $owner = legacyResultsUser();
    $quiz = Quiz::create(['title' => 'Images', 'user_id' => $owner->id, 'is_published' => false, 'visibility' => 'private']);
    Illuminate\Support\Facades\Storage::fake(getStorageDriver());
    Illuminate\Support\Facades\Storage::disk(getStorageDriver())->put('public/library/1/images/pic.jpg', 'jpg');
    $question = Question::create([
        'quiz_id' => $quiz->id,
        'question_text' => 'With a picture',
        'question_type' => 'quiz_single_choice',
        'serial_number' => 1,
        'visibility' => 'private',
        'source_content_url' => 'storage/library/1/images/pic.jpg',
        'options' => [['text' => 'A', 'is_correct' => true], ['text' => 'B', 'is_correct' => false]],
    ]);

    Sanctum::actingAs($owner);
    $this->postJson('/api/v1/quiz/questions/update-multiple', [
        'questions' => [['id' => $question->id, 'question_text' => 'Renamed']],
    ])->assertOk();

    Illuminate\Support\Facades\Storage::disk(getStorageDriver())->assertExists('public/library/1/images/pic.jpg');
});

function legacyMultiQuestion(Quiz $quiz): Question
{
    return Question::create([
        'quiz_id' => $quiz->id,
        'question_text' => 'Pick the even numbers',
        'question_type' => 'quiz_multiple_choice',
        'points' => 2,
        'visibility' => 'private',
        'options' => ['choices' => ['2', '3', '4', '5'], 'correct_answer' => [0, 2], 'color' => []],
    ]);
}

it('scores multiple answers all-or-nothing and marks them the same in reports', function (string $picked, int $expected) {
    [$quiz, $session, $participant] = legacyResultsAttempt($owner = legacyResultsUser(), 'Ann');
    $question = legacyMultiQuestion($quiz);
    UserQuizAnswer::create([
        'quiz_participant_id' => $participant->id,
        'question_id' => $question->id,
        'answer_data' => ['selected_option' => $picked],
        'time_taken_seconds' => 4,
    ]);
    $token = app(ParticipantTokenService::class)->issue($participant, $session);

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->putJson("/api/v1/quiz-attempts/{$participant->id}/status", ['status' => 'Completed'])
        ->assertOk();
    expect((int) $participant->refresh()->score)->toBe($expected);

    Sanctum::actingAs($owner);
    $report = $this->getJson(route('quizes.leaderboard.session.answered.questions', $session->id))->assertOk();
    expect((int) $report->json('data.participantScores.0.total_score'))->toBe($expected);
})->with([
    'exactly the correct set' => ['2,0', 2],
    'every option' => ['0,1,2,3', 0],
    'only part of it' => ['0', 0],
    'one right, one wrong' => ['0,1', 0],
]);

it('only lets the quiz owner add or delete its questions, and keeps their images', function () {
    $owner = legacyResultsUser();
    $other = legacyResultsUser();
    $quiz = Quiz::create(['title' => 'Mine', 'user_id' => $owner->id, 'is_published' => false, 'visibility' => 'private']);

    Sanctum::actingAs($other);
    $this->postJson('/api/v1/quiz/questions/store', ['quiz_id' => $quiz->id, 'question_text' => '.', 'visibility' => 'public'])
        ->assertForbidden();
    $this->postJson('/api/v1/quiz/questions/store-multiple', ['questions' => [[
        'quiz_id' => $quiz->id, 'question_text' => 'Sneaky', 'question_type' => 'quiz_single_choice', 'visibility' => 'private',
    ]]])->assertForbidden();
    expect($quiz->questions()->count())->toBe(0);

    Sanctum::actingAs($owner);
    $id = $this->postJson('/api/v1/quiz/questions/store', ['quiz_id' => $quiz->id, 'question_text' => '.', 'visibility' => 'public'])
        ->assertCreated()->json('data.question.id');
    Question::whereKey($id)->update(['source_content_url' => 'storage/library/1/images/kept.jpg']);
    Illuminate\Support\Facades\Storage::fake(getStorageDriver());
    Illuminate\Support\Facades\Storage::disk(getStorageDriver())->put('public/library/1/images/kept.jpg', 'jpg');

    Sanctum::actingAs($other);
    $this->deleteJson("/api/v1/quiz/questions/delete/{$id}")->assertForbidden();
    $this->deleteJson('/api/v1/quiz/questions/delete-multiple', ['ids' => [$id]])->assertForbidden();
    expect(Question::find($id))->not->toBeNull();

    Sanctum::actingAs($owner);
    $this->deleteJson("/api/v1/quiz/questions/delete/{$id}")->assertOk();
    expect(Question::find($id))->toBeNull();
    Illuminate\Support\Facades\Storage::disk(getStorageDriver())->assertExists('public/library/1/images/kept.jpg');
});

it('drops abandoned blank questions when the quiz is saved and never counts them', function () {
    $owner = legacyResultsUser();
    $quiz = Quiz::create(['title' => 'Blanks', 'user_id' => $owner->id, 'is_published' => false, 'visibility' => 'private']);
    $kept = legacyMultiQuestion($quiz);
    // "Add question" rows: one still being edited (in the save), one abandoned.
    $editing = Question::create(['quiz_id' => $quiz->id, 'question_text' => '.', 'visibility' => 'public']);
    $abandoned = Question::create(['quiz_id' => $quiz->id, 'question_text' => '.', 'visibility' => 'public']);

    Sanctum::actingAs($owner);
    $count = fn () => collect($this->getJson(route('quizes.index', ['per_page' => 100]))->assertOk()->json('data.quizes.data'))
        ->firstWhere('id', $quiz->id)['questions_count'] ?? null;
    expect($count())->toBe(1);

    $this->postJson('/api/v1/quiz/questions/update-multiple', ['questions' => [
        ['id' => $kept->id, 'quiz_id' => $quiz->id, 'question_text' => 'Pick the even numbers'],
        ['id' => $editing->id, 'quiz_id' => $quiz->id, 'question_text' => 'Now written', 'question_type' => 'quiz_single_choice',
            'options' => ['choices' => ['a', 'b'], 'correct_answer' => 0, 'color' => []]],
    ]])->assertOk();

    expect(Question::find($abandoned->id))->toBeNull()
        ->and(Question::find($editing->id)?->question_text)->toBe('Now written')
        ->and($count())->toBe(2);
});

it('accepts a typed short answer regardless of case and marks it right in reports', function (string $typed, int $expected) {
    [$quiz, $session, $participant] = legacyResultsAttempt($owner = legacyResultsUser(), 'Ann');
    $question = Question::create([
        'quiz_id' => $quiz->id,
        'question_text' => 'Capital of France?',
        'question_type' => 'sort_answer_choice',
        'points' => 3,
        'visibility' => 'private',
        // The editor's shape: every accepted answer, all indexes correct.
        'options' => ['choices' => ['Paris', 'Paname'], 'correct_answer' => [0, 1], 'color' => []],
    ]);
    UserQuizAnswer::create([
        'quiz_participant_id' => $participant->id,
        'question_id' => $question->id,
        'answer_data' => ['selected_option' => $typed],
        'time_taken_seconds' => 7,
    ]);
    $token = app(ParticipantTokenService::class)->issue($participant, $session);

    $this->withHeader(ParticipantTokenService::HEADER, $token)
        ->putJson("/api/v1/quiz-attempts/{$participant->id}/status", ['status' => 'Completed'])
        ->assertOk();
    expect((int) $participant->refresh()->score)->toBe($expected);

    Sanctum::actingAs($owner);
    $report = $this->getJson(route('quizes.leaderboard.session.answered.questions', $session->id))->assertOk();
    expect((int) $report->json('data.participantScores.0.total_score'))->toBe($expected);
})->with([
    'same case' => ['Paris', 3],
    'lower case with spaces' => ['  paris ', 3],
    'another accepted answer' => ['PANAME', 3],
    'wrong' => ['Lyon', 0],
    'empty' => ['', 0],
]);

it('scores every live attempt still in progress when the host ends the session', function () {
    $owner = legacyResultsUser();
    [$quiz, $session, $ann] = legacyResultsAttempt($owner, 'Ann');
    $bob = QuizParticipant::create([
        'quiz_id' => $quiz->id, 'quiz_session_id' => $session->id, 'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Bob'], 'start_time' => now(), 'score' => 0, 'status' => 'In Progress',
    ]);
    $multi = legacyMultiQuestion($quiz); // 2 points, correct [0, 2]
    $single = Question::create([
        'quiz_id' => $quiz->id, 'question_text' => '2 + 2?', 'question_type' => 'quiz_single_choice', 'points' => 1,
        'visibility' => 'private', 'options' => ['choices' => ['3', '4'], 'correct_answer' => 1, 'color' => []],
    ]);
    // What the live player sends: "0,2" for several answers, the index for one.
    foreach ([[$ann, $multi, '0,2'], [$ann, $single, 1], [$bob, $multi, '0'], [$bob, $single, 0]] as [$who, $question, $picked]) {
        UserQuizAnswer::create([
            'quiz_participant_id' => $who->id, 'question_id' => $question->id,
            'answer_data' => ['selected_option' => $picked], 'time_taken_seconds' => 3,
        ]);
    }
    app(ParticipantTokenService::class)->issue($ann, $session);

    Sanctum::actingAs($owner);
    $this->postJson("/api/v1/quizes/end-host-live/{$session->id}")->assertOk();

    expect($ann->refresh()->status)->toBe('Completed')
        ->and((int) $ann->score)->toBe(3)
        ->and($bob->refresh()->status)->toBe('Completed')
        ->and((int) $bob->score)->toBe(0);
});
