<?php

use App\Models\Quiz\Question;
use App\Models\Quiz\Quiz;
use App\Models\Quiz\QuizParticipant;
use App\Models\Quiz\QuizSession;
use App\Models\Quiz\UserQuizAnswer;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

function exportHost(): User
{
    return User::create([
        'first_name' => 'Export',
        'last_name' => 'Host',
        'email' => 'quiz-export-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]);
}

function exportCsvRows($response): array
{
    $csv = file_get_contents($response->baseResponse->getFile()->getPathname());
    $csv = preg_replace('/^\xEF\xBB\xBF/', '', $csv);
    $handle = fopen('php://memory', 'r+');
    fwrite($handle, $csv);
    rewind($handle);
    $rows = [];
    while (($row = fgetcsv($handle, escape: '\\')) !== false) {
        $rows[] = $row;
    }

    return $rows;
}

it('lets the quiz owner download each player\'s answers as readable text', function () {
    $owner = exportHost();
    $quiz = Quiz::create(['title' => 'Capitals', 'user_id' => $owner->id, 'is_published' => true, 'visibility' => 'private']);
    $single = Question::create([
        'quiz_id' => $quiz->id, 'serial_number' => 1, 'question_text' => '<p>Capital of Japan?</p>', 'question_type' => 'quiz_single_choice',
        'points' => 2, 'visibility' => 'private', 'options' => ['choices' => ['Kyoto', '', 'Tokyo'], 'correct_answer' => 2],
    ]);
    $multi = Question::create([
        'quiz_id' => $quiz->id, 'serial_number' => 2, 'question_text' => 'Primary colours?', 'question_type' => 'quiz_multiple_choice',
        'points' => 1, 'visibility' => 'private', 'options' => ['choices' => ['Red', 'Green', 'Blue', 'Yellow'], 'correct_answer' => [0, 2, 3]],
    ]);
    $typed = Question::create([
        'quiz_id' => $quiz->id, 'serial_number' => 3, 'question_text' => 'Largest planet?', 'question_type' => 'sort_answer_choice',
        'points' => 1, 'visibility' => 'private', 'options' => ['choices' => ['Jupiter'], 'correct_answer' => [0]],
    ]);
    $session = QuizSession::create([
        'quiz_id' => $quiz->id, 'title' => 'Live', 'session_id' => 'QUIZ-EXPORT-' . str()->random(6),
        'running_status' => false, 'start_datetime' => now()->subHour(), 'end_datetime' => now(), 'timezone' => 'UTC', 'is_host_live' => true,
    ]);
    $player = fn (string $name) => QuizParticipant::create([
        'quiz_id' => $quiz->id, 'quiz_session_id' => $session->id, 'is_anonymous' => true,
        'anonymous_details' => ['name' => $name, 'email' => strtolower($name) . '@example.test'],
        'start_time' => now(), 'score' => 0, 'status' => 'Completed',
    ]);
    $answer = fn ($participant, $question, $selected) => UserQuizAnswer::create([
        'quiz_participant_id' => $participant->id, 'question_id' => $question->id,
        'answer_data' => ['selected_option' => $selected], 'time_taken_seconds' => 5,
    ]);

    $bob = $player('Bob');
    $answer($bob, $single, 0);
    $answer($bob, $multi, '0,2');
    $ann = $player('Ann');
    $answer($ann, $single, 2);
    $answer($ann, $multi, '0,2,3');
    $answer($ann, $typed, ['jupiter']);

    $url = "/api/v1/quiz-leaderboard/download-session-attempts/{$session->id}/export/csv";

    // Players' names and emails: not for anyone with the session number.
    $this->get($url, ['Accept' => 'application/json'])->assertUnauthorized();
    Sanctum::actingAs(exportHost());
    $this->get($url, ['Accept' => 'application/json'])->assertForbidden();

    Sanctum::actingAs($owner);
    $rows = exportCsvRows($this->get($url)->assertOk());

    expect($rows[0])->toBe(['Name', 'Email', 'Joined at', 'Status', 'Score', 'Correct answers', 'Q1. Capital of Japan?', 'Q2. Primary colours?', 'Q3. Largest planet?'])
        // Best first; the empty second option doesn't shift "Tokyo" onto another answer.
        ->and([$rows[1][0], $rows[1][1], $rows[1][4], $rows[1][5]])->toBe(['Ann', 'ann@example.test', '4', '3 of 3'])
        ->and(array_slice($rows[1], 6))->toBe(['Tokyo (correct)', 'Red, Blue, Yellow (correct)', 'jupiter (correct)'])
        ->and([$rows[2][0], $rows[2][4], $rows[2][5]])->toBe(['Bob', '0', '0 of 3'])
        ->and(array_slice($rows[2], 6))->toBe(['Kyoto (wrong)', 'Red, Blue (wrong)', 'Not answered']);

    $this->get("/api/v1/quiz-leaderboard/download-session-attempts/{$session->id}/export/excel")->assertOk()
        ->assertHeader('content-disposition', 'attachment; filename=capitals-session-' . $session->id . '-answers.xlsx');
});
