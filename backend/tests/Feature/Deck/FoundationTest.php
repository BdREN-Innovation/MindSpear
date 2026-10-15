<?php

use App\Deck\Broadcasts\BroadcastPayload;
use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Broadcasts\DeckChannels;
use App\Deck\Slides\AbstractSlideType;
use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\UnknownSlideType;
use App\Deck\Support\ProfanityFilter;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckQaQuestion;
use App\Models\Deck\DeckQaUpvote;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\File;
use App\Models\User;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

beforeEach(function () {
    config(['broadcasting.default' => 'null', 'cache.default' => 'array', 'queue.default' => 'sync']);
});

/** Minimal poll type: counts option ids. Test-only. */
function deckFoundationPollType(string $key = 'fixture_poll', array $products = ['quest']): SlideTypeContract
{
    return new class ($key, $products) extends AbstractSlideType {
        public function __construct(private readonly string $typeKey, private readonly array $typeProducts) {}

        public function key(): string
        {
            return $this->typeKey;
        }

        public function products(): array
        {
            return $this->typeProducts;
        }

        public function category(): string
        {
            return self::CATEGORY_POLL;
        }

        public function revealModel(): string
        {
            return self::REVEAL_LIVE;
        }

        public function aggregate(array $config, array $options, Collection $answers): array
        {
            $counts = array_fill_keys(array_column($options, 'id'), 0);
            foreach ($answers as $answer) {
                $counts[$answer->answer_payload['option_id']]++;
            }

            return ['total_responses' => $answers->count(), 'counts' => $counts];
        }
    };
}

function deckFoundationPayload(string $visibility, string $event = 'fixture.event', array $data = ['value' => 1]): BroadcastPayload
{
    return new class ($visibility, $event, $data) implements BroadcastPayload {
        public function __construct(private string $vis, private string $event, private array $data) {}

        public function eventName(): string
        {
            return $this->event;
        }

        public function visibility(): string
        {
            return $this->vis;
        }

        public function toArray(): array
        {
            return $this->data;
        }
    };
}

function deckFoundationFile(User $owner): File
{
    return File::create([
        'name' => 'cover.png',
        'type' => 'image',
        'category' => File::CATEGORY_IMAGE,
        'visibility' => File::VISIBILITY_PUBLIC,
        'path' => 'storage/library/' . $owner->id . '/images/cover.png',
        'mime_type' => 'image/png',
        'extension' => 'png',
        'size' => 10,
        'user_id' => $owner->id,
    ]);
}

// --- Schema, relations, factories -------------------------------------------

it('creates the whole graph through factories and wires every relation', function () {
    $upvote = DeckQaUpvote::factory()->create();
    $question = $upvote->question;
    $run = $question->run;
    $session = $run->session;

    expect($question->session->is($session))->toBeTrue()
        ->and($upvote->participant->deck_session_id)->toBe($session->id)
        ->and($question->participant->deck_session_id)->toBe($session->id)
        ->and($question->upvotes)->toHaveCount(1)
        ->and($run->qaQuestions->pluck('id')->all())->toBe([$question->id])
        ->and($session->qaQuestions)->toHaveCount(1)
        ->and($session->participants)->toHaveCount(2)
        ->and($session->deck->owner->id)->toBe($session->host_user_id)
        ->and($session->host->id)->toBe($session->host_user_id)
        ->and($session->product())->toBe(Deck::PRODUCT_QUEST);

    $answer = DeckParticipantAnswer::factory()->create(['slide_run_id' => $run->id, 'answer_payload' => ['option_id' => 1]]);
    expect($answer->run->is($run))->toBeTrue()
        ->and($answer->participant->deck_session_id)->toBe($session->id)
        ->and($answer->participant->answers->pluck('id')->all())->toBe([$answer->id])
        ->and($run->answers()->count())->toBe(1)
        ->and($answer->fresh()->answer_payload)->toBe(['option_id' => 1])
        ->and($answer->participant->makeVisible([])->toArray())->not->toHaveKey('participant_token_hash');
});

