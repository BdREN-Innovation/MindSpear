<?php

namespace App\Deck\Legacy;

use Illuminate\Console\Command;

/**
 * One-time migration: copies the legacy v1 quizzes and quests (which the deck editor
 * can't show) into decks owned by the same users. Safe to run again; see
 * LegacyDeckConverter and PRODUCTION_MIGRATION_GUIDE.md §1.4.
 */
class ConvertLegacyDecks extends Command
{
    protected $signature = 'legacy:convert-decks
        {--dry-run : Check everything and report, but save nothing}
        {--only= : quiz or quest (default: both)}
        {--id=* : Only these legacy ids (with --only)}
        {--visibility=private : private (default) or keep (public stays public, so it appears in Discover)}
        {--report= : Also write the full per-deck report to this JSON file}';

    protected $description = 'Copy legacy v1 quizzes and quests into decks (old tables are only read)';

    public function handle(LegacyDeckConverter $converter): int
    {
        $only = $this->option('only');
        if ($only !== null && ! in_array($only, [LegacyDeckImport::SOURCE_QUIZ, LegacyDeckImport::SOURCE_QUEST], true)) {
            $this->error('--only must be quiz or quest.');

            return self::INVALID;
        }
        $ids = array_map('intval', (array) $this->option('id'));
        if ($ids !== [] && $only === null) {
            $this->error('--id needs --only=quiz or --only=quest.');

            return self::INVALID;
        }
        $visibility = $this->option('visibility');
        if (! in_array($visibility, [LegacyDeckConverter::VISIBILITY_PRIVATE, LegacyDeckConverter::VISIBILITY_KEEP], true)) {
            $this->error('--visibility must be private or keep.');

            return self::INVALID;
        }
        $dryRun = (bool) $this->option('dry-run');

        $sources = [];
        foreach ([LegacyDeckImport::SOURCE_QUIZ, LegacyDeckImport::SOURCE_QUEST] as $source) {
            if ($only === null || $only === $source) {
                $list = $ids !== [] ? $ids : ($source === LegacyDeckImport::SOURCE_QUIZ ? $converter->quizIds() : $converter->questIds());
                foreach ($list as $id) {
                    $sources[] = [$source, $id];
                }
            }
        }

        $this->info(($dryRun ? 'DRY RUN, nothing is saved. ' : '') . 'Converting ' . count($sources) . ' legacy quizzes/quests...');
        $results = [];
        $bar = $this->output->createProgressBar(count($sources));
        foreach ($sources as [$source, $id]) {
            $results[] = $converter->convert($source, $id, $dryRun, $visibility);
            $bar->advance();
        }
        $bar->finish();
        $this->newLine(2);

        $this->summary($results);

        if ($path = $this->option('report')) {
            file_put_contents($path, json_encode($results, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $this->info("Full report: {$path}");
        }

        return collect($results)->whereIn('status', ['failed', 'missing'])->isNotEmpty() ? self::FAILURE : self::SUCCESS;
    }

    private function summary(array $results): void
    {
        $rows = [];
        foreach ([LegacyDeckImport::SOURCE_QUIZ, LegacyDeckImport::SOURCE_QUEST] as $source) {
            $of = collect($results)->where('source', $source);
            if ($of->isEmpty()) {
                continue;
            }
            $rows[] = [
                $source,
                $of->where('status', 'converted')->count(),
                $of->where('status', 'converted')->where('slides', 0)->count(),
                $of->where('status', 'already')->count(),
                $of->where('status', 'failed')->count() + $of->where('status', 'missing')->count(),
                $of->sum('slides'),
                $of->sum(fn ($r) => count($r['skipped'])),
            ];
        }
        $this->table(['Source', 'Converted', 'of which empty', 'Already done', 'Failed', 'Slides created', 'Questions skipped'], $rows);

        $reasons = collect($results)->flatMap(fn ($r) => array_map(fn ($s) => "{$r['source']}: {$s['reason']}", $r['skipped']))->countBy()->sortDesc();
        if ($reasons->isNotEmpty()) {
            $this->line('Skipped questions by reason:');
            $this->table(['Reason', 'Count'], $reasons->map(fn ($n, $reason) => [$reason, $n])->values()->all());
        }

        $notes = collect($results)->sum(fn ($r) => count($r['notes']));
        if ($notes > 0) {
            $this->line("{$notes} converted questions carry a note (for example no correct answer marked); see --report.");
        }

        foreach (collect($results)->whereIn('status', ['failed', 'missing']) as $r) {
            $this->error("{$r['source']} #{$r['id']} \"{$r['title']}\": {$r['error']}");
        }
    }
}
