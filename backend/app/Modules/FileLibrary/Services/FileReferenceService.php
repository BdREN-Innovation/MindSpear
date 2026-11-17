<?php

namespace App\Modules\FileLibrary\Services;

use App\Models\File;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Counts where a library file is still shown. Quizzes and quests (decks)
 * store the file id, so they are matched exactly. The question banks and fun
 * games store the image URL instead, so those are matched on the stored file
 * name, which is a random 40-character string and therefore unique.
 */
class FileReferenceService
{
    /**
     * Places that store image URLs: label => [table, column] (json columns are
     * searched as text). Every one of these tables soft-deletes.
     */
    private const URL_PLACES = [
        'question bank' => ['quiz_bank_questions', 'source_content_url'],
        'quest task bank' => ['quest_bank_tasks', 'task_data'],
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
        return [
            'deck covers' => DB::table('decks')
                ->where('cover_file_id', $fileId)
                ->whereNull('deleted_at'),
            'deck slides' => DB::table('slides')
                ->join('decks', 'decks.id', '=', 'slides.deck_id')
                ->where('slides.media_file_id', $fileId)
                ->whereNull('slides.deleted_at')
                ->whereNull('decks.deleted_at'),
            'deck slide options' => DB::table('slide_options')
                ->join('slides', 'slides.id', '=', 'slide_options.slide_id')
                ->join('decks', 'decks.id', '=', 'slides.deck_id')
                ->where('slide_options.image_file_id', $fileId)
                ->whereNull('slides.deleted_at')
                ->whereNull('decks.deleted_at'),
        ];
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
            $count = DB::table($table)
                ->whereRaw("CAST({$column} AS text) LIKE ?", [$like])
                ->whereNull('deleted_at')
                ->count();
            if ($count > 0) {
                $found[$label] = $count;
            }
        }

        return $found;
    }
}
