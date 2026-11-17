<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Turns the generic `files` table into the per-user library ("My Files"):
 * numeric size for quota sums, image/document category, private storage
 * for documents and a checksum to reuse identical uploads.
 * Soft-deleted rows are kept; they no longer count toward quota.
 */
return new class extends Migration
{
    public function up(): void
    {
        // size was a string; quota needs SUM(size).
        DB::statement("ALTER TABLE files ALTER COLUMN size TYPE bigint USING COALESCE(NULLIF(regexp_replace(size, '[^0-9]', '', 'g'), '')::bigint, 0)");
        DB::statement('ALTER TABLE files ALTER COLUMN size SET DEFAULT 0');
        DB::statement('ALTER TABLE files ALTER COLUMN size SET NOT NULL');
        // Private documents have no public path.
        DB::statement('ALTER TABLE files ALTER COLUMN path DROP NOT NULL');

        Schema::table('files', function (Blueprint $table) {
            $table->string('category', 16)->default('document')->after('type');
            $table->string('disk', 32)->default('local')->after('path');
            $table->string('disk_path', 512)->nullable()->after('disk');
            $table->string('visibility', 10)->default('public')->after('disk_path');
            $table->char('checksum', 64)->nullable()->after('extension');
            $table->unsignedInteger('page_count')->nullable()->after('checksum');
            $table->string('extraction_status', 16)->default('none')->after('page_count');
            $table->timestamp('last_used_at')->nullable()->after('extraction_status');

            $table->index(['user_id', 'category', 'created_at']);
            $table->index(['user_id', 'checksum']);
        });

        DB::statement("UPDATE files SET category = CASE WHEN mime_type LIKE 'image/%' OR type = 'image' THEN 'image' ELSE 'document' END");
        DB::statement("UPDATE files SET disk_path = regexp_replace(path, '^storage/', 'public/') WHERE path IS NOT NULL");
    }

    public function down(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'category', 'created_at']);
            $table->dropIndex(['user_id', 'checksum']);
            $table->dropColumn(['category', 'disk', 'disk_path', 'visibility', 'checksum', 'page_count', 'extraction_status', 'last_used_at']);
        });

        DB::statement("UPDATE files SET path = '' WHERE path IS NULL");
        DB::statement('ALTER TABLE files ALTER COLUMN path SET NOT NULL');
        DB::statement('ALTER TABLE files ALTER COLUMN size DROP DEFAULT');
        DB::statement('ALTER TABLE files ALTER COLUMN size TYPE varchar(255) USING size::text');
    }
};
