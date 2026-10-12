<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('fun_game_imports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fun_game_id')->constrained('fun_games')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('source', 20); // json | library_quiz
            $table->unsignedBigInteger('source_quiz_id')->nullable();
            $table->string('mode', 10); // append | replace
            $table->jsonb('previous_questions'); // snapshot for Undo
            $table->jsonb('previous_timer')->nullable();
            $table->unsignedInteger('added_count')->default(0);
            $table->unsignedInteger('removed_count')->default(0);
            $table->timestampTz('undone_at', 3)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fun_game_imports');
    }
};
