<?php

namespace App\Modules\FileLibrary\Services;

use App\Models\File;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Counts where a library file is still shown. Decks (Quest/Quiz v2) store the
 * file id, so they are matched exactly. Older questions store the image URL
 * instead, so those are matched on the stored file name, which is a random
 * 40-character string and therefore unique.
 */
class FileReferenceService
{
    /** Legacy places that store image URLs: label => [table, column] (json columns are searched as text). */
    private const URL_PLACES = [
        'quiz questions' => ['questions', 'source_content_url'],
        'question bank' => ['quiz_bank_questions', 'source_content_url'],
        'quest tasks' => ['quest_tasks', 'task_data'],
        'quest task bank' => ['quest_bank_tasks', 'task_data'],
        'survey questions' => ['survey_questions', 'options'],
        'fun game questions' => ['fun_game_questions', 'image_url'],
    ];

    /**
     * @return array<string, int> place => count, only places with references
     */
    public function references(File $file): array
    {
        $found = [];
        foreach ($this->idQueries($file->id) as $label => $query) {
            $count = $query->count();
            if ($count > 0) {
                $found[$label] = $count;
            }
        }

        return $found + $this->urlReferences($file);
    }

    /**
     * Deck places that point at the file by id. Soft-deleted decks and slides
     * don't count: deleting them never touches My Files, and nobody sees them.
     *
     * @return array<string, Builder>
     */
    private function idQueries(int $fileId): array
    {
        $queries = [];

        if (Schema::hasTable('decks')) {
            $queries['deck covers'] = DB::table('decks')
                ->where('cover_file_id', $fileId)
                ->whereNull('deleted_at');
        }
        if (Schema::hasTable('slides')) {
            $queries['deck slides'] = DB::table('slides')
                ->join('decks', 'decks.id', '=', 'slides.deck_id')
                ->where('slides.media_file_id', $fileId)
                ->whereNull('slides.deleted_at')
                ->whereNull('decks.deleted_at');
        }
        if (Schema::hasTable('slide_options')) {
            $queries['deck slide options'] = DB::table('slide_options')
                ->join('slides', 'slides.id', '=', 'slide_options.slide_id')
                ->join('decks', 'decks.id', '=', 'slides.deck_id')
                ->where('slide_options.image_file_id', $fileId)
                ->whereNull('slides.deleted_at')
                ->whereNull('decks.deleted_at');
        }

        return $queries;
    }

    /** @return array<string, int> */
    private function urlReferences(File $file): array
    {
        $path = $file->getRawOriginal('path');
        if (! $file->isImage() || ! $path) {
            return [];
        }

        $like = '%' . addcslashes(basename($path), '%_\\') . '%';
        $found = [];
        foreach (self::URL_PLACES as $label => [$table, $column]) {
            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
                continue;
            }
            $query = DB::table($table)->whereRaw("CAST({$column} AS text) LIKE ?", [$like]);
            if (Schema::hasColumn($table, 'deleted_at')) {
                $query->whereNull('deleted_at');
            }
            $count = $query->count();
            if ($count > 0) {
                $found[$label] = $count;
            }
        }

        return $found;
    }
}
