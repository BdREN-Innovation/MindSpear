<?php

namespace App\Deck\Http\Controllers;

use App\Http\Controllers\api\v1\ApiBaseController;
use Illuminate\Http\JsonResponse;

/** Public, static lookups for the deck clients. */
class MetaController extends ApiBaseController
{
    /**
     * GET /api/v1/meta/emoji-avatars — the curated join avatars (plan §4.5).
     * data: {emojis: list<string>, labels: {emoji: label}}. Cached by the
     * route's cache.headers middleware; clients may keep it indefinitely.
     */
    public function emojiAvatars(): JsonResponse
    {
        $emojis = array_values((array) config('deck.emoji_avatars', []));
        $labels = (array) config('deck.emoji_avatar_labels', []);

        return $this->okResponse([
            'emojis' => $emojis,
            'labels' => (object) array_intersect_key($labels, array_flip($emojis)),
        ]);
    }
}
