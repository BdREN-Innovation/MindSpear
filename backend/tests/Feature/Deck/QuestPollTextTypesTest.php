<?php

use App\Deck\Broadcasts\Payloads\SlideAggregateUpdatedPayload;
use App\Deck\Broadcasts\Payloads\SlideClosedPayload;
use App\Deck\Slides\AppendsSubmissions;
use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\OpenEndedSlideType;
use App\Deck\Slides\Types\Quest\WordCloudSlideType;
use App\Deck\Support\ProfanityFilter;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

uses(DatabaseTransactions::class);

afterEach(function () {
    Carbon::setTestNow();
});

function qpTextAnswer(int $id, array $payload, ?string $submittedAt = '2026-10-15 10:00:00', ?string $emoji = null): DeckParticipantAnswer
{
    $answer = new DeckParticipantAnswer([
        'answer_payload' => $payload,
        'submitted_at' => $submittedAt === null ? null : Carbon::parse($submittedAt, 'UTC'),
    ]);
    $answer->id = $id;
    if ($emoji !== null) {
        $answer->setRelation('participant', new DeckParticipant(['emoji_avatar' => $emoji, 'display_name' => 'Secret Name']));
    }

    return $answer;
}

function qpTextRun(string $type, array $config): DeckSessionSlideRun
{
    $run = new DeckSessionSlideRun([
        'deck_session_id' => 1,
        'position_snapshot' => 2,
        'type_snapshot' => $type,
        'title_snapshot' => 'Tell us',
        'config_snapshot' => $config + ['answer_key' => 'nope'],
        'options_snapshot' => [],
        'state' => DeckSessionSlideRun::STATE_VOTING,
        'state_version' => 1,
    ]);
    $run->id = 88;

    return $run;
}

function qpTextKeysDeep(array $data): array
{
    $keys = [];
    foreach ($data as $key => $value) {
        $keys[] = $key;
        if (is_array($value)) {
            $keys = [...$keys, ...qpTextKeysDeep($value)];
        }
    }

    return $keys;
}

function qpTextRejects(callable $callback): void
{
    expect($callback)->toThrow(ValidationException::class);
}

function qpTextWordCloud(): WordCloudSlideType
{
    return new WordCloudSlideType(new ProfanityFilter(['darn', 'heck']));
}

function qpTextOpenEnded(): OpenEndedSlideType
{
    return new OpenEndedSlideType(new ProfanityFilter(['darn', 'heck']));
}

/**
 * Bytes of the Pusher HTTP body Reverb receives for this aggregate (event data
 * JSON-encoded inside the JSON body, as pusher-php-server sends it), for the
 * larger of slide.aggregate.updated and slide.closed.
 */
function qpTextBroadcastBytes(DeckSessionSlideRun $run, array $aggregate): int
{
    $channel = 'session.quest.' . str_repeat('k', 64);
    $meta = ['module' => 'quest', 'session_id' => 123456789, 'broadcasted_at' => now()->toISOString()];

    return max(array_map(function ($payload) use ($channel, $meta) {
        $event = LiveBroadcastEvent::fromPayload($payload, $channel, $meta, now: true);

        return strlen(json_encode([
            'name' => $event->broadcastAs(),
            'data' => json_encode($event->broadcastWith()),
            'channels' => [$channel],
        ]));
    }, [SlideAggregateUpdatedPayload::fromRun($run, $aggregate), SlideClosedPayload::fromRun($run, $aggregate)]));
}

dataset('qp_text_types', [
    'word_cloud' => [WordCloudSlideType::KEY, WordCloudSlideType::class],
    'open_ended' => [OpenEndedSlideType::KEY, OpenEndedSlideType::class],
]);

