# Privacy-safe production error tracking

Production server exception tracking is an optional, provider-gated Sentry integration. It is inert unless `SENTRY_DSN` is configured. Browser telemetry and session replay are not enabled — there is no client Sentry bundle path. Structured server/edge **Logs** are available under the privacy rules below. Runtime init is owned by `src/sentry.{server,edge}.config.ts` (loaded once from Next server/edge instrumentation); do not add a second `Sentry.init()` path or a browser SDK import.

## Data envelope

### Errors

The application sends only an error type, scrubbed code stack-frame locations, the static Next.js route pattern, route/router type, release/environment identifiers, an allowlisted capture mechanism (`type` and `handled` only), and an event identifier. Before export it discards exception messages, requested URLs and query strings, headers, cookies, bodies, users, breadcrumbs, arbitrary context, local variables, prompts, clinical queries, answers, document content, and `mechanism.data`. Do not add those fields to the allowlist. The same `privacySafeErrorEvent` scrubber runs on server and edge `beforeSend` hooks.

The static route pattern (for example `/api/documents/[id]`) is safe operational metadata; the actual request path is deliberately ignored. Error grouping uses the route pattern, a fixed JavaScript runtime error type, and scrubbed code-frame location. When no `route_path` tag is present the pattern is recovered from the Next per-route server bundle named in the stack (`/app/.next/server/app/api/medications/route.js` yields `/api/medications`), in both that spelling and the `app:///_next/...` form the SDK rewrites frames to once source-map upload is enabled. Route-group and parallel-route directories (`(search-app)`, `@slot`) are compiled into that path but are not part of the URL, so they are stripped to match what `captureRequestError` itself tags; a dynamic segment appears as the literal pattern Next compiled (`[slug]`) and is never a request value. Custom error names are treated as untrusted free-form text and collapse to `Error`; grouping never uses an owner, patient, query, document, or request identifier. The capture mechanism carries only an SDK code literal and a boolean, and is what distinguishes an unhandled rejection from a caught-and-reported error; without it Sentry defaults every event to handled.

### Performance traces (DB query visibility)

Server/edge tracing is enabled at a low default sample rate (`tracesSampleRate` defaults to `0.1`; override with `SENTRY_TRACES_SAMPLE_RATE`, or set `0` to disable). The Supabase JS integration (Node server only — `src/lib/observability/supabase-tracing.ts`) instruments PostgREST operations so Sentry's Queries dashboard can show slowest tables/operations. Integration and admin-client instrumentation stay inert unless `SENTRY_DSN` is set and the resolved sample rate is greater than zero.

Privacy constraints for traces:

- `sendOperationData` / `dataCollection.databaseQueryData` stay **false** — PostgREST filter values and mutation bodies are never attached as `db.query` / `db.body`.
- Span descriptions are rewritten to `select from(<table>)` (operation + table only) by `privacySafeTransactionEvent` before export.
- Allowed span attributes: `db.table`, `db.schema`, `db.system`, `db.operation`, `db.sdk`, `http.status_code`, and Sentry op/origin metadata.
- Breadcrumbs remain disabled (`maxBreadcrumbs: 0`). Request URLs, users, and free-form context are stripped from transactions the same way as errors.

View samples in Sentry under **Explore → Traces**, and aggregated DB performance under **Dashboards → Sentry Built → Queries**.

### AI agent monitoring (OpenAI spans)

The OpenAI client is wrapped by `src/lib/observability/agent-monitoring.ts` (`Sentry.instrumentOpenAiClient`, SDK ≥ 10.67) so Sentry's AI/agents views show per-call operation, model, latency, and token usage. The wrap is inert unless `SENTRY_DSN` is set, the resolved traces sample rate is greater than zero, **and** the runtime actually initialized Sentry — so it is always a no-op in the ingestion worker and in tests, which import the module but never run `Sentry.init()`.

Privacy constraints for agent monitoring:

