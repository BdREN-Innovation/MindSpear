<?php

namespace App\Deck\Legacy;

use App\Deck\Authoring\DeckAuthoringService;
use App\Deck\Authoring\SlideAuthoringService;
use App\Models\Deck\Deck;
use App\Models\Deck\Slide;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Copies legacy v1 quizzes (`quizes` + `questions`) and quests (`quests` + `quest_tasks`)
 * into decks of the same owner, through the editor's own services, so every slide passes
 * the same validation as one made by hand. The legacy tables are only read.
 *
 * Each source is converted in its own transaction, together with its LegacyDeckImport row;
 * a dry run rolls it back, so it checks exactly what a real run would write.
 */
class LegacyDeckConverter
{
    public const VISIBILITY_PRIVATE = 'private';

    public const VISIBILITY_KEEP = 'keep';

    public function __construct(
        private readonly DeckAuthoringService $decks,
        private readonly SlideAuthoringService $slides,
    ) {}

    /** Not soft-deleted legacy quiz ids, oldest first. */
    public function quizIds(): array
    {
        return DB::table('quizes')->whereNull('deleted_at')->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all();
    }

    /** Not soft-deleted legacy quest ids, oldest first. */
    public function questIds(): array
    {
        return DB::table('quests')->whereNull('deleted_at')->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all();
    }

    /**
     * @return array{source:string, id:int, title:?string, owner_id:?int, status:string, deck_id:?int,
     *               slides:int, skipped:list<array>, notes:list<string>, error:?string}
     *   status: converted | already | missing | failed
     */
    public function convert(string $source, int $id, bool $dryRun = false, string $visibility = self::VISIBILITY_PRIVATE): array
    {
        $quiz = $source === LegacyDeckImport::SOURCE_QUIZ;
        $row = DB::table($quiz ? 'quizes' : 'quests')->where('id', $id)->whereNull('deleted_at')->first();
        $report = [
            'source' => $source, 'id' => $id, 'title' => $row->title ?? null,
            'owner_id' => $row ? (int) ($quiz ? $row->user_id : $row->creator_id) : null,
            'status' => 'failed', 'deck_id' => null, 'slides' => 0, 'skipped' => [], 'notes' => [], 'error' => null,
        ];

        if ($row === null) {
            return ['status' => 'missing', 'error' => 'not found or deleted'] + $report;
        }
        if ($existing = LegacyDeckImport::query()->where('source_type', $source)->where('source_id', $id)->first()) {
            return ['status' => 'already', 'deck_id' => $existing->deck_id, 'slides' => $existing->slides_created] + $report;
        }
        $owner = User::query()->find($report['owner_id']);
        if ($owner === null) {
            return ['error' => "owner #{$report['owner_id']} not found"] + $report;
        }

        DB::beginTransaction();
        try {
            $report = $this->write($quiz, $row, $owner, $visibility, $report);
            $dryRun ? DB::rollBack() : DB::commit();
        } catch (Throwable $e) {
            DB::rollBack();

            return ['status' => 'failed', 'deck_id' => null, 'slides' => 0, 'error' => self::message($e)] + $report;
        }

        return $report;
    }

    private function write(bool $quiz, object $row, User $owner, string $visibility, array $report): array
    {
        $product = $quiz ? Deck::PRODUCT_QUIZ : Deck::PRODUCT_QUEST;
        $deck = $this->decks->create($owner, $product, [
            'title' => $row->title,
            'description' => self::description($row->description ?? null),
            'visibility' => $visibility === self::VISIBILITY_KEEP && ($row->visibility ?? null) === Deck::VISIBILITY_PUBLIC
                ? Deck::VISIBILITY_PUBLIC
                : Deck::VISIBILITY_PRIVATE,
        ]);

        // Map every question / task; keep the slide data and why the others were left out.
        $prepared = [];
        foreach ($this->items($quiz, (int) $row->id) as $position => $item) {
            $mapped = $quiz ? LegacySlides::fromQuestion((array) $item) : LegacySlides::fromTask((array) $item);
            $legacyType = $quiz ? $item->question_type : $item->task_type;
            if (isset($mapped['skip'])) {
                $report['skipped'][] = ['position' => $position + 1, 'type' => $legacyType, 'reason' => $mapped['skip']];

                continue;
            }
            foreach ($mapped['notes'] as $note) {
                $report['notes'][] = 'question ' . ($position + 1) . ": {$note}";
            }
            $prepared[] = $mapped + ['position' => $position + 1, 'legacy_type' => $legacyType];
        }

        $created = $this->addSlides($deck, $prepared, $report);

        // Same dates as the original, so the library lists it where the owner expects.
        DB::table('decks')->where('id', $deck->id)->update([
            'created_at' => $row->created_at ?? now(),
            'updated_at' => $row->updated_at ?? $row->created_at ?? now(),
        ]);

        LegacyDeckImport::query()->create([
            'source_type' => $report['source'],
            'source_id' => (int) $row->id,
            'deck_id' => $deck->id,
            'slides_created' => $created,
            'skipped' => $report['skipped'] ?: null,
        ]);

        return ['status' => 'converted', 'deck_id' => $deck->id, 'slides' => $created] + $report;
    }

    /** The source's live questions / tasks in their order. */
    private function items(bool $quiz, int $id): array
    {
        return $quiz
            ? DB::table('questions')->where('quiz_id', $id)->whereNull('deleted_at')
                ->orderByRaw('serial_number NULLS LAST')->orderBy('id')
                ->get(['id', 'question_type', 'question_text', 'options', 'time_limit_seconds'])->all()
            : DB::table('quest_tasks')->where('quest_id', $id)->whereNull('deleted_at')
                ->orderByRaw('serial_number NULLS LAST')->orderBy('id')
                ->get(['id', 'task_type', 'title', 'description', 'task_data'])->all();
    }

    /**
     * Appends the slides in bulk (all-or-nothing per batch). If a batch is refused, its slides
     * are added one by one so a single bad question is reported instead of losing the rest.
     */
    private function addSlides(Deck $deck, array $prepared, array &$report): int
    {
        $count = 0;
        foreach (array_chunk($prepared, SlideAuthoringService::MAX_BULK) as $batch) {
            try {
                $count += $this->append($deck, $batch);
            } catch (ValidationException) {
                foreach ($batch as $item) {
                    try {
                        $count += $this->append($deck, [$item]);
                    } catch (ValidationException $e) {
                        $report['skipped'][] = ['position' => $item['position'], 'type' => $item['legacy_type'], 'reason' => self::message($e)];
                    }
                }
            }
        }

        return $count;
    }

    private function append(Deck $deck, array $items): int
    {
        $created = $this->slides->bulk($deck, array_column($items, 'slide'));

        foreach ($created->values() as $index => $slide) {
            $seconds = $items[$index]['time_limit'] ?? null;
            if ($seconds !== null) {
                /** @var Slide $slide */
                $slide->setRelation('deck', $deck);
                $this->slides->update($slide, ['time_limit_seconds' => $seconds]);
            }
        }

        return $created->count();
    }

    private static function description(?string $text): ?string
    {
        $text = trim((string) $text);

        return $text === '' ? null : $text;
    }

    private static function message(Throwable $e): string
    {
        if ($e instanceof ValidationException) {
            return collect($e->errors())->map(fn ($messages, $key) => "{$key}: " . implode(' ', (array) $messages))->implode('; ');
        }

        return $e->getMessage();
    }
}
