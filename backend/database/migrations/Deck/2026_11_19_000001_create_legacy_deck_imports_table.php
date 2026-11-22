<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * One row per legacy v1 quiz or quest copied into a deck by `legacy:convert-decks`
 * (app/Deck/Legacy). It makes the command safe to run again: a source that has a row
 * is never converted twice, even when its deck was deleted later. The legacy tables
 * themselves are only read.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('legacy_deck_imports', function (Blueprint $table) {
            $table->id();
            $table->string('source_type', 16); // quiz (table quizes) | quest (table quests)
            $table->unsignedBigInteger('source_id');
            $table->foreignId('deck_id')->nullable()->constrained('decks')->nullOnDelete();
            $table->unsignedInteger('slides_created')->default(0);
            // [{position, type, reason}] for every legacy question or task not converted.
            $table->jsonb('skipped')->nullable();
            $table->timestamps();
            $table->unique(['source_type', 'source_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('legacy_deck_imports');
    }
};
