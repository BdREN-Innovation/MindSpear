<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        // Questions are soft-deleted so finished sessions keep their questions,
        // answers and answer sheets after the game is edited or re-imported.
        Schema::table('fun_game_questions', function (Blueprint $table) {
            $table->softDeletes();
        });

        // Undo works on question ids instead of a copy of the old rows.
        Schema::table('fun_game_imports', function (Blueprint $table) {
            $table->jsonb('added_question_ids')->nullable();
            $table->jsonb('removed_question_ids')->nullable();
            $table->jsonb('skipped')->nullable(); // [{position, text, reason}]
            $table->jsonb('previous_questions')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('fun_game_imports', function (Blueprint $table) {
            $table->dropColumn(['added_question_ids', 'removed_question_ids', 'skipped']);
        });
        Schema::table('fun_game_questions', function (Blueprint $table) {
            $table->dropSoftDeletes();
        });
    }
};
