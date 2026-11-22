# BDREN SSO in Mindspear

Mindspear can now sign people in through the BDREN SSO server (ZITADEL) and read their BDREN plan
limits (the BDREN entitlement API). It is an **add-on**: the existing email/password, Google and
Microsoft logins are unchanged, and with `SSO_ENABLED=false` (the default) Mindspear behaves exactly as
before.

For the SSO server itself, see `sso/docs/USER_GUIDE.md`.

---

## 1. What was added

| Part | Where | What it does |
|---|---|---|
| Backend module | `backend/app/Modules/Sso/` | OpenID Connect login (code + PKCE), matching a BDREN identity to a Mindspear user, entitlement checks |
| Backend config | `backend/config/sso.php` | Every setting, read from `SSO_*` / `BDREN_*` env vars (§8) |
| Database | table `sso_identities` (migration in the module) | One row per linked BDREN identity: `user_id`, `issuer`, `subject`, `email`. The `users` table is not changed. |
| Frontend feature | `frontend/src/features/sso/` | Sign-in button, callback handling, profile panel, logout helper |
| Frontend page | `frontend/src/app/(auth)/auth/sso/callback/page.tsx` | Where ZITADEL sends the browser back |
| Tests | `backend/tests/Feature/Sso/SsoTest.php` | 26 tests with a fake ZITADEL and a fake BDREN API |
| `backend/tests/Feature/Sso/LocalSignupTest.php` | `LOCAL_SIGNUP_ENABLED=false`: form and first-time social logins refused, existing logins kept |

Small hooks into existing files (the only edits outside the two new folders):

| File | Change |
|---|---|
| `backend/bootstrap/providers.php` | registers `SsoServiceProvider` |
| `frontend/src/features/auth/store/authSlice.ts` | new `setCredentials` reducer (stores a login that finished elsewhere) |
| `frontend/src/features/auth/components/Auth/Signin/index.tsx` | shows `<SsoSigninButton>` (renders nothing while SSO is off) |
| `frontend/src/app/(protected)/profile/page.tsx` | shows `<SsoAccountPanel>` (renders nothing while SSO is off) |
| `frontend/src/components/Layouts/header/user-info/index.tsx` | logout also ends the BDREN session when the user signed in with SSO |
| `docker-compose.yml` | backend gets `host.docker.internal` so it can reach the SSO server on this machine |
| `backend/.env.prod.example` | the SSO settings, off |
| `AuthenticationController::register`, `SocialAuthController::processSocialUser` | refuse new accounts while `LOCAL_SIGNUP_ENABLED=false` (§3a) |
| `frontend/src/features/auth/components/Auth/Signup/index.tsx` | shows `<BdrenSignup>` instead of the form while `LOCAL_SIGNUP_ENABLED=false` |
| `frontend/src/app/(auth)/auth/{google,microsoft}/callback/page.tsx` | show the backend's reason when a login is refused |

---

## 2. How sign-in works

```
Browser                Mindspear frontend          Mindspear backend               ZITADEL (auth.…)
   │ "Sign in with BDREN SSO"  │                            │                              │
   │──────────────────────────▶│ POST /api/v1/sso/login ───▶│ state, nonce, PKCE verifier  │
   │                           │◀── redirect_url + state ───│ kept in cache (10 min, 1 use)│
   │◀─ go to ZITADEL ──────────│ (state saved in this tab)  │                              │
   │──────────────────────── login page (or straight through if already signed in) ────────▶│
   │◀─────────────────────── back to /auth/sso/callback?code&state ────────────────────────│
   │──────────────────────────▶│ POST /api/v1/sso/callback ▶│ code → tokens (client secret │
   │                           │                            │ + PKCE), checks the ID token,│
   │                           │                            │ finds/creates the user       │
   │                           │◀── Mindspear token + user ─│ (a normal Sanctum token)     │
   │◀─ dashboard ──────────────│ stored like any other login│                              │
```

- The BDREN tokens never reach the browser and are not stored. The browser only gets Mindspear's own
  token, the same kind password and Google logins give. Everything else (AI server, deck editor,
  realtime) works unchanged.
- The ID token is checked fully: RS256 only, signature from ZITADEL's keys (fetched again if ZITADEL
  rotated them), `iss`, `aud`/`azp`, `exp`, `nonce`. `state` is single use and must come back to the
  tab that started the login.
- **Logout**: if the session came from SSO, logging out also sends the browser to ZITADEL's logout
  page, which ends the BDREN session and returns to `/auth/sign-in`. Otherwise logout is as before.

