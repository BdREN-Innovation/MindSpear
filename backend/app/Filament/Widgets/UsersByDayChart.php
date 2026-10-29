<?php

namespace App\Filament\Widgets;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

class UsersByDayChart extends DailyCountChart
{
    protected static ?string $heading = 'Users (Last 30 Days)';

    protected function query(): Builder
    {
        return User::query();
    }

    protected function label(): string
    {
        return 'Users';
    }
}
