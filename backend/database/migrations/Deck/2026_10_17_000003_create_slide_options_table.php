<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('slide_options', function (Blueprint $table) {
            $table->id();
            $table->foreignId('slide_id')->constrained('slides')->cascadeOnDelete();
            $table->integer('position');
            $table->text('label')->nullable();
            $table->foreignId('image_file_id')->nullable()->constrained('files')->nullOnDelete();
            $table->boolean('is_correct')->nullable(); // Quiz only
            // Type-specific extras: pair_key, category_key, correct_order_index, matrix label...
            $table->jsonb('payload')->default(DB::raw("'{}'::jsonb"));
            $table->timestamps();

            $table->index(['slide_id', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('slide_options');
    }
};