it('orders slides, options and runs by position and snapshots a slide', function () {
    $deck = Deck::factory()->create();
    $third = Slide::factory()->for($deck)->create(['position' => 3]);
    $first = Slide::factory()->for($deck)->create(['position' => 1]);
    $second = Slide::factory()->for($deck)->create(['position' => 2]);

    expect($deck->slides->pluck('id')->all())->toBe([$first->id, $second->id, $third->id]);

    $b = SlideOption::factory()->for($first)->create(['position' => 2, 'label' => 'B', 'payload' => ['x' => 1]]);
    $a = SlideOption::factory()->for($first)->create(['position' => 1, 'label' => 'A']);
    expect($first->options->pluck('id')->all())->toBe([$a->id, $b->id]);

    $session = DeckSession::factory()->for($deck)->create();
    $run2 = DeckSessionSlideRun::factory()->for($session, 'session')->fromSlide($second)->create();
    $run1 = DeckSessionSlideRun::factory()->for($session, 'session')->fromSlide($first)->create();

    expect($session->runs->pluck('id')->all())->toBe([$run1->id, $run2->id])
        // jsonb does not keep key order, so compare loosely.
        ->and($run1->fresh()->options_snapshot)->toEqual([
            ['id' => $a->id, 'position' => 1, 'label' => 'A', 'image_file_id' => null, 'image_url' => null, 'is_correct' => null, 'payload' => []],
            ['id' => $b->id, 'position' => 2, 'label' => 'B', 'image_file_id' => null, 'image_url' => null, 'is_correct' => null, 'payload' => ['x' => 1]],
        ])
        ->and($run1->fresh()->state)->toBe(DeckSessionSlideRun::STATE_WAITING)
        ->and($run1->fresh()->state_version)->toBe(0);
});

it('stores jsonb with {} defaults and supports @> containment queries', function () {
    $deck = Deck::factory()->create();
    $plain = Slide::factory()->for($deck)->create();
    $tagged = Slide::factory()->for($deck)->create(['config' => ['layout' => 'bars', 'max' => 3]]);

    DB::table('decks')->where('id', $deck->id)->update(['settings' => DB::raw('DEFAULT')]);
    expect(DB::table('decks')->where('id', $deck->id)->value('settings'))->toBe('{}');

    $matches = Slide::where('deck_id', $deck->id)
        ->whereRaw('config @> ?::jsonb', [json_encode(['layout' => 'bars'])])
        ->pluck('id')->all();

    expect($matches)->toBe([$tagged->id])
        ->and($plain->fresh()->config)->toBe([]);

    $run = DeckSessionSlideRun::factory()->create(['config_snapshot' => ['media' => ['file_id' => 7, 'url' => 'https://x/y.png']]]);
    expect(DeckSessionSlideRun::whereKey($run->id)->whereRaw('config_snapshot @> ?::jsonb', ['{"media":{"file_id":7}}'])->exists())->toBeTrue();
});

it('enforces a unique live position per deck but ignores soft-deleted slides', function () {
    $deck = Deck::factory()->create();
    $slide = Slide::factory()->for($deck)->create(['position' => 1]);

    expect(fn () => DB::transaction(fn () => Slide::factory()->for($deck)->create(['position' => 1])))
        ->toThrow(UniqueConstraintViolationException::class);

    $slide->delete();
    $replacement = Slide::factory()->for($deck)->create(['position' => 1]);

    expect($replacement->exists)->toBeTrue()
        ->and(Slide::withTrashed()->where('deck_id', $deck->id)->where('position', 1)->count())->toBe(2)
        ->and($deck->fresh()->slides->pluck('id')->all())->toBe([$replacement->id]);
});

