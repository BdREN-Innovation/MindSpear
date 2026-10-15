<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('deck_qa_questions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('deck_session_id')->constrained('deck_sessions')->cascadeOnDelete();
            $table->foreignId('slide_run_id')->constrained('deck_session_slide_runs')->cascadeOnDelete();
            $table->foreignId('participant_id')->nullable()->constrained('deck_participants')->nullOnDelete();
            $table->text('body');
            // Only ever changed with `upvote_count = upvote_count ± 1`, never read-modify-write.
            $table->integer('upvote_count')->default(0);
            $table->boolean('is_answered')->default(false);
            $table->boolean('is_hidden')->default(false);
            $table->boolean('is_starred')->default(false);
            $table->timestampTz('submitted_at', 3)->nullable();
            $table->timestampsTz(3);

            // Top-N reads: most upvoted first.
            $table->rawIndex('slide_run_id, upvote_count DESC', 'deck_qa_questions_run_upvotes_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deck_qa_questions');
    }
};
