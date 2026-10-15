<?php

namespace App\Modules\FileLibrary\Services;

use App\Models\File;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Counts where a library image is still shown. Questions store the image
 * URL (not the file id), so this matches on the stored file name, which is
 * a random 40-character string and therefore unique.
 */
class FileReferenceService
{
    /** table => column (json columns are searched as text) */
    private const PLACES = [
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
        $path = $file->getRawOriginal('path');
        if (! $file->isImage() || ! $path) {
            return [];
        }

        $like = '%' . addcslashes(basename($path), '%_\\') . '%';
        $found = [];
        foreach (self::PLACES as $label => [$table, $column]) {
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
