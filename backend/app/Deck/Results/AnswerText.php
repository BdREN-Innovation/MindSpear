<?php

namespace App\Deck\Results;

/**
 * One stored answer as plain text, for the results CSV. Option ids become
 * their labels from the run's options snapshot; shapes without an obvious
 * reading fall back to compact JSON so nothing is lost.
 */
final class AnswerText
{
    /**
     * @param  array<string, mixed>  $payload  deck_participant_answers.answer_payload
     * @param  array<int, array<string, mixed>>  $options  deck_session_slide_runs.options_snapshot
     */
    public static function format(array $payload, array $options): string
    {
        if ($payload === []) {
            return '';
        }

        $labels = [];
        foreach ($options as $option) {
            if (isset($option['id'])) {
                $labels[(string) $option['id']] = (string) ($option['label'] ?? $option['id']);
            }
        }
        $label = fn ($id) => $labels[(string) $id] ?? (string) $id;

        $parts = [];
        foreach ($payload as $key => $value) {
            $parts[] = match (true) {
                $key === 'option_id' && is_scalar($value) => $label($value),
                $key === 'option_ids' && is_array($value) => implode('; ', array_map($label, $value)),
                $key === 'order' && is_array($value) => implode(' > ', array_map($label, $value)),
                in_array($key, ['text', 'value'], true) && is_scalar($value) => (string) $value,
                in_array($key, ['ratings', 'allocations', 'points'], true) && is_array($value) && ! array_is_list($value) => implode('; ', array_map(
                    fn ($id, $score) => $label($id) . ': ' . (is_scalar($score) ? $score : json_encode($score)),
                    array_keys($value),
                    $value,
                )),
                is_array($value) && array_is_list($value) && array_reduce($value, fn ($ok, $v) => $ok && is_scalar($v), true) => implode(' | ', array_map('strval', $value)),
                is_scalar($value) => $key . ': ' . $value,
                default => $key . ': ' . json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            };
        }

        return implode(' · ', array_filter($parts, fn ($part) => $part !== ''));
    }
}