### Which Mindspear account a BDREN identity lands in

People are matched by **BDREN issuer + subject** (their permanent BDREN id), never by email alone:

1. **Already linked** → that account.
2. **Not linked yet, and a Mindspear account has the same email** → linked to that account, but only if
   BDREN says the email is **verified** (`SSO_LINK_BY_VERIFIED_EMAIL`). From then on, the subject is used.
   If the email is not verified, the person is told to sign in with their password and connect from the
   profile instead.
3. **Nobody matches** → a new Mindspear account is created (`SSO_AUTO_CREATE_USERS`). Its password is
   random and unknown; the person can set one later with "Forgot password".

Signed-in users can also **Connect** / **Disconnect** BDREN from their **Profile** page. Use this when
their BDREN email differs from their Mindspear email.

---

## 3. Will this affect people who already use mindspear.app?

**Deploying this code changes nothing for current users.** While `SSO_ENABLED=false`:
- the button and profile panel are hidden;
- `/api/v1/sso/*` answers 404, except `config`, which says "off";
- the only database change is the new, empty `sso_identities` table. No existing table is altered.

**Turning SSO on doesn't break anything either:**
- Password, Google and Microsoft logins keep working.
- Existing tokens stay valid, so nobody is logged out.
- Quizzes, quests, files and everything else stay with the same account.
- Limits from BDREN apply only to accounts linked to BDREN. Even those are only logged, never refused,
  until you set `SSO_ENFORCE_ENTITLEMENTS=true`.

**The one real risk is duplicate accounts.** Someone who signs in with SSO using a *different* email
than their Mindspear account gets a new, empty account. Two ways to avoid it:
- Tell users to **Connect** BDREN from their Profile page first.
- Set `SSO_AUTO_CREATE_USERS=false` during the pilot. Unknown people are then asked to sign in normally
  and connect, instead of getting a new account.

**Recommended rollout:**

| Phase | Settings | What users see |
|---|---|---|
| 1. Deploy | `SSO_ENABLED=false` | Nothing changes |
| 2. Pilot | `SSO_ENABLED=true`, `SSO_AUTO_CREATE_USERS=false` | "Sign in with BDREN SSO" works for existing users whose verified email matches, and for anyone who connected from Profile |
| 3. Open | `SSO_AUTO_CREATE_USERS=true` | New people can join with BDREN |
| 4. Limits | `SSO_ENFORCE_ENTITLEMENTS=true` (once plans are set up in BDREN) | Linked users are held to their BDREN plan |
| 5. SSO only | Remove the old logins (§10) | Only after every active account is linked |

To see how many accounts are not linked yet:
```bash
docker compose exec backend php artisan tinker --execute \
 'echo App\Models\User::whereNotIn("id", App\Modules\Sso\Models\SsoIdentity::select("user_id"))->count();'
```

### 3a. Every new account from BDREN (`LOCAL_SIGNUP_ENABLED=false`)

Use this from phase 3 on, so nobody gets a Mindspear-only account any more:

- `POST /register` answers 403 `signup_disabled` (with `data.signup_url`), and a first-time Google or
  Microsoft login no longer creates an account. People who already have an account keep signing in with
  their password, Google or Microsoft, and can connect BDREN from Profile.
- The Sign Up page shows **Create a BDREN account**, a link to
  `{BDREN_PLATFORM_URL}/register?next={SSO_APP_URL}/auth/sign-in?sso=start`. BDREN's sign-up creates the
  person in ZITADEL **and** in BDREN's own database (so plan checks know them), then the person signs in on
  bdren.ai once and comes back to `/auth/sign-in?sso=start`, which starts BDREN sign-in by itself. ZITADEL
  already has their session, so they arrive signed in, and `SSO_AUTO_CREATE_USERS=true` creates their
  Mindspear account.
- For the "comes back" part, BDREN must allow Mindspear's origin: `APP_REDIRECT_ORIGINS=https://dev.mindspear.app`
  in `sso/.env.prod` (it feeds `OIDC_ALLOWED_REDIRECT_ORIGINS`; locally, add `http://localhost:3001` to
  `OIDC_ALLOWED_REDIRECT_ORIGINS` in `sso/.env`). Without it people land on the bdren.ai home page after
  signing up. The same setting makes the "Activate it once" link (§4 step 4) return to Mindspear.
- Leave `SSO_AUTO_CREATE_USERS=true`, or the new BDREN users have no way in.

---

## 4. Testing locally