it('allows the negative-position staging trick for reorders', function () {
    $deck = Deck::factory()->create();
    $one = Slide::factory()->for($deck)->create(['position' => 1]);
    $two = Slide::factory()->for($deck)->create(['position' => 2]);

    DB::transaction(function () use ($deck, $one, $two) {
        Slide::where('deck_id', $deck->id)->update(['position' => DB::raw('-position')]);
        Slide::whereKey($one->id)->update(['position' => 2]);
        Slide::whereKey($two->id)->update(['position' => 1]);
    });

    expect($deck->fresh()->slides->pluck('id')->all())->toBe([$two->id, $one->id]);
});

it('enforces one answer per participant per run, unique tokens and join codes', function () {
    $answer = DeckParticipantAnswer::factory()->create();

    expect(fn () => DB::transaction(fn () => DeckParticipantAnswer::factory()->create([
        'slide_run_id' => $answer->slide_run_id,
        'deck_participant_id' => $answer->deck_participant_id,
    ])))->toThrow(UniqueConstraintViolationException::class);

    $participant = $answer->participant;
    expect(fn () => DB::transaction(fn () => DeckParticipant::factory()->create([
        'participant_token_hash' => $participant->participant_token_hash,
    ])))->toThrow(UniqueConstraintViolationException::class);

    $session = $participant->session;
    expect(fn () => DB::transaction(fn () => DeckSession::factory()->create(['join_code' => $session->join_code])))
        ->toThrow(UniqueConstraintViolationException::class);

    $question = DeckQaQuestion::factory()->create();
    $upvote = DeckQaUpvote::factory()->create(['qa_question_id' => $question->id]);
    expect(fn () => DB::transaction(fn () => DeckQaUpvote::create([
        'qa_question_id' => $question->id,
        'participant_id' => $upvote->participant_id,
    ])))->toThrow(UniqueConstraintViolationException::class);
});

it('rejects products and statuses outside the enums', function () {
    expect(fn () => DB::transaction(fn () => Deck::factory()->create(['product' => 'survey'])))
        ->toThrow(Illuminate\Database\QueryException::class);
    expect(fn () => DB::transaction(fn () => DeckSession::factory()->create(['status' => 'paused'])))
        ->toThrow(Illuminate\Database\QueryException::class);
});

it('keeps file references through soft deletes and nulls them on hard delete', function () {
    $owner = DeckFactory::newOwner();
    $file = deckFoundationFile($owner);
    $deck = Deck::factory()->ownedBy($owner)->create(['cover_file_id' => $file->id]);
    $slide = Slide::factory()->for($deck)->create(['type' => 'image', 'media_file_id' => $file->id]);
    $option = SlideOption::factory()->for($slide)->create(['image_file_id' => $file->id]);

    $file->delete(); // My Files delete is a soft delete

    expect($deck->fresh()->coverFile?->id)->toBe($file->id)
        ->and($slide->fresh()->mediaFile?->id)->toBe($file->id)
        ->and($option->fresh()->imageFile?->url)->toBe(url('storage/library/' . $owner->id . '/images/cover.png'));

    $file->forceDelete();

    expect($deck->fresh()->cover_file_id)->toBeNull()
        ->and($slide->fresh()->media_file_id)->toBeNull()
        ->and($option->fresh()->image_file_id)->toBeNull();
});

it('keeps session runs when their authoring slide is deleted', function () {
    $slide = Slide::factory()->create();
    $run = DeckSessionSlideRun::factory()->fromSlide($slide)->create();

    $slide->delete();
    expect($run->fresh()->slide?->id)->toBe($slide->id);

    $slide->forceDelete();
    expect($run->fresh())->not->toBeNull()
        ->and($run->fresh()->slide_id)->toBeNull()
        ->and($run->fresh()->type_snapshot)->toBe('poll_single');
});

