<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Copying someone's public quiz or quest gives the copier their own My Files
 * rows for its images, pointing at the same stored bytes. Replacing a file
 * looks up other rows on the same disk_path before deleting the old bytes.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->index('disk_path');
        });
    }

    public function down(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->dropIndex(['disk_path']);
        });
    }
};
