<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Shared slide engine (Quest v2 now, Quiz v2 later): one deck per authored
 * presentation, discriminated by `product`.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('decks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->string('product', 16); // quest | quiz
            $table->string('title');
            $table->text('description')->nullable();
            $table->foreignId('cover_file_id')->nullable()->constrained('files')->nullOnDelete();
            // Deck-wide defaults (time limit, get_ready, theme).
            $table->jsonb('settings')->default(DB::raw("'{}'::jsonb"));
            $table->timestamp('published_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['owner_id', 'product', 'updated_at']);
        });

        DB::statement("ALTER TABLE decks ADD CONSTRAINT decks_product_check CHECK (product IN ('quest', 'quiz'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('decks');
    }
};
