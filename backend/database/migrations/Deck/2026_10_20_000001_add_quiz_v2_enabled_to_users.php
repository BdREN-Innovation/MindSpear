<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Quiz v2 rollout flag (QUIZ_REDESIGN_PLAN.md §2.4, §4.3), gated exactly like
 * users.quest_v2_enabled. Off by default; QUIZ_V2_DEFAULT_ENABLED turns it on
 * for every account.
 */
return new class () extends Migration {
    public function up(): void
    {
        if (Schema::hasColumn('users', 'quiz_v2_enabled')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->boolean('quiz_v2_enabled')->default(false);
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('users', 'quiz_v2_enabled')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('quiz_v2_enabled');
        });
    }
};