The SSO stack (`sso/`) runs on port **8080**. Mindspear's backend reaches it through
`SSO_CONNECT_URL=http://host.docker.internal:8080`, because inside a container `*.localhost` means the
container itself. Your browser must open `http://auth.bdren.localhost:8080`. If you work on a remote
machine through port forwarding, forward 8080 as well as 3001 and 8000.

**Step 1: register Mindspear in ZITADEL.** Add this to `sso/deploy/zitadel/clients.json`:
```json
{
  "name": "mindspear",
  "redirect_uris": ["http://localhost:3001/auth/sso/callback"],
  "post_logout_redirect_uris": ["http://localhost:3001/auth/sign-in"],
  "dev_mode": true
}
```
Then run the bootstrap. It is safe to repeat, and is the same command as in the SSO user guide §3.2:
```bash
cd sso
docker run --rm -v bdren-sso_zitadel-bootstrap:/b:ro alpine:3 cat /b/admin-bootstrap.pat \
  | python3 scripts/bootstrap_zitadel.py \
      --issuer http://auth.bdren.localhost:8080 --connect http://127.0.0.1:8080 \
      --pat-file - --config deploy/zitadel/clients.json
```
The `mindspear` client id and secret are written to `sso/.zitadel-secrets.json`.

**Step 2: configure Mindspear.** `backend/.env.docker` already has an SSO block. Set:
```
SSO_ENABLED=true
SSO_CLIENT_ID=<mindspear client_id>
SSO_CLIENT_SECRET=<mindspear client_secret>
```
Then restart: `docker compose up -d backend`, and the frontend (`docker compose up -d frontend-dev`,
port 3001).

**Step 3: try it.**

| Test | Expected |
|---|---|
| Open http://localhost:3001/auth/sign-in | A "Sign in with BDREN SSO" button under Google / Microsoft |
| Sign in with a BDREN user whose email is new to Mindspear | New account, lands on the dashboard |
| Sign in with a BDREN user whose **verified** email already has a Mindspear account | The existing account, with its quizzes |
| Already signed in on bdren.localhost, then click the button | No password prompt (single sign-on) |
| Profile page | "BDREN SSO" panel: Connected as …, Disconnect |
| Log in with a password, then Profile → Connect | Back on Profile, "Connected" |
| Log out after an SSO login | Passes through ZITADEL's logout, ends on the sign-in page |

**Step 4 (optional): plan limits.** Get Mindspear's product key from the SSO backend (this replaces any
previous key):
```bash
cd sso && docker compose exec backend python manage.py shell -c "
from apps.products.models import Product
print(Product.objects.get(slug='mindspear').rotate_api_key())"
```
Put it in `BDREN_PRODUCT_API_KEY`, then restart the backend. The Profile panel then shows **Plan limits**.

If it says "Activate it once", BDREN doesn't know the person yet (SSO user guide §5.3). The link signs
them in on the BDREN website (no password, thanks to SSO) and comes back to Profile. For the "comes back"
part, add `http://localhost:3001` to `OIDC_ALLOWED_REDIRECT_ORIGINS` in `sso/.env`.

**Automated tests:**
```bash
docker compose exec backend php artisan test tests/Feature/Sso
```

---

## 5. Production

1. **ZITADEL client.** Register a `mindspear` client on the **production** ZITADEL with only `https://`
   URIs, e.g. `https://dev.mindspear.app/auth/sso/callback` and `https://dev.mindspear.app/auth/sign-in`,
   with `"dev_mode": false`.
2. **Settings.** Set the SSO block of `backend/.env.prod` (template in `backend/.env.prod.example`).
   Leave `SSO_CONNECT_URL` empty in production.
3. **Network.** The backend container must reach `auth.bdren.ai` and `bdren.ai` (the BDREN API is at `https://bdren.ai/api/v1`) over HTTPS.
4. **Deploy.** Run `docker compose -f docker-compose.prod.yml up -d --build`. The migration runs on start.
5. **Roll out.** Follow §3.

---

## 6. Using plan limits in code

Two tools, both of which leave users without a BDREN identity alone:

**Read-only check on a route.** The request is refused with 429 `quota_exceeded`, or 403
`not_provisioned`, only when `SSO_ENFORCE_ENTITLEMENTS=true`:
```php
Route::post('ai/generate', ...)->middleware(['auth:sanctum', 'sso.entitlement:ai_requests']);
Route::post('projects', ...)->middleware(['auth:sanctum', 'sso.entitlement:projects,1']);
```

