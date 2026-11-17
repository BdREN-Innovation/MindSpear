<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

/**
 * Base data every environment needs. The question / task bank seeders
 * (Database\Seeders\Quiz\QuizBankQuestionSeeder,
 * Database\Seeders\Quest\QuestBankTaskSeeder) are demo content: run them with
 * `php artisan db:seed --class=...`.
 */
class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            UsersTableSeeder::class,
            PasswordResetTokensTableSeeder::class,
            PreferencesTableSeeder::class,
            SuperAdminSeeder::class,
        ]);
    }
}
