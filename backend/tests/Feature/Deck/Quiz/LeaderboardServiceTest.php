<?php

use App\Deck\Scoring\LeaderboardService;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

uses(DatabaseTransactions::class);

/**
 * A live quiz session: runs 1 pick_answer_single (reveal), 2 leaderboard
 * (current), 3 pick_answer_multi (reveal, after the current slide),
 * 4 heading (closed); participants Ann 300 (joined second), Ben 300 (joined
 * first), Cal 150, Dee null. Run 1 points: Ann 100, Ben 0, Cal 50, Dee null.
 *
 * @return array{session: DeckSession, runs: list<DeckSessionSlideRun>, p: array<string, DeckParticipant>}
 */
function lbSession(): array
{
    $deck = Deck::factory()->quiz()->create();
    $session = DeckSession::factory()->live()->create(['deck_id' => $deck->id]);

    $runs = [];
    foreach ([['pick_answer_single', 'reveal'], ['leaderboard', DeckSessionSlideRun::STATE_WAITING], ['pick_answer_multi', 'reveal'], ['heading', DeckSessionSlideRun::STATE_CLOSED]] as $index => [$type, $state]) {
        $runs[] = DeckSessionSlideRun::factory()->create([
            'deck_session_id' => $session->id,
            'position_snapshot' => $index + 1,
            'type_snapshot' => $type,
            'state' => $state,
        ]);
    }
    $session->forceFill(['current_slide_run_id' => $runs[1]->id])->save();

    $base = now()->subMinutes(10);
    $p = [];
    foreach (['Ann' => [300, 2], 'Ben' => [300, 1], 'Cal' => [150, 3], 'Dee' => [null, 4]] as $name => [$points, $joined]) {
        $p[$name] = DeckParticipant::factory()->create([
            'deck_session_id' => $session->id,
            'display_name' => $name,
            'emoji_avatar' => '🦊',
            'total_points' => $points,
            'joined_at' => $base->copy()->addSeconds($joined),
        ]);
    }

    foreach (['Ann' => 100, 'Ben' => 0, 'Cal' => 50, 'Dee' => null] as $name => $points) {
        DeckParticipantAnswer::factory()->create([
            'slide_run_id' => $runs[0]->id,
            'deck_participant_id' => $p[$name]->id,
            'answer_payload' => ['option_id' => 1],
            'points_awarded' => $points,
            'is_correct' => $points > 0,
        ]);
    }

    DeckParticipantAnswer::factory()->create([
        'slide_run_id' => $runs[2]->id,
        'deck_participant_id' => $p['Cal']->id,
        'answer_payload' => ['option_ids' => [1]],
        'points_awarded' => 90,
    ]);

    return ['session' => $session->fresh(), 'runs' => $runs, 'p' => $p];
}

function lbService(): LeaderboardService
{
    return app(LeaderboardService::class);
}

it('ranks by total points, ties share a rank and break by earliest join', function () {
    ['session' => $session, 'p' => $p] = lbSession();

    expect(lbService()->currentTopN($session))->toBe([
        ['rank' => 1, 'participant_id' => $p['Ben']->id, 'display_name' => 'Ben', 'emoji_avatar' => '🦊', 'total_points' => 300, 'points_delta' => 0],
        ['rank' => 1, 'participant_id' => $p['Ann']->id, 'display_name' => 'Ann', 'emoji_avatar' => '🦊', 'total_points' => 300, 'points_delta' => 100],
        ['rank' => 3, 'participant_id' => $p['Cal']->id, 'display_name' => 'Cal', 'emoji_avatar' => '🦊', 'total_points' => 150, 'points_delta' => 50],
        ['rank' => 4, 'participant_id' => $p['Dee']->id, 'display_name' => 'Dee', 'emoji_avatar' => '🦊', 'total_points' => 0, 'points_delta' => 0],
    ]);
});

it('cuts to the top N', function () {
    ['session' => $session, 'p' => $p] = lbSession();

    expect(array_column(lbService()->currentTopN($session, 2), 'participant_id'))->toBe([$p['Ben']->id, $p['Ann']->id])
        ->and(lbService()->currentTopN($session, 0))->toBe([])
        ->and(lbService()->currentTopN($session, 50))->toHaveCount(4);
});

it('takes deltas from the latest played scored run at or before the current slide', function () {
    ['session' => $session, 'runs' => $runs, 'p' => $p] = lbSession();

    // Current = leaderboard (position 2): run 1; run 3 is later in the deck.
    expect(lbService()->latestScoredRun($session)?->id)->toBe($runs[0]->id);

    // On run 4 (content, closed): run 3 is the latest played scored run.
    $session->forceFill(['current_slide_run_id' => $runs[3]->id])->save();
    expect(lbService()->latestScoredRun($session)?->id)->toBe($runs[2]->id)
        ->and(collect(lbService()->currentTopN($session))->firstWhere('participant_id', $p['Cal']->id)['points_delta'])->toBe(90);

    // While run 3 is still being answered it does not count yet.
    $runs[2]->forceFill(['state' => DeckSessionSlideRun::STATE_VOTING])->save();
    expect(lbService()->latestScoredRun($session)?->id)->toBe($runs[0]->id);
});

