<?php

use App\Models\Quest\Quest;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

function legacyQuestOwner(): User
{
    return User::create([
        'first_name' => 'Quest',
        'last_name' => 'Owner',
        'email' => 'quest-editor-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]);
}

it('saves the quest settings start time in UTC and keeps its visibility', function () {
    $owner = legacyQuestOwner();
    $quest = Quest::create(['title' => 'Untitled Quest', 'creator_id' => $owner->id, 'visibility' => 'public']);

    Sanctum::actingAs($owner);
    $this->postJson("/api/v1/quests/update/{$quest->id}", [
        'title' => 'Team check-in',
        'start_datetime' => '2026-10-18 12:50:00',
        'end_datetime' => '2031-10-18 12:50:00',
        'timezone' => 'Asia/Dhaka',
        'visibility' => 'private',
    ])->assertOk();

    $quest->refresh();
    expect($quest->start_datetime->utc()->format('Y-m-d H:i:s'))->toBe('2026-10-18 06:50:00')
        ->and($quest->end_datetime->utc()->format('Y-m-d H:i:s'))->toBe('2031-10-18 06:50:00')
        ->and($quest->visibility)->toBe('private');
});

it('publishes the quest when it is hosted live so players can join', function () {
    $owner = legacyQuestOwner();
    $quest = Quest::create([
        'title' => 'Live check-in', 'creator_id' => $owner->id, 'visibility' => 'private', 'is_published' => false,
        'start_datetime' => now()->subHour(), 'end_datetime' => now()->addYear(),
    ]);

    Sanctum::actingAs($owner);
    $this->postJson("/api/v1/quests/host-live/{$quest->id}", [
        'title' => 'Live check-in · today',
        'timezone' => 'UTC',
        'start_datetime' => now()->format('Y-m-d H:i:s'),
        'end_datetime' => now()->addDay()->format('Y-m-d H:i:s'),
    ])->assertOk();

    $quest->refresh();
    expect($quest->is_published)->toBeTrue();
    $this->getJson("/api/v1/quest-attempts-url/show-by-link/{$quest->join_link}")->assertOk();
});

it('shows quick form submissions only to the quest owner', function () {
    $owner = legacyQuestOwner();
    $other = legacyQuestOwner();
    $quest = \App\Models\Quest\Quest::create(['title' => 'Form', 'creator_id' => $owner->id, 'visibility' => 'private', 'is_published' => true]);
    $session = \App\Models\Quest\QuestSession::create([
        'quest_id' => $quest->id, 'title' => 'Live', 'session_id' => 'QUEST-FORM-' . str()->random(6),
        'running_status' => true, 'start_datetime' => now(), 'end_datetime' => now()->addHour(), 'timezone' => 'UTC',
    ]);
    $task = \App\Models\Quest\QuestTask::create([
        'quest_id' => $quest->id, 'title' => 'Contact', 'task_type' => 'quick_form', 'serial_number' => 1,
        'task_data' => ['questions' => [['id' => '1', 'type' => 'short-answer', 'label' => 'Your name', 'options' => []]]],
    ]);
    $participant = \App\Models\Quest\QuestParticipant::create([
        'quest_id' => $quest->id, 'quest_session_id' => $session->id, 'is_anonymous' => true,
        'anonymous_details' => ['name' => 'Ann'], 'start_time' => now(), 'status' => 'In Progress',
    ]);
    \App\Models\Quest\QuestTaskCompletion::create([
        'participant_id' => $participant->id, 'task_id' => $task->id, 'status' => 'Completed', 'completed_at' => now(),
        'completion_data' => ['0' => ['id' => '1', 'type' => 'short-answer', 'label' => 'Your name', 'options' => [], 'text' => 'Ann Lee']],
    ]);
    $url = "/api/v1/quests/{$quest->id}/sessions/{$session->id}/tasks/{$task->id}/form-responses";

    Sanctum::actingAs($other);
    $this->getJson($url)->assertForbidden();

    Sanctum::actingAs($owner);
    $this->getJson($url)->assertOk()
        ->assertJsonPath('data.responses.0.participant', 'Ann')
        ->assertJsonPath('data.responses.0.answer_data.0.text', 'Ann Lee');
});

it('reports each scale statement its own average and how many players answered', function () {
    $owner = legacyQuestOwner();
    $quest = Quest::create(['title' => 'Rate', 'creator_id' => $owner->id, 'visibility' => 'private', 'is_published' => true]);
    $session = \App\Models\Quest\QuestSession::create([
        'quest_id' => $quest->id, 'title' => 'Live', 'session_id' => 'QUEST-RATE-' . str()->random(6),
        'running_status' => false, 'start_datetime' => now()->subHour(), 'end_datetime' => now(), 'timezone' => 'UTC',
    ]);
    $task = \App\Models\Quest\QuestTask::create([
        'quest_id' => $quest->id, 'title' => 'Rate the workshop', 'task_type' => 'scales', 'serial_number' => 1,
        'task_data' => ['minNumber' => 1, 'maxNumber' => 5, 'questions' => [
            ['id' => 1, 'text' => 'Content'], ['id' => 2, 'text' => 'Pace'], ['id' => 3, 'text' => 'Venue'],
        ]],
    ]);
    // Pace rates highest; Ann left Venue unrated (0), Bob rated it 3.
    foreach (['Ann' => [2, 5, 0], 'Bob' => [3, 4, 3]] as $name => $ratings) {
        $participant = \App\Models\Quest\QuestParticipant::create([
            'quest_id' => $quest->id, 'quest_session_id' => $session->id, 'is_anonymous' => true,
            'anonymous_details' => ['name' => $name], 'start_time' => now(), 'status' => 'Completed',
        ]);
        \App\Models\Quest\QuestTaskCompletion::create([
            'participant_id' => $participant->id, 'task_id' => $task->id, 'status' => 'Completed', 'completed_at' => now(),
            'completion_data' => ['selected_option' => $ratings],
        ]);
    }

    Sanctum::actingAs($owner);
    $this->getJson("/api/v1/quest-leaderboard/session-details-combined-score/{$session->id}")
        ->assertOk()
        ->assertJsonPath('data.questTasks.0.responses_count', 2)
        // Statements stay in their order, each with its own result.
        ->assertJsonPath('data.questTasks.0.task_data.questions.0.text', 'Content')
        ->assertJsonPath('data.questTasks.0.optionsCount.0.average', 2.5)
        ->assertJsonPath('data.questTasks.0.optionsCount.1.average', 4.5)
        ->assertJsonPath('data.questTasks.0.optionsCount.2.average', 3);
});
