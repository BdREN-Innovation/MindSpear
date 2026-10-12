<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('fun_game_questions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fun_game_id')->constrained('fun_games')->cascadeOnDelete();
            $table->unsignedInteger('position')->default(0);
            $table->string('type', 30)->default('single_choice');
            $table->text('text');
            $table->string('image_url', 2048)->nullable();
            $table->jsonb('options'); // [{id, text}]
            $table->string('correct_option_id', 32);
            $table->decimal('marks', 6, 2)->default(1);
            $table->decimal('negative_marks', 6, 2)->default(0);
            $table->unsignedSmallInteger('seconds_override')->nullable(); // per-question mode only
            $table->timestamps();

            $table->index(['fun_game_id', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fun_game_questions');
    }
};
