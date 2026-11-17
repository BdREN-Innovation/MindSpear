<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Indexes the deck columns that point at My Files. PostgreSQL doesn't index
 * foreign keys on its own, so every My Files delete (FileReferenceService) and
 * every nullOnDelete would otherwise scan all decks, slides and options.
 * Partial: most rows have no file attached.
 */
return new class () extends Migration {
    private const INDEXES = [
        'decks_cover_file_id_index' => ['decks', 'cover_file_id'],
        'slides_media_file_id_index' => ['slides', 'media_file_id'],
        'slide_options_image_file_id_index' => ['slide_options', 'image_file_id'],
    ];

    public function up(): void
    {
        foreach (self::INDEXES as $index => [$table, $column]) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, $column)) {
                DB::statement("CREATE INDEX IF NOT EXISTS {$index} ON {$table} ({$column}) WHERE {$column} IS NOT NULL");
            }
        }
    }

    public function down(): void
    {
        foreach (array_keys(self::INDEXES) as $index) {
            DB::statement("DROP INDEX IF EXISTS {$index}");
        }
    }
};
