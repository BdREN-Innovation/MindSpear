<?php

use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quiz\QuizOptions;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use Illuminate\Foundation\Testing\DatabaseTransactions;

require_once __DIR__ . '/QuizTypeHelpers.php';
require_once __DIR__ . '/QuizApiHelpers.php';

/*
 * Quiz review fixes Q-S2 / Q-S3 (QUIZ_REDESIGN_PLAN.md "Review fixes"):
 * display orders are a keyed (app.key) per-participant shuffle with no
 * "never the given order" rule, and opaque option keys are salted per run.
 */

uses(DatabaseTransactions::class);

/** $n options with ids 1..$n in author order. */
function qshufOptions(int $n): array
{
    return array_map(fn (int $i) => quizOption($i, $i, "Item {$i}"), range(1, $n));
}

/** The order of $options for run $runId / $participantId as an id signature. */
function qshufOrder(array $options, int $runId, ?int $participantId = null): string
{
    return implode(',', array_column(QuizOptions::shuffle($options, $runId, $participantId), 'id'));
}

/** The pre-fix scheme: sha256("{run_id}:{option_id}"), no secret. */
function qshufUnkeyed(array $options, int $runId): string
{
    usort($options, fn (array $a, array $b) => hash('sha256', $runId . ':' . $a['id']) <=> hash('sha256', $runId . ':' . $b['id']));

    return implode(',', array_column($options, 'id'));
}

it('shuffles two items 50 / 50 over many runs: neither order is ever forced', function () {
    $options = qshufOptions(2);
    $counts = ['1,2' => 0, '2,1' => 0];

    foreach (range(1, 4000) as $runId) {
        $counts[qshufOrder($options, $runId)]++;
    }

    // Expected 2000 each; ±160 is ±5 standard deviations (the old rotation gave 0 / 4000).
    expect($counts['1,2'])->toBeGreaterThan(1840)->toBeLessThan(2160)
        ->and($counts['2,1'])->toBeGreaterThan(1840)->toBeLessThan(2160);

    // Per participant on one run, too (a 2-pair match_pairs right column is no longer determined).
    $byParticipant = ['1,2' => 0, '2,1' => 0];
    foreach (range(1, 4000) as $participantId) {
        $byParticipant[qshufOrder($options, 77, $participantId)]++;
    }
    expect($byParticipant['1,2'])->toBeGreaterThan(1840)->toBeLessThan(2160);
});

it('shuffles three items uniformly: all six orders, the correct one as likely as any', function () {
    $options = qshufOptions(3);
    $counts = [];

    foreach (range(1, 6000) as $runId) {
        $order = qshufOrder($options, $runId);
        $counts[$order] = ($counts[$order] ?? 0) + 1;
    }

    // Expected 1000 each; ±145 is ±5 standard deviations (the old rotation never showed 1,2,3 and doubled 2,3,1).
    expect(array_keys($counts))->toEqualCanonicalizing(['1,2,3', '1,3,2', '2,1,3', '2,3,1', '3,1,2', '3,2,1']);
    foreach ($counts as $order => $count) {
        expect($count)->toBeGreaterThan(855, "order {$order}")->toBeLessThan(1145, "order {$order}");
    }
});

it('cannot be recomputed from the public run, participant and option ids without app.key', function () {
    $options = qshufOptions(6);
    $original = config('app.key');
    $runs = range(1000, 1199);

    $real = array_map(fn (int $runId) => qshufOrder($options, $runId, 5), $runs);

    // The old unkeyed hash (what the probe used to recover a full 6-item order) no longer matches.
    $unkeyed = array_map(fn (int $runId) => qshufUnkeyed($options, $runId), $runs);
    $unkeyedHits = count(array_filter(array_map(fn ($a, $b) => $a === $b, $real, $unkeyed)));

    // Neither does the same keyed scheme under any other key.
    config(['app.key' => 'base64:' . base64_encode(random_bytes(32))]);
    $otherKey = array_map(fn (int $runId) => qshufOrder($options, $runId, 5), $runs);
    config(['app.key' => $original]);
    $otherKeyHits = count(array_filter(array_map(fn ($a, $b) => $a === $b, $real, $otherKey)));

    // 720 orders: a guess matches 1 time in 720, so 200 runs give ~0 hits.
    expect($unkeyedHits)->toBeLessThan(5)
        ->and($otherKeyHits)->toBeLessThan(5)
        // Same key, same inputs: the same order again (stable across reads).
        ->and(array_map(fn (int $runId) => qshufOrder($options, $runId, 5), $runs))->toBe($real);
});

