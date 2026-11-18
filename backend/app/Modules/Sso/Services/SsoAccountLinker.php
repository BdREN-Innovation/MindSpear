<?php

namespace App\Modules\Sso\Services;

use App\Models\User;
use App\Modules\Sso\Exceptions\SsoException;
use App\Modules\Sso\Models\SsoIdentity;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Matches a BDREN identity to a Mindspear user. In order:
 *  1. an identity already linked by (issuer, subject): that user;
 *  2. (sso.link_by_verified_email) an existing user with the same email, only when
 *     BDREN marks the email verified: linked once, by subject from then on;
 *  3. (sso.auto_create_users) a new user.
 * Existing password and Google/Microsoft logins of a user are never changed.
 */
class SsoAccountLinker
{
    /** @return array{user: User, linked_via: string, created: bool} */
    public function resolve(SsoProfile $profile): array
    {
        try {
            return DB::transaction(fn () => $this->resolveOnce($profile));
        } catch (UniqueConstraintViolationException) {
            // A second callback for the same new identity won the race: use what it created.
            return DB::transaction(fn () => $this->resolveOnce($profile));
        }
    }

    /** Links the identity to a signed-in user (from the profile page). */
    public function link(User $user, SsoProfile $profile): SsoIdentity
    {
        return DB::transaction(function () use ($user, $profile) {
            $existing = $this->findIdentity($profile);
            if ($existing && $existing->user_id !== $user->id) {
                throw new SsoException('This BDREN account is already linked to another Mindspear account.', 409, 'identity_in_use');
            }
            if (! $existing && SsoIdentity::forUser($user)) {
                throw new SsoException('Your Mindspear account is already linked to a different BDREN account. Disconnect it first.', 409, 'already_linked');
            }

            $identity = $existing ?? new SsoIdentity(['user_id' => $user->id, 'linked_via' => SsoIdentity::VIA_LINK]);
            $this->touch($identity, $profile)->save();
            Log::info('sso.linked', ['user_id' => $user->id, 'subject' => $profile->subject, 'via' => $identity->linked_via]);

            return $identity;
        });
    }

    public function unlink(User $user): bool
    {
        $deleted = SsoIdentity::query()->where('user_id', $user->id)->where('issuer', config('sso.issuer'))->delete() > 0;
        if ($deleted) {
            Log::info('sso.unlinked', ['user_id' => $user->id]);
        }

        return $deleted;
    }

    private function resolveOnce(SsoProfile $profile): array
    {
        if ($identity = $this->findIdentity($profile)) {
            $this->touch($identity, $profile)->save();

            return ['user' => $identity->user, 'linked_via' => $identity->linked_via, 'created' => false];
        }

        $existing = $profile->email ? $this->userByEmail($profile->email) : null;

        if ($existing) {
            if (! config('sso.link_by_verified_email') || ! $profile->emailVerified) {
                throw new SsoException(
                    'A Mindspear account with this email already exists. Sign in with your password, then connect BDREN SSO from your profile.',
                    409,
                    'email_in_use',
                );
            }
            if (SsoIdentity::forUser($existing)) {
                throw new SsoException('The Mindspear account with this email is already linked to a different BDREN account.', 409, 'already_linked');
            }

            $identity = new SsoIdentity(['user_id' => $existing->id, 'linked_via' => SsoIdentity::VIA_EMAIL]);
            $this->touch($identity, $profile)->save();
            Log::info('sso.linked', ['user_id' => $existing->id, 'subject' => $profile->subject, 'via' => SsoIdentity::VIA_EMAIL]);

            return ['user' => $existing, 'linked_via' => SsoIdentity::VIA_EMAIL, 'created' => false];
        }

        if (! config('sso.auto_create_users')) {
            throw new SsoException(
                'No Mindspear account is linked to this BDREN account. Sign in with your password, then connect BDREN SSO from your profile.',
                403,
                'no_account',
            );
        }
        if (! $profile->email) {
            throw new SsoException('Your BDREN account has no email address, which Mindspear needs to create an account.', 422, 'email_required');
        }

        $user = User::create([
            'first_name' => $profile->firstName,
            'last_name' => $profile->lastName,
            'email' => $profile->email,
            // Never used: this person signs in through BDREN (or sets a password with "Forgot password").
            'password' => Hash::make(Str::random(64)),
            'is_verified' => true,
            'email_verified_at' => $profile->emailVerified ? now() : null,
            'profile_picture' => $profile->picture,
            'provider' => 'bdren',
            'provider_id' => $profile->subject,
        ]);
        $identity = new SsoIdentity(['user_id' => $user->id, 'linked_via' => SsoIdentity::VIA_SUBJECT]);
        $this->touch($identity, $profile)->save();
        Log::info('sso.user_created', ['user_id' => $user->id, 'subject' => $profile->subject]);

        return ['user' => $user, 'linked_via' => SsoIdentity::VIA_SUBJECT, 'created' => true];
    }

    private function findIdentity(SsoProfile $profile): ?SsoIdentity
    {
        return SsoIdentity::query()
            ->where('issuer', $profile->issuer)
            ->where('subject', $profile->subject)
            ->lockForUpdate()
            ->first();
    }

    private function userByEmail(string $email): ?User
    {
        return User::query()->whereRaw('LOWER(email) = ?', [strtolower($email)])->first();
    }

    private function touch(SsoIdentity $identity, SsoProfile $profile): SsoIdentity
    {
        return $identity->fill([
            'issuer' => $profile->issuer,
            'subject' => $profile->subject,
            'email' => $profile->email,
            'email_verified' => $profile->emailVerified,
            'last_login_at' => now(),
        ]);
    }
}
