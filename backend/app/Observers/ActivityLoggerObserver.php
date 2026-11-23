<?php

namespace App\Observers;

use App\Models\Log\ActivityLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Request;

class ActivityLoggerObserver
{
    public function created(Model $model): void
    {
        $this->log($model, 'created');
    }

    public function updated(Model $model): void
    {
        // Never record password hashes or tokens (the model's hidden attributes).
        $secret = array_merge($model->getHidden(), ['password', 'remember_token', 'email_verification_token', 'pending_email_token']);
        $changes = [
            'attributes' => \Illuminate\Support\Arr::except($model->getChanges(), $secret),
            'original' => \Illuminate\Support\Arr::except($model->getOriginal(), $secret),
        ];
        $this->log($model, 'updated', $changes);
    }

    public function deleted(Model $model): void
    {
        $this->log($model, 'deleted');
    }

    public function restored(Model $model): void
    {
        $this->log($model, 'restored');
    }

    protected function log(Model $model, string $event, ?array $changes = null): void
    {
        ActivityLog::create([
            'user_id' => optional(auth()->user())->id,
            'subject_type' => get_class($model),
            'subject_id' => $model->getKey(),
            'event' => $event,
            'changes' => $changes,
            'ip' => Request::ip(),
            'user_agent' => Request::userAgent(),
        ]);
    }
}
