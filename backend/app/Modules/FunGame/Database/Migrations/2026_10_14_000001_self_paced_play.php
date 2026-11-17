<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Self-paced play: each player gets their own (shuffled) question order and
 * their own deadlines; scoring can reward speed.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('fun_games', function (Blueprint $table) {
            $table->string('scoring_mode', 10)->default('marks'); // marks | speed
            $table->boolean('shuffle_questions')->default(true);
        });

        Schema::table('fun_game_sessions', function (Blueprint $table) {
            $table->timestampTz('join_closes_at', 3)->nullable(); // new players can't join after this
            $table->timestampTz('ends_at', 3)->nullable(); // hard end: every admitted player can finish by then
        });

        Schema::table('fun_game_participants', function (Blueprint $table) {
            $table->jsonb('question_order')->nullable();
            $table->unsignedInteger('current_index')->nullable(); // null until the first question is opened
            $table->timestampTz('current_opened_at', 3)->nullable();
            $table->timestampTz('current_deadline', 3)->nullable(); // per-question timer
            $table->timestampTz('first_opened_at', 3)->nullable();
            $table->timestampTz('personal_deadline', 3)->nullable(); // total timer
            $table->unsignedInteger('elapsed_ms')->nullable(); // first question shown → finished
            $table->decimal('score', 12, 2)->nullable()->change();
            $table->index(['fun_game_session_id', 'finished_at']);
        });

        Schema::table('fun_game_answers', function (Blueprint $table) {
            $table->timestampTz('opened_at', 3)->nullable();
            $table->unsignedInteger('response_ms')->nullable();
            $table->decimal('points', 10, 2)->nullable();
        });

        // Sessions still running under the old shared-question flow can't continue.
        DB::table('fun_game_sessions')
            ->whereIn('status', ['live', 'finishing'])
            ->update(['status' => 'finished', 'finished_at' => now(), 'ended_by_host' => true]);
    }

    public function down(): void
    {
        Schema::table('fun_game_answers', function (Blueprint $table) {
            $table->dropColumn(['opened_at', 'response_ms', 'points']);
        });
        Schema::table('fun_game_participants', function (Blueprint $table) {
            $table->dropIndex(['fun_game_session_id', 'finished_at']);
            $table->dropColumn([
                'question_order', 'current_index', 'current_opened_at', 'current_deadline',
                'first_opened_at', 'personal_deadline', 'elapsed_ms',
            ]);
        });
        Schema::table('fun_game_sessions', function (Blueprint $table) {
            $table->dropColumn(['join_closes_at', 'ends_at']);
        });
        Schema::table('fun_games', function (Blueprint $table) {
            $table->dropColumn(['scoring_mode', 'shuffle_questions']);
        });
    }
};
