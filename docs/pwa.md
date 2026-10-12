# Progressive Web App architecture

PsychSift is an installable, production-first PWA with a deliberately limited offline surface. The service worker
improves launch, static-asset reuse, update handling, and failure messaging without turning private clinical data into
durable browser storage.

The central invariant is:

> CacheStorage may contain only the generic offline page and explicitly allow-listed public application assets. It
> must never contain clinical queries, answers, documents, uploads, signed URLs, account data, auth responses, API
> responses, RSC payloads, or user-specific HTML.

This is a product and privacy boundary, not just a performance preference. Any change that broadens the cache
allowlist requires a privacy and security review.

## Architecture map

| Concern                                            | Implementation                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Web app manifest                                   | `src/app/manifest.ts` -> `/manifest.webmanifest`                                                             |
| Brand and install icons                            | `src/app/icon.svg`, `src/app/apple-icon.tsx`, `src/app/icons/[variant]/route.tsx`, `src/lib/brand-image.tsx` |
| Service worker                                     | `public/sw.js` -> `/sw.js`, scope `/`                                                                        |
| Generic offline document                           | `public/offline.html` -> `/offline.html`                                                                     |
| Registration, install, update, and connectivity UI | `src/components/pwa-lifecycle.tsx`, mounted once in `src/app/layout.tsx`                                     |
| PWA layout and safe-area styling                   | `src/app/globals.css`                                                                                        |
| Theme and browser chrome colour                    | `src/app/layout.tsx`, `src/lib/theme.ts`, `src/components/clinical-dashboard/use-theme.ts`                   |
| Resource-specific headers                          | `next.config.ts`                                                                                             |
| Page CSP and public PWA proxy bypass               | `src/lib/security-headers.ts`, `src/proxy.ts`                                                                |

The worker is intentionally hand-written and dependency-free. There is no Workbox runtime, generated precache
manifest, or framework HTML app-shell cache to conceal the privacy policy.

## Installability

The manifest defines a stable app identity and root scope:

- `id`, `start_url`, and `scope` are `/`.
- `display` is `standalone`; the document viewport uses `viewport-fit=cover`.
- `background_color` is the brand light splash (`APP_THEME_COLORS.light`). `theme_color` is intentionally omitted
  from the manifest so light/dark browser chrome can keep updating via meta `theme-color`.
- Language and direction are `en-AU` and `ltr`.
- Categories are `medical`, `productivity`, `utilities`, and `education`; related native applications are not preferred.
- The SVG icon is accompanied by generated 192 px and 512 px PNG icons for the `any`, `maskable`, and `monochrome`
  purposes; the monochrome pair is a white alpha-only silhouette that platforms recolour (badges, themed icons).
- `display_override` prefers `standalone` with a `minimal-ui` fallback and never requests `fullscreen`;
  `launch_handler` focuses an existing app window (`navigate-existing`, then `auto`) instead of spawning duplicates.
- The 180 px Apple icon is opaque so iOS does not render transparency as black or fall back to a page screenshot.
- Manifest shortcuts open Ask, Documents, Medication guidance, Differentials, On Call, and CME. They are launch shortcuts, not
  offline features; each destination still requires the normal network/auth capabilities.
- `appleWebApp.capable`, title, and translucent status-bar metadata support Add to Home Screen on Apple platforms.

Production installability requires HTTPS, a successful manifest response, reachable icons, and a successfully
registered service worker. Localhost is the browser's secure-context development exception. The custom install card
is shown only when the browser emits `beforeinstallprompt`; browsers that do not expose that event retain their own
install/Add to Home Screen flow.

The install card is not shown in standalone mode. It stays non-blocking and lower-right on tall wide screens; on short
desktop heights (under ~900px) it moves to the top-right and compact-sheet layout so the mode-home search stays
usable; on phones it becomes a compact sheet positioned clear of the current composer owner (above a bottom dock or
below an in-flow home composer) and the safe area. The benefit list is deliberately limited to quick access, app-like
launch, and the familiar PsychSift workspace. It does not imply offline clinical access.
Choosing **Not now**, using **Dismiss**, or dismissing the browser prompt suppresses the custom prompt for 30 days
using `clinical-kb-pwa-install-dismissed-at` in localStorage. `appinstalled` clears that value. Storage failures are
treated as non-fatal progressive-enhancement failures.

