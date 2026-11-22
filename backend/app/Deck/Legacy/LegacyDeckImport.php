<?php

namespace App\Deck\Legacy;

use App\Models\Deck\Deck;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A legacy v1 quiz or quest that `legacy:convert-decks` copied into a deck. */
class LegacyDeckImport extends Model
{
    public const SOURCE_QUIZ = 'quiz';

    public const SOURCE_QUEST = 'quest';

    protected $fillable = ['source_type', 'source_id', 'deck_id', 'slides_created', 'skipped'];

    protected $casts = ['skipped' => 'array', 'source_id' => 'integer', 'deck_id' => 'integer', 'slides_created' => 'integer'];

    public function deck(): BelongsTo
    {
        return $this->belongsTo(Deck::class)->withTrashed();
    }
}
