<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Filament\Models\Contracts\FilamentUser;
use Filament\Models\Contracts\HasAvatar;
use Filament\Models\Contracts\HasName;
use Filament\Panel;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

class User extends Authenticatable implements FilamentUser, HasAvatar, HasName
{
    use HasApiTokens;

    /** @use HasFactory<\Database\Factories\UserFactory> */
    use HasFactory;

    use HasRoles;
    use Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'first_name',
        'last_name',
        'email',
        'phone',
        'email_verified_at',
        'email_verification_token',
        'is_verified',
        'profile_picture',
        'account_type',
        'institution_id',
        'institution_name',
        'designation',
        'department',
        'password',
        'remember_token',
        'provider',
        'provider_id',
        'storage_quota_bytes',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
        'email_verification_token',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'storage_quota_bytes' => 'integer',
        ];
    }

    /**
     * The attributes that should be appended to the model's array form.
     *
     * @var list<string>
     */
    protected $appends = [
        'full_name',
    ];

    /**
     * Get the user's full name.
     */
    public function getFullNameAttribute(): string
    {
        return $this->first_name . ' ' . $this->last_name;
    }

    /**
     * Get the user's profile picture URL.
     */
    public function getProfilePictureAttribute($value): string
    {
        if (! $value) {
            return '';
        }

        // If already an absolute URL, return as-is
        if (filter_var($value, FILTER_VALIDATE_URL)) {
            return $value;
        }

        // Otherwise, treat as local path
        return url($value);
    }

    /**
     * Get the Institution associated with the user.
     */
    public function institution()
    {
        return $this->belongsTo(Institution::class);
    }

    /**
     * Files in the user's library (My Files).
     */
    public function files()
    {
        return $this->hasMany(File::class);
    }

    public function canAccessPanel(Panel $panel): bool
    {
        // Only allow Super Admins to access Filament panels
        return $this->hasRole('Super Admin');
    }

    public function getFilamentName(): string
    {
        $name = trim((string) ($this->full_name ?? ''));
        if ($name === '') {
            $name = (string) ($this->first_name ?? '');
        }
        if ($name === '' && ! empty($this->email)) {
            $name = (string) $this->email;
        }

        return $name !== '' ? $name : 'Admin';
    }

    public function getFilamentAvatarUrl(): ?string
    {
        $raw = $this->getRawOriginal('profile_picture');

        if (empty($raw)) {
            return null; // let Filament fall back to initials avatar
        }

        if (filter_var($raw, FILTER_VALIDATE_URL)) {
            return $raw;
        }

        return Storage::disk('public')->url($raw);
    }
}
