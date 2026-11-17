<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('slides', function (Blueprint $table) {
            $table->id();
            $table->foreignId('deck_id')->constrained('decks')->cascadeOnDelete();
            $table->string('type', 40); // SlideTypeRegistry key
            // Signed: reorders stage rows at -position inside one transaction.
            $table->integer('position');
            $table->text('title')->nullable();
            $table->jsonb('body')->nullable(); // rich text for content slides
            $table->jsonb('config')->default(DB::raw("'{}'::jsonb"));
            // Image for image/pin_on_image, mp4 for video. Never a storage path.
            $table->foreignId('media_file_id')->nullable()->constrained('files')->nullOnDelete();
            $table->integer('time_limit_seconds')->nullable();
            $table->integer('get_ready_seconds')->nullable();
            // Quiz only.
            $table->integer('points_min')->nullable();
            $table->integer('points_max')->nullable();
            $table->boolean('speed_bonus_enabled')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });

        // Soft-deleted slides must not block the position they used to hold.
        DB::statement('CREATE UNIQUE INDEX slides_deck_id_position_unique ON slides (deck_id, position) WHERE deleted_at IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('slides');
    }
};
