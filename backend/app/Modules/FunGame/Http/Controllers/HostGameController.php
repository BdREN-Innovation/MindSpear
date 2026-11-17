<?php

namespace App\Modules\FunGame\Http\Controllers;

use App\Modules\FunGame\Http\Requests\GameRequest;
use App\Modules\FunGame\Http\Resources\GamePresenter;
use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameQuestion;
use App\Modules\FunGame\Services\FunGameException;
use App\Modules\FunGame\Services\FunGameLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class HostGameController extends FunGameController
{
    public function __construct(
        private readonly GamePresenter $presenter,
        private readonly FunGameLogger $logger,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $games = FunGame::query()
            ->where('user_id', $request->user()->id)
            ->withCount(['questions', 'sessions'])
            ->withSum('questions', 'marks')
            ->with('latestSession')
            ->latest('updated_at')
            ->get();

        return $this->okResponse(['games' => $games->map(fn ($g) => $this->presenter->summary($g))->all()]);
    }

    public function store(GameRequest $request): JsonResponse
    {
        $game = new FunGame([
            'user_id' => $request->user()->id,
            'status' => FunGame::STATUS_DRAFT,
        ]);
        $this->fill($game, $request);
        $game->save();

        $this->logger->info('game.created', ['game_id' => $game->id, 'user_id' => $game->user_id]);

        return $this->createdResponse(['game' => $this->presenter->detail($game)], 'Game created.');
    }

    public function show(Request $request, int $game): JsonResponse
    {
        return $this->okResponse(['game' => $this->presenter->detail($this->ownedGame($request, $game))]);
    }

    public function update(GameRequest $request, int $game): JsonResponse
    {
        $model = $this->ownedGame($request, $game);
        if ($request->has('timer')) {
            $this->ensureEditable($model);
        }

        DB::transaction(function () use ($model, $request) {
            $this->fill($model, $request);
            $model->save();
            if ($request->has('timer.overrides')) {
                $overrides = $request->input('timer.overrides', []);
                foreach ($model->questions()->get() as $question) {
                    $question->forceFill(['seconds_override' => $overrides[(string) $question->id] ?? null])->save();
                }
            }
        });

        $this->logger->info('game.updated', [
            'game_id' => $model->id,
            'user_id' => $model->user_id,
            'fields' => array_keys($request->validated()),
        ]);

        return $this->okResponse(['game' => $this->presenter->detail($model->refresh())], 'Game saved.');
    }

    public function destroy(Request $request, int $game): JsonResponse
    {
        $model = $this->ownedGame($request, $game);
        if ($model->hasOpenSession()) {
            throw FunGameException::conflict('End this game\'s session before deleting it.');
        }
        $model->delete();
        $this->logger->info('game.deleted', ['game_id' => $model->id, 'user_id' => $model->user_id]);

        return $this->okResponse([], 'Game deleted.');
    }

    public function duplicate(Request $request, int $game): JsonResponse
    {
        $source = $this->ownedGame($request, $game);

        $copy = DB::transaction(function () use ($source) {
            $copy = $source->replicate(['status']);
            $copy->title = mb_substr($source->title . ' (copy)', 0, 200);
            $copy->status = FunGame::STATUS_DRAFT;
            $copy->save();
            foreach ($source->questions()->get() as $question) {
                $clone = $question->replicate();
                $clone->fun_game_id = $copy->id;
                $clone->save();
            }

            return $copy;
        });

        $this->logger->info('game.duplicated', ['game_id' => $copy->id, 'source_game_id' => $source->id]);

        return $this->createdResponse(['game' => $this->presenter->detail($copy)], 'Game duplicated.');
    }

    public function publish(Request $request, int $game): JsonResponse
    {
        $model = $this->ownedGame($request, $game);
        $issues = $this->publishIssues($model);
        if ($issues) {
            return $this->unprocessableResponse(['issues' => $issues], 'Fix these before publishing.');
        }
        $model->forceFill(['status' => FunGame::STATUS_PUBLISHED])->save();
        $this->logger->info('game.published', ['game_id' => $model->id, 'user_id' => $model->user_id]);

        return $this->okResponse(['game' => $this->presenter->detail($model)], 'Game published.');
    }

    /** @return list<string> */
    private function publishIssues(FunGame $game): array
    {
        $issues = [];
        $questions = $game->questions()->get();
        if ($questions->isEmpty()) {
            $issues[] = 'Add at least one question.';
        }
        $questions->each(function (FunGameQuestion $q, int $i) use (&$issues) {
            if (count($q->options) < 2 || ! $q->hasOption($q->correct_option_id)) {
                $issues[] = 'Question ' . ($i + 1) . ' needs at least two options and a correct answer.';
            }
        });
        if ($game->questions_per_player && $game->questions_per_player > $questions->count()) {
            $issues[] = "Each player should answer {$game->questions_per_player} questions, but the game has only {$questions->count()}.";
        }

        return $issues;
    }

    private function fill(FunGame $game, GameRequest $request): void
    {
        $data = $request->validated();
        foreach (['title' => 'title', 'description' => 'description', 'instructions' => 'instructions',
            'defaultMarks' => 'default_marks', 'defaultNegativeMarks' => 'default_negative_marks',
            'scoringMode' => 'scoring_mode', 'shuffleQuestions' => 'shuffle_questions',
            'questionsPerPlayer' => 'questions_per_player', 'questionSelection' => 'question_selection'] as $input => $column) {
            if (array_key_exists($input, $data)) {
                $game->{$column} = $data[$input];
            }
        }
        if (isset($data['timer'])) {
            $timer = $data['timer'];
            // Only the chosen mode's values change; the other mode keeps its own settings.
            if ($timer['mode'] === 'perQuestion') {
                $game->timer_mode = FunGame::TIMER_PER_QUESTION;
                $game->seconds_per_question = (int) $timer['secondsPerQuestion'];
            } else {
                $game->timer_mode = FunGame::TIMER_TOTAL;
                $game->total_seconds = (int) $timer['totalSeconds'];
            }
        }
    }
}