iOS and iPadOS never emit `beforeinstallprompt`, so outside standalone mode those platforms get a one-time manual
hint instead (Safari: Share, then Add to Home Screen). **Not now** suppresses it for 30 days via
`clinical-kb-pwa-ios-install-dismissed-at`; the same storage-failure tolerance applies.

The manifest deliberately leaves orientation unrestricted so zoom, rotation, desktop windows, and split-screen use
remain available. Manifest screenshots are also omitted until current production UI can be captured and reviewed at
the declared form factors; prototype/mockup screenshots must not be advertised as the installed product.

## Cache and privacy contract

### Explicit allowlist

The worker caches a request only when its class and every listed condition match.

| Request class                                                   | Conditions                                                                                                                                                                   | Strategy                                                | Cache                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------- |
| `/offline.html`                                                 | Fetched during worker installation                                                                                                                                           | Precached; used only after a navigation network failure | Shell, maximum 16 entries   |
| `/icon.svg` and `/manifest.webmanifest`                         | Best-effort during installation                                                                                                                                              | Precached; a failure does not block installation        | Shell                       |
| `/_next/static/*`                                               | Same-origin `GET`; no query string except a single `dpl` with a full public commit SHA; no `Authorization` or `Range`; destination is `font`, `script`, `style`, or `worker` | Cache first, then network and store                     | Static, maximum 128 entries |
| `/manifest.webmanifest`, `/icon.svg`, `/apple-icon`, `/icons/*` | Same-origin `GET`; no query string, `Authorization`, or `Range`                                                                                                              | Stale while revalidate                                  | Shell, maximum 16 entries   |

`/apple-icon` is allowlisted but is, in practice, network-only: Next's metadata-image loader emits the generated
Apple icon as `<link rel="apple-touch-icon" href="/apple-icon?<contenthash>">`, and the query string fails the
"no query string" condition above before the allow-list is consulted. Only a bare `GET /apple-icon` (which the
browser never issues for the rendered link) would be cached. This is deliberate: less is cached, and the entry
stays so that a future bare reference is treated like the other icons rather than falling through to the denylist.

Every allowlisted runtime and precache fetch uses `credentials: "omit"`. Before storage, the response must be an exact,
non-redirected, successful same-origin/basic response and must not carry private/no-store caching, attachment,
authentication-challenge, HTML-for-an-asset, or credential-varying metadata. A visible `Set-Cookie` is rejected as an
additional defense, but browser Fetch filters that header; the credential-free request plus proxy/browser no-cookie
assertions are the enforceable controls. Required precache entries also validate their expected MIME type. Cache
writes are bounded; the required offline document is pinned when older shell assets are pruned.

On development hosts matched by `public/sw.js`'s `LOCAL_HOSTS` guard, the fetch handler does not runtime-cache Next.js
or PWA assets. This prevents development HMR and transient chunks from becoming durable. The installation step still
stores the generic offline fallback and best-effort bootstrap assets needed to exercise the worker.

### Explicit denylist

The service worker never writes these request/response classes to CacheStorage:

- non-`GET` requests;
- cross-origin traffic, including Supabase Storage and signed document/image URLs;
- requests with query strings, `Authorization`, or `Range` headers;
- API, authentication, upload, ingestion, answer, search, registry, and account responses;
- RSC/Flight payloads and dynamic application HTML;
- clinical queries, answers, citations, documents, pages, images, file contents, or user-specific state;
- failed, opaque/cross-origin, private, `no-store`, or cookie-setting responses;
- arbitrary same-origin images or media outside the named PWA asset paths.

Same-origin page navigations are intercepted only to provide the offline fallback. They are always fetched from the
network and are never written to CacheStorage, even when the URL contains search parameters or the request carries
cookies. All requests that do not match the allowlist pass through the browser's normal network path without a
service-worker `respondWith` handler.

