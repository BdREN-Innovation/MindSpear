<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('deck_qa_upvotes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('qa_question_id')->constrained('deck_qa_questions')->cascadeOnDelete();
            $table->foreignId('participant_id')->constrained('deck_participants')->cascadeOnDelete();
            $table->timestampTz('created_at', 3)->useCurrent();

            $table->unique(['qa_question_id', 'participant_id']);
            $table->index('participant_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deck_qa_upvotes');
    }
};
