<?php

namespace App\Deck\Http\Requests\Qa;

use App\Http\Requests\BaseFormRequest;
use Illuminate\Validation\Validator;

/**
 * PATCH .../qa/questions/{question} — host moderation:
 * {is_hidden?: bool, is_starred?: bool, is_answered?: bool}, at least one.
 * The plan §3.1 action names (and LiveQaService's aliases) work too:
 * hide → is_hidden, star → is_starred, mark_answered → is_answered. Sending
 * an alias and its is_* key together is fine when they agree; when they
 * disagree it is a 422 on the alias.
 */
class ModerateQaQuestionRequest extends BaseFormRequest
{
    /** Accepted field → the column it sets. */
    public const FLAGS = [
        'is_hidden' => 'is_hidden',
        'is_starred' => 'is_starred',
        'is_answered' => 'is_answered',
        'hide' => 'is_hidden',
        'star' => 'is_starred',
        'mark_answered' => 'is_answered',
    ];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return array_fill_keys(array_keys(self::FLAGS), ['sometimes', 'boolean']);
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                if (! $this->hasAny(array_keys(self::FLAGS))) {
                    $validator->errors()->add(
                        'flags',
                        'Send at least one of is_hidden, is_starred or is_answered (or hide, star, mark_answered).',
                    );

                    return;
                }

                foreach (self::FLAGS as $field => $column) {
                    if ($field === $column || ! $this->has($field) || ! $this->has($column)) {
                        continue;
                    }

                    $alias = $this->boolOrNull($this->input($field));
                    $canonical = $this->boolOrNull($this->input($column));

                    if ($alias !== null && $canonical !== null && $alias !== $canonical) {
                        $validator->errors()->add($field, "The {$field} and {$column} fields disagree. Send one of them.");
                    }
                }
            },
        ];
    }

    /** @return array<string, bool> the sent flags keyed by column, as real booleans (LiveQaService::moderate() input) */
    public function flags(): array
    {
        $flags = [];
        foreach (self::FLAGS as $field => $column) {
            if ($this->has($field)) {
                $flags[$column] = filter_var($this->validated($field), FILTER_VALIDATE_BOOL);
            }
        }

        return $flags;
    }

    /** A value the `boolean` rule accepts, as a bool; null for anything else (that rule reports it). */
    private function boolOrNull(mixed $value): ?bool
    {
        return in_array($value, [true, false, 0, 1, '0', '1'], true) ? (bool) $value : null;
    }
}