it('is discovered by the registry as a live, unscored Quest poll that appends submissions', function (string $key, string $class) {
    $type = app(SlideTypeRegistry::class)->for($key);

    expect($type)->toBeInstanceOf($class)
        ->and($type)->toBeInstanceOf(AppendsSubmissions::class)
        ->and($type->products())->toBe(['quest'])
        ->and($type->category())->toBe(SlideTypeContract::CATEGORY_POLL)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_LIVE)
        ->and($type->acceptsAnswers())->toBeTrue()
        ->and($type->defaultOptions())->toBe([]);
})->with('qp_text_types');

it('accepts its own default config unchanged', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);

    expect($type->validateConfig($type->defaultConfig()))->toBe($type->defaultConfig())
        ->and($type->validateConfig(['unknown' => true]))->toBe($type->defaultConfig());
})->with('qp_text_types');

it('always scores zero', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);

    expect($type->score(['entries' => ['x']], $type->defaultConfig(), [], 500))->toEqual(ScoreResult::zero());
})->with('qp_text_types');

it('never sends aggregate data or answer keys to participants', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);

    $view = $type->serializeForParticipant(qpTextRun($key, $type->defaultConfig()));
    $keys = qpTextKeysDeep($view);

    expect($keys)->not->toContain('aggregate')
        ->and($keys)->not->toContain('is_correct')
        ->and($keys)->not->toContain('answer_key')
        ->and($view['config'])->toBe($type->defaultConfig())
        ->and($view['options'])->toBe([]);
})->with('qp_text_types');

it('has the planned word_cloud defaults', function () {
    expect(app(SlideTypeRegistry::class)->for('word_cloud')->defaultConfig())->toBe([
        'max_entries_per_participant' => 3,
        'max_entry_length' => 25,
        'profanity_filter_enabled' => true,
        'allow_multiple_submissions' => false,
        'show_results_to_participants' => false,
    ]);
});

it('rejects bad word_cloud config', function (array $config) {
    qpTextRejects(fn () => qpTextWordCloud()->validateConfig($config));
})->with([
    'zero entries' => [['max_entries_per_participant' => 0]],
    'too many entries' => [['max_entries_per_participant' => 11]],
    'entry length zero' => [['max_entry_length' => 0]],
    'entry length huge' => [['max_entry_length' => 101]],
    'filter not bool' => [['profanity_filter_enabled' => 'sometimes']],
    'multiple not bool' => [['allow_multiple_submissions' => 'yes please']],
]);

it('validates and normalises word_cloud answers and stamps each entry', function () {
    Carbon::setTestNow(Carbon::parse('2026-10-15 09:30:00.250', 'UTC'));
    $type = qpTextWordCloud();
    $config = $type->defaultConfig();
    $now = '2026-10-15T09:30:00.250000Z';

    expect($type->validateAnswer(['entries' => ['  Hello   World ', 'hello world', 'Pizza']], $config, []))
        ->toBe(['entries' => ['Hello World', 'Pizza'], 'entry_times' => [$now, $now]])
        ->and($type->validateAnswer(['entries' => ['one']], $config, []))->toBe(['entries' => ['one'], 'entry_times' => [$now]]);

    foreach ([
        [],
        ['entries' => 'pizza'],
        ['entries' => []],
        ['entries' => ['a', 'b', 'c', 'd']],                  // above max_entries_per_participant
        ['entries' => ['   ']],                               // blank after trimming
        ['entries' => [str_repeat('x', 26)]],                 // above max_entry_length
        ['entries' => [['nested']]],
        ['entries' => [42]],
    ] as $bad) {
        qpTextRejects(fn () => $type->validateAnswer($bad, $config, []));
    }
});

