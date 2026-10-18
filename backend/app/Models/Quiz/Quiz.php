<?php

namespace App\Models\Quiz;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

class Quiz extends Model
{
    protected $table = 'quizes';

    protected $fillable = [
        'title',
        'description',
        'user_id',
        'origin_owner_id',
        'origin_owner_name',
        'origin_owner_profile_picture',
        'category_id',
        'is_published',
        'is_live',
        'open_datetime',
        'close_datetime',
        'quiztime_mode',
        'duration',
        'logged_in_users_only',
        'safe_browser_mode',
        'quiz_mode',
        'visibility',
        'timezone',
        'join_link',
        'join_code',
        'is_pin_required',
        'pin',
        'deleted_at',
        'deleted_by',
    ];

    protected $casts = [
        'is_published' => 'boolean',
        'is_pin_required' => 'boolean',
        'open_datetime' => 'datetime',
        'close_datetime' => 'datetime',
        'quiztime_mode' => 'boolean',
        'logged_in_users_only' => 'boolean',
        'safe_browser_mode' => 'boolean',
        'deleted_at' => 'datetime',
        'deleted_by' => 'integer',
        'join_link' => 'string',
        'join_code' => 'string',
        'is_live' => 'boolean',
        'origin_owner_id' => 'integer',
    ];

    protected $appends = [
        'open_datetime_local',
        'close_datetime_local',
    ];

    public function getLocalDateTime($attribute)
    {
        if (empty($this->$attribute)) {
            return null;
        }

        $timezone = $this->timezone ?: config('app.timezone');

        try {
            $date = new \DateTime($this->$attribute, new \DateTimeZone('UTC'));
            $date->setTimezone(new \DateTimeZone($timezone));

            return $date->format('Y-m-d H:i:s');
        } catch (\Exception $e) {
            return $this->$attribute;
        }
    }

    public function getOpenDatetimeLocalAttribute()
    {
        return $this->getLocalDateTime('open_datetime');
    }

    public function getCloseDatetimeLocalAttribute()
    {
        return $this->getLocalDateTime('close_datetime');
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    // public function category()
    // {
    //     return $this->belongsTo(Category::class);
    // }

    public function questions()
    {
        // In the editor's order (they came back unsorted, e.g. in the quiz page's question list).
        return $this->hasMany(Question::class)->orderBy('serial_number')->orderBy('id');
    }

    public function quizParticipants()
    {
        return $this->hasMany(QuizParticipant::class);
    }

    public function sessions()
    {
        return $this->hasMany(QuizSession::class);
    }

    public function deletedBy()
    {
        return $this->belongsTo(User::class, 'deleted_by');
    }

    public function scopeActive($query)
    {
        return $query->where('is_published', true);
    }

    public function scopeInactive($query)
    {
        return $query->where('is_published', false);
    }

    public function scopePublished($query, $isPublished = true)
    {
        return $query->where('is_published', $isPublished);
    }

    public function scopeUnpublished($query)
    {
        return $query->where('is_published', false);
    }

    public function scopePublic($query, $visibility = 'public')
    {
        return $query->where('visibility', $visibility);
    }

    public function scopePrivate($query)
    {
        return $query->whereNot('visibility', 'public');
    }

    public function scopeSoftDeleted($query)
    {
        return $query->whereNotNull('deleted_at');
    }

    public function scopeNotSoftDeleted($query)
    {
        return $query->whereNull('deleted_at');
    }

    public function scopeSearch($query, $searchTerm)
    {
        return $query->whereRaw('LOWER(title) LIKE ?', ['%' . strtolower($searchTerm) . '%'])
            ->orWhereRaw('LOWER(description) LIKE ?', ['%' . strtolower($searchTerm) . '%']);
    }

    public function scopeFilterByUserId($query, $userId)
    {
        return $query->where('user_id', $userId);
    }

    public function scopeFilterByCategoryId($query, $categoryId)
    {
        return $query->where('category_id', $categoryId);
    }

    public function scopeFilterByIsPublished($query, $isPublished)
    {
        return $query->where('is_published', $isPublished);
    }

    public function scopeFilterByVisibility($query, $visibility)
    {
        return $query->where('visibility', $visibility);
    }

    public function scopeFilterByJoinLink($query, $joinLink)
    {
        return $query->where('join_link', $joinLink);
    }

    public function scopeFilterByJoinCode($query, $joinCode)
    {
        return $query->where('join_code', $joinCode);
    }

    public function scopeFilterByOpenDatetime($query, $openDatetime)
    {
        return $query->where('open_datetime', '>=', $openDatetime);
    }

    public function scopeFilterByCloseDatetime($query, $closeDatetime)
    {
        return $query->where('close_datetime', '<=', $closeDatetime);
    }

    public function scopeFilterByQuiztimeMode($query, $quiztimeMode)
    {
        return $query->where('quiztime_mode', $quiztimeMode);
    }

    public function scopeFilterByDuration($query, $duration)
    {
        return $query->where('duration', $duration);
    }

    public function scopeFilterByLoggedInUsersOnly($query, $loggedInUsersOnly)
    {
        return $query->where('logged_in_users_only', $loggedInUsersOnly);
    }

    public function scopeFilterBySafeBrowserMode($query, $safeBrowserMode)
    {
        return $query->where('safe_browser_mode', $safeBrowserMode);
    }

    public function scopeFilterByQuizMode($query, $quizMode)
    {
        return $query->where('quiz_mode', $quizMode);
    }

    public function scopeFilterByTimezone($query, $timezone)
    {
        return $query->where('timezone', $timezone);
    }

    public function scopeFilterByDeletedAt($query, $deletedAt)
    {
        return $query->where('deleted_at', $deletedAt);
    }

    public function scopeFilterByNotDeletedAt($query)
    {
        return $query->whereNull('deleted_at');
    }

    public function scopeFilterByDeletedBy($query, $deletedBy)
    {
        return $query->where('deleted_by', $deletedBy);
    }

    public function scopeFilterByInstitutionId($query, $institutionId)
    {
        return $query->where('institution_id', $institutionId);
    }

    public function scopeForAuthenticatedUser($query, $userId)
    {
        return $query->where('user_id', $userId);
    }

    public function scopeForDiscover($query)
    {
        return $query->where('visibility', 'public')->where('is_published', true);
    }

    public function scopeOrderById($query, $direction = 'desc')
    {
        return $query->orderBy('id', $direction);
    }

    public function scopeOrderByCreatedAt($query, $direction = 'desc')
    {
        return $query->orderBy('created_at', $direction);
    }

    public function scopeCompleted($query)
    {
        return $query->where('status', 'Completed');
    }

    public function scopeForQuiz($query, $quizId)
    {
        return $query->find($quizId);
    }

    public function scopeOrderByFastestTime($query)
    {
        $dbDriver = DB::getDriverName();

        if ($dbDriver == 'pgsql') {
            return $query->orderByRaw('EXTRACT(EPOCH FROM end_time - start_time) ASC');
        } elseif ($dbDriver == 'mysql' || $dbDriver == 'sqlite') {
            return $query->orderByRaw('TIMESTAMPDIFF(SECOND, start_time, end_time) ASC');
        } else {
            // Default ordering if DB driver is not recognized
            return $query->orderBy('score', 'desc');
        }
    }

    public function scopeTopParticipants($query, $limit = 10)
    {
        return $query->take($limit);
    }
}
