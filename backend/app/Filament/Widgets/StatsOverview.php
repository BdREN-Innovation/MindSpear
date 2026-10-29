<?php

namespace App\Filament\Widgets;

use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use App\Models\Institution;
use App\Models\User;
use Filament\Widgets\StatsOverviewWidget as BaseWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

class StatsOverview extends BaseWidget
{
    protected function getStats(): array
    {
        return [
            Stat::make('Users', User::count()),
            Stat::make('Institutions', Institution::count()),
            Stat::make('Quizzes', Deck::query()->quiz()->count()),
            Stat::make('Quests', Deck::query()->quest()->count()),
            Stat::make('Sessions hosted', DeckSession::count()),
            Stat::make('Session participants', DeckParticipant::count()),
        ];
    }
}
