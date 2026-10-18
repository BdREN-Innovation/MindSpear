<?php

namespace App\Models\Quiz;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Question extends Model
{
    use HasFactory;
    use SoftDeletes;

    protected $fillable = [
        'quiz_id',
        'owner_id',
        'serial_number',
        'question_text',
        'question_type',
        'time_limit_seconds',
        'points',
        'is_ai_generated',
        'source_content_url',
        'visibility',
        'options',
        'deleted_by',
        'deleted_at',
        'created_at',
        'updated_at',
    ];

    protected $casts = [
        'is_ai_generated' => 'boolean',
        'options' => 'array',
        'deleted_at' => 'datetime',
        'deleted_by' => 'integer',
        'quiz_id' => 'integer',
        'owner_id' => 'integer',
        'question_text' => 'string',
        'question_type' => 'string',
        'time_limit_seconds' => 'integer',
        'points' => 'integer',
    ];

    public function getSourceContentUrlAttribute($url)
    {
        return $url ? url($url) : null;
    }

    public function quiz()
    {
        return $this->belongsTo(Quiz::class);
    }

    public function userQuizAnswers()
    {
        return $this->hasMany(UserQuizAnswer::class);
    }

    public function deletedBy()
    {
        return $this->belongsTo(User::class, 'deleted_by');
    }

    // Bank category is not tracked on quiz questions anymore

    public function owner()
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /**
     * Rows made by "Add question" and never saved: placeholder text and no options yet.
     */
    public function scopeBlank($query)
    {
        return $query->whereNull('options')->where('question_text', '.');
    }

    /**
     * Questions with content: excludes the blank rows above.
     */
    public function scopeAuthored($query)
    {
        return $query->where(fn ($q) => $q->whereNotNull('options')->orWhere('question_text', '!=', '.'));
    }

    public function scopeActive($query)
    {
        return $query->where('is_published', true);
    }

    public function scopeInactive($query)
    {
        return $query->where('is_published', false);
    }

    public function scopeWithDeleted($query)
    {
        return $query->withTrashed();
    }

    public function scopeOnlyTrashed($query)
    {
        return $query->onlyTrashed();
    }

    public function scopeWhereQuizId($query, $quizId)
    {
        return $query->where('quiz_id', $quizId);
    }

    public function scopeWhereDeletedBy($query, $deletedBy)
    {
        return $query->where('deleted_by', $deletedBy);
    }

    public function scopeSearch($query, $searchTerm)
    {
        return $query->where('question_text', 'like', '%' . $searchTerm . '%');
    }

    public function scopeFilterByType($query, $type)
    {
        return $query->where('question_type', $type);
    }

    public function scopeFilterByTimeLimit($query, $timeLimit)
    {
        return $query->where('time_limit_seconds', '<=', $timeLimit);
    }

    public function scopeFilterByPoints($query, $points)
    {
        return $query->where('points', '<=', $points);
    }

    public function scopeFilterByAiGenerated($query, $isAiGenerated)
    {
        return $query->where('is_ai_generated', $isAiGenerated);
    }

    public function scopeFilterBySourceContentUrl($query, $sourceContentUrl)
    {
        return $query->where('source_content_url', 'like', '%' . $sourceContentUrl . '%');
    }

    public function scopeFilterByVisibility($query, $visibility)
    {
        return $query->where('visibility', $visibility);
    }

    public function scopeFilterBySerialNumber($query, $serialNumber)
    {
        return $query->orderBy('id', $serialNumber);
    }

    public function scopeFilterByDeletedBy($query, $deletedBy)
    {
        return $query->where('deleted_by', $deletedBy);
    }

    public function scopeFilterByDeletedAt($query, $deletedAt)
    {
        return $query->where('deleted_at', $deletedAt);
    }

    public function scopeFilterByNotDeletedAt($query)
    {
        return $query->whereNull('deleted_at');
    }

    public function scopeFilterByQuiz($query, $quiz)
    {
        return $query->where('quiz_id', $quiz->id);
    }

    public function scopeFilterByQuizId($query, $quizId)
    {
        return $query->where('quiz_id', $quizId);
    }
}