- `recordInputs` / `recordOutputs` are **false** on the wrap and `dataCollection.genAI` is `{ inputs: false, outputs: false }` in both runtime configs — prompts, clinical queries, source evidence, generated answers, and embedding inputs are never recorded.
- `privacySafeTransactionEvent` allowlists only gen_ai metadata attributes (system, operation name, request/response model, response id, finish reasons, token usage, conversation id) and rebuilds gen_ai span descriptions as `<operation> <model>` from those attributes. Message, prompt, tool-payload, and embedding-input attributes are stripped on export even if a future SDK version records them.
- Each answer / stream / document-summarize request calls `Sentry.getIsolationScope().setConversationId(<interactionId>)` **before** OpenAI work — the request's synthetic UUID — so the embedding/generation calls of one request group into one conversation without carrying any query text. The public scope method exists in both the installed Node and Edge entries; UUID syntax is checked, while callers remain responsible for supplying the generated request ID.
- User identification (`Sentry.setUser`) is deliberately **not** wired: the committed privacy boundary strips `user` from every outgoing event (see the tests), and linking clinical-query telemetry to an identity would need its own governance review first.
- `responses.parse` (schema-parsed generation) is not in the SDK's instrumentation registry and emits no gen_ai span; `responses.create` and `embeddings.create` are covered.

Rollback matches tracing: set `SENTRY_TRACES_SAMPLE_RATE=0` (agent spans stop; error capture stays) or remove `SENTRY_DSN`. Raising the sample rate above the 0.1 default captures a larger share of answer requests in the agents view and is an operator decision.

### Ingestion worker

The worker is a plain Node process, not a Next runtime, so it initializes `@sentry/node` directly in `worker/observability.ts` (called from `worker/index.ts` before `main.ts` loads, so module-level failures are caught too). It reuses the same `privacySafeErrorEvent` / `privacySafeTransactionEvent` scrubbers as the app and is inert unless `SENTRY_DSN` is set **on the worker service**, which is a separate Railway service from the app — setting the DSN on the app alone leaves ingestion unreported.

Three failure paths report, each tagged with a fixed stage label:

- `process` — a single ingestion job threw. The job's own retry/fail handling is unchanged; this only adds visibility.
- `claim` — job claiming failed repeatedly and the retry budget (`WORKER_MAX_CLAIM_FAILURES`) is spent. A single transient claim failure self-heals on the next poll and is deliberately not reported.
- `fatal` — the worker loop stopped. Events are flushed before exit, and the existing `WORKER_FAILURE_WEBHOOK_URL` dispatch still fires independently.

Privacy constraints are stricter here than for the app, because ingestion errors routinely quote storage paths, filenames, and extracted clinical text: the exception message is discarded like every other event, and the only added tags are `service=worker` and `worker_stage`, both set from code literals and never from job, document, or owner data. Worker events have no route pattern, so grouping uses `service` + stage + runtime error type + top frame. `tests/worker-observability.test.ts` pins that a document id, owner id, storage path, filename, and extracted text are all stripped.

### Sentry “Agent Monitoring” wizard mapping

The product wizard’s copy is generic. Map it to this repo as follows — do **not** paste the wizard’s sample code:

| Wizard step                      | This repo                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Install `@sentry/nextjs` ≥ 10.67 | repository dependency `@sentry/nextjs@^10.69.0` (lockfile resolves `10.69.0`); `10.67` is the minimum supported version; do not switch to pnpm                           |
| `Sentry.init` + tracing          | `src/sentry.server.config.ts` / `src/sentry.edge.config.ts`; DSN from `SENTRY_DSN` only (never hardcode); default `tracesSampleRate` 0.1 via `SENTRY_TRACES_SAMPLE_RATE` |
| `dataCollection.genAI`           | Explicitly `{ inputs: false, outputs: false }`                                                                                                                           |
| `instrumentOpenAiClient`         | `instrumentOpenAIClientForAgentMonitoring` in `createOpenAIClient()` — `recordInputs`/`recordOutputs` **false**                                                          |
| `setConversationId`              | `setAgentConversationId(interactionId)` on `/api/answer`, `/api/answer/stream`, and `/api/documents/[id]/summarize`                                                      |
| `setUser` (optional)             | **Rejected** — scrubbers strip `user`; do not wire                                                                                                                       |

Leaving wizard checkboxes for “record inputs/outputs” or “identify users” unchecked is expected and correct for this clinical app.

### Structured logs (Sentry Logs)

Server/edge `enableLogs` turns on when `SENTRY_DSN` is set (disable with `SENTRY_ENABLE_LOGS=false`). There is still no browser logging path and no `consoleLoggingIntegration` — console output is too easy to leak clinical text.

Privacy constraints for logs:

- Emit only through `sentryLog` / the app `logger` bridge in `src/lib/observability/sentry-logging.ts`.
- Prefer **wide events**: a static allowlisted message plus structured attributes (`bucket`, `code`, `status`, `retry_after_seconds`, …). Never interpolate queries, answers, prompts, document text, emails, or owner ids into the message.
- `beforeSendLog` → `privacySafeLog` is fail-closed: drops `trace`/`debug`, unknown messages, and non-allowlisted attributes.
- The Node runtime registers `forwardAppLogToSentry` after init so existing `logger.warn` / `logger.error` calls reach Sentry with the same scrubber (unknown messages collapse to `Application warn` / `Application error`).