it('nulls current_slide_run_id when that run is deleted', function () {
    $run = DeckSessionSlideRun::factory()->create();
    $session = $run->session;
    $session->update(['current_slide_run_id' => $run->id]);

    expect($session->fresh()->currentRun->is($run))->toBeTrue();

    $run->delete();
    expect($session->fresh()->current_slide_run_id)->toBeNull();
});

it('keeps millisecond precision on runtime timestamps', function () {
    $at = now()->setTime(10, 11, 12, 345000);
    $run = DeckSessionSlideRun::factory()->create(['voting_started_at' => $at]);

    expect($run->fresh()->voting_started_at->format('H:i:s.v'))->toBe('10:11:12.345');
});

// --- Scopes -----------------------------------------------------------------

it('filters decks by product and owner', function () {
    $owner = DeckFactory::newOwner();
    $quest = Deck::factory()->ownedBy($owner)->create();
    $quiz = Deck::factory()->ownedBy($owner)->quiz()->create();
    $other = Deck::factory()->create();

    $ids = [$quest->id, $quiz->id, $other->id];

    expect(Deck::quest()->whereIn('id', $ids)->pluck('id')->sort()->values()->all())->toBe(collect([$quest->id, $other->id])->sort()->values()->all())
        ->and(Deck::quiz()->whereIn('id', $ids)->pluck('id')->all())->toBe([$quiz->id])
        ->and(Deck::ownedBy($owner)->orderBy('id')->pluck('id')->all())->toBe([$quest->id, $quiz->id])
        ->and(Deck::ownedBy($owner->id)->quiz()->pluck('id')->all())->toBe([$quiz->id])
        ->and(Deck::forProduct('quiz')->whereIn('id', $ids)->pluck('id')->all())->toBe([$quiz->id]);
});

it('filters live sessions and current runs', function () {
    $live = DeckSession::factory()->live()->create();
    $pending = DeckSession::factory()->create();
    $ended = DeckSession::factory()->ended()->create();

    expect(DeckSession::live()->whereIn('id', [$live->id, $pending->id, $ended->id])->pluck('id')->all())->toBe([$live->id])
        ->and(DeckSession::forProduct('quest')->whereKey($live->id)->exists())->toBeTrue()
        ->and(DeckSession::forProduct('quiz')->whereKey($live->id)->exists())->toBeFalse();

    $first = DeckSessionSlideRun::factory()->for($live, 'session')->create();
    $second = DeckSessionSlideRun::factory()->for($live, 'session')->create();
    $live->update(['current_slide_run_id' => $second->id]);

    $scoped = DeckSessionSlideRun::current()->whereIn('id', [$first->id, $second->id])->get();
    expect($scoped->pluck('id')->all())->toBe([$second->id])
        ->and($scoped->first()->state_version)->toBe(0)
        ->and($second->fresh()->acceptsSubmissions())->toBeFalse()
        ->and(DeckSessionSlideRun::factory()->inState('voting')->create()->acceptsSubmissions())->toBeTrue();
});

// --- Slide type registry ------------------------------------------------------

it('registers, resolves and filters slide types by product', function () {
    $registry = new SlideTypeRegistry();
    $questOnly = deckFoundationPollType('fixture_poll');
    $shared = deckFoundationPollType('fixture_shared', ['quest', 'quiz']);
    $registry->register($shared);
    $registry->register($questOnly);

    expect($registry->has('fixture_poll'))->toBeTrue()
        ->and($registry->has('nope'))->toBeFalse()
        ->and($registry->for('fixture_poll'))->toBe($questOnly)
        ->and($registry->keys())->toBe(['fixture_poll', 'fixture_shared'])
        ->and(array_keys($registry->forProduct('quest')))->toBe(['fixture_poll', 'fixture_shared'])
        ->and(array_keys($registry->forProduct('quiz')))->toBe(['fixture_shared'])
        ->and($registry->forProduct('survey'))->toBe([]);

    expect(fn () => $registry->for('nope'))->toThrow(UnknownSlideType::class, 'Unknown slide type [nope].');
    expect(fn () => $registry->register(deckFoundationContentType()))->toThrow(LogicException::class);
});

