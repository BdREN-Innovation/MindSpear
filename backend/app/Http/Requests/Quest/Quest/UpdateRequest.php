<?php

namespace App\Http\Requests\Quest\Quest;

use App\Http\Requests\BaseFormRequest;

class UpdateRequest extends BaseFormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'title' => 'required|string|max:255',
            'description' => 'nullable|string|max:1000',
            'is_published' => 'nullable|boolean',
            'visibility' => 'nullable|in:public,private',
            'sequential_progression' => 'nullable',
            'timezone' => 'nullable|string|max:255',
            'start_datetime' => [
                'nullable',
                'date_format:Y-m-d H:i:s',
                function ($attribute, $value, $fail) {
                    $timezone = $this->input('timezone') ?: config('app.timezone');
                    $this->validateDateTimeInTimezone($attribute, $value, $timezone, $fail);
                },
            ],
            'end_datetime' => [
                'nullable',
                'date_format:Y-m-d H:i:s',
                function ($attribute, $value, $fail) {
                    $timezone = $this->input('timezone') ?: config('app.timezone');
                    $this->validateDateTimeInTimezone($attribute, $value, $timezone, $fail);
                },
            ],
        ];
    }

    /**
     * Validate that the datetime is in the specified timezone.
     */
    private function validateDateTimeInTimezone($attribute, $value, $fail): void
    {
        if (empty($value)) {
            return;
        }

        $timezone = $this->input('timezone') ?: config('app.timezone');

        try {
            $dt = new \DateTime($value, new \DateTimeZone($timezone));
            // Additional validation if needed
        } catch (\Exception $e) {
            $fail("The $attribute is not a valid datetime in the $timezone timezone.");
        }
    }

    /**
     * Get the validated data from the request.
     */
    public function validated($key = null, $default = null): array
    {
        $data = parent::validated();
        $timezone = $this->input('timezone') ?: config('app.timezone');

        $convertedData = [];

        // A quest's times are start/end (this converted the quiz's open/close names, so the
        // local time was saved as if it were UTC).
        foreach (['start_datetime', 'end_datetime'] as $field) {
            if ($this->filled($field)) {
                $convertedData[$field] = $this->convertToUtc($this->input($field), $timezone);
            }
        }

        return array_merge($data, $convertedData, [
            'timezone' => $timezone,
        ]);
    }

    /**
     * Convert given datetime string from request or config timezone to UTC.
     */
    private function convertToUtc(?string $value, string $timezone): ?string
    {
        if (empty($value)) {
            return null;
        }

        try {
            $datetime = new \DateTime($value, new \DateTimeZone($timezone));
            $datetime->setTimezone(new \DateTimeZone('UTC'));

            return $datetime->format('Y-m-d H:i:s');
        } catch (\Exception $e) {
            return null;
        }
    }
}
