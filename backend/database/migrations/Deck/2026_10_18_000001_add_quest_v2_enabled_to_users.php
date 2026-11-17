<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Quest v2 rollout flag (plan §8.3): internal → beta → default on → Quest v1
 * removed. Off by default; the frontend routes a user to the v2 editor only
 * when it is on.
 */
return new class () extends Migration {
    public function up(): void
    {
        if (Schema::hasColumn('users', 'quest_v2_enabled')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->boolean('quest_v2_enabled')->default(false);
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('users', 'quest_v2_enabled')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('quest_v2_enabled');
        });
    }
};
