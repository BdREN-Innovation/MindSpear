<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Each player answers N questions drawn from the game's pool. */
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('fun_games', function (Blueprint $table) {
            $table->unsignedSmallInteger('questions_per_player')->nullable(); // null = all questions
            $table->string('question_selection', 10)->default('same'); // same | different
        });
    }

    public function down(): void
    {
        Schema::table('fun_games', function (Blueprint $table) {
            $table->dropColumn(['questions_per_player', 'question_selection']);
        });
    }
};
