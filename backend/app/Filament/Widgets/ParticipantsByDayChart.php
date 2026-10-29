<?php

namespace App\Filament\Widgets;

use App\Models\Deck\DeckParticipant;
use Illuminate\Database\Eloquent\Builder;

/** People joining live quiz and quest sessions. */
class ParticipantsByDayChart extends DailyCountChart
{
    protected static ?string $heading = 'Session Participants (Last 30 Days)';

    protected function query(): Builder
    {
        return DeckParticipant::query();
    }

    protected function label(): string
    {
        return 'Participants';
    }
}
