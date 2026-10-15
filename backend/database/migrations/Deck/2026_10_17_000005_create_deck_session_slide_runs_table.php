<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One row per slide per session, frozen when the session starts. Live code
 * reads only these snapshots, so editing the deck mid-session is harmless.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('deck_session_slide_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('deck_session_id')->constrained('deck_sessions')->cascadeOnDelete();
            // Sessions outlive the authoring slide.
            $table->foreignId('slide_id')->nullable()->constrained('slides')->nullOnDelete();
            $table->integer('position_snapshot');
            $table->string('type_snapshot', 40);
            $table->text('title_snapshot')->nullable();
            $table->jsonb('body_snapshot')->nullable();
            $table->jsonb('config_snapshot')->default(DB::raw("'{}'::jsonb"));
            $table->jsonb('options_snapshot')->default(DB::raw("'[]'::jsonb"));
            $table->integer('time_limit_seconds')->nullable();
            $table->integer('get_ready_seconds')->nullable();
            // waiting | get_ready | voting | open | closed (Quiz adds reveal) — no CHECK on purpose.
            $table->string('state', 20)->default('waiting');
            $table->unsignedInteger('state_version')->default(0);
            $table->timestampTz('state_started_at', 3)->nullable();
            $table->timestampTz('voting_started_at', 3)->nullable();
            $table->timestampTz('closed_at', 3)->nullable();
            $table->timestampsTz(3);

            $table->unique(['deck_session_id', 'position_snapshot']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deck_session_slide_runs');
    }
};
