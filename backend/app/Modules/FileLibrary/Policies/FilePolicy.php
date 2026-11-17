<?php

namespace App\Modules\FileLibrary\Policies;

use App\Models\File;
use App\Models\User;

class FilePolicy
{
    /** A library file is only visible to and managed by the user who uploaded it. */
    public function manage(User $user, File $file): bool
    {
        return $file->user_id !== null && (int) $file->user_id === (int) $user->id;
    }
}
