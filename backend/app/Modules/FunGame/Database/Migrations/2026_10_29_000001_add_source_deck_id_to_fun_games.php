<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Games and imports copied from a My Library quiz now point at the quiz deck
 * (decks.id). source_quiz_id keeps the legacy quiz of games made before.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fun_games', function (Blueprint $table) {
            $table->foreignId('source_deck_id')->nullable()->after('source_quiz_id')->constrained('decks')->nullOnDelete();
        });

        Schema::table('fun_game_imports', function (Blueprint $table) {
            $table->unsignedBigInteger('source_deck_id')->nullable()->after('source_quiz_id');
        });
    }

    public function down(): void
    {
        Schema::table('fun_game_imports', function (Blueprint $table) {
            $table->dropColumn('source_deck_id');
        });

        Schema::table('fun_games', function (Blueprint $table) {
            $table->dropConstrainedForeignId('source_deck_id');
        });
    }
};
