<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Added separately: deck_sessions and deck_session_slide_runs reference each other. */
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('deck_sessions', function (Blueprint $table) {
            $table->foreign('current_slide_run_id')
                ->references('id')->on('deck_session_slide_runs')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('deck_sessions', function (Blueprint $table) {
            $table->dropForeign(['current_slide_run_id']);
        });
    }
};
