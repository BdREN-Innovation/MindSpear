<?php

namespace App\Deck\Http\Requests;

use App\Deck\Slides\Types\Quest\PollText;
use App\Http\Requests\BaseFormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /{sessions prefix}/{session}/participants/join.
 *
 * join_code: the session's join code as typed or carried by the join link
 * (case, spaces and dashes do not matter); the service compares it with the
 * session's, so the numeric session id alone never lets anyone in.
 * display_name: 1..40 characters after cleaning (valid UTF-8, control and
 * invisible characters removed, whitespace collapsed, trimmed); the join
 * service masks profanity afterwards. emoji_avatar: exactly one entry of
 * config('deck.emoji_avatars').
 */
class JoinDeckSessionRequest extends BaseFormRequest
{
    public const NAME_MAX = 40;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $name = $this->input('display_name');

        if (is_string($name)) {
            $this->merge(['display_name' => self::cleanName($name)]);
        }
    }

    public function rules(): array
    {
        return [
            'join_code' => ['required', 'string', 'max:32'],
            'display_name' => ['required', 'string', 'min:1', 'max:' . self::NAME_MAX],
            'emoji_avatar' => ['required', 'string', Rule::in(array_values((array) config('deck.emoji_avatars', [])))],
        ];
    }

    public function messages(): array
    {
        return [
            'emoji_avatar.in' => 'Pick one of the listed avatars.',
        ];
    }

    public static function cleanName(string $name): string
    {
        $name = mb_scrub($name, 'UTF-8');
        $name = preg_replace('/\p{Cc}+/u', ' ', $name) ?? $name;
        $name = PollText::stripInvisible($name);

        return trim(preg_replace('/\s+/u', ' ', $name) ?? $name);
    }
}
