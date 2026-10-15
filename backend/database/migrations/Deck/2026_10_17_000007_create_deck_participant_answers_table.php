<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('deck_participant_answers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('deck_participant_id')->constrained('deck_participants')->cascadeOnDelete();
            $table->foreignId('slide_run_id')->constrained('deck_session_slide_runs')->cascadeOnDelete();
            $table->jsonb('answer_payload');
            $table->integer('time_to_answer_ms')->nullable();
            $table->boolean('is_correct')->nullable(); // Quiz only
            $table->integer('points_awarded')->nullable(); // Quiz only
            $table->timestampTz('submitted_at', 3)->nullable();
            $table->timestampsTz(3);

            // One answer row per participant per slide run (multi-entry types keep a list in the payload).
            $table->unique(['deck_participant_id', 'slide_run_id']);
            $table->index('slide_run_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deck_participant_answers');
    }
};
