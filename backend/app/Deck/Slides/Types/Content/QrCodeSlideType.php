<?php

namespace App\Deck\Slides\Types\Content;

/**
 * `qr_code`: renders the session's join QR code (and the code itself when
 * `show_join_code`). The join code / URL is session data, so the presenter
 * and participant UIs read it from the session, not from this slide.
 *
 * Config: {show_join_code: bool (default true)}.
 * Answer payload: none (validateAnswer always throws). Aggregate: [].
 */
class QrCodeSlideType extends ContentSlideType
{
    public function key(): string
    {
        return 'qr_code';
    }

    public function defaultConfig(): array
    {
        return ['show_join_code' => true];
    }

    protected function normaliseConfig(array $config): array
    {
        return [
            'show_join_code' => $this->boolean($config['show_join_code'], 'show_join_code', true),
        ];
    }
}
