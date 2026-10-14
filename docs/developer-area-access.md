# Developer area access

How the two developer-gated subtrees under `/mockups` (`/mockups/development`
and `/mockups/care-plan`) are protected, and how to open them without signing in.

The gated path prefixes are listed once, in `src/lib/developer-area/headers.ts`
(`DEVELOPER_GATED_PATH_PREFIXES`): `/mockups/development` (Development hub and
panel sub-routes) and `/mockups/care-plan` (Care Plan prototype). Every other
`/mockups/**` path 404s in production and is not covered here.

## Two credentials, either of which opens the area

`DeveloperAreaGate` (`src/components/developer-area/developer-area-gate.tsx`)
admits a request holding **either**:

1. **A signed-in administrator** — a Supabase session whose
   `app_metadata.site_role` is `administrator`, the same claim that gates
   document and corpus management. Signing in is a magic link sent to an email
   address, or Apple/Google/Microsoft — this route has no password of its own.
2. **A valid developer-key cookie** — obtained by typing the key on the gate
   screen or by opening the `?devkey=` link, both described below.

The cookie is checked first, because it is the expected case on the owner's own
devices and it needs no provider round trip to answer.

Outside production the gate is a no-op, matching every other `/mockups/**`
route. In production it bypasses only under the exact double-flag pairing the
isolated Playwright production build uses; `NEXT_PUBLIC_MOCKUPS_ENABLED=true`
alone must never open it, which was incident `#L30`.

## The developer key

One secret, presented either of two ways: typed into the field on the gate
screen, or carried once in a bookmarked link. Both hand the value to the same
`?devkey=` exchange in `src/proxy.ts`, which verifies it in constant time, sets
the signed cookie and redirects the secret back out of the URL. There is no
second verification path, deliberately — two would be two things to get wrong.

**Setup, once per deployment.** Generate a secret and set it as the server-only
Railway variable `DEVELOPER_AREA_ACCESS_KEY` on the `PsychSift` service:

```bash
openssl rand -hex 32
```

Minimum 32 characters, enforced in `src/lib/env.ts` and again in
`resolveDeveloperAccessKey`. A shorter value is treated as unconfigured rather
than accepted, because this secret travels in a URL where it is visible in
browser history and in any screen share. Never name it `NEXT_PUBLIC_…`: Next.js
inlines those into the client bundle, and `check:production-readiness` fails the
release if it finds that name.

**Setup, once per device — by typing it.** Open
`https://psychiatry.tools/mockups/development`, put the secret in the
**Developer key** field and press Unlock. The field is shown only when the
deployment actually has a key configured at sufficient strength, and only a
boolean crosses to the browser, never the key. A refused key says so, because
`src/proxy.ts` marks the redirect with `devkeyerror=1`; without that the screen
would simply reappear and a wrong key would be indistinguishable from a slow
one.

**Setup, once per device — by link.** Equivalent, and the better option when
sending yourself access from another machine:

```
https://psychiatry.tools/mockups/development?devkey=<the secret>
```

Either way `src/proxy.ts` verifies the secret, sets a signed cookie, and
redirects to the same URL without the parameter — so it does not stay in the
address bar, in the history entry that gets shared, or in a `Referer` header
sent onward. The field submits with `location.replace`, so the URL that briefly
carries the secret is not left as a history entry either. From then on that
browser opens the developer area with no sign-in at all.

The response carries separate `Set-Cookie` headers for `/admin/developer-hub`,
`/mockups/development`, and `/mockups/care-plan`. They share the developer cookie
name; each header is appended separately so Next.js does not overwrite the
other paths. Renewal uses the same path scopes.

**The key travels in a URL either way, so rotate it after exporting logs.**
Typed or bookmarked, the secret is presented as `?devkey=…` on one request. The
proxy redirects it straight back out, so it does not persist in the address bar
and — because the field submits with `location.replace` — it is not left as a
history entry the back button returns to. Two places do still see it: the
browser's own profile history records redirect _sources_, and the platform HTTP
access log records the request line. Neither is reachable by a visitor, but both
mean the same thing operationally: if you ever export or share request logs, or
hand over a browser profile, rotate `DEVELOPER_AREA_ACCESS_KEY` afterwards.