**Using quota up.** Reserve, then commit, or release if the work fails. This is safe on retries:
```php
use App\Modules\Sso\Services\EntitlementsClient;

$result = app(EntitlementsClient::class)->metered($user, 'ai_requests', 1, function () {
    return $this->callTheModel();   // release on exception, commit on success
});
```

If the BDREN API is down, both let the request through and log it (`SSO_ENTITLEMENTS_FAIL_OPEN=true`).

**Nothing is metered yet.** AI generation runs in `ai-server/` (Python), which checks the user's token
against Laravel's `/profile/show`. To meter `ai_requests`, the next step is a small Laravel endpoint that
ai-server calls before and after each generation (reserve, then commit or release), or the
`sso.entitlement:ai_requests` middleware on a Laravel route that fronts it. `storage_gb` could replace
the My Files quota (`FileLibrary/Services/QuotaService::limitFor`) for linked users. Both are deliberate
follow-ups, so limits can be tested first.

---

## 7. API (`/api/v1/sso`)

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `config` | public | `{enabled, provider_name, logout_url, local_signup, signup_url}` |
| POST | `login` | public, 20/min | `{redirect_url, state}` |
| POST | `callback` | public, 20/min (Bearer only for a link) | login: `{mode:"login", user, token, token_type, provider:"bdren", sso:{linked_via, created}}`; link: `{mode:"link", identity}` |
| GET | `status` | Bearer | `{enabled, provider_name, linked, identity}` |
| POST | `link` | Bearer, 20/min | `{redirect_url, state}` |
| DELETE | `link` | Bearer | `{unlinked}` |
| GET | `entitlements` | Bearer | `{product, features:[{feature, status, allowed, limit, used, reserved, remaining, reset_at}], activate_url}` |

Errors use the usual `{status:false, message, data:{code}}`.

| `data.code` | HTTP | Meaning |
|---|---|---|
| `sso_disabled` | 404 | `SSO_ENABLED=false` |
| `sso_not_configured` | 503 | A required setting is missing; the message names it |
| `invalid_state` | 400 | Expired, already used, or unknown state |
| `invalid_token` | 400 | The ID token failed a check; `data.reason` says which |
| `provider_unavailable` | 502 | ZITADEL can't be reached, or answered an error |
| `email_in_use` | 409 | An account with that email exists, but BDREN hasn't verified the email |
| `no_account` | 403 | No match and `SSO_AUTO_CREATE_USERS=false` |
| `identity_in_use` | 409 | That BDREN account is linked to another Mindspear account |
| `already_linked` | 409 | This Mindspear account is linked to a different BDREN account |
| `link_user_mismatch` | 403 | A link was finished by a different signed-in user |
| `quota_exceeded` | 429 | Plan limit reached (middleware or `metered`) |
| `not_provisioned` | 403 | BDREN doesn't know the person yet; `data.activate_url` fixes it |
| `signup_disabled` | 403 | From `POST /register` and the Google/Microsoft callbacks: `LOCAL_SIGNUP_ENABLED=false` and no account has this email; `data.signup_url` is BDREN's sign-up |

---

## 8. Settings (`backend/config/sso.php`)

| Env var | Default | Meaning |
|---|---|---|
| `SSO_ENABLED` | `false` | Master switch |
| `SSO_PROVIDER_NAME` | `BDREN SSO` | Button text: "Sign in with …" |
| `SSO_ISSUER` | `http://auth.bdren.localhost:8080` | Exactly as ZITADEL publishes it |
| `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET` | — | From the BDREN bootstrap. Required. |
| `SSO_REDIRECT_URI` | `http://localhost:3001/auth/sso/callback` | Must match ZITADEL exactly |
| `SSO_POST_LOGOUT_REDIRECT_URI` | `http://localhost:3001/auth/sign-in` | Must match ZITADEL exactly |
| `SSO_SCOPES` | `openid profile email` | |
| `SSO_TOKEN_AUTH_METHOD` | `client_secret_basic` | What the BDREN bootstrap registers. Or `client_secret_post`. |
| `SSO_CONNECT_URL` | — | Local Docker only: e.g. `http://host.docker.internal:8080` |
| `SSO_LINK_BY_VERIFIED_EMAIL` | `true` | §2 rule 2 |
| `SSO_AUTO_CREATE_USERS` | `true` | §2 rule 3 |
| `LOCAL_SIGNUP_ENABLED` | `true` | `false`: Mindspear stops creating accounts itself; new people sign up on BDREN (§3a) |
| `SSO_APP_URL` | `http://localhost:3001` | Mindspear's address, for the "activate" return link |
| `BDREN_API_URL` | `http://api.bdren.localhost:8080/api/v1` | Entitlement API |
| `BDREN_PLATFORM_URL` | `http://bdren.localhost:8080` | BDREN website, for "activate" |
| `BDREN_PRODUCT_SLUG` | `mindspear` | |
| `BDREN_PRODUCT_API_KEY` | — | Server-side secret. Without it, limits show "not set up". |
| `BDREN_FEATURES` | `ai_requests,storage_gb` | Shown on the Profile page |
| `SSO_ENFORCE_ENTITLEMENTS` | `false` | `false` means limits are only logged |
| `SSO_ENTITLEMENTS_FAIL_OPEN` | `true` | When BDREN is down, let requests through |
| `SSO_HTTP_TIMEOUT`, `SSO_CLOCK_LEEWAY`, `SSO_STATE_TTL` | `10`, `60`, `600` | Seconds |

