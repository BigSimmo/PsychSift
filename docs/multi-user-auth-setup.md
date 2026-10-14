# PsychSift authentication activation handoff

This is the operator handoff for PsychSift email/password, Apple, Google, and
Microsoft sign-in. It records a read-only configuration snapshot from
2026-09-21. Recheck the live values before activation because provider and
deployment settings can change independently of this repository.

No secret belongs in this file, a chat, a commit, or a screenshot. Enter
provider secrets directly in the relevant provider console and Supabase.

## Current application implementation

- Browser and server sessions use `@supabase/ssr` cookies.
- OAuth, email confirmation, magic link, and password recovery return through
  `/auth/callback`, which exchanges the one-time PKCE code with
  `exchangeCodeForSession`.
- The account dialog offers password sign-in, password signup, email link,
  Apple, Google, and Microsoft. Password signup requires at least 12 characters.
- `/auth/reset-password` requests a recovery email, returns through the shared
  PKCE callback, verifies the resulting user, and then permits a password update.
- Microsoft requests the required `email` scope.
- OAuth error details are removed from the browser address and reduced to safe,
  allowlisted messages.

These repository changes are committed and published in PR #2972. They are not
merged or deployed, and they are not proof that a provider works in production.

## Exact current targets

### Supabase

- Production: `PsychSift Production` (`sjrfecxgysukkwxsowpy`), healthy,
  `ap-southeast-2`.
- Staging: `PsychSift Staging` (`ikoiolksxqxfxgiyqpnu`), healthy,
  `ap-southeast-2`.
- The primary checkout is currently linked to **staging**, not production.

Production Auth configuration:

- Site URL: `https://psychiatry.tools`
- Email provider: enabled
- New user signup: allowed
- Email confirmation: required
- Minimum password length: 12
- Custom SMTP: not configured
- Apple: disabled; no client ID or secret configured
- Google: enabled; client ID and secret present
- Azure (Microsoft): enabled; client ID and secret present
- Azure tenant URL: `https://login.microsoftonline.com/common`

Production redirect allowlist:

- `http://localhost:*/**`
- `https://psychiatry.tools/auth/callback`
- `https://www.psychiatry.tools/auth/callback`
- `https://database-production-c1c0.up.railway.app/auth/callback`
- `https://psychiatry.tools/auth/callback?next=%2Fauth%2Freset-password`
- `https://www.psychiatry.tools/auth/callback?next=%2Fauth%2Freset-password`
- `https://database-production-c1c0.up.railway.app/auth/callback?next=%2Fauth%2Freset-password`

Staging Auth configuration:

- Site URL: `https://app-staging-6a78.up.railway.app`
- Redirect allowlist:
  - `https://app-staging-6a78.up.railway.app/auth/callback`
  - `https://app-staging-6a78.up.railway.app/auth/callback?next=%2Fauth%2Freset-password`
- Email provider: enabled; confirmation required; signup allowed
- Minimum password length: 12
- Apple, Google, and Azure: disabled and unconfigured
- Custom SMTP: not configured

These credential-free staging URL and password-policy changes were applied and
re-read in the Supabase dashboard on 2026-09-21. The provider callback to
register with Apple, Google, or Microsoft is:

`https://ikoiolksxqxfxgiyqpnu.supabase.co/auth/v1/callback`

Staging still needs separate provider credentials entered directly in Supabase;
none were copied from production or requested during this preparation.

### Railway

- Project: `PsychSift` (`5deaad0b-675a-4c13-978e-5ca2b5b877f9`)
- Production app service: `PsychSift` (formerly `Database`,
  `6db32f39-2ecd-493c-a688-feb2d6670ff4`)
- Production worker service: `worker`
  (`29510fca-4920-470d-941c-b1290e06d3d5`)
- Staging app service: `app`
  (`d9ddf695-3403-4785-b2dd-2cfd3c4816a6`)
- Staging worker service: `worker-5g6o`
  (`0a521251-9d6e-4f18-9ed3-ec362a48e8da` — exists in `staging` and carries
  `OPENAI_API_KEY`; operators must not point it at production or trigger
  unintended background work)
- Active production app domains:
  `psychiatry.tools`, `www.psychiatry.tools`, and
  `database-production-c1c0.up.railway.app`
- Active staging app domain: `app-staging-6a78.up.railway.app`

