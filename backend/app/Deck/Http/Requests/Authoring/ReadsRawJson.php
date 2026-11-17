<?php

namespace App\Deck\Http\Requests\Authoring;

/**
 * Access to the JSON body as sent. The global TrimStrings and
 * ConvertEmptyStringsToNull middleware rewrite every nested string, which
 * breaks rich text (" world" after a bold run loses its space, a lone " "
 * run becomes null). Rich-text `body` values are read from here instead.
 * A top-level JSON list is exposed under `slides` (POST /slides/reorder and
 * /slides/bulk accept a bare list).
 */
trait ReadsRawJson
{
    private ?array $rawJsonCache = null;

    /** The decoded request body, or null when it is not a JSON object/list. */
    protected function rawJson(): ?array
    {
        if ($this->rawJsonCache !== null) {
            return $this->rawJsonCache;
        }

        if (! $this->isJson()) {
            return null;
        }

        $decoded = json_decode((string) $this->getContent(), true);
        if (! is_array($decoded)) {
            return null;
        }

        return $this->rawJsonCache = ($decoded !== [] && array_is_list($decoded)) ? ['slides' => $decoded] : $decoded;
    }

    /** $key (dot notation) from the untouched JSON body, falling back to the normal input. */
    public function raw(string $key, mixed $default = null): mixed
    {
        $raw = $this->rawJson();

        return $raw === null ? $this->input($key, $default) : data_get($raw, $key, $default);
    }

    /** Lets a bare JSON list body validate as {slides: [...]}. */
    protected function wrapListBody(): void
    {
        $json = $this->isJson() ? $this->json()->all() : [];

        if ($json !== [] && array_is_list($json)) {
            $this->json()->replace(['slides' => $json]);
        }
    }
}
