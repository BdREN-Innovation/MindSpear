<?php

namespace App\Deck\Http\Requests;

use App\Http\Requests\BaseFormRequest;

/**
 * POST /{sessions prefix}/{session}/slide-runs/{run}/answers.
 * Body: {answer_payload: object}; its shape is checked by the run's slide
 * type (errors keyed answer_payload.*). The body size is capped before this
 * runs (LimitAnswerBodySize, config('deck.max_answer_body_kb')).
 */
class SubmitDeckAnswerRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'answer_payload' => ['present', 'array'],
        ];
    }
}
