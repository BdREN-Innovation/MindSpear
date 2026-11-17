<?php

namespace App\Deck\Http\Requests\Qa;

use App\Deck\Qa\LiveQaService;
use App\Http\Requests\BaseFormRequest;

/**
 * POST .../slide-runs/{run}/qa/questions — {body}. Only shape is checked
 * here (with a generous size cap); the real rules (trimmed length within the
 * slide's max_question_length, a visible character, profanity masking) are
 * LiveQaService's and come back as 422 `body`.
 */
class SubmitQaQuestionRequest extends BaseFormRequest
{
    /** Rejects absurd bodies before any processing; whitespace padding may make the raw text longer than the limit. */
    public const RAW_BODY_MAX = LiveQaService::MAX_BODY_LENGTH_CEILING * 4;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'max:' . self::RAW_BODY_MAX],
        ];
    }

    public function body(): string
    {
        return (string) $this->validated('body');
    }
}
