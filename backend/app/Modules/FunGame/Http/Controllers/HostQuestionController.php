<?php

namespace App\Modules\FunGame\Http\Controllers;

use App\Modules\FunGame\Http\Requests\QuestionRequest;
use App\Modules\FunGame\Http\Requests\ReorderQuestionsRequest;
use App\Modules\FunGame\Http\Resources\GamePresenter;
use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameQuestion;
use App\Modules\FunGame\Services\FunGameException;
use App\Modules\FunGame\Services\FunGameLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class HostQuestionController extends FunGameController
{
    public function __construct(
        private readonly GamePresenter $presenter,
        private readonly FunGameLogger $logger,
    ) {}

    public function store(QuestionRequest $request, int $game): JsonResponse
    {
        $model = $this->ownedGame($request, $game);
        $this->ensureEditable($model);

        $question = new FunGameQuestion([
            'fun_game_id' => $model->id,
            'position' => (int) $model->questions()->max('position') + 1,
        ]);
        $this->fill($question, $model, $request);
        $question->save();
        $model->touch();

        $this->logger->info('question.created', ['game_id' => $model->id, 'question_id' => $question->id]);

        return $this->createdResponse(['question' => $this->presenter->question($question)]);
    }

    public function update(QuestionRequest $request, int $game, int $question): JsonResponse
    {
        $model = $this->ownedGame($request, $game);
        $this->ensureEditable($model);
        $row = $this->question($model, $question);
        $this->fill($row, $model, $request);
        $row->save();
        $model->touch();

        $this->logger->info('question.updated', ['game_id' => $model->id, 'question_id' => $row->id]);

        return $this->okResponse(['question' => $this->presenter->question($row)]);
    }

    public function destroy(Request $request, int $game, int $question): JsonResponse
    {
        $model = $this->ownedGame($request, $game);
        $this->ensureEditable($model);
        $this->question($model, $question)->delete();
        $model->touch();

        $this->logger->info('question.deleted', ['game_id' => $model->id, 'question_id' => $question]);

        return $this->okResponse([], 'Question deleted.');
    }

    public function reorder(ReorderQuestionsRequest $request, int $game): JsonResponse
    {
        $model = $this->ownedGame($request, $game);
        $this->ensureEditable($model);
        $ids = array_map('intval', $request->validated()['questionIds']);
        $existing = $model->questions()->pluck('id')->map(fn ($id) => (int) $id)->sort()->values()->all();
        $requested = collect($ids)->sort()->values()->all();
        if ($existing !== $requested) {
            throw FunGameException::conflict('The question list changed. Reload and try again.');
        }

        DB::transaction(function () use ($ids) {
            foreach ($ids as $position => $id) {
                FunGameQuestion::query()->whereKey($id)->update(['position' => $position + 1]);
            }
        });
        $model->touch();

        return $this->okResponse([], 'Order saved.');
    }

    private function question(FunGame $game, int $questionId): FunGameQuestion
    {
        $question = $game->questions()->whereKey($questionId)->first();
        if (! $question) {
            throw FunGameException::notFound('Question not found.');
        }

        return $question;
    }

    private function fill(FunGameQuestion $question, FunGame $game, QuestionRequest $request): void
    {
        $data = $request->validated();
        $question->fill([
            'type' => $data['type'] ?? FunGameQuestion::TYPE_SINGLE_CHOICE,
            'text' => $data['text'],
            'image_url' => $data['imageUrl'] ?? null,
            'options' => array_map(fn ($o) => ['id' => $o['id'], 'text' => $o['text']], $data['options']),
            'correct_option_id' => $data['correctOptionId'],
            'marks' => $data['marks'] ?? $game->default_marks,
            'negative_marks' => $data['negativeMarks'] ?? $game->default_negative_marks,
            'seconds_override' => $data['secondsOverride'] ?? null,
        ]);
    }
}
