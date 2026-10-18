<?php

namespace App\Deck\Http\Requests\Authoring;

use App\Deck\Authoring\SlideAuthoringService;
use App\Deck\Authoring\SlideInput;
use App\Http\Requests\BaseFormRequest;

/**
 * POST /quests/v2/{deck}/slides/bulk (plan §5.7):
 *   {slides: [{type, title?, body?, config?, options?: [{label?, payload?}]}, ...], after_position?}
 * or the bare list. 1..50 slides; options null/absent = the type's defaults.
 * Quiz routes also take slides.*.points_min / points_max / speed_bonus_enabled
 * and slides.*.options.*.is_correct (QuizFields).
 */
class BulkSlidesRequest extends BaseFormRequest
{
    use QuizFields;
    use ReadsRawJson;
    use RejectsInvalidUtf8;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->wrapListBody();
    }

    public function rules(): array
    {
        return [
            'after_position' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'slides' => ['required', 'array', 'list', 'min:1', 'max:' . SlideAuthoringService::MAX_BULK],
            'slides.*' => ['required', 'array'],
            'slides.*.type' => ['required', 'string', 'max:40'],
            'slides.*.title' => ['sometimes', 'nullable', 'string', 'max:' . SlideInput::MAX_TITLE],
            'slides.*.body' => ['sometimes', 'nullable', 'array'],
            'slides.*.config' => ['sometimes', 'nullable', 'array'],
            'slides.*.options' => ['sometimes', 'nullable', 'array', 'list'],
            'slides.*.options.*' => ['required', 'array'],
            'slides.*.options.*.label' => ['sometimes', 'nullable', 'string', 'max:' . SlideInput::MAX_LABEL],
            'slides.*.options.*.payload' => ['sometimes', 'nullable', 'array'],
            ...$this->scoringRules('slides.*.'),
            ...$this->correctRules('slides.*.options.*.'),
        ];
    }

    public function messages(): array
    {
        return $this->quizMessages('slides.*.', 'slides.*.options.*.');
    }

    /** Validated slides, each `body` as sent (untrimmed). */
    public function slides(): array
    {
        $slides = array_values($this->validated()['slides']);

        foreach ($slides as $index => $slide) {
            if (array_key_exists('body', $slide)) {
                $slides[$index]['body'] = $this->raw("slides.{$index}.body");
            }
        }

        return $slides;
    }

    public function afterPosition(): ?int
    {
        $after = $this->validated()['after_position'] ?? null;

        return $after === null ? null : (int) $after;
    }
}
