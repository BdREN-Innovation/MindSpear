<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('fun_game_answers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fun_game_participant_id')->constrained('fun_game_participants')->cascadeOnDelete();
            $table->foreignId('fun_game_question_id')->constrained('fun_game_questions')->cascadeOnDelete();
            $table->string('option_id', 32);
            $table->timestampTz('submitted_at', 3); // server time
            $table->boolean('is_correct')->nullable(); // set when the session is scored
            $table->timestamps();

            $table->unique(['fun_game_participant_id', 'fun_game_question_id'], 'fun_game_answers_participant_question_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fun_game_answers');
    }
};