/** A different class claiming an already registered key. */
function deckFoundationContentType(): SlideTypeContract
{
    return new class () extends AbstractSlideType {
        public function key(): string
        {
            return 'fixture_poll';
        }

        public function category(): string
        {
            return self::CATEGORY_CONTENT;
        }

        public function revealModel(): string
        {
            return self::REVEAL_NONE;
        }
    };
}

it('aggregates a run from its snapshots and loads answers itself', function () {
    $registry = new SlideTypeRegistry();
    $registry->register(deckFoundationPollType());

    $run = DeckSessionSlideRun::factory()->create([
        'type_snapshot' => 'fixture_poll',
        'options_snapshot' => [['id' => 10, 'position' => 1, 'label' => 'A', 'payload' => []], ['id' => 11, 'position' => 2, 'label' => 'B', 'payload' => []]],
    ]);
    DeckParticipantAnswer::factory()->count(2)->create(['slide_run_id' => $run->id, 'answer_payload' => ['option_id' => 11]]);
    DeckParticipantAnswer::factory()->create(['slide_run_id' => $run->id, 'answer_payload' => ['option_id' => 10]]);

    expect($registry->aggregate($run))->toBe(['total_responses' => 3, 'counts' => [10 => 1, 11 => 2]])
        ->and($registry->aggregate($run, collect()))->toBe(['total_responses' => 0, 'counts' => [10 => 0, 11 => 0]]);

    $run->update(['type_snapshot' => 'gone']);
    expect(fn () => $registry->aggregate($run))->toThrow(UnknownSlideType::class);
});

it('discovers concrete types recursively and skips everything else', function () {
    $dir = sys_get_temp_dir() . '/deck-discovery-' . getmypid() . '-' . uniqid();
    @mkdir($dir . '/Nested', 0777, true);
    $ns = 'Tests\\DeckDiscovery' . str_replace('.', '', uniqid('', true));

    file_put_contents($dir . '/TopType.php', "<?php namespace {$ns}; class TopType extends \\App\\Deck\\Slides\\AbstractSlideType { public function key(): string { return 'top'; } public function category(): string { return 'poll'; } public function revealModel(): string { return 'live_aggregate'; } }");
    file_put_contents($dir . '/Nested/DeepType.php', "<?php namespace {$ns}\\Nested; class DeepType extends \\App\\Deck\\Slides\\AbstractSlideType { public function key(): string { return 'deep'; } public function products(): array { return ['quest', 'quiz']; } public function category(): string { return 'content'; } public function revealModel(): string { return 'none'; } public function acceptsAnswers(): bool { return false; } }");
    file_put_contents($dir . '/BaseType.php', "<?php namespace {$ns}; abstract class BaseType extends \\App\\Deck\\Slides\\AbstractSlideType {}");
    file_put_contents($dir . '/Helper.php', "<?php namespace {$ns}; class Helper {}");

    $autoload = function (string $class) use ($ns, $dir) {
        if (str_starts_with($class, $ns . '\\')) {
            $path = $dir . '/' . str_replace('\\', '/', substr($class, strlen($ns) + 1)) . '.php';
            if (is_file($path)) {
                require $path;
            }
        }
    };
    spl_autoload_register($autoload);

    try {
        $classes = SlideTypeRegistry::discover($dir, $ns);
        expect($classes)->toBe(["{$ns}\\Nested\\DeepType", "{$ns}\\TopType"]);
        expect(SlideTypeRegistry::discover($dir . '/missing', $ns))->toBe([]);
    } finally {
        spl_autoload_unregister($autoload);
        array_map('unlink', [$dir . '/TopType.php', $dir . '/Nested/DeepType.php', $dir . '/BaseType.php', $dir . '/Helper.php']);
        @rmdir($dir . '/Nested');
        @rmdir($dir);
    }
});

