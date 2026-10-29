<?php

namespace App\Filament\Widgets;

use Carbon\Carbon;
use Filament\Widgets\ChartWidget;
use Illuminate\Database\Eloquent\Builder;

/**
 * A line chart of how many rows of query() were created on each of the last
 * DAYS days (days without any show 0).
 */
abstract class DailyCountChart extends ChartWidget
{
    protected const DAYS = 30;

    /** The rows to count, by created_at. */
    abstract protected function query(): Builder;

    /** The dataset's legend label. */
    abstract protected function label(): string;

    protected function getData(): array
    {
        $from = Carbon::now()->subDays(static::DAYS - 1)->startOfDay();
        $counts = $this->query()
            ->where('created_at', '>=', $from)
            ->selectRaw('DATE(created_at) as d, COUNT(*) as c')
            ->groupBy('d')
            ->pluck('c', 'd')
            ->all();

        $labels = [];
        $values = [];
        for ($i = 0; $i < static::DAYS; $i++) {
            $date = $from->copy()->addDays($i)->toDateString();
            $labels[] = $date;
            $values[] = (int) ($counts[$date] ?? 0);
        }

        return [
            'labels' => $labels,
            'datasets' => [['label' => $this->label(), 'data' => $values]],
        ];
    }

    protected function getType(): string
    {
        return 'line';
    }
}
