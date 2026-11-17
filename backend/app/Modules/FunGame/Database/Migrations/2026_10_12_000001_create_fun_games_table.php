<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('fun_games', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('title', 200);
            $table->text('description')->nullable();
            $table->text('instructions')->nullable();
            $table->string('status', 20)->default('draft'); // draft | published
            // Both modes keep their own settings; switching mode never converts one into the other.
            $table->string('timer_mode', 20)->default('total'); // total | per_question
            $table->unsignedInteger('total_seconds')->default(1200);
            $table->boolean('allow_navigation')->default(true);
            $table->unsignedSmallInteger('seconds_per_question')->default(30);
            $table->decimal('default_marks', 6, 2)->default(1);
            $table->decimal('default_negative_marks', 6, 2)->default(0);
            $table->foreignId('source_quiz_id')->nullable()->constrained('quizes')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['user_id', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fun_games');
    }
};