it('merges repeat word_cloud submissions only when allowed, up to the cap', function () {
    $type = qpTextWordCloud();
    $config = $type->defaultConfig();
    $t1 = '2026-10-15T10:00:00.000000Z';
    $t2 = '2026-10-15T10:05:00.000000Z';

    $incoming = ['entries' => ['c'], 'entry_times' => [$t2]];
    expect($type->allowsMultipleSubmissions($config))->toBeFalse()
        ->and($type->mergeSubmissions(['entries' => ['a', 'b'], 'entry_times' => [$t1, $t1]], $incoming, $config))->toBe($incoming);

    $multi = ['allow_multiple_submissions' => true] + $config;
    expect($type->allowsMultipleSubmissions($multi))->toBeTrue()
        // 'A' repeats 'a': the earlier spelling and time win.
        ->and($type->mergeSubmissions(['entries' => ['a'], 'entry_times' => [$t1]], ['entries' => ['A', 'b'], 'entry_times' => [$t2, $t2]], $multi))
        ->toBe(['entries' => ['a', 'b'], 'entry_times' => [$t1, $t2]])
        ->and($type->mergeSubmissions(['entries' => ['a', 'b'], 'entry_times' => [$t1, $t1]], $incoming, $multi))
        ->toBe(['entries' => ['a', 'b', 'c'], 'entry_times' => [$t1, $t1, $t2]])
        // Rows stored without entry_times keep a null time (the row time is used when aggregating).
        ->and($type->mergeSubmissions(['entries' => ['a']], $incoming, $multi))
        ->toBe(['entries' => ['a', 'c'], 'entry_times' => [null, $t2]]);

    qpTextRejects(fn () => $type->mergeSubmissions(['entries' => ['a', 'b', 'c']], ['entries' => ['d']], $multi));
});

it('keeps the first time of each word across merged word_cloud submissions', function () {
    $type = qpTextWordCloud();
    $config = ['allow_multiple_submissions' => true] + $type->defaultConfig();

    Carbon::setTestNow(Carbon::parse('2026-10-15 10:00:00', 'UTC'));
    $first = $type->validateAnswer(['entries' => ['Alpha']], $config, []);
    Carbon::setTestNow(Carbon::parse('2026-10-15 10:05:00', 'UTC'));
    $merged = $type->mergeSubmissions($first, $type->validateAnswer(['entries' => ['Beta']], $config, []), $config);

    // updateOrCreate refreshes the row's submitted_at on every submission.
    $mine = qpTextAnswer(1, $merged, '2026-10-15 10:05:00');
    $other = qpTextAnswer(2, ['entries' => ['beta', 'gamma']], '2026-10-15 10:02:00'); // stored before entry_times: row time

    $words = $type->aggregate($config, [], collect([$mine, $other]))['words'];

    expect($words)->toBe([
        ['word' => 'beta', 'count' => 2, 'first_seen_at' => '2026-10-15T10:02:00.000000Z'],
        ['word' => 'alpha', 'count' => 1, 'first_seen_at' => '2026-10-15T10:00:00.000000Z'],
        ['word' => 'gamma', 'count' => 1, 'first_seen_at' => '2026-10-15T10:02:00.000000Z'],
    ]);
});

it('keeps joiners that shape real text in word_cloud entries and strips invisible junk', function () {
    $type = qpTextWordCloud();
    $config = ['max_entries_per_participant' => 6] + $type->defaultConfig();
    $kept = [
        "র\u{200D}্যাব",                                          // Bengali ra-phala with ZWJ
        "می\u{200C}خواهم",                                        // Persian with ZWNJ
        "👨\u{200D}👩\u{200D}👧",                                   // emoji ZWJ family
        "❤\u{FE0F}\u{200D}🔥",                                    // emoji ZWJ with variation selector
        "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}", // subdivision flag (tag characters)
    ];

    $stored = $type->validateAnswer(['entries' => $kept], $config, []);
    expect($stored['entries'])->toBe($kept);

    $words = $type->aggregate($config, [], collect([qpTextAnswer(1, $stored)]))['words'];
    expect(array_column($words, 'word'))->toEqualCanonicalizing($kept);

    expect($type->validateAnswer(['entries' => [
        "pi\u{200B}zza",          // zero-width space
        "\u{202E}kcuf\u{202C}",   // bidi override
        "da\u{200D}rn",           // ZWJ between ASCII letters joins nothing
        "\u{FEFF}he\u{00AD}ck",   // BOM and soft hyphen
        "two\tword\u{2066}s",     // tab and bidi isolate
    ]], $config, [])['entries'])->toBe(['pizza', 'kcuf', 'darn', 'heck', 'two words']);

    // Hidden characters can no longer slip a listed word past the filter.
    $masked = $type->aggregate($config, [], collect([qpTextAnswer(1, ['entries' => ["da\u{200B}rn", "he\u{200D}ck"]])]));
    expect($masked['words'])->toBe([['word' => '****', 'count' => 1, 'first_seen_at' => '2026-10-15T10:00:00.000000Z']]);
});

