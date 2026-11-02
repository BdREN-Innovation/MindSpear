@component('mail::message')
# E-mail Verification Request

You requested to verify Your Email Address. Click the button below to verify Your Email Address:

@component('mail::button', ['url' => frontend_url('/auth/verify/') . 'token=' . $token . '&email=' . urlencode($email)])
Verify Email
@endcomponent

If you did not request this, please ignore this email.

Thanks,<br>
{{ config('app.name') }}
@endcomponent
