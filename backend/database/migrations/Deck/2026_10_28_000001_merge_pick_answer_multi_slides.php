<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/*
 * Pick answer takes one or several correct answers now, so pick_answer_multi
 * slides (soft-deleted ones too) become pick_answer_single. Their options and
 * correct marks stay; config is {} for both. Session runs keep their
 * type_snapshot, so past results still read as pick_answer_multi.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('slides')->where('type', 'pick_answer_multi')->update(['type' => 'pick_answer_single', 'updated_at' => now()]);
    }

    /** One-way: a converted slide can't be told from one made as Pick answer. */
    public function down(): void {}
};
