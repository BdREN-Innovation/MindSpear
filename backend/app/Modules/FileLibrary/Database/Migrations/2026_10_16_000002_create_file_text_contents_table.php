<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Text pulled out of a library document (per page/slide/section), kept apart so file lists stay light. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('file_text_contents', function (Blueprint $table) {
            $table->unsignedBigInteger('file_id')->primary();
            $table->jsonb('pages');
            $table->unsignedInteger('char_count')->default(0);
            $table->string('extractor', 32);
            $table->timestamp('extracted_at')->nullable();
            $table->timestamps();

            $table->foreign('file_id')->references('id')->on('files')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_text_contents');
    }
};