it('has no deltas before any scored run was played', function () {
    ['session' => $session, 'runs' => $runs] = lbSession();
    DeckSessionSlideRun::query()->whereKey([$runs[0]->id, $runs[2]->id])->update(['state' => DeckSessionSlideRun::STATE_VOTING]);

    $rows = lbService()->currentTopN($session);

    expect(lbService()->latestScoredRun($session))->toBeNull()
        ->and(array_unique(array_column($rows, 'points_delta')))->toBe([0])
        ->and(Cache::has(LeaderboardService::cacheKey($session->id, null)))->toBeTrue();
});

it('sums points awarded per participant for one run', function () {
    ['session' => $session, 'runs' => $runs, 'p' => $p] = lbSession();
    $other = lbSession();

    expect(lbService()->pointsDeltaAfterSlideRun($session, $runs[0]))->toBe([
        $p['Ann']->id => 100,
        $p['Ben']->id => 0,
        $p['Cal']->id => 50,
        $p['Dee']->id => 0,
    ])
        ->and(lbService()->pointsDeltaAfterSlideRun($session, $runs[1]))->toBe([])
        ->and(lbService()->pointsDeltaAfterSlideRun($session, $other['runs'][0]))->toBe([]);
});

it('builds the reveal delta for every participant, best first, optionally cut', function () {
    ['session' => $session, 'runs' => $runs, 'p' => $p] = lbSession();

    expect(lbService()->revealDelta($session, $runs[0]))->toBe([
        ['participant_id' => $p['Ben']->id, 'points_delta' => 0, 'new_total' => 300, 'new_rank' => 1],
        ['participant_id' => $p['Ann']->id, 'points_delta' => 100, 'new_total' => 300, 'new_rank' => 1],
        ['participant_id' => $p['Cal']->id, 'points_delta' => 50, 'new_total' => 150, 'new_rank' => 3],
        ['participant_id' => $p['Dee']->id, 'points_delta' => 0, 'new_total' => 0, 'new_rank' => 4],
    ])
        ->and(lbService()->revealDelta($session, $runs[0], 1))->toHaveCount(1)
        ->and(lbService()->revealDelta($session, $runs[2])[2])->toBe(['participant_id' => $p['Cal']->id, 'points_delta' => 90, 'new_total' => 150, 'new_rank' => 3]);
});

it('returns one participant standing', function () {
    ['session' => $session, 'runs' => $runs, 'p' => $p] = lbSession();

    expect(lbService()->standing($session, $p['Cal']->id))->toMatchArray(['rank' => 3, 'total_points' => 150, 'points_delta' => 50])
        ->and(lbService()->standing($session, $p['Cal']->id, $runs[2])['points_delta'])->toBe(90)
        ->and(lbService()->standing($session, 999_999_999))->toBeNull();
});

it('caches each snapshot under its run and rebuilds when participants change', function () {
    ['session' => $session, 'runs' => $runs, 'p' => $p] = lbSession();
    $key = "leaderboard:deck_session:{$session->id}:after:{$runs[0]->id}";

    lbService()->currentTopN($session);
    expect(LeaderboardService::cacheKey($session->id, $runs[0]->id))->toBe($key)
        ->and(Cache::get($key)['rows'])->toHaveCount(4);

    // A change the fingerprint cannot see is served from the cache.
    DB::table('deck_participants')->where('id', $p['Cal']->id)->update(['display_name' => 'Renamed']);
    expect(collect(lbService()->currentTopN($session))->firstWhere('participant_id', $p['Cal']->id)['display_name'])->toBe('Cal');

    // Points change: rebuilt.
    DB::table('deck_participants')->where('id', $p['Cal']->id)->update(['total_points' => 400]);
    $rows = lbService()->currentTopN($session);
    expect($rows[0])->toMatchArray(['participant_id' => $p['Cal']->id, 'display_name' => 'Renamed', 'total_points' => 400, 'rank' => 1])
        ->and($rows[1]['rank'])->toBe(2);

    // A join: rebuilt.
    $new = DeckParticipant::factory()->create(['deck_session_id' => $session->id, 'total_points' => 0]);
    expect(array_column(lbService()->currentTopN($session), 'participant_id'))->toContain($new->id);

    // Points moving between two players with the same sum: rebuilt.
    DB::table('deck_participants')->where('id', $p['Ann']->id)->update(['total_points' => 250]);
    DB::table('deck_participants')->where('id', $p['Ben']->id)->update(['total_points' => 350]);
    expect(collect(lbService()->currentTopN($session))->firstWhere('participant_id', $p['Ben']->id)['total_points'])->toBe(350);
});

it('forgets every snapshot of a session', function () {
    ['session' => $session, 'runs' => $runs] = lbSession();
    $other = lbSession();

    lbService()->revealDelta($session, $runs[0]);
    lbService()->revealDelta($session, $runs[2]);
    lbService()->currentTopN($other['session']);

    lbService()->forget($session);

    expect(Cache::has(LeaderboardService::cacheKey($session->id, $runs[0]->id)))->toBeFalse()
        ->and(Cache::has(LeaderboardService::cacheKey($session->id, $runs[2]->id)))->toBeFalse()
        ->and(Cache::has(LeaderboardService::cacheKey($other['session']->id, $other['runs'][0]->id)))->toBeTrue();
});
