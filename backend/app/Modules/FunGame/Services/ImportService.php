<?php

namespace App\Modules\FunGame\Services;

use App\Models\Quiz\Question;
use App\Models\Quiz\Quiz;
use App\Models\User;
use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameImport;
use App\Modules\FunGame\Models\FunGameQuestion;
use App\Modules\FunGame\Models\FunGameSession;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Turns outside questions into Fun Games questions, which the game then owns.
 *
 * Sources: a My Library quiz (copied; editing either afterwards doesn't touch
 * the other) and the JSON v1 file format. Every source is previewed as rows
 * with status ready / check / error / skipped before anything is saved, and
 * every applied import can be undone until the game is played again.
 */
class ImportService
{
    public const MAX_QUESTIONS = 500;

    public const MAX_OPTIONS = 10;

    /** Library types that are single-answer already. */
    private const SINGLE_TYPES = ['quiz_single_choice', 'single_choice', 'true_false_choice', 'true_false'];

    /** Library types that import when exactly one answer is marked correct. */
    private const CONVERTIBLE_TYPES = [
        'quiz_multiple_choice', 'multiple_choice',
        'fill_in_the_blanks_choice', 'fill_in_the_blanks_multiple_choice', 'fill_in_the_blanks',
    ];

    private const TYPE_LABELS = [
        'quiz_single_choice' => 'Single choice',
        'single_choice' => 'Single choice',
        'true_false_choice' => 'True / false',
        'true_false' => 'True / false',
        'quiz_multiple_choice' => 'Multiple choice',
        'multiple_choice' => 'Multiple choice',
        'fill_in_the_blanks_choice' => 'Fill in the blanks',
        'fill_in_the_blanks_multiple_choice' => 'Fill in the blanks',
        'fill_in_the_blanks' => 'Fill in the blanks',
        'sort_answer_choice' => 'Sort answer',
        'sort_answer' => 'Sort answer',
        'short_answer' => 'Short answer',
        'short_answer_choice' => 'Short answer',
    ];

    public function __construct(private readonly FunGameLogger $logger) {}

    // ------------------------------------------------------------------ My Library

    /** The host's own library quizzes, newest first. */
    public function libraryQuizzes(User $user): Collection
    {
        return Quiz::query()
            ->where('user_id', $user->id)
            ->whereNull('deleted_at')
            ->withCount('questions')
            ->latest('updated_at')
            ->limit(200)
            ->get(['id', 'title', 'description', 'updated_at'])
            ->map(fn (Quiz $quiz) => [
                'id' => (string) $quiz->id,
                'title' => $quiz->title ?: 'Untitled quiz',
                'description' => $this->clean($quiz->description ?? ''),
                'questionCount' => (int) $quiz->questions_count,
                'updatedAt' => TimerService::iso($quiz->updated_at),
            ]);
    }

    public function ownedLibraryQuiz(User $user, int|string $quizId): Quiz
    {
        $quiz = Quiz::query()
            ->whereKey($quizId)
            ->where('user_id', $user->id)
            ->whereNull('deleted_at')
            ->first();
        if (! $quiz) {
            throw FunGameException::notFound('Quiz not found in your library.');
        }

        return $quiz;
    }

    /**
     * Converts a library quiz. Questions that can't be played as single choice are
     * reported as "skipped" with the reason; they never block the import.
     *
     * @return array{rows: list<array>, questions: list<array>, suggestedTimer: array}
     */
    public function fromLibrary(Quiz $quiz, float $defaultMarks, float $defaultNegative): array
    {
        $source = $quiz->questions()->orderBy('serial_number')->orderBy('id')->get();
        $rows = [];
        $questions = [];
        $limits = [];

        foreach ($source->values() as $i => $q) {
            [$question, $row] = $this->convertLibraryQuestion($q, $i, $defaultMarks, $defaultNegative);
            $rows[] = $row;
            if ($question) {
                $questions[] = $question;
                if ($q->time_limit_seconds) {
                    $limits[] = (int) $q->time_limit_seconds;
                }
            }
        }

        $perQuestion = $this->mostCommon($limits) ?? 30;
        $perQuestion = max(TimerService::PER_QUESTION_MIN, min(TimerService::PER_QUESTION_MAX, $perQuestion));
        foreach ($questions as &$question) {
            if ($question['seconds_override'] === $perQuestion) {
                $question['seconds_override'] = null;
            }
        }
        unset($question);

        $total = $limits ? array_sum($limits) : count($questions) * $perQuestion;
        $total = (int) (ceil(max(TimerService::TOTAL_MIN, min(TimerService::TOTAL_MAX, $total)) / 60) * 60);

        return [
            'rows' => $rows,
            'questions' => $questions,
            'suggestedTimer' => [
                'mode' => 'perQuestion',
                'secondsPerQuestion' => $perQuestion,
                'totalSeconds' => $total,
            ],
        ];
    }

