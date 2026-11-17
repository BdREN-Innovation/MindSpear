<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('deck_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('deck_id')->constrained('decks')->cascadeOnDelete();
            $table->foreignId('host_user_id')->constrained('users')->cascadeOnDelete();
            $table->string('public_channel_key', 64)->unique();
            // Globally unique (not just among live sessions): old links stay unambiguous.
            $table->string('join_code', 12)->unique();
            $table->string('status', 16)->default('pending'); // pending | live | ended
            // FK to deck_session_slide_runs is added once that table exists (000010).
            $table->unsignedBigInteger('current_slide_run_id')->nullable();
            $table->jsonb('timer_state')->nullable();
            $table->timestampTz('started_at', 3)->nullable();
            $table->timestampTz('ended_at', 3)->nullable();
            $table->timestampsTz(3);

            $table->index(['deck_id', 'status']);
            $table->index(['host_user_id', 'status']);
        });

        DB::statement("ALTER TABLE deck_sessions ADD CONSTRAINT deck_sessions_status_check CHECK (status IN ('pending', 'live', 'ended'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('deck_sessions');
    }
};
