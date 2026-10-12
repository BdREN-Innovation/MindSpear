<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('fun_game_participants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fun_game_session_id')->constrained('fun_game_sessions')->cascadeOnDelete();
            $table->string('name', 60);
            $table->string('email', 190); // stored lower-cased
            $table->string('participant_token_hash', 64)->nullable()->unique();
            $table->timestampTz('participant_token_expires_at', 3)->nullable();
            $table->timestampTz('participant_token_revoked_at', 3)->nullable();
            $table->timestampTz('joined_at', 3);
            $table->timestampTz('last_seen_at', 3)->nullable();
            $table->timestampTz('finished_at', 3)->nullable(); // total mode: handed in early
            $table->decimal('score', 8, 2)->nullable();
            $table->unsignedInteger('correct_count')->nullable();
            $table->unsignedInteger('incorrect_count')->nullable();
            $table->unsignedInteger('unanswered_count')->nullable();
            $table->unsignedInteger('rank')->nullable();
            $table->timestamps();

            $table->unique(['fun_game_session_id', 'email']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fun_game_participants');
    }
};
