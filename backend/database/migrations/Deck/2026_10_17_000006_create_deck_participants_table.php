<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('deck_participants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('deck_session_id')->constrained('deck_sessions')->cascadeOnDelete();
            $table->string('display_name', 80)->nullable();
            // First-class column (not JSON) so leaderboard joins can read it.
            $table->string('emoji_avatar', 32)->nullable();
            $table->char('participant_token_hash', 64)->unique(); // SHA-256 hex
            $table->timestampTz('participant_token_expires_at', 3)->nullable();
            $table->timestampTz('participant_token_revoked_at', 3)->nullable();
            $table->integer('total_points')->nullable(); // Quiz only
            $table->timestampTz('joined_at', 3)->nullable();
            $table->timestampTz('left_at', 3)->nullable();
            $table->timestampsTz(3);

            $table->index(['deck_session_id', 'joined_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deck_participants');
    }
};
