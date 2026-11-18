<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A BDREN SSO identity (issuer + subject) linked to a Mindspear user. Users are
 * found by (issuer, subject), never by email. Removing the SSO module = dropping
 * this table; the users table is not touched.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('sso_identities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('issuer');
            $table->string('subject');
            $table->string('email')->nullable();
            $table->boolean('email_verified')->default(false);
            // How the identity was first matched: subject (new user), email (existing user) or link (from the profile).
            $table->string('linked_via', 16);
            $table->timestamp('last_login_at')->nullable();
            $table->timestamps();

            $table->unique(['issuer', 'subject']);
            // One BDREN identity per user per issuer.
            $table->unique(['user_id', 'issuer']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sso_identities');
    }
};
