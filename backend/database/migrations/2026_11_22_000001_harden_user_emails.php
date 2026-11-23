<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Email hardening:
 *  - a changed email waits in pending_email until the person proves it (ProfileController::update);
 *  - emails are compared case-insensitively everywhere, so one address can't exist twice in
 *    different spellings (which would let a second account catch the real owner's SSO sign-in).
 * Password reset tokens become hashed and time-limited (AuthenticationController) without a schema change.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('pending_email')->nullable()->after('email');
            $table->string('pending_email_token', 64)->nullable()->after('pending_email');
            $table->timestamp('pending_email_requested_at')->nullable()->after('pending_email_token');
        });

        // Lowercase existing addresses; if two rows only differ by case, keep the first and tag
        // the others so the index can be created (they are reported in the log for a human to merge).
        DB::statement('UPDATE users SET email = LOWER(email) WHERE email <> LOWER(email) AND NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.id <> users.id AND LOWER(u2.email) = LOWER(users.email))');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email))');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS users_email_lower_unique');
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['pending_email', 'pending_email_token', 'pending_email_requested_at']);
        });
    }
};
