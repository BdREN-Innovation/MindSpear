<?php

use App\Models\Quest\Quest;
use App\Models\Quest\QuestSession;
use App\Models\Quiz\Quiz;
use App\Models\Quiz\QuizSession;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;

uses(DatabaseTransactions::class);

function joinCodeOwner(): User
{
    return User::create([
        'first_name' => 'Code',
        'last_name' => 'Host',
        'email' => 'join-code-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]);
}

it('finds a running quiz session by the code on the host screen, with or without its letter', function () {
    $owner = joinCodeOwner();
    $quiz = Quiz::create(['title' => 'Code quiz', 'user_id' => $owner->id, 'is_published' => true, 'visibility' => 'public']);
    $session = QuizSession::create([
        'quiz_id' => $quiz->id, 'title' => 'Live', 'session_id' => 'QUIZ-CODE-' . str()->random(6),
        'running_status' => true, 'start_datetime' => now(), 'end_datetime' => now()->addHour(),
        'timezone' => 'UTC', 'is_host_live' => true, 'join_link' => 'abc-def-ghi-jkl', 'join_code' => '611576',
    ]);

    foreach (['Q611576', '611576', 'q 611-576'] as $typed) {
        $this->postJson('/api/v1/quiz-attempts-url/code', ['join_code' => $typed])
            ->assertOk()
            ->assertJsonPath('data.session.id', $session->id)
            ->assertJsonPath('data.session.join_link', 'abc-def-ghi-jkl');
    }

    $session->update(['running_status' => false]);
    $this->postJson('/api/v1/quiz-attempts-url/code', ['join_code' => 'Q611576'])->assertNotFound();
});

it('finds a live quest by its code and refuses one that is not running', function () {
    $owner = joinCodeOwner();
    $quest = Quest::create([
        'title' => 'Code quest', 'creator_id' => $owner->id, 'visibility' => 'public', 'is_published' => true,
        'start_datetime' => now()->subHour(), 'end_datetime' => now()->addDay(),
    ]);
    $quest->forceFill(['join_code' => '915122'])->save();
    $ended = QuestSession::create([
        'quest_id' => $quest->id, 'title' => 'Earlier', 'session_id' => 'QUEST-CODE-' . str()->random(6),
        'running_status' => false, 'start_datetime' => now()->subHour(), 'end_datetime' => now(), 'timezone' => 'UTC',
    ]);

    // Its last session has ended.
    $this->postJson('/api/v1/quest-attempts-url/join-by-code', ['join_code' => 'T915122'])->assertStatus(400);

    $live = QuestSession::create([
        'quest_id' => $quest->id, 'title' => 'Live', 'session_id' => 'QUEST-CODE-' . str()->random(6),
        'running_status' => true, 'start_datetime' => now(), 'end_datetime' => now()->addHour(), 'timezone' => 'UTC',
    ]);

    foreach (['T915122', '915122', 't-915122'] as $typed) {
        $this->postJson('/api/v1/quest-attempts-url/join-by-code', ['join_code' => $typed])
            ->assertOk()
            ->assertJsonPath('data.quest.id', $quest->id)
            ->assertJsonPath('data.session.id', $live->id);
    }

    expect($ended->id)->not->toBe($live->id);
});