    /** @return array{0: ?array, 1: array} the converted question (or null) and its preview row */
    private function convertLibraryQuestion(Question $q, int $index, float $defaultMarks, float $defaultNegative): array
    {
        $type = (string) $q->question_type;
        $text = $this->clean((string) $q->question_text);
        $row = [
            'index' => $index,
            'position' => $index + 1,
            'text' => Str::limit($text, 160),
            'type' => self::TYPE_LABELS[$type] ?? ($type !== '' ? Str::headline($type) : 'Unknown'),
            'status' => 'ready',
            'messages' => [],
            'optionCount' => 0,
        ];
        $skip = function (string $reason) use ($row) {
            $row['status'] = 'skipped';
            $row['messages'][] = $reason;

            return [null, $row];
        };

        if (! in_array($type, self::SINGLE_TYPES, true) && ! in_array($type, self::CONVERTIBLE_TYPES, true)) {
            return $skip(($row['type']) . ' questions can\'t be played in Fun Games.');
        }
        if ($text === '') {
            return $skip('The question text is empty.');
        }

        $choices = is_array($q->options['choices'] ?? null) ? $q->options['choices'] : [];
        $options = [];
        $idByIndex = [];
        foreach (array_values($choices) as $choiceIndex => $choice) {
            $choiceText = $this->clean((string) ($choice ?? ''));
            if ($choiceText === '') {
                continue;
            }
            $id = 'o' . (count($options) + 1);
            $options[] = ['id' => $id, 'text' => Str::limit($choiceText, 500, '')];
            $idByIndex[$choiceIndex] = $id;
        }
        $row['optionCount'] = count($options);

        $correct = $q->options['correct_answer'] ?? null;
        $correct = is_array($correct) ? array_values(array_filter($correct, 'is_numeric')) : (is_numeric($correct) ? [$correct] : []);
        $correct = array_map('intval', $correct);

        if (count($options) < 2) {
            return $skip('Needs at least two answer options.');
        }
        if (count($options) > self::MAX_OPTIONS) {
            return $skip('Has more than ' . self::MAX_OPTIONS . ' answer options.');
        }
        if (count($correct) === 0) {
            return $skip('No correct answer is marked.');
        }
        if (count($correct) > 1) {
            return $skip('Has ' . count($correct) . ' correct answers — Fun Games questions have exactly one.');
        }
        if (! isset($idByIndex[$correct[0]])) {
            return $skip('The correct answer is blank.');
        }

        if (in_array($type, self::CONVERTIBLE_TYPES, true)) {
            $row['status'] = 'check';
            $row['messages'][] = 'Imported as single choice.';
        }

        $limit = $q->time_limit_seconds ? (int) $q->time_limit_seconds : null;
        $question = [
            'type' => FunGameQuestion::TYPE_SINGLE_CHOICE,
            'text' => Str::limit($text, 2000, ''),
            'image_url' => $this->imageUrl($q->source_content_url),
            'options' => $options,
            'correct_option_id' => $idByIndex[$correct[0]],
            'marks' => $q->points && $q->points > 0 ? (float) $q->points : $defaultMarks,
            'negative_marks' => $defaultNegative,
            'seconds_override' => $limit && $limit >= TimerService::PER_QUESTION_MIN && $limit <= TimerService::PER_QUESTION_MAX ? $limit : null,
        ];

        return [$question, $row];
    }

    // ------------------------------------------------------------------ JSON v1

