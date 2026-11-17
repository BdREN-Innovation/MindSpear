<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sharing for v2 quizzes and quests: a public deck is listed in Discover,
 * where any signed-in user can preview it and copy it into their library.
 * source_deck_id marks such a copy (it counts towards the source's "copied"
 * total and survives the source being deleted).
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('decks', function (Blueprint $table) {
            $table->string('visibility', 16)->default('private')->after('settings');
            $table->foreignId('source_deck_id')->nullable()->after('visibility')->constrained('decks')->nullOnDelete();

            $table->index(['product', 'visibility', 'updated_at']);
            $table->index('source_deck_id');
        });

        DB::statement("ALTER TABLE decks ADD CONSTRAINT decks_visibility_check CHECK (visibility IN ('private', 'public'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE decks DROP CONSTRAINT IF EXISTS decks_visibility_check');

        Schema::table('decks', function (Blueprint $table) {
            $table->dropIndex(['product', 'visibility', 'updated_at']);
            $table->dropIndex(['source_deck_id']);
            $table->dropConstrainedForeignId('source_deck_id');
            $table->dropColumn('visibility');
        });
    }
};