it('aggregates word_cloud entries normalised, counted once per participant and sorted', function () {
    $type = qpTextWordCloud();
    $config = $type->defaultConfig();
    $answers = collect([
        qpTextAnswer(1, ['entries' => ['Pizza', 'Tacos']], '2026-10-15 10:00:03'),
        qpTextAnswer(2, ['entries' => ['pizza ', 'PIZZA', 'Sushi']], '2026-10-15 10:00:01'),
        qpTextAnswer(3, ['entries' => ['tacos', 'darn']], '2026-10-15 10:00:02'),
        qpTextAnswer(4, ['entries' => ['Heck']], '2026-10-15 10:00:04'),
        qpTextAnswer(5, ['entries' => []], '2026-10-15 10:00:05'), // no entries: not a response
        qpTextAnswer(6, ['garbage' => true]),
    ]);

    $expected = [
        'total_responses' => 4,
        'total_entries' => 7,
        'distinct_words' => 4,
        'truncated' => false,
        'words' => [
            ['word' => 'pizza', 'count' => 2, 'first_seen_at' => '2026-10-15T10:00:01.000000Z'],
            // 'darn' and 'heck' both mask to four asterisks and are counted together;
            // ties on count and first_seen_at fall back to the word itself.
            ['word' => '****', 'count' => 2, 'first_seen_at' => '2026-10-15T10:00:02.000000Z'],
            ['word' => 'tacos', 'count' => 2, 'first_seen_at' => '2026-10-15T10:00:02.000000Z'],
            ['word' => 'sushi', 'count' => 1, 'first_seen_at' => '2026-10-15T10:00:01.000000Z'],
        ],
    ];

    expect($type->aggregate($config, [], $answers))->toBe($expected)
        ->and($type->aggregate($config, [], $answers->reverse()->values()))->toBe($expected);

    $unfiltered = $type->aggregate(['profanity_filter_enabled' => false] + $config, [], $answers);
    expect(array_column($unfiltered['words'], 'word'))->toBe(['pizza', 'tacos', 'sushi', 'darn', 'heck']);
});

it('caps the word_cloud aggregate at MAX_WORDS words', function () {
    $type = qpTextWordCloud();
    $answers = collect(range(1, WordCloudSlideType::MAX_WORDS + 5))
        ->map(fn (int $i) => qpTextAnswer($i, ['entries' => ["w{$i}"]]));

    $aggregate = $type->aggregate($type->defaultConfig(), [], $answers);

    expect($aggregate['words'])->toHaveCount(WordCloudSlideType::MAX_WORDS)
        ->and($aggregate['distinct_words'])->toBe(WordCloudSlideType::MAX_WORDS + 5)
        ->and($aggregate['truncated'])->toBeTrue();

    $few = $type->aggregate($type->defaultConfig(), [], $answers->take(3));
    expect($few['words'])->toHaveCount(3)->and($few['truncated'])->toBeFalse();
});