    /**
     * Validates JSON v1 questions (the client validates the same rules for its preview).
     *
     * @return array{rows: list<array>, questions: list<?array>}
     */
    public function fromJson(array $items, FunGame $game, string $mode): array
    {
        $existing = $mode === 'append'
            ? $game->questions()->pluck('text')->map(fn ($t) => $this->key($t))->values()->all()
            : [];
        $seen = [];
        $rows = [];
        $questions = [];

        foreach (array_values($items) as $i => $item) {
            $messages = [];
            $status = 'ready';
            $error = function (string $message) use (&$messages, &$status) {
                $status = 'error';
                $messages[] = $message;
            };
            $item = is_array($item) ? $item : [];
            $text = is_string($item['text'] ?? null) ? trim($item['text']) : '';
            $type = $item['type'] ?? null;

            if ($type === null) {
                $error('"type" is missing.');
            } elseif ($type !== 'single_choice') {
                $error('Unknown type "' . (is_scalar($type) ? $type : gettype($type)) . '". Only "single_choice" is supported.');
            }
            if ($text === '') {
                $error('"text" is empty.');
            } elseif (mb_strlen($text) > 2000) {
                $error('"text" is longer than 2000 characters.');
            }

            $options = $item['options'] ?? null;
            $validOptions = is_array($options) && array_is_list($options)
                && collect($options)->every(fn ($o) => is_string($o) && trim($o) !== '');
            if (! $validOptions) {
                $error('"options" must be a list of non-empty strings.');
            } elseif (count($options) < 2) {
                $error('Needs at least 2 options.');
            } elseif (count($options) > self::MAX_OPTIONS) {
                $error('At most ' . self::MAX_OPTIONS . ' options.');
            }

            $answer = $item['answer'] ?? null;
            if (! is_int($answer)) {
                $error('"answer" must be the 0-based index of the correct option.');
            } elseif ($validOptions && ($answer < 0 || $answer >= count($options))) {
                $error('"answer" is ' . $answer . ' but there are only ' . count($options) . ' options (0–' . (count($options) - 1) . ').');
            }

            foreach (['marks', 'negative'] as $field) {
                if (array_key_exists($field, $item) && $item[$field] !== null && (! is_numeric($item[$field]) || $item[$field] < 0)) {
                    $error('"' . $field . '" must be a number of 0 or more.');
                }
            }
            $image = $item['image'] ?? null;
            if ($image !== null && (! is_string($image) || ! filter_var($image, FILTER_VALIDATE_URL))) {
                $error('"image" must be a URL or null.');
            }

            if ($status !== 'error') {
                if (! array_key_exists('marks', $item) || $item['marks'] === null) {
                    $status = 'check';
                    $messages[] = 'No marks — the game default (' . $game->default_marks . ') is used.';
                }
                $key = $this->key($text);
                if (($dup = array_search($key, $existing, true)) !== false) {
                    $status = 'check';
                    $messages[] = 'Looks like a duplicate of question ' . ($dup + 1) . ' already in this game.';
                } elseif (isset($seen[$key])) {
                    $status = 'check';
                    $messages[] = 'Same text as row ' . ($seen[$key] + 1) . ' in this file.';
                }
                $seen[$key] ??= $i;
            }

            $rows[] = [
                'index' => $i,
                'position' => $i + 1,
                'text' => Str::limit($text, 160),
                'type' => 'Single choice',
                'status' => $status,
                'messages' => $messages,
                'optionCount' => is_array($options) ? count($options) : 0,
            ];
            $questions[] = $status === 'error' ? null : [
                'type' => FunGameQuestion::TYPE_SINGLE_CHOICE,
                'text' => $text,
                'image_url' => $image,
                'options' => array_map(fn ($o, $n) => ['id' => 'o' . ($n + 1), 'text' => trim($o)], $options, array_keys($options)),
                'correct_option_id' => 'o' . ($answer + 1),
                'marks' => isset($item['marks']) ? (float) $item['marks'] : $game->default_marks,
                'negative_marks' => isset($item['negative']) ? (float) $item['negative'] : $game->default_negative_marks,
                'seconds_override' => null,
            ];
        }

        return ['rows' => $rows, 'questions' => $questions];
    }

    // ------------------------------------------------------------------ apply / undo

