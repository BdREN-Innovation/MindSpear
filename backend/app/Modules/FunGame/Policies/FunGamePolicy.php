<?php

namespace App\Modules\FunGame\Policies;

use App\Models\User;
use App\Modules\FunGame\Models\FunGame;

class FunGamePolicy
{
    /** Games, their questions and sessions are managed by their creator only. */
    public function manage(User $user, FunGame $game): bool
    {
        return (int) $game->user_id === (int) $user->id;
    }
}