it('binds a singleton registry holding every type under app/Deck/Slides/Types', function () {
    $registry = app(SlideTypeRegistry::class);
    $expected = collect(SlideTypeRegistry::discover(app_path('Deck/Slides/Types'), 'App\\Deck\\Slides\\Types'))
        ->map(fn (string $class) => app($class)->key())
        ->sort()->values()->all();

    expect(app(SlideTypeRegistry::class))->toBe($registry)
        ->and($registry->keys())->toBe($expected);

    foreach ($registry->all() as $key => $type) {
        expect($type->key())->toBe($key)
            ->and($type->category())->toBeIn(['poll', 'interactive', 'content'])
            ->and($type->revealModel())->toBeIn([
                SlideTypeContract::REVEAL_LIVE,
                SlideTypeContract::REVEAL_HIDDEN,
                SlideTypeContract::REVEAL_MODERATED,
                SlideTypeContract::REVEAL_NONE,
            ]);
    }
});

it('gives sensible defaults and never leaks answer keys or aggregates to participants', function () {
    $type = deckFoundationPollType();
    $run = DeckSessionSlideRun::factory()->inState('voting')->create([
        'type_snapshot' => 'fixture_poll',
        'title_snapshot' => 'Favourite colour?',
        'config_snapshot' => ['layout' => 'bars', 'correct_option_ids' => [1], '_internal' => 'x', 'answer_key' => 'a'],
        'options_snapshot' => [
            ['id' => 1, 'position' => 1, 'label' => 'Red', 'image_file_id' => 5, 'image_url' => 'https://x/r.png', 'is_correct' => true, 'payload' => ['correct_order_index' => 0, 'color' => '#f00']],
        ],
    ]);

    $view = $type->serializeForParticipant($run);

    expect($view)->not->toHaveKey('aggregate')
        ->and($view['type'])->toBe('fixture_poll')
        ->and($view['title'])->toBe('Favourite colour?')
        ->and($view['state'])->toBe('voting')
        ->and($view['config'])->toBe(['layout' => 'bars'])
        ->and($view['options'])->toBe([['id' => 1, 'position' => 1, 'label' => 'Red', 'image_url' => 'https://x/r.png', 'payload' => ['color' => '#f00']]])
        ->and(json_encode($view))->not->toContain('is_correct');

    $presenter = $type->serializeForPresenter($run, ['total_responses' => 4]);
    expect($presenter['aggregate'])->toBe(['total_responses' => 4])
        ->and(Illuminate\Support\Arr::except($presenter, 'aggregate'))->toBe($view);

    $score = $type->score([], [], [], 1000);
    expect($score)->toEqual(ScoreResult::zero())
        ->and($score->pointsAwarded)->toBe(0)
        ->and($score->isCorrect)->toBeNull()
        ->and($score->partialCreditRatio)->toBeNull()
        ->and($type->acceptsAnswers())->toBeTrue()
        ->and($type->defaultOptions())->toBe([])
        ->and($type->validateConfig(['a' => 1]))->toBe(['a' => 1])
        ->and($type->validateAnswer(['option_id' => 1], [], []))->toBe(['option_id' => 1]);

    $content = deckFoundationContentType();
    $contentWithNoAnswers = new class () extends AbstractSlideType {
        public function key(): string
        {
            return 'fixture_content';
        }

        public function category(): string
        {
            return self::CATEGORY_CONTENT;
        }

        public function revealModel(): string
        {
            return self::REVEAL_NONE;
        }

        public function acceptsAnswers(): bool
        {
            return false;
        }
    };
    expect($content->products())->toBe(['quest']);
    expect(fn () => $contentWithNoAnswers->validateAnswer(['x' => 1], [], []))
        ->toThrow(Illuminate\Validation\ValidationException::class);
});