    /**
     * Saves converted questions. "replace" removes the game's current questions
     * (soft delete, so past sessions keep theirs). The timer changes only when
     * `$timer` is given, i.e. when the host chose to apply the file's timer.
     *
     * @param  list<array>  $questions  converted questions (see fromLibrary / fromJson)
     * @param  list<array>  $skipped  rows that were left out, kept for the summary
     */
    public function apply(
        FunGame $game,
        User $user,
        array $questions,
        string $mode,
        ?array $timer,
        string $source,
        ?int $sourceQuizId = null,
        array $skipped = [],
    ): FunGameImport {
        if ($game->hasRunningSession()) {
            throw FunGameException::conflict('Questions can\'t change while a session is running.');
        }
        if (count($questions) === 0) {
            throw new FunGameException('There are no questions to import.', 422, 'validation');
        }
        if (count($questions) > self::MAX_QUESTIONS) {
            throw new FunGameException('At most ' . self::MAX_QUESTIONS . ' questions per import.', 422, 'validation');
        }

        $import = DB::transaction(function () use ($game, $user, $questions, $mode, $timer, $source, $sourceQuizId, $skipped) {
            $removed = [];
            if ($mode === 'replace') {
                $removed = $game->questions()->pluck('id')->map(fn ($id) => (int) $id)->all();
                FunGameQuestion::query()->whereIn('id', $removed)->delete();
            }
            $position = $mode === 'replace' ? 0 : (int) $game->questions()->max('position');

            $added = [];
            foreach ($questions as $q) {
                $added[] = FunGameQuestion::create($q + [
                    'fun_game_id' => $game->id,
                    'position' => ++$position,
                ])->id;
            }

            $previousTimer = null;
            if ($timer) {
                $previousTimer = $game->only(['timer_mode', 'total_seconds', 'allow_navigation', 'seconds_per_question']);
                $this->applyTimer($game, $timer);
            }
            $game->touch();

            return FunGameImport::create([
                'fun_game_id' => $game->id,
                'user_id' => $user->id,
                'source' => $source,
                'source_quiz_id' => $sourceQuizId,
                'mode' => $mode,
                'previous_timer' => $previousTimer,
                'added_question_ids' => $added,
                'removed_question_ids' => $removed,
                'skipped' => $skipped,
                'added_count' => count($added),
                'removed_count' => count($removed),
            ]);
        });

        $this->logger->info('import.applied', [
            'game_id' => $game->id,
            'user_id' => $user->id,
            'import_id' => $import->id,
            'source' => $source,
            'source_quiz_id' => $sourceQuizId,
            'mode' => $mode,
            'added' => $import->added_count,
            'removed' => $import->removed_count,
            'skipped' => count($skipped),
            'timer_applied' => $timer !== null,
        ]);

        return $import;
    }

    public function undo(FunGameImport $import): void
    {
        $game = $import->game;
        if ($import->undone_at) {
            throw FunGameException::conflict('This import was already undone.');
        }
        if ($game->hasRunningSession()) {
            throw FunGameException::conflict('Questions can\'t change while a session is running.');
        }
        $playedSince = FunGameSession::query()
            ->where('fun_game_id', $game->id)
            ->whereNotNull('started_at')
            ->where('started_at', '>', $import->created_at)
            ->exists();
        if ($playedSince) {
            throw FunGameException::conflict('The game has been played since this import, so it can\'t be undone.');
        }

        DB::transaction(function () use ($import, $game) {
            FunGameQuestion::query()->whereIn('id', $import->added_question_ids ?? [])->delete();
            FunGameQuestion::onlyTrashed()->whereIn('id', $import->removed_question_ids ?? [])->restore();
            if ($import->previous_timer) {
                $game->forceFill($import->previous_timer)->save();
            }
            $import->forceFill(['undone_at' => now()])->save();
            $game->touch();
        });

        $this->logger->info('import.undone', ['game_id' => $game->id, 'import_id' => $import->id]);
    }

    /** Timer in the API shape (as validated by GameRequest) onto the game columns. */
    public function applyTimer(FunGame $game, array $timer): void
    {
        if (($timer['mode'] ?? null) === 'perQuestion') {
            $game->timer_mode = FunGame::TIMER_PER_QUESTION;
            $game->seconds_per_question = (int) $timer['secondsPerQuestion'];
        } else {
            $game->timer_mode = FunGame::TIMER_TOTAL;
            $game->total_seconds = (int) $timer['totalSeconds'];
            if (array_key_exists('allowNavigation', $timer)) {
                $game->allow_navigation = (bool) $timer['allowNavigation'];
            }
        }
        $game->save();
    }

    public function presentImport(FunGameImport $import): array
    {
        return [
            'id' => (string) $import->id,
            'source' => $import->source,
            'mode' => $import->mode,
            'added' => $import->added_count,
            'removed' => $import->removed_count,
            'skipped' => $import->skipped ?? [],
            'undoneAt' => TimerService::iso($import->undone_at),
            'createdAt' => TimerService::iso($import->created_at),
        ];
    }

    // ------------------------------------------------------------------ helpers

    /** Library text can hold editor HTML; Fun Games shows plain text. */
    private function clean(string $value): string
    {
        $text = html_entity_decode(strip_tags(str_replace(['<br>', '<br/>', '<br />', '</p>'], "\n", $value)), ENT_QUOTES | ENT_HTML5);

        return trim(preg_replace("/[ \t]+/", ' ', preg_replace("/\n{3,}/", "\n\n", $text)));
    }

    private function key(string $text): string
    {
        return mb_strtolower(preg_replace('/\s+/', ' ', trim($text)));
    }

    private function imageUrl(?string $url): ?string
    {
        return $url && preg_match('/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i', $url) ? Str::limit($url, 2048, '') : null;
    }

    private function mostCommon(array $values): ?int
    {
        if (! $values) {
            return null;
        }
        $counts = array_count_values($values);
        arsort($counts);

        return (int) array_key_first($counts);
    }
}