Examples already wired:

- Rate-limit denials and durable-limiter fallbacks in `src/lib/api-rate-limit.ts` (`API rate limited`, fallback messages).
- API failures via `jsonError` → `logger.error("API request failed", …)` (bridged).
- Upload cleanup warnings via the existing logger messages (allowlisted).

#### Sentry Logs wizard mapping

| Wizard step                                                                            | This repo                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npm install @sentry/nextjs` (min `9.41.0`)                                            | `@sentry/nextjs@^10.69.0` (installed `10.69.0`)                                |
| Hardcoded `dsn: "https://…@….ingest…"`                                                 | Env-only `SENTRY_DSN` — never commit a DSN                                     |
| `enableLogs: true`                                                                     | `enableLogs: isSentryLoggingEnabled()` in `src/sentry.{server,edge}.config.ts` |
| `consoleLoggingIntegration({ levels: ["log","warn","error"] })`                        | **Not enabled** — too leaky for clinical text; use `sentryLog` / logger bridge |
| Verify: `Sentry.logger.info('User triggered test log', { log_source: 'sentry_test' })` | `sendSentryTestLog()` after Node init when `SENTRY_SEND_TEST_LOG=true`         |

View samples in Sentry under **Explore → Logs**. Set `SENTRY_ENABLE_LOGS=false` to roll logs back without removing the DSN. For a one-shot wizard verify, set `SENTRY_SEND_TEST_LOG=true`, restart once, confirm the log, then unset the flag.

## Operator approval and rollout

Before setting `SENTRY_DSN`, the operator must approve the vendor/project, data region, retention period, access roles, sampling rate, cost budget, and alert destination. Configure a server-side DSN only; never use a `NEXT_PUBLIC_*` DSN. Keep provider-side IP/user enrichment disabled and restrict project access. Start with a non-production synthetic exception and inspect the received event before enabling production alerts.

When enabling tracing, also review a sampled transaction in Sentry and confirm span descriptions contain only table/operation metadata (no filter literals, clinical text, or mutation payloads). Set `SENTRY_TRACES_SAMPLE_RATE=0` to roll tracing back without removing the DSN.

Source maps are built by `next.config.ts` (`withSentryConfig`, debug ids injected) whenever `SENTRY_ORG` and `SENTRY_PROJECT` reach the build, but the Railway Docker build never uploads them and deletes `.next/static/**/*.map` before the runner stage, so maps are never served publicly. The upload token is **not** a Docker build argument: Railway's Dockerfile builder rejects BuildKit secret mounts, and a build ARG is readable by every script `npm run build` runs. The Sentry plugin's own delete-after-upload option is off because it would also delete the maps from the token-less CI build before the upload step reads them. Uploads run in `.github/workflows/sentry-sourcemaps.yml` on each push to `main`: it rebuilds the same commit with the same release identity (`RAILWAY_GIT_COMMIT_SHA` = the pushed SHA, plus `SENTRY_RELEASE` / `NEXT_DEPLOYMENT_ID` only if Railway sets them) and the same build-time `NEXT_PUBLIC_*` values, then runs a pinned `@sentry/cli sourcemaps upload` with the repository secret `SENTRY_AUTH_TOKEN`; only that step sees the token. Runtime events fall back to Railway's provider-supplied `RAILWAY_GIT_COMMIT_SHA`, so GitHub-triggered deployments do not collapse into the `dev` release. `/api/health` exposes the validated 40-character deployment commit SHA for read-only deploy correlation.

### Source-map upload: verify, scope and rotate the token (owner)

Verify CI maps match a Railway release (on a test release before removing the Railway variable):

1. Set `SENTRY_ORG` and `SENTRY_PROJECT` (not secret) on the Railway app service **and** as repository variables, so both builds inject the same debug ids.
1. After a push to `main`, confirm the `Sentry source maps` workflow ran for that SHA and `/api/health` reports the same SHA.
1. In Sentry, open the release (the SHA, or `SENTRY_RELEASE` if set) → Source Maps / Artifact Bundles: the bundle should list `~/_next/static/chunks/*.js` files with debug ids.
1. Spot-check filenames: pick 2–3 chunk URLs from the live site's page source and confirm the same filenames appear in the uploaded bundle (identical names = identical content hashes).
1. Trigger or wait for a production browser error and confirm the stack trace is de-minified. If it is not, use Sentry's "Unminify" / source-map debug view on the event: a debug-id or filename mismatch means the CI build differs from Railway (check Node version, lockfile, and every `NEXT_PUBLIC_*` / `SENTRY_RELEASE` / `NEXT_DEPLOYMENT_ID` repository variable against the Railway service).

Confirm the token scope (Sentry → Settings → Developer Settings / Organization Auth Tokens): use an organisation auth token (or internal integration) whose only scopes are `project:releases` (release + source-map upload) and, if Sentry requires it for the org, `org:read`. It must not have `project:write`, `project:admin`, `org:write`, `member:*` or `event:*`.

Rotate: create the new token with that scope, update the GitHub repository secret `SENTRY_AUTH_TOKEN` (Settings → Secrets and variables → Actions), re-run the `Sentry source maps` workflow for the latest `main` commit to prove it works, then revoke the old token in Sentry. Never paste the token into issues, PRs, logs or chat.

Because frames arrive minified, the fingerprint built in `privacySafeErrorEvent` normalises the two parts that a rebuild changes. Numbered webpack chunk filenames (`/app/.next/server/chunks/41261.js`) collapse to `unknown`, and minified identifier segments are dropped from a function name while the readable tail is kept (`rV.handleResponse` becomes `handleResponse`, `d0.makeRequest` and `gX.makeRequest` both become `makeRequest`); a wholly mangled name such as `Z` becomes `unknown`. Route handler names `GET`, `POST` and `PUT` are preserved, which is why the minified-identifier pattern is capped at two characters. Without this, one recurring `/api/medications` fault was spread across 25 separate Sentry issues, one or more per deploy, because the fingerprint changed whenever the bundle was rebuilt (2026-09-16 review). Uploading source maps would also fix the grouping, but it is not required for it. Pinned by `tests/error-tracking-fingerprint-stability.test.ts`.

**The fingerprint is never `undefined`.** That normalisation only ever reached events carrying a `route_path` tag, and only `captureRequestError` sets one: measured on 2026-09-17, 853 of the 857 error events in the preceding 30 days had no such tag, because almost everything reaches Sentry through the SDK's own global handlers instead. Those events took an `undefined` fingerprint, which hands grouping straight back to Sentry's default algorithm over exactly the minified frames above — so the 2026-09-16 fix reached 0.5% of error events (worker events aside, which already group by stage and never needed the tag) and the rest kept splintering on every deploy, reaching 20 open issues under the single title "Unhandled server request error". The route pattern is now recovered from the stack when the tag is missing, and a stack naming no route bundle at all falls back to `unrouted` plus the innermost build-stable frame, so those events still separate by origin rather than collapsing into one application-wide bucket. Pinned by the untagged-event cases in `tests/error-tracking-fingerprint-stability.test.ts`, including the `app:///_next` rewrite and the `(search-app)` route group — the two shapes a fixture written to match the pattern, rather than taken from a build, would have missed.

When enabling logs, inspect a sample in **Explore → Logs** and confirm bodies are allowlisted static strings with only operational attributes. Set `SENTRY_ENABLE_LOGS=false` to disable logs without removing the DSN.

## Disable and rollback

Remove `SENTRY_DSN` and restart the service. The tracker then makes no provider calls. To disable only performance tracing while keeping error capture, set `SENTRY_TRACES_SAMPLE_RATE=0` and restart. To disable only structured logs while keeping errors/traces, set `SENTRY_ENABLE_LOGS=false` and restart. Provider-side deletion and retention remain operator responsibilities under the approved Sentry project policy.

## Content-free upload and fatal diagnostics

Upload cleanup logs contain an opaque SHA-256 object reference and fixed operational error classes/codes, rather than storage paths, filenames, owner IDs or provider prose. The digest is an aid for comparing a separately authorised scoped storage inventory; it is not a replacement for durable cleanup records. Exact paths remain in the owner-scoped cleanup queue when that write succeeds. Unknown error names/codes are withheld. The logger also redacts filename and storage/document-path context keys as defense in depth.

Fatal worker console and notification payloads omit raw exception text. Notifications retain the fixed failure state; the existing privacy-filtered error-tracking path retains its stage and scrubbed stack information. No notification was sent during local tests. These measures minimise known diagnostic egress; they do not constitute clinical PHI-minimisation approval or a complete deidentification guarantee.