// --- Broadcasting ---------------------------------------------------------------

it('builds LiveBroadcastEvent from payloads with channel privacy by visibility', function () {
    $public = LiveBroadcastEvent::fromPayload(deckFoundationPayload('public', 'slide.changed', ['slide_run_id' => 3]), 'session.quest.abc', ['module' => 'quest']);
    $host = LiveBroadcastEvent::fromPayload(deckFoundationPayload('host', 'answer.submitted'), 'host.quest.v2.9');

    expect($public->broadcastOn())->not->toBeInstanceOf(PrivateChannel::class)
        ->and($public->broadcastOn()->name)->toBe('session.quest.abc')
        ->and($public->broadcastAs())->toBe('slide.changed')
        ->and($public->broadcastWith())->toBe(['module' => 'quest', 'slide_run_id' => 3, 'event' => 'slide.changed'])
        ->and($public->shouldBroadcastNow())->toBeFalse()
        ->and($host->broadcastOn())->toBeInstanceOf(PrivateChannel::class)
        ->and($host->broadcastOn()->name)->toBe('private-host.quest.v2.9')
        ->and($host->isPrivate())->toBeTrue();

    // Payload keys win over meta.
    $clash = LiveBroadcastEvent::fromPayload(deckFoundationPayload('public', 'x', ['session_id' => 1]), 'c', ['session_id' => 2], now: true);
    expect($clash->broadcastWith()['session_id'])->toBe(1)
        ->and($clash->shouldBroadcastNow())->toBeTrue();

    // Legacy constructor unchanged.
    $legacy = new LiveBroadcastEvent('host.quest.5', 'answer.submitted', ['a' => 1], true);
    expect($legacy->broadcastOn())->toBeInstanceOf(PrivateChannel::class)
        ->and($legacy->broadcastWith())->toBe(['a' => 1])
        ->and($legacy->shouldBroadcastNow())->toBeFalse();
});

it('names deck channels per product', function () {
    $quest = DeckSession::factory()->create(['public_channel_key' => 'k' . uniqid()]);
    $quiz = DeckSession::factory()->for(Deck::factory()->quiz())->create();
    $channels = app(DeckChannels::class);

    expect($channels->publicChannel($quest))->toBe("session.quest.{$quest->public_channel_key}")
        ->and($channels->hostChannel($quest))->toBe("host.quest.v2.{$quest->id}")
        ->and($channels->publicChannel($quiz))->toBe("session.quiz.{$quiz->public_channel_key}")
        ->and($channels->hostChannel($quiz))->toBe("host.quiz.v2.{$quiz->id}");
});

it('routes host payloads only to the host channel and public ones only to the public channel', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $session = DeckSession::factory()->live()->create();
    $broadcaster = app(DeckBroadcaster::class);

    $broadcaster->broadcast($session, deckFoundationPayload('public', 'slide.changed', ['slide_run_id' => 1]));
    $broadcaster->broadcast($session, deckFoundationPayload('host', 'answer.submitted', ['participant_id' => 2]));

    $events = Event::dispatched(LiveBroadcastEvent::class)->map(fn ($call) => $call[0]);
    expect($events)->toHaveCount(2);

    [$public, $host] = $events->all();
    expect($public->broadcastAs())->toBe('slide.changed')
        ->and($public->broadcastOn()->name)->toBe("session.quest.{$session->public_channel_key}")
        ->and($public->isPrivate())->toBeFalse()
        ->and($public->shouldBroadcastNow())->toBeTrue()
        ->and($public->broadcastWith())->toMatchArray(['slide_run_id' => 1, 'module' => 'quest', 'session_id' => $session->id, 'event' => 'slide.changed'])
        ->and($public->broadcastWith())->toHaveKey('broadcasted_at')
        ->and($host->broadcastAs())->toBe('answer.submitted')
        ->and($host->broadcastOn())->toBeInstanceOf(PrivateChannel::class)
        ->and($host->broadcastOn()->name)->toBe("private-host.quest.v2.{$session->id}");

    expect(fn () => $broadcaster->broadcast($session, deckFoundationPayload('everyone')))->toThrow(InvalidArgumentException::class);
});

