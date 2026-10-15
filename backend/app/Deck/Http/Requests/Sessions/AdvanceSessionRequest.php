<?php

namespace App\Deck\Http\Requests\Sessions;

use App\Deck\Sessions\SessionStateMachine;
use App\Http\Requests\BaseFormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/{product}-sessions/v2/{session}/advance
 * {action: start_voting|close_voting|next_slide|previous_slide|jump_to,
 *  target_run_id?: int (required for jump_to), force?: bool}
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
            'action' => ['required', 'string', Rule::in(SessionStateMachine::ACTIONS)],
            'target_run_id' => ['nullable', 'required_if:action,' . SessionStateMachine::ACTION_JUMP_TO, 'integer', 'min:1'],
            'force' => ['sometimes', 'boolean'],
        ];
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