This policy governs service-worker CacheStorage. Normal HTTP caching remains controlled by each route's response
headers; private API routes must continue to emit their existing `private`/`no-store` policies.

Because every owned cache entry is public and user-independent, sign-out does not rely on a cache purge for
confidentiality. If user-scoped caching were ever introduced, logout, revocation, multi-tab cleanup, and storage
partition behavior would become mandatory design inputs; that broader cache policy is currently prohibited.

### The offline pocket pack (owner decision, 2026-09-25)

`public/offline.html` carries one narrow exception to "generic offline shell only": a small,
generated block of public, non-patient reference information. The owner approved this scope,
recorded here verbatim and dated:

> The offline page may hold only public, non-patient information: WA crisis numbers and Act
> deadlines the owner has signed off, shown as quotes. Each item shows its source and the date it
> was checked. Nothing else is stored on the device: no searches, answers, documents or patient
> data.

What ships, and how:

- **WA crisis numbers.** Every entry of `WA_CRISIS_CONTACTS` (`src/lib/crisis-contacts.ts`) —
  name, phone number as a `tel:` link, availability window, any stated caveat, its source, and
  "Checked `<verifiedOn>`".
- **Mental Health Act deadlines.** Only entries of `data/mha-timeframes.json` with
  `status: "reviewed"` and both `reviewedBy` and `reviewedAt` set — i.e. only what the owner has
  actually signed off from their own computer, never a drafted entry. Each shows its quote, its
  section, and "Signed off `<reviewedAt>`". `data/mha-timeframes.json` may not exist yet (a
  different task owns it); when it is absent, this section is simply omitted.
- **Nothing else.** No search, no generated answer, no document, no upload, no account state, and
  no patient data of any kind is written into this page or into CacheStorage. The explicit
  allowlist and denylist above are otherwise unchanged.

This block is generated, not hand-written: `scripts/build-offline-pack.ts` writes it between the
`<!-- offline-pack:start -->` / `<!-- offline-pack:end -->` sentinels in `public/offline.html`,
reading `WA_CRISIS_CONTACTS` and the reviewed entries of `data/mha-timeframes.json` and nothing
else. `npm run offline:build` regenerates it; `npm run check:offline-pack` fails if the committed
block has drifted from those sources (wired the same way as `npm run brand:check` above it).
Because this changes `public/offline.html`, every regeneration still needs the `CACHE_VERSION` /
`tests/pwa-manifest.test.ts` pairing bump described below — `build-offline-pack.ts` and
`generate-brand-assets.ts` share that one page and that one obligation.

## Offline semantics

Offline support means **clear failure handling**, not offline clinical operation:

1. A controlled navigation first uses navigation preload when available, otherwise a normal network fetch.
2. If that fetch fails, the worker returns the cached, self-contained `/offline.html` document.
3. If the precached document is unexpectedly unavailable, the worker returns a minimal in-memory HTML response with
   status `503` and `Cache-Control: no-store`.
4. The offline page states that search, answer generation, private documents, uploads, and account data need a
   connection. It contains no retrieved or user-specific content.
5. A cross-route connectivity notice mirrors `navigator.onLine` and offers a reload. A four-second polite status is
   shown when connectivity returns.

`navigator.onLine` is only a browser connectivity hint; it does not prove that the application backend or a provider
is healthy. Existing content may remain visible in an already-open tab, but it is not an offline-data guarantee and
clinical actions remain network-dependent.

## Registration and update lifecycle

`PwaLifecycle` is mounted once in the root layout so lifecycle handling is consistent across all routes.

### Registration

- Production registers `/sw.js` after the `load` event, using `requestIdleCallback` with a two-second timeout when
  available. Registration therefore stays off the critical rendering path.
- Registration uses scope `/` and `updateViaCache: "none"`.
- Unsupported browsers and non-secure contexts continue as ordinary web applications.
- Development does not register by default. Add `?pwa-dev=1` to the first local page load for an explicit test session.
- Registration failure is non-fatal; development logs a warning and the web app remains usable.

### Worker install and activation

- Installation must cache `/offline.html`; icon and manifest precaching is best-effort.
- A new worker does not call `skipWaiting` automatically. Existing sessions are not refreshed without the user's
  choice.