it('broadcasts only after the surrounding transaction commits', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $session = DeckSession::factory()->live()->create();
    $broadcaster = app(DeckBroadcaster::class);

    DB::transaction(function () use ($broadcaster, $session) {
        $broadcaster->broadcast($session, deckFoundationPayload('public', 'slide.changed'));
        Event::assertNotDispatched(LiveBroadcastEvent::class);
    });
    Event::assertDispatchedTimes(LiveBroadcastEvent::class, 1);

    try {
        DB::transaction(function () use ($broadcaster, $session) {
            $broadcaster->broadcast($session, deckFoundationPayload('public', 'slide.rolled_back'));
            throw new RuntimeException('rollback');
        });
    } catch (RuntimeException) {
    }
    Event::assertDispatchedTimes(LiveBroadcastEvent::class, 1);
    Event::assertNotDispatched(LiveBroadcastEvent::class, fn ($event) => $event->broadcastAs() === 'slide.rolled_back');
});

it('authorises the v2 host channel for the session host only', function () {
    config([
        'broadcasting.default' => 'reverb',
        'broadcasting.connections.reverb.key' => 'local',
        'broadcasting.connections.reverb.secret' => 'local-secret',
        'broadcasting.connections.reverb.app_id' => 'local',
    ]);
    $session = DeckSession::factory()->create();
    $host = User::find($session->host_user_id);
    $stranger = DeckFactory::newOwner();

    $auth = fn (string $channel) => $this->postJson('/broadcasting/auth', [
        'socket_id' => '123.456',
        'channel_name' => "private-{$channel}",
    ]);

    Sanctum::actingAs($host);
    $auth("host.quest.v2.{$session->id}")->assertOk()->assertJsonStructure(['auth']);
    $auth("host.quiz.v2.{$session->id}")->assertForbidden();

    Sanctum::actingAs($stranger);
    $auth("host.quest.v2.{$session->id}")->assertForbidden();
});

// --- Profanity filter --------------------------------------------------------

it('masks whole listed words case-insensitively and leaves the rest alone', function () {
    $filter = new ProfanityFilter(['damn', 'shit', 'ass', 'merde']);

    expect($filter->mask('Damn it, SHIT happens!'))->toBe('**** it, **** happens!')
        ->and($filter->contains('What a classic assessment'))->toBeFalse()
        ->and($filter->mask('What a classic assessment'))->toBe('What a classic assessment')
        ->and($filter->contains('kiss my ASS'))->toBeTrue()
        ->and($filter->mask('Ça, c’est de la MERDE 💩'))->toBe('Ça, c’est de la ***** 💩')
        ->and($filter->contains('merdeé'))->toBeFalse()
        ->and($filter->contains('shit_happens'))->toBeFalse()
        ->and($filter->mask(''))->toBe('')
        ->and($filter->mask("bad \xC3\x28 damn"))->toContain('****');

    $empty = new ProfanityFilter([]);
    expect($empty->contains('damn'))->toBeFalse()
        ->and($empty->mask('damn'))->toBe('damn');
});

it('reads its default list from config', function () {
    config(['deck.profanity' => ['Bloop']]);
    $filter = new ProfanityFilter();

    expect($filter->mask('bloop and BLOOP but not bloops'))->toBe('***** and ***** but not bloops')
        ->and(app(ProfanityFilter::class))->toBeInstanceOf(ProfanityFilter::class)
        ->and(config('deck.aggregate_debounce_ms'))->toBe(500)
        ->and(config('deck.qa_upvote_debounce_ms'))->toBe(200)
        ->and(config('deck.default_get_ready_seconds'))->toBe(5);
});