Changing an env var needs `docker compose up -d backend` (or a restart in production).

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No SSO button | `SSO_ENABLED` is not `true`, or the backend wasn't restarted. `GET /api/v1/sso/config` shows the current value. |
| "not configured: SSO_CLIENT_ID is missing" | Fill in the client id and secret, then restart |
| "The sign-in service is not reachable" (502) | The backend can't reach ZITADEL. Locally: is the `sso/` stack up, and is `SSO_CONNECT_URL` set? `data.reason` gives the detail. |
| ZITADEL error page `redirect_uri` / `Errors.App.NotFound` | The `mindspear` client is missing, or its URIs differ from `SSO_REDIRECT_URI`. Re-run the bootstrap (§4). |
| "could not be verified" (`invalid_token`) | `data.reason` names the failed check. Usually `aud` (wrong client id) or `iss` (`SSO_ISSUER` differs from the discovery `issuer`). |
| "This sign-in was started in another browser or tab" | The callback opened in a different tab or browser than the button click. Start again in one tab. |
| "already exists … connect from your profile" | Same email, but BDREN hasn't verified it. Log in with the password, then Profile → Connect. |
| Plan limits: "Activate it once" | BDREN has never seen this person. Use the link (§4 step 4). |
| Plan limits: "Not set up on this server" | `BDREN_PRODUCT_API_KEY` is empty |
| After BDREN sign-up, people land on the bdren.ai home page | Mindspear's origin is missing from BDREN's `APP_REDIRECT_ORIGINS` (§3a) |
| Google/Microsoft: "No Mindspear account uses this email" | Expected with `LOCAL_SIGNUP_ENABLED=false`: that person signs up through BDREN |

---

## 10. Later: SSO only, or removing SSO

**To make SSO the only login,** once §3 shows every active account linked:
- Frontend: drop `SigninWithPassword`, `GoogleSigninButton`, `MicrosoftSigninButton` and the sign-up and
  forgot-password pages. `SsoSigninButton` stays.
- Backend: remove the `register`, `login`, `forgot-password`, `reset-password`, `verify-email` routes
  and `SocialAuthController`. **Keep** `logout` and `user-check`, and Sanctum itself: the SSO login
  issues Sanctum tokens.
- Set `SSO_AUTO_CREATE_USERS=true`.
- Alternatively, import the remaining password users into ZITADEL first. ZITADEL can import users with
  existing password hashes (Laravel uses bcrypt); check ZITADEL's user migration docs for your version.
  Then link them by email on their first SSO login.

**To remove SSO:**
1. Delete `backend/app/Modules/Sso`, `backend/config/sso.php`, `backend/tests/Feature/Sso`,
   `frontend/src/features/sso` and `frontend/src/app/(auth)/auth/sso`.
2. Undo the one-line hooks listed in §1.
3. Optionally, drop the `sso_identities` table.

---

## 11. Security notes

- The client secret and product API key stay on the server (`backend/.env.*`, git-ignored). Never put
  them in `NEXT_PUBLIC_*` values.
- `sso/` is a separate repository with its own `.env` and `.zitadel-secrets.json`. Mindspear's
  `.gitignore` now ignores it, so it can't be committed here by accident.
- Linking by email needs `email_verified=true` from BDREN. Unverified emails never take over an existing
  account.
- A link flow only completes for the same signed-in user who started it, so someone else's BDREN
  identity can't be planted in an account.
- The existing Google/Microsoft login (`SocialAuthController`) matches accounts by email without
  checking that the provider verified it. This is unchanged by this work, but worth reviewing.