At the snapshot time, new deployments of current `main` were waiting. The last
successful production app deployment was commit
`3a43f808de5a079f61732ac9c37d1f9d7e8cb3fc`. This is deployment evidence only;
it is not authentication acceptance evidence.

## Production provider callback

Use this exact production URL in Apple, Google, and Microsoft provider consoles:

`https://sjrfecxgysukkwxsowpy.supabase.co/auth/v1/callback`

Do not substitute the app callback. The provider returns to Supabase first;
Supabase then returns the browser to an allowlisted PsychSift `/auth/callback`.

## Email/password handoff

The live email provider is already enabled, signup is open, email confirmation
is required, and the 12-character production password minimum matches the app.
Before real-user activation, configure custom SMTP in Supabase Auth. Supply the
SMTP host, port, username, password, sender address, and sender name directly in
the Supabase dashboard, then test confirmation and recovery mail. The built-in
sender is best-effort and not suitable for production authentication traffic.

## Apple handoff

Current state: not configured and disabled.

In Apple Developer:

1. Enable **Sign in with Apple** on a primary App ID.
2. Create a Services ID for the PsychSift web app and associate it with that App
   ID.
3. Configure the website domain as
   `sjrfecxgysukkwxsowpy.supabase.co` and the return URL as the shared provider
   callback above.
4. Create a Sign in with Apple key and download its `.p8` file once. Store it in
   the approved secret store; never put it in the repository.
5. Generate the Apple web client secret and record a rotation reminder before
   its six-month expiry.

Values you must supply directly to Supabase Apple settings:

- Services ID, as the first Client ID
- Apple Team ID
- Apple Key ID
- Generated Apple client secret

Leave Apple disabled until those values are saved and a staging test passes.

## Google handoff

Current state: enabled in production with a client ID and secret present. A
Google flow worked end to end on 2026-09-11, but that historical test is not
fresh production proof.

In Google Auth Platform, recheck the existing Web application client:

1. Authorized JavaScript origins include `https://psychiatry.tools` and
   `https://www.psychiatry.tools`.
2. Authorized redirect URIs include the shared provider callback above.
3. Data Access includes `openid`, email, and profile scopes.
4. Audience and Branding are appropriate for the intended public users.

No new value is currently required. If the existing credential is replaced,
supply the new Web Client ID and Client Secret directly in Supabase Google
settings. Do not paste either value into this handoff or chat. After any change,
run a fresh sign-in, hard refresh, and sign-out check before calling Google
working.

## Microsoft / Azure handoff

Current state: enabled in production with a client ID and secret present, using
the `common` tenant. The last attempted exchange on 2026-09-11 failed with
`AADSTS7000215` / `invalid_client`, so Microsoft must be treated as not working.

In Microsoft Entra ID, open **App registrations → PsychSift** and recheck:

1. Supported account types allow organizational and personal Microsoft
   accounts.
2. The Web redirect URI is the shared provider callback above.
3. The optional ID-token claims include `email` and `xms_edov`; keep the
   `xms_edov` access-token claim recommended by Supabase.
4. The email permission is present. The app now requests the `email` scope.
5. Under **Certificates & secrets**, use the secret **Value**, never the Secret
   ID. If the Value is no longer visible, create one replacement secret and
   record its expiry before leaving the page.

Values you must supply directly to Supabase Azure settings:

- Application (client) ID, only if it differs from the existing value
- Client secret **Value**
- Azure Tenant URL: `https://login.microsoftonline.com/common`

Save the corrected secret in Supabase but do not call Microsoft working until a
fresh sign-in completes the PsychSift callback, displays the account, survives a
hard refresh, and signs out cleanly.

## Activation boundary and acceptance

Hosted-change approval was received on 2026-09-21. Production activation is
still blocked by `check:production-readiness` until the OpenAI and Railway DPA,
cross-border, privacy-notice, ZDR, and PHI-minimisation evidence is resolved. In
order:

1. Review, commit, publish, and deploy the repository change through the normal
   protected workflow.
2. Configure custom SMTP and prove confirmation plus password recovery email.
3. Configure and test each provider in staging where practical.
4. Correct and retest Microsoft; revalidate Google; configure and test Apple.
5. Repeat on the production domains and verify session persistence, sign-out,
   cancellation/error recovery, and owner isolation between two test accounts.

Do not merge or activate production while the required production-readiness
gate is failing. Provider secrets must still be entered directly in their
approved consoles; never put them in the repository, chat, logs, or screenshots.