it('keeps the worst-case word_cloud broadcast under the Reverb request limit', function (int $length, string $char) {
    $type = qpTextWordCloud();
    $config = ['max_entry_length' => 100, 'max_entries_per_participant' => 10] + $type->defaultConfig();
    $answers = collect(range(1, 40))->map(fn (int $p) => qpTextAnswer($p, $type->validateAnswer([
        'entries' => array_map(fn (int $e) => mb_substr(str_repeat($char, $length) . "/\"{$p}x{$e}", -$length), range(1, 10)),
    ], $config, [])));

    $aggregate = $type->aggregate($config, [], $answers);

    expect($aggregate['distinct_words'])->toBe(400)
        ->and($aggregate['truncated'])->toBeTrue()
        ->and($aggregate['words'])->not->toBeEmpty()
        ->and(qpTextBroadcastBytes(qpTextRun('word_cloud', $config), $aggregate))->toBeLessThan(9_000);
})->with([
    'default length, ASCII' => [25, 'w'],
    'default length, Bengali' => [25, 'ক'],
    'max length, Bengali' => [100, 'ক'],
    'max length, emoji' => [100, '🦊'],
]);

it('has the planned open_ended defaults', function () {
    expect(app(SlideTypeRegistry::class)->for('open_ended')->defaultConfig())->toBe([
        'max_length' => 500,
        'max_submissions_per_participant' => 1,
        'profanity_filter_enabled' => true,
        'show_results_to_participants' => false,
    ]);
});

it('rejects bad open_ended config', function (array $config) {
    qpTextRejects(fn () => qpTextOpenEnded()->validateConfig($config));
})->with([
    'length too short' => [['max_length' => 5]],
    'length too long' => [['max_length' => 5000]],
    'submissions zero' => [['max_submissions_per_participant' => 0]],
    'submissions too many' => [['max_submissions_per_participant' => 21]],
    'submissions not int' => [['max_submissions_per_participant' => 'lots']],
    'filter not bool' => [['profanity_filter_enabled' => 'maybe']],
]);

it('validates open_ended answers and stamps the submission time', function () {
    Carbon::setTestNow(Carbon::parse('2026-10-15 09:30:00.250', 'UTC'));
    $type = qpTextOpenEnded();
    $config = ['max_length' => 20] + $type->defaultConfig();

    expect($type->validateAnswer(['text' => "  Line one\r\nline two  "], $config, []))->toBe([
        'entries' => [['body' => "Line one\nline two", 'submitted_at' => '2026-10-15T09:30:00.250000Z']],
    ]);

    foreach ([[], ['text' => ''], ['text' => "  \n "], ['text' => str_repeat('x', 21)], ['text' => ['x']], ['entries' => ['x']]] as $bad) {
        qpTextRejects(fn () => $type->validateAnswer($bad, $config, []));
    }
});

it('merges repeat open_ended submissions up to max_submissions_per_participant', function () {
    $type = qpTextOpenEnded();
    $first = ['entries' => [['body' => 'one', 'submitted_at' => '2026-10-15T10:00:00.000000Z']]];
    $second = ['entries' => [['body' => 'two', 'submitted_at' => '2026-10-15T10:01:00.000000Z']]];

    $single = $type->defaultConfig();
    expect($type->allowsMultipleSubmissions($single))->toBeFalse()
        ->and($type->mergeSubmissions($first, $second, $single))->toBe($second);

    $multi = ['max_submissions_per_participant' => 2] + $single;
    $merged = $type->mergeSubmissions($first, $second, $multi);
    expect($type->allowsMultipleSubmissions($multi))->toBeTrue()
        ->and($merged)->toBe(['entries' => [...$first['entries'], ...$second['entries']]]);

    qpTextRejects(fn () => $type->mergeSubmissions($merged, $second, $multi));
});

