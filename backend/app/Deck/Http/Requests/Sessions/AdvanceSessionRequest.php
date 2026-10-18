<?php

namespace App\Deck\Http\Requests\Sessions;

use App\Deck\Http\DeckRoutes;
use App\Deck\Sessions\SessionStateMachine;
use App\Models\Deck\Deck;
use App\Http\Requests\BaseFormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/{product}-sessions/v2/{session}/advance
 * {action: start_voting|close_voting|next_slide|previous_slide|jump_to
 *  (+ reveal, insert_leaderboard on quiz routes), target_run_id?: int (required for jump_to), force?: bool}
 */
class AdvanceSessionRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true; // ownership is checked by the controller (404 for other hosts)
    }

    public function rules(): array
    {
        return [
            'action' => ['required', 'string', Rule::in($this->actions())],
            'target_run_id' => ['nullable', 'required_if:action,' . SessionStateMachine::ACTION_JUMP_TO, 'integer', 'min:1'],
            'force' => ['sometimes', 'boolean'],
        ];
    }

    /** Every action on quiz routes; Quest has no `reveal` / `insert_leaderboard` (no quiz, spinner or leaderboard slides). */
    private function actions(): array
    {
        return DeckRoutes::productOf($this->route()) === Deck::PRODUCT_QUIZ
            ? SessionStateMachine::ACTIONS
            : array_values(array_diff(SessionStateMachine::ACTIONS, SessionStateMachine::QUIZ_ACTIONS));
    }

    public function action(): string
    {
        return (string) $this->validated('action');
    }

    public function targetRunId(): ?int
    {
        $id = $this->validated('target_run_id');

        return $id === null ? null : (int) $id;
    }

    public function force(): bool
    {
        return $this->boolean('force');
    }
}
