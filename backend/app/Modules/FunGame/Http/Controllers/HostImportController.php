<?php

namespace App\Modules\FunGame\Http\Controllers;

use App\Modules\FunGame\Http\Requests\CreateFromLibraryRequest;
use App\Modules\FunGame\Http\Requests\ImportRequest;
use App\Modules\FunGame\Http\Resources\GamePresenter;
use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameImport;
use App\Modules\FunGame\Services\FunGameException;
use App\Modules\FunGame\Services\FunGameLogger;
use App\Modules\FunGame\Services\ImportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class HostImportController extends FunGameController
{
    public function __construct(
        private readonly ImportService $imports,
        private readonly GamePresenter $games,
        private readonly FunGameLogger $logger,
    ) {}

    /** The host's My Library quizzes. */
    public function libraryQuizzes(Request $request): JsonResponse
    {
        return $this->okResponse(['quizzes' => $this->imports->libraryQuizzes($request->user())->all()]);
    }

    /** What importing a library quiz into a new game would produce. Saves nothing. */
    public function libraryPreview(Request $request, int $quiz): JsonResponse
    {
        $source = $this->imports->ownedLibraryQuiz($request->user(), $quiz);
        $converted = $this->imports->fromLibrary($source, 1.0, 0.0);

        return $this->okResponse([
            'quiz' => ['id' => (string) $source->id, 'title' => $source->title ?: 'Untitled quiz'],
            'rows' => $converted['rows'],
            'importable' => count($converted['questions']),
            'suggestedTimer' => $converted['suggestedTimer'],
        ]);
    }

    /** New draft game copied from a library quiz; the game owns its questions from then on. */
    public function createFromLibrary(CreateFromLibraryRequest $request): JsonResponse
    {
        $data = $request->validated();
        $user = $request->user();
        $quiz = $this->imports->ownedLibraryQuiz($user, $data['quizId']);
        $converted = $this->imports->fromLibrary($quiz, 1.0, 0.0);
        if (! $converted['questions']) {
            throw new FunGameException('None of this quiz\'s questions can be played in Fun Games.', 422, 'validation');
        }
        $suggested = $converted['suggestedTimer'];
        $perQuestion = ($data['timerMode'] ?? 'perQuestion') === 'perQuestion';

        [$game, $import] = DB::transaction(function () use ($user, $quiz, $converted, $suggested, $perQuestion) {
            $game = FunGame::create([
                'user_id' => $user->id,
                'title' => mb_substr($quiz->title ?: 'Untitled quiz', 0, 200),
                'description' => mb_substr(trim(strip_tags($quiz->description ?? '')), 0, 2000),
                'status' => FunGame::STATUS_DRAFT,
                'timer_mode' => $perQuestion ? FunGame::TIMER_PER_QUESTION : FunGame::TIMER_TOTAL,
                'seconds_per_question' => $suggested['secondsPerQuestion'],
                'total_seconds' => $suggested['totalSeconds'],
                'allow_navigation' => true,
                'source_quiz_id' => $quiz->id,
            ]);
            $skipped = $this->skippedRows($converted['rows']);
            $import = $this->imports->apply($game, $user, $converted['questions'], 'append', null, 'library_quiz', $quiz->id, $skipped);

            return [$game, $import];
        });

        $this->logger->info('game.created_from_library', [
            'game_id' => $game->id,
            'user_id' => $user->id,
            'source_quiz_id' => $quiz->id,
        ]);

        return $this->createdResponse([
            'game' => $this->games->detail($game->refresh()),
            'import' => $this->imports->presentImport($import),
        ], 'Game created from your quiz.');
    }

    /** Adds (or replaces) questions in an existing game, from JSON or a library quiz. */
    public function store(ImportRequest $request, int $game): JsonResponse
    {
        $model = $this->ownedGame($request, $game);
        $data = $request->validated();
        $mode = $data['mode'];

        if ($data['source'] === 'library_quiz') {
            $quiz = $this->imports->ownedLibraryQuiz($request->user(), $data['quizId']);
            $converted = $this->imports->fromLibrary($quiz, $model->default_marks, $model->default_negative_marks);
            $questions = $converted['questions'];
            $rows = $converted['rows'];
            $sourceQuizId = $quiz->id;
        } else {
            $converted = $this->imports->fromJson($data['questions'] ?? [], $model, $mode);
            $rows = $converted['rows'];
            $questions = array_values(array_filter($converted['questions']));
            $sourceQuizId = null;
        }

        $errors = collect($rows)->where('status', 'error')->count();
        if ($request->boolean('dryRun')) {
            return $this->okResponse(['rows' => $rows, 'importable' => count($questions), 'errors' => $errors]);
        }
        if ($errors > 0) {
            return $this->unprocessableResponse(
                ['rows' => $rows, 'errors' => $errors],
                $errors === 1 ? '1 question has an error. Fix or leave it out, then import.' : "{$errors} questions have errors. Fix or leave them out, then import.",
            );
        }

        $skipped = array_merge($this->skippedRows($rows), array_values($data['skipped'] ?? []));
        $import = $this->imports->apply(
            $model,
            $request->user(),
            $questions,
            $mode,
            $data['timer'] ?? null,
            $data['source'],
            $sourceQuizId,
            $skipped,
        );

        return $this->createdResponse([
            'import' => $this->imports->presentImport($import),
            'game' => $this->games->detail($model->refresh()),
        ], 'Questions imported.');
    }

    public function undo(Request $request, int $import): JsonResponse
    {
        $model = FunGameImport::with('game')->find($import);
        if (! $model || ! $model->game || Gate::forUser($request->user())->denies('manage', $model->game)) {
            throw FunGameException::notFound('Import not found.');
        }
        $this->imports->undo($model);

        return $this->okResponse([
            'import' => $this->imports->presentImport($model->refresh()),
            'game' => $this->games->detail($model->game->refresh()),
        ], 'Import undone.');
    }

    /** @return list<array{position: int, text: string, reason: string}> */
    private function skippedRows(array $rows): array
    {
        return collect($rows)
            ->where('status', 'skipped')
            ->map(fn ($row) => ['position' => $row['position'], 'text' => $row['text'], 'reason' => $row['messages'][0] ?? ''])
            ->values()
            ->all();
    }
}