it('aggregates open_ended entries newest first with emoji, masked bodies and no names', function () {
    $type = qpTextOpenEnded();
    $config = ['max_submissions_per_participant' => 3] + $type->defaultConfig();
    $answers = collect([
        qpTextAnswer(10, ['entries' => [
            ['body' => 'First idea', 'submitted_at' => '2026-10-15T10:00:00.000000Z'],
            ['body' => 'What the heck', 'submitted_at' => '2026-10-15T10:05:00.000000Z'],
        ]], '2026-10-15 10:05:00', '🦊'),
        qpTextAnswer(11, ['entries' => [['body' => 'Middle', 'submitted_at' => '2026-10-15T10:02:00.000000Z']]], '2026-10-15 10:02:00', '🐼'),
        qpTextAnswer(12, ['entries' => [['body' => 'No stamp']]], '2026-10-15 10:01:00'), // falls back to the row time
        qpTextAnswer(13, ['entries' => [['body' => '   ']]]),
    ]);

    $expected = [
        'total_responses' => 3,
        'total_entries' => 4,
        'page' => 1,
        'per_page' => OpenEndedSlideType::BROADCAST_PER_PAGE,
        'last_page' => 1,
        'truncated' => false,
        'items' => [
            ['id' => '10:1', 'body' => 'What the ****', 'body_truncated' => false, 'participant_emoji' => '🦊', 'submitted_at' => '2026-10-15T10:05:00.000000Z'],
            ['id' => '11:0', 'body' => 'Middle', 'body_truncated' => false, 'participant_emoji' => '🐼', 'submitted_at' => '2026-10-15T10:02:00.000000Z'],
            ['id' => '12:0', 'body' => 'No stamp', 'body_truncated' => false, 'participant_emoji' => null, 'submitted_at' => '2026-10-15T10:01:00.000000Z'],
            ['id' => '10:0', 'body' => 'First idea', 'body_truncated' => false, 'participant_emoji' => '🦊', 'submitted_at' => '2026-10-15T10:00:00.000000Z'],
        ],
    ];

    $aggregate = $type->aggregate($config, [], $answers);
    expect($aggregate)->toBe($expected)
        ->and($type->aggregate($config, [], $answers->reverse()->values()))->toBe($expected)
        ->and(json_encode($aggregate))->not->toContain('Secret Name');

    expect($type->aggregate(['profanity_filter_enabled' => false] + $config, [], $answers)['items'][0]['body'])->toBe('What the heck');

    // Pagination for GET /aggregate?page=N.
    $page = $type->page($config, $answers, 2, 3);
    expect($page['last_page'])->toBe(2)
        ->and($page['page'])->toBe(2)
        ->and($page['truncated'])->toBeFalse()
        ->and(array_column($page['items'], 'id'))->toBe(['10:0'])
        ->and($type->page($config, $answers, 1)['per_page'])->toBe(OpenEndedSlideType::PER_PAGE);
});

it('broadcasts short open_ended previews while page() keeps the full text', function () {
    $type = qpTextOpenEnded();
    $config = ['max_length' => 2000, 'max_submissions_per_participant' => 20] + $type->defaultConfig();
    $long = str_repeat('a', OpenEndedSlideType::PREVIEW_LENGTH - 1) . "👨\u{200D}👩\u{200D}👧 and more";
    $answers = collect(range(1, 12))->map(fn (int $i) => qpTextAnswer($i, ['entries' => [
        ['body' => $i === 12 ? $long : "Card {$i}", 'submitted_at' => sprintf('2026-10-15T10:00:%02d.000000Z', $i)],
    ]]));

    $aggregate = $type->aggregate($config, [], $answers);

    expect($aggregate['items'])->toHaveCount(OpenEndedSlideType::BROADCAST_PER_PAGE)
        ->and($aggregate['last_page'])->toBe(2)
        ->and($aggregate['truncated'])->toBeTrue()
        ->and($aggregate['items'][0]['id'])->toBe('12:0')
        // Cut on a grapheme boundary: the emoji family is never split.
        ->and($aggregate['items'][0]['body'])->toBe(str_repeat('a', OpenEndedSlideType::PREVIEW_LENGTH - 1))
        ->and($aggregate['items'][0]['body_truncated'])->toBeTrue()
        ->and($aggregate['items'][1]['body_truncated'])->toBeFalse();

    $full = $type->page($config, $answers, 1);
    expect($full['items'][0]['body'])->toBe($long)
        ->and($full['items'][0]['body_truncated'])->toBeFalse()
        ->and($full['items'])->toHaveCount(12);
});

