<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('fun_game_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fun_game_id')->constrained('fun_games')->cascadeOnDelete();
            $table->string('join_code', 12)->unique();
            $table->string('public_channel_key', 64)->unique();
            $table->string('status', 20)->default('waiting'); // waiting | live | finishing | finished
            $table->timestampTz('starts_at', 3)->nullable(); // scheduled start; null = host starts it
            $table->timestampTz('started_at', 3)->nullable();
            $table->timestampTz('deadline', 3)->nullable(); // total mode
            $table->integer('current_question_index')->nullable(); // per-question mode
            $table->unsignedBigInteger('current_question_id')->nullable();
            $table->timestampTz('question_opened_at', 3)->nullable();
            $table->timestampTz('question_deadline', 3)->nullable();
            $table->integer('locked_question_index')->nullable();
            $table->timestampTz('next_opens_at', 3)->nullable();
            $table->timestampTz('finishing_at', 3)->nullable();
            $table->timestampTz('finished_at', 3)->nullable();
            // Timer and question order frozen when the session starts.
            $table->jsonb('timer_snapshot')->nullable();
            $table->boolean('ended_by_host')->default(false);
            $table->timestamps();

            $table->index(['status', 'starts_at']);
            $table->index(['fun_game_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fun_game_sessions');
    }
};