A POST to a dedicated route would avoid this. It is deliberately not done,
because it would be a second place the same secret is verified — see "The
developer key" above.

**It does not expire in practice.** The cookie is stamped for one year —
deliberately inside the ~400-day ceiling browsers clamp `Set-Cookie` lifetimes
to, so the stated expiry is the real one — and `src/proxy.ts` re-issues it on
every verified visit. A device used at least once a year never needs the link
again.

## What the link does not grant

Reaching the page is all it grants. The panels in `src/lib/developer-area/hub-panels.ts`
(`HUB_PANELS`) span 10 operational panels under `/mockups/development/*` —
`roster-teams` (`/mockups/development/roster-teams`), `task-ledger`
(`/mockups/development/ledger`), `clinical-trust`
(`/mockups/development/clinical-trust`), `on-call-freshness`
(`/mockups/development/on-call-freshness`), `clinical-answer-failures`
(`/mockups/development/clinical-answer-failures`), `hazard-register`
(`/mockups/development/hazards`), `clinical-sign-off`
(`/mockups/development/clinical-sign-off`), `ingestion`
(`/mockups/development/ingestion`), `corpus-health`
(`/mockups/development/corpus-health`), and `settings-check`
(`/mockups/development/settings`) — plus the 2 reference entries (`brand` at
`/brand/preview.html` and `care-plan` at `/mockups/care-plan`). The panels that
read live server or Supabase data retain their own authorization rules. The guarded readers
`resolveHubEnvironmentFacts` (`environment-facts.ts`), corpus health, and settings check call
`isAdministratorUser` independently of the developer gate and degrade to unavailable or
unauthorized for a link holder. The ingestion reader's `GET /api/ingestion/jobs` also requires
an administrator via `requireAuthenticatedUser`. `GET /api/on-call/entries` returns
shared entries to signed-in users; it does not require an administrator claim. The developer
link itself grants no authorization to these readers or APIs.

That separation is deliberate. The link is a convenience credential that can be
forwarded in a message or copied off a screen; the corpus is the clinical
library. Do not "simplify" those panels by having them trust the cookie.

What a link holder _can_ read is the prototype content and the repository-derived
panels (such as `task-ledger`, `hazard-register`, `clinical-sign-off`, `brand`,
and the `care-plan` prototype). Treat the
link accordingly — it is roughly as sensitive as the internal notes themselves.

## Revoking access

Rotate `DEVELOPER_AREA_ACCESS_KEY` in Railway. Every existing cookie was signed
under the old key, so all of them stop verifying at once, on every device. There
is no per-device revocation, and none is planned for a single-operator
deployment.

To turn the passwordless route off entirely, unset the variable. The
administrator sign-in is then the only way in, exactly as before this existed.

## Why the cookie is not the key

The cookie carries `v1.<issuedAt>.<HMAC-SHA256 over both, keyed by the secret>`,
not the secret. A stolen cookie therefore cannot be turned back into the key, it
cannot be re-dated to extend itself (the signature covers the issue time), and
the server enforces the expiry rather than trusting the browser to drop it.
Every unset, under-strength, malformed, or wrongly-keyed case resolves to "not
granted" and falls through to the sign-in screen.

Implementation: `src/lib/developer-area/link-access.ts` (minting and
verification, server-only) and `src/lib/developer-area/link-access-shared.ts`
(the query-parameter names and URL shape, which the Client Component gate screen
needs and which therefore cannot live beside `node:crypto`). Tests:
`tests/developer-area-link-access.test.ts` (the credential),
`tests/proxy.test.ts` (the exchange and the renewal),
`tests/developer-area-access.test.ts` and
`tests/developer-area-gate.dom.test.tsx` (the gate),
`tests/developer-gate-screen.dom.test.tsx` (the key field).