- On activation, obsolete shell caches and all but the two newest prior static caches bearing the
  `clinical-kb-pwa-` prefix are deleted. Navigation preload is enabled when supported, and the worker claims clients.
  Cache and preload failures are best-effort so an online network response or the in-memory emergency page remains
  available.

### Update UX

- An already-waiting worker, or an installing worker that reaches `installed` while a controller exists, shows
  **Update available**.
- While visible, the app checks for a newer worker every ten minutes, and on focus,
  visibility, connectivity or back-forward restoration. These triggers share the same
  ten-minute throttle; hidden or offline pages do not check.
- **Reload** sends `SKIP_WAITING`. The page reloads once after `controllerchange`, so it cannot loop.
- **Later** hides that release for six hours, including after a page load. The app asks
  the waiting or activated worker for its actual cache version through a message port:
  the `/sw.js` URL is the same in every deployment. A newer release remains eligible
  immediately, including when it arrives in the same open tab. If a worker cannot
  identify its version within one second, dismissal applies only to that worker in
  the open page. Unknown versions are never persisted under the shared `/sw.js` URL;
  another worker or a new page load remains eligible.
- If another tab activates the update, an already-controlled tab receives `controllerchange` and offers its own
  refresh. A first-ever worker claim is not misreported as an update.
- Next.js navigation uses the deployment commit SHA as its `deploymentId` (an explicit
  `NEXT_DEPLOYMENT_ID` takes precedence). When an older open app receives a navigation response
  from another release, Next reloads the requested destination instead of mixing route trees
  across releases. The service-worker update notice alone does not provide this protection.
- The shared On Call loading screen explicitly says **Loading this On Call page…** above the
  public crisis lines, so opening Refer, People or Handbook cannot mistake that fallback for
  a finished Now page. The lines remain available while the destination loads.
- Next's static-asset URLs with a single `?dpl=<full-commit-SHA>` retain static caching,
  keyed by the complete URL so releases cannot share an entry. Other query strings,
  including custom non-SHA deployment IDs, remain network-only.

Because clients may remain on the prior worker until they accept an update or close their tabs, deployments must keep
server routes compatible with the immediately previous client during rollout.

## Versioning, invalidation, and storage bounds

`public/sw.js` owns the manual `CACHE_VERSION`. Current cache names are composed from:

```text
clinical-kb-pwa-shell-<CACHE_VERSION>
clinical-kb-pwa-static-<CACHE_VERSION>
```

Operational rules:

1. Bump `CACHE_VERSION` whenever the offline document, precache contents, cache allowlist, strategy, or response
   semantics change, and whenever a deployment must force eviction of previously cached assets. A guard in
   `tests/pwa-manifest.test.ts` binds the `offline.html` content hash to `CACHE_VERSION`, so an offline-document edit
   cannot ship without a version bump.
2. Change the worker script in the same deployment. `/sw.js` is served with `no-cache, no-store, must-revalidate`, and
   registration uses `updateViaCache: "none"`, so the browser can detect the new script.
3. Activation deletes only owned obsolete caches. It retains the two newest prior static caches and the new worker
   consults them after a current-cache miss, protecting older open tabs that request a lazy chunk after another tab
   accepts an update. It does not disturb caches owned by unrelated applications on the origin.
4. Previous static caches are retained in CacheStorage creation order, rather than sorted
   by release names: commit hashes do not sort by deployment time. This keeps the two
   most recently cached releases available to open pages that still need their lazy chunks.
5. Hashed `/_next/static/` assets can safely use cache-first. New builds request new hashes; each static-cache version
   has a 128-entry bound. Deployments must still preserve server compatibility with the immediately previous client.
6. Do not reuse an old cache version after a rollback. A rollback may encounter clients and caches from the newer
   release; publish another unique version if cache semantics need to move backward.
7. Do not remove `/sw.js` as a way to retire the PWA. Installed workers can outlive that response. A future retirement
   must ship an explicit worker that deletes the owned cache prefix and unregisters itself. The committed retirement
   worker at `public/sw-kill-switch.js` implements exactly this: deploy its content as `/sw.js` in a single release
   (never delete the route). Its behavior is locked by `tests/pwa-kill-switch.test.ts`.
