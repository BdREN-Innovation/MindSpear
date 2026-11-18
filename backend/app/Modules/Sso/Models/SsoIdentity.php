<?php

namespace App\Modules\Sso\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $user_id
 * @property string $issuer
 * @property string $subject
 * @property ?string $email
 * @property bool $email_verified
 * @property string $linked_via
 * @property ?\Illuminate\Support\Carbon $last_login_at
 */
class SsoIdentity extends Model
{
    public const VIA_SUBJECT = 'subject';

    public const VIA_EMAIL = 'email';

    public const VIA_LINK = 'link';

    protected $fillable = ['user_id', 'issuer', 'subject', 'email', 'email_verified', 'linked_via', 'last_login_at'];

    protected function casts(): array
    {
        return [
            'email_verified' => 'boolean',
            'last_login_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** The identity of `$user` at the configured issuer, if linked. */
    public static function forUser(User $user): ?self
    {
        return self::query()
            ->where('user_id', $user->id)
            ->where('issuer', config('sso.issuer'))
            ->first();
    }

    public function toSummary(): array
    {
        return [
            'issuer' => $this->issuer,
            'subject' => $this->subject,
            'email' => $this->email,
            'linked_via' => $this->linked_via,
            'linked_at' => $this->created_at?->toIso8601String(),
            'last_login_at' => $this->last_login_at?->toIso8601String(),
        ];
    }
}
