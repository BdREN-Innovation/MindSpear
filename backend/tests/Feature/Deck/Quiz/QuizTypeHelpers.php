<?php

/*
 * Shared helpers for the quiz slide type tests (required by each
 * *TypeTest.php; not a test file itself).
 */

use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quiz\QuizOptions;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Validation\ValidationException;

function quizType(string $key): SlideTypeContract
{
    return app(SlideTypeRegistry::class)->for($key);
}

/** One options_snapshot row. */
function quizOption(int $id, int $position, ?string $label = null, array $payload = [], ?bool $isCorrect = null): array
{
    return [
        'id' => $id,
        'position' => $position,
        'label' => $label ?? "Option {$id}",
        'image_file_id' => 900 + $id,
        'image_url' => "https://cdn.example.test/{$id}.png",
        'is_correct' => $isCorrect,
        'payload' => $payload,
    ];
}

/** config['scoring'] as the session launcher snapshots it. */
function quizScoring(int $min = 50, int $max = 100, bool $speed = false, ?int $limit = 20): array
{
    return ['scoring' => ['points_min' => $min, 'points_max' => $max, 'speed_bonus_enabled' => $speed, 'time_limit_seconds' => $limit]];
}

/** An unsaved run in contract shape. */
function quizRun(string $type, array $config, array $options, int $id = 77): DeckSessionSlideRun
{
    $run = new DeckSessionSlideRun([
        'deck_session_id' => 1,
        'slide_id' => 5,
        'position_snapshot' => 2,
        'type_snapshot' => $type,
        'title_snapshot' => 'Question?',
        'body_snapshot' => null,
        'config_snapshot' => $config + ['_internal' => 'x'],
        'options_snapshot' => $options,
        'time_limit_seconds' => 20,
        'state' => DeckSessionSlideRun::STATE_VOTING,
        'state_version' => 3,
    ]);
    $run->id = $id;

    return $run;
}

/** An unsaved answer row. */
function quizAnswer(array $payload, int $id = 1): DeckParticipantAnswer
{
    $answer = new DeckParticipantAnswer(['answer_payload' => $payload, 'submitted_at' => now()]);
    $answer->id = $id;

    return $answer;
}

/** Every key at any depth. */
function quizKeysDeep(array $data): array
{
    $keys = [];
    foreach ($data as $key => $value) {
        $keys[] = $key;
        if (is_array($value)) {
            $keys = [...$keys, ...quizKeysDeep($value)];
        }
    }

    return $keys;
}

function quizRejects(callable $callback): void
{
    expect($callback)->toThrow(ValidationException::class);
}

function quizKey(int $id): string
{
    return QuizOptions::key($id);
}

/**
 * The participant view of $run must carry no answer key: no correctness or
 * answer-key fields at any depth, none of $secrets anywhere in its JSON, and
 * no aggregate.
 */
function quizAssertNoLeak(SlideTypeContract $type, DeckSessionSlideRun $run, array $secrets = []): array
{
    $view = $type->serializeForParticipant($run);
    $keys = quizKeysDeep($view);
    $json = json_encode($view, JSON_UNESCAPED_UNICODE);

    foreach (['aggregate', 'is_correct', 'correct', 'answer_key', 'correct_option_ids', 'correct_order', 'correct_category_key',
        'pair_key', 'accepted_answers', 'image_file_id', '_internal', 'option_id'] as $forbidden) {
        expect($keys)->not->toContain($forbidden);
    }

    foreach ($secrets as $secret) {
        expect($json)->not->toContain($secret);
    }

    return $view;
}