8. CacheStorage is evictable and installation can fail under storage pressure. The application must remain a fully
   usable online website when that happens; it does not request persistent storage for these replaceable public assets.

## Headers, CSP, and proxy handling

PWA bootstrap resources are public, stable, and independent of Supabase sessions. `src/proxy.ts` recognizes `/sw.js`,
`/offline.html`, `/manifest.webmanifest`, `/apple-icon`, and `/icons/*` and returns before nonce generation or session
refresh. Static `/icon.svg` is excluded by the proxy's file matcher. These routes must not redirect to auth, refresh
cookies, or vary by user. No generic public PWA namespace is trusted; future assets must be enumerated explicitly.

`next.config.ts` applies resource-specific headers:

| Resource                | Required behavior                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/sw.js`                | JavaScript content type; `no-cache, no-store, must-revalidate`; root `Service-Worker-Allowed`; same-origin CORP; script-only self CSP |
| `/offline.html`         | Immediate revalidation; no indexing; same-origin CORP; no framing; CSP permits only its inline style and self form action             |
| `/manifest.webmanifest` | Public response with immediate revalidation                                                                                           |

The page CSP adds `worker-src 'self'` and `manifest-src 'self'`. The existing nonce-based production script policy,
Supabase media/connect restrictions, HSTS gating, and other security headers remain unchanged. Do not solve a PWA
resource problem by weakening the page CSP or adding a provider origin to the worker cache.

## Performance and resilience choices

- Registration waits until load/idle, avoiding competition with first paint and hydration.
- Navigation preload avoids an avoidable service-worker startup/network waterfall.
- Only immutable hashed framework assets use cache-first.
- Public install assets use stale-while-revalidate and remain bounded.
- Application HTML is network-first without runtime storage, preventing stale authenticated shells and sensitive URL
  persistence.
- The offline document is self-contained and has no external font, script, image, API, or provider dependency.
- Cache failures are best-effort after the required offline install step; a cache quota/write error does not break the
  live network response.

## Accessibility, theme, and device fit

- Lifecycle notices use a polite live region, labelled status/region containers, real buttons, 48 px minimum target
  height, and visible focus treatment.
- The notice stack does not take page scroll ownership. Its cards restore pointer events while the container remains
  transparent to unrelated interaction.
- Phone and standalone placement accounts for left, right, and bottom safe-area insets and sits above the bottom
  composer/home indicator. The offline page uses all four safe-area insets.
- The offline page supports light/dark colour schemes, keyboard focus, responsive type, and forced-colour mode.
- Manifest `background_color` uses `APP_THEME_COLORS.light` for splash only; do not lock `theme_color` in the manifest.
- Light and dark theme colours come from `APP_THEME_COLORS`. The pre-hydration theme script updates `theme-color`
  before paint, and the theme hook keeps it synchronized after user/OS theme changes.
- Standalone detection covers both `display-mode: standalone` and the Apple `navigator.standalone` extension; the
  current mode is exposed as `data-pwa-display-mode` on the document root.
- No PWA-specific animation is required, so reduced-motion users do not receive an avoidable transition.

## Local development and verification

Normal development sessions do not register a worker. For focused testing:

1. Run `npm run ensure` and use the exact project URL it prints.
2. Open that URL with `/?pwa-dev=1` (preserve the printed host and port).
3. In browser DevTools, wait for `/sw.js` to be activated and controlling the page.
4. Test navigation fallback and CacheStorage as described below. Local runtime caching of HMR and Next.js chunks is
   disabled by the worker.
5. When finished, open the same URL with `/?pwa-dev=0`: on local hosts this unregisters the worker and deletes the
   `clinical-kb-pwa-*` caches automatically. The manual path still works too — DevTools
   **Application -> Service Workers -> Unregister**, then clear the two `clinical-kb-pwa-*` caches. Loading without any
   flag only prevents new registration; it does not remove a worker registered during an earlier opt-in session.

Use local/static/mocked checks by default:

```powershell
npm run verify:cheap
npm run build
npm run ensure
npm run test:e2e:pwa
npm run verify:ui
```

The focused Chromium gate blocks local `/api/**`, Supabase, and OpenAI traffic before loading the shell. It validates
the manifest and icon bytes, installability diagnostics, worker/header/scope state, cold offline navigation,
connectivity recovery, and the complete owned CacheStorage inventory without exercising a clinical API.

Run the smallest relevant check first, then widen. `ensure` must precede browser QA and its project-identity URL must
be used. `verify:release` includes broader production/provider gates and requires explicit confirmation under the
repository API/provider boundary; it is not an automatic PWA check.

### Manual browser checklist

Use a clean browser profile for install tests and a demo/mocked/local environment unless live-provider access has been
explicitly authorized.

- [ ] `/manifest.webmanifest` returns successfully, reports the expected name/scope/start URL/shortcuts, and all icon
      URLs load at their declared dimensions.
- [ ] `/sw.js` has JavaScript content type, root scope permission, no-store update headers, and no auth redirect or
      `Set-Cookie`.
- [ ] `/offline.html` has the restrictive CSP, noindex policy, no external requests, and readable light/dark rendering.
- [ ] Browser DevTools reports a valid manifest and an activated worker controlling scope `/` with no console errors.
- [ ] Install from browser UI; verify the icon is not cropped for both normal and maskable launch surfaces, then launch
      in standalone mode.
- [ ] Verify the custom install card can be installed/dismissed, is keyboard operable, and is absent in standalone
      mode. Also verify the platform-native Add to Home Screen path where `beforeinstallprompt` is unavailable.
- [ ] Launch each manifest shortcut and confirm its online route. Do not interpret a shortcut as offline support.
- [ ] Inspect CacheStorage after representative navigation. Every entry must match the allowlist; there must be no API,
      query-string, document, signed-URL, RSC, upload, auth, or clinical-content entry.
- [ ] With a controlled page, enable browser offline mode and navigate to a route not already open. The generic offline
      document must appear and must not reveal prior content. Restore connectivity and verify the restored notice.
- [ ] Confirm an offline API/document/media request is not answered from a PWA cache.
- [ ] Deploy a worker with a new cache version in a staging environment. Verify the update waits, **Later** does not
      force a refresh, **Reload** activates it, every older tab is offered a refresh, and only the two newest
      prior static caches remain for lazy-chunk compatibility.
- [ ] Check keyboard focus, screen-reader announcements, forced colours, light/dark theme, portrait/landscape, display
      cutouts, and the standalone home-indicator area at phone and desktop breakpoints.
- [ ] Repeat the supported browser/device matrix, including at least one Chromium install surface and the Apple Add to
      Home Screen surface. Treat browser install UI differences as progressive enhancement, not an app failure.
- [ ] Verify no service worker, watcher, or test cache is left behind in the normal development profile.

### Deployment checklist

- [ ] Serve the canonical production origin over HTTPS and configure canonical metadata (`NEXT_PUBLIC_SITE_URL` or the
      trusted deployment domain) without relying on forwarded user-controlled hosts.
- [ ] Keep `/sw.js`, `/offline.html`, the manifest, and icon routes public and same-origin.
- [ ] Verify the CDN/reverse proxy preserves `Cache-Control`, `Content-Type`, CSP, CORP,
      `Service-Worker-Allowed`, and `X-Robots-Tag` exactly; it must not pin an old `/sw.js`.
- [ ] Ensure redirects do not move the manifest `start_url` or worker script outside scope `/`.
- [ ] Bump `CACHE_VERSION` when required and test upgrade from the currently deployed worker, not only a clean install.
- [ ] Preserve compatibility with the previous waiting/active client during staged rollout and rollback.
- [ ] Review cache contents and storage bounds in the deployed origin before release sign-off.
- [ ] Record any provider-backed release check separately and obtain explicit authorization before running it.

## Roster push notifications (shipped)

Push notifications are built and in use for Roster and My Day. An earlier version of this document listed them under
deferred capabilities; that was out of date and has been corrected. They are not a generic PWA enhancement: they exist
because staff asked to hear about roster changes, shift offers and swaps, a morning brief and due reminders.

| Part                  | How it works                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Opt in                | The user turns phone alerts on at `/my-day/alerts` (`src/components/alerts/use-phone-alerts.ts`). The browser asks for permission; nothing is subscribed before that.                                                                                                    |
| Subscription          | The browser's push address and keys are saved against the signed-in user (`web_push_subscriptions`, via `POST /api/roster/alerts`). No shift content is stored. `DELETE /api/roster/alerts` removes it.                                                                  |
| Revocation            | A push service answering 404 or 410 means the subscription is gone; the sender deletes that row (`src/lib/roster/alerts/send.ts`).                                                                                                                                       |
| Server configuration  | `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` and `WEB_PUSH_SUBJECT` must be set together (validated in `src/lib/env.ts`). Without them the sender is off (`webPushConfigured()`).                                                                                       |
| What the server sends | One word only: a type code such as `{"t":"changed"}`. Server-sent text, names and links are never shown.                                                                                                                                                                 |
| What the phone shows  | The service worker (`ROSTER_PUSH` in `public/sw.js`) owns every word and every click destination. Codes: `changed`, `request`, `offer`, `manage`, `test`, `brief`, `reminder`, `due`. Each is generic, for example "Your roster changed. Open Roster to see what moved." |
| Cache                 | Push does not touch CacheStorage, so the cache and privacy contract above is unaffected.                                                                                                                                                                                 |

The lock-screen guarantee is the central rule: a server response can never put a patient name, clinical detail or
arbitrary link on a clinician's lock screen, because the payload has no field that could carry one. Keep it that way; do
not add a free-text field to the payload. The privacy reasoning is recorded in the privacy impact assessment under "Web
push notification privacy", including the residual action to clear subscriptions on shared-device logout.

## Intentionally deferred capabilities

These omissions are deliberate and must not be added as generic PWA enhancements:

| Capability                                 | Status and reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background Sync / Periodic Background Sync | Deferred. Queuing or replaying clinical queries, uploads, answers, or mutations risks sensitive local persistence, duplicate writes, stale auth, and actions occurring after the user's context changed. Browser support is also not a correctness guarantee.                                                                                                                                                                                                                                                                                         |
| Web Share Target / inbound sharing         | Deferred. Accepting text, URLs, or documents from another app needs an explicit consent, validation, auth, provenance, malware/file-safety, and retention flow. The manifest intentionally has no `share_target`.                                                                                                                                                                                                                                                                                                                                     |
| File handlers                              | Deferred. Associating PsychSift with clinical document types could import sensitive files without the existing upload review and validation context. The manifest intentionally has no `file_handlers`.                                                                                                                                                                                                                                                                                                                                               |
| Offline clinical data, search, or answers  | Prohibited by the current privacy model, with one narrow, owner-approved exception (2026-09-25, see "The offline pocket pack" above): the generated crisis-number and signed-off Act-deadline pack in `public/offline.html`, which is public and non-patient. Everything else stays prohibited — cached clinical guidance can become stale, lose revocation/auth guarantees, separate answers from source provenance, and expose private content to durable same-origin storage. No search, answer, document, upload, or patient data is ever cached. |

Any proposal to enable one of these capabilities needs a product decision, threat model, privacy review, data lifecycle,
revocation and logout behavior, browser-support fallback, accessible consent UX, and targeted offline/update tests before
implementation.

## Change review checklist

When changing the PWA:

1. Re-read the cache invariant and keep the allowlist path- and destination-specific.
2. Confirm request and response guards still reject private, query-bearing, ranged, authenticated, cookie-setting, and
   cross-origin content.
3. Update `CACHE_VERSION` when cache contents or semantics change.
4. Keep worker/manifest/offline/icon routes public without session refresh, while preserving their restrictive headers.
5. Test both a clean install and an upgrade from the prior worker.
6. Verify offline failure language does not imply that clinical features work offline.
7. Check installed light/dark chrome, keyboard/screen-reader behavior, maskable icons, safe areas, and update recovery.
8. Run local checks first; stop and request confirmation before any provider-backed verification.