it('gives every participant an order of their own, stable for them and independent of the snapshot order', function () {
    $options = qshufOptions(6);

    $orders = array_map(fn (int $participantId) => qshufOrder($options, 42, $participantId), range(1, 30));
    expect(count(array_unique($orders)))->toBeGreaterThan(25)
        ->and(qshufOrder(array_reverse($options), 42, 7))->toBe(qshufOrder($options, 42, 7))
        ->and(qshufOrder($options, 42, 7))->toBe($orders[6])
        // The run-level order (presenter, public broadcasts) is its own order.
        ->and(qshufOrder($options, 42))->toBe(qshufOrder($options, 42, null));

    // Through the type: the participant view follows QuizOptions::shuffle for that participant.
    $type = quizType('correct_order');
    $run = quizRun('correct_order', [], $options, 42);
    $view = $type->serializeForViewer($run, 7);
    expect(array_column($view['options'], 'id'))->toBe(array_map(fn ($o) => quizKey($o['id']), QuizOptions::shuffle($options, 42, 7)));
});

it('salts opaque option keys per run: new keys on every run and session, legacy runs unchanged', function () {
    $a = [QuizOptions::KEY_SALT => str_repeat('a', 32)];
    $b = [QuizOptions::KEY_SALT => str_repeat('b', 32)];

    expect(QuizOptions::key(5, $a))->not->toBe(QuizOptions::key(5, $b))
        ->and(QuizOptions::key(5, $a))->toBe(QuizOptions::key(5, $a))
        ->and(QuizOptions::key(5, $a))->toMatch('/^k[0-9a-f]{12}$/')
        // A run snapshotted before salts existed keeps its old keys (its stored answers still match).
        ->and(QuizOptions::key(5, []))->toBe('k' . substr(hash_hmac('sha256', 'deck-quiz-option:5', (string) config('app.key')), 0, 12))
        ->and(QuizOptions::newSalt())->toMatch('/^[0-9a-f]{32}$/')
        ->and(QuizOptions::newSalt())->not->toBe(QuizOptions::newSalt());
});

it('snapshots a fresh salt per run, so a key learned in one session is useless in the next', function () {
    qapiSetUp();
    $host = qapiOwner();
    $deck = Deck::factory()->quiz()->ownedBy($host)->create();
    $registry = app(SlideTypeRegistry::class);
    $slides = [];
    foreach ([1, 2] as $position) {
        $slide = Slide::factory()->ofType('correct_order', $registry->for('correct_order')->defaultConfig())
            ->create(['deck_id' => $deck->id, 'position' => $position, 'time_limit_seconds' => 20, 'get_ready_seconds' => 0]);
        foreach (['First', 'Second', 'Third'] as $i => $label) {
            SlideOption::factory()->create(['slide_id' => $slide->id, 'position' => $i + 1, 'label' => $label, 'payload' => []]);
        }
        $slides[] = $slide;
    }

    $first = qapiStart($host, $deck->id);
    $runs = DeckSessionSlideRun::query()->where('deck_session_id', $first['session_id'])->orderBy('position_snapshot')->get();
    $salts = $runs->map(fn ($run) => QuizOptions::salt($run->config_snapshot))->all();
    expect($salts[0])->toMatch('/^[0-9a-f]{32}$/')->and($salts[1])->not->toBe($salts[0]);

    // The salt is never serialised to the host or a phone.
    $people = qapiJoin($first, ['Ada']);
    qapiAdvance($host, $first['session_id'], ['action' => 'start_voting'])->assertOk();
    $hostJson = json_encode(qapiHostState($host, $first['session_id'])->assertOk()->json());
    $phone = qapiState($first['session_id'], $people[0]['token'])->assertOk()->json('data');
    expect($hostJson)->not->toContain('_key_salt')->not->toContain($salts[0])
        ->and(json_encode($phone))->not->toContain('_key_salt')->not->toContain($salts[0]);

    $oldKeys = array_column($phone['current_slide_run']['options'], 'id');
    qapiAsHost($host);
    test()->postJson(QAPI_SESSIONS . "/{$first['session_id']}/end")->assertOk();

    // Second session of the same deck: same options, different keys; the old ones are rejected.
    $second = qapiStart($host, $deck->id);
    $people = qapiJoin($second, ['Ada']);
    qapiAdvance($host, $second['session_id'], ['action' => 'start_voting'])->assertOk();
    $run = DeckSessionSlideRun::query()->where('deck_session_id', $second['session_id'])->where('position_snapshot', 1)->firstOrFail();
    $newKeys = array_column(qapiState($second['session_id'], $people[0]['token'])->json('data.current_slide_run.options'), 'id');

    expect(array_intersect($newKeys, $oldKeys))->toBe([]);
    qapiSubmit($second['session_id'], $run->id, $people[0]['token'], ['order' => $oldKeys])
        ->assertStatus(422)->assertJsonValidationErrors(['answer_payload.order.0'], 'data.validation_errors');
    qapiSubmit($second['session_id'], $run->id, $people[0]['token'], ['order' => $newKeys])->assertNoContent();
});