it('keeps the worst-case open_ended broadcast under the Reverb request limit', function (int $length, string $char) {
    $type = qpTextOpenEnded();
    $config = ['max_length' => 2000, 'max_submissions_per_participant' => 20] + $type->defaultConfig();
    $answers = collect(range(1, 30))->map(fn (int $i) => qpTextAnswer($i, [
        'entries' => [['body' => str_repeat($char, $length), 'submitted_at' => '2026-10-15T10:00:00.000000Z']],
    ], '2026-10-15 10:00:00', '👩🏽‍🚀'));

    $aggregate = $type->aggregate($config, [], $answers);

    expect($aggregate['total_entries'])->toBe(30)
        ->and($aggregate['items'])->not->toBeEmpty()
        ->and($aggregate['truncated'])->toBeTrue()
        ->and(qpTextBroadcastBytes(qpTextRun('open_ended', $config), $aggregate))->toBeLessThan(9_000);
})->with([
    'default length, ASCII' => [500, 'x'],
    'default length, Bengali' => [500, 'ক'],
    'max length, quotes' => [2000, '"'],
    'max length, emoji' => [2000, '🦊'],
]);

it('strips invisible characters from open_ended text but keeps real joiners', function () {
    $type = qpTextOpenEnded();
    $config = $type->defaultConfig();

    $stored = $type->validateAnswer(['text' => "what the he\u{200B}ck, \u{202E}kcuf\u{202C} and da\u{200D}rn\u{FEFF}"], $config, []);
    expect($stored['entries'][0]['body'])->toBe('what the heck, kcuf and darn')
        ->and($type->aggregate($config, [], collect([qpTextAnswer(1, $stored)]))['items'][0]['body'])->toBe('what the ****, kcuf and ****');

    // Bodies stored before this cleaning are cleaned when aggregated too.
    $legacy = qpTextAnswer(2, ['entries' => [['body' => "sh\u{200B}ush, da\u{2060}rn", 'submitted_at' => '2026-10-15T10:00:00.000000Z']]]);
    expect($type->aggregate($config, [], collect([$legacy]))['items'][0]['body'])->toBe('shush, ****');

    $real = "👨\u{200D}👩\u{200D}👧 می\u{200C}خواهم\nর\u{200D}্যাব\t🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    expect($type->validateAnswer(['text' => $real], $config, [])['entries'][0]['body'])->toBe($real);
});

it('pages a persisted open_ended run with participant emoji loaded', function () {
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->create([
        'type_snapshot' => 'open_ended',
        'config_snapshot' => app(SlideTypeRegistry::class)->for('open_ended')->defaultConfig(),
    ]);
    $participant = DeckParticipant::factory()->create(['deck_session_id' => $run->deck_session_id, 'emoji_avatar' => '🐙']);
    DeckParticipantAnswer::factory()->create([
        'slide_run_id' => $run->id,
        'deck_participant_id' => $participant->id,
        'answer_payload' => ['entries' => [['body' => 'Persisted', 'submitted_at' => '2026-10-15T10:00:00.000000Z']]],
    ]);

    $aggregate = app(SlideTypeRegistry::class)->aggregate($run->fresh());

    expect($aggregate['total_entries'])->toBe(1)
        ->and($aggregate['items'][0]['body'])->toBe('Persisted')
        ->and($aggregate['items'][0]['participant_emoji'])->toBe('🐙');
});
