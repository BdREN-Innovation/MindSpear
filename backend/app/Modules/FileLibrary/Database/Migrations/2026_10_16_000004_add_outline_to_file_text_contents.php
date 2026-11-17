<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Chapters/headings of a document ([{title, level, page}]); null = not read yet, [] = none. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('file_text_contents', function (Blueprint $table) {
            $table->jsonb('outline')->nullable()->after('pages');
        });
    }

    public function down(): void
    {
        Schema::table('file_text_contents', function (Blueprint $table) {
            $table->dropColumn('outline');
        });
    }
};
