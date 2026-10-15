<?php

namespace App\Deck\Http\Requests\Qa;

use App\Deck\Qa\LiveQaService;
use App\Deck\Qa\SessionQaService;
use App\Http\Requests\BaseFormRequest;
use Illuminate\Validation\Rule;

/**
 * GET .../slide-runs/{run}/qa/questions?sort=top|new&limit=1..500.
 * `newest` is accepted as an alias of `new`; no sort = the slide's setting.
 */
class QaFeedRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'sort' => ['sometimes', 'nullable', 'string', Rule::in([LiveQaService::SORT_TOP, LiveQaService::SORT_NEW, 'newest'])],
            'limit' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:' . SessionQaService::MAX_FEED_LIMIT],
        ];
    }

    public function sort(): ?string
    {
        $sort = $this->validated('sort');

        return is_string($sort) && $sort !== '' ? $sort : null;
    }

    public function limit(): ?int
    {
        $limit = $this->validated('limit');

        return $limit === null ? null : (int) $limit;
    }
}
