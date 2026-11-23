<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The BDREN session (ID token `sid`) a token was issued for, so a back-channel logout from BDREN revokes
// exactly the Mindspear sign-ins of that session.
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->string('sso_sid')->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->dropIndex(['sso_sid']);
            $table->dropColumn('sso_sid');
        });
    }
};
