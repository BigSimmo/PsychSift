# PsychSift Production Readiness Checklist (Executable Today)

_Updated 2026-10-08 — corrected documentation guidance; operational evidence retains its original dates._

**Status: reusable release-candidate checklist, not an outstanding-task ledger.** Live/provider-gated
action detail is indexed in [`operator-backlog.md`](operator-backlog.md); canonical task status is
governed by the [task-status authority map](task-receipts.md#status-authority).
Unchecked boxes below are rerun per release candidate; they do not imply abandoned repository work.

**Privacy status authority:** [`governance/privacy-readiness.v1.json`](governance/privacy-readiness.v1.json).
The 2026-09-01 closeout records privacy-minimal OpenAI account controls and an acknowledged ZDR
request, not ZDR approval. The production HMAC and database-retention owner attestations were recorded
on 2026-09-01. `npm run check:production-readiness` must continue to fail closed until the remaining
six provider, legal, privacy-adviser, and clinical-safety requirements in that register are verified.
Detailed requirements for OpenAI ZDR, Railway DPA applicability and the production
`RAG_QUERY_HASH_SECRET` control are documented in [`production-readiness.md`](production-readiness.md).
Do not infer a `DOCUMENT_SIGNED_URL_HMAC_SECRET` rotation requirement from this checklist;
the readiness guide corrects that earlier reference. The register remains the status authority.

**Provider-backed boundary:** commands such as `check:supabase-project`, `eval:quality`,
`eval:retrieval:quality`, and `verify:release` touch live Supabase and/or OpenAI. Agents must not
run them without explicit user approval (`AGENTS.md`). Offline substitutes:
`verify:cheap` / `verify:pr-local` / `eval:quality:release:offline` where applicable.

This is the runbook to make the app publishable in one focused pass.

Last reviewed: 2026-07-10. Applies to any feature branch or release candidate.

- Runtime target: the Next.js version pinned in `package.json`, Node >=24.15.0 <25, npm 11.x.
- Supabase target: `sjrfecxgysukkwxsowpy` (`PsychSift Production`).

## Immediate completion targets

- [x] Security headers are enforced at the framework layer (`next.config.ts`).
  - `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
    `Cross-Origin-*`, `Permissions-Policy`, and `Origin-Agent-Cluster`.
- [x] Server-side headers exposure is reduced (`X-Powered-By` disabled).
- [x] Added one-command production preflight:
  - `npm run check:production-readiness`
  - runs env validation, Supabase target checks, lockfile/env-file presence checks, and placeholder checks.
- [x] Added local/dev secret presence helper:
  - `npm run check:local-presence` (optional `--fill`)
  - names + length buckets only; fills only safety-identifier / query-hash / deep-probe into gitignored `.env.local`; never prints values or invents provider credentials.
- [x] Added deployment startup readiness gate:
  - `npm run check:deployment-readiness`
  - verifies `next start` boot behavior and local project identity guard on a managed local port.
- [x] Added README-visible command for readiness preflight.
- [x] Added CI-safe production preflight:
  - `npm run check:production-readiness:ci`
  - used in CI and non-blocking on local-only secret absence.
- [x] Added strict runtime release gate:
  - `npm run check:runtime`
  - enforces Node 24.x and npm 11.x before broad local and release verification.

## Remaining high-priority publish items (same day)

- [ ] Run the readiness preflight with fully populated `.env.local`.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.
- [ ] Run `npm run eval:quality -- --fail-on-threshold` for strict clinical search/answer/source-governance confidence, or `npm run eval:quality:release` only when the active release metadata debt file is accepted.
- [ ] Run browser smoke verification for auth + search + answer formatting after final changes.
- [ ] Confirm no production-only WIP flags (e.g., local no-auth modes) are enabled in deployment
      environment variables.
- [ ] Add deployment/runbook checks for observability, alerts, and rollback.

## Execution flow for a publish candidate

1. `npm run ensure` (capture the published local URL if browser checks are needed).
2. `npm run check:runtime`.
3. `npm run check:production-readiness`.
4. `npm run check:supabase-project`.
5. `npm run check:document-label-coverage`.
6. `npm run lint`.
7. `npm run typecheck`.
8. `npm run test`.
9. `npm run build`.
10. `npm run eval:quality -- --fail-on-threshold` after cheaper local gates pass, or `npm run eval:quality:release` when the active release metadata debt file is intentionally accepted.
11. `npm run check:deployment-readiness`.
12. `npm run check:production-readiness:ci` (CI context only).
13. Frontend browser smoke:

- auth flow
- protected endpoint behavior
- search + answer render path
- mobile viewport

14. Staging deployment smoke + rollback rehearsal.

## Command outputs to record

- `scripts/production-readiness.ts` result: PASS / WARN / FAIL.
- `scripts/check-runtime.ts` result: PASS / FAIL.
- `scripts/check-document-label-coverage.ts` result: PASS / FAIL and missing-label counts.
- `npm run lint` output.
- `npm run typecheck` output.
- `npm run test` output.
- `npm run build` output.
- `npm run eval:quality -- --fail-on-threshold` or `npm run eval:quality:release` output, including source-governance warning baseline if warnings remain.
- Active source metadata debt file path and expiry, if `eval:quality:release` was used.
- Any blocking warnings from readiness preflight should be cleared before publishing.

## Clinical Ask evidence separation

The Clinical Ask implementation is dormant and has no user-visible composer entry point. The controls below remain
required before any future UI reactivation; dormant repository code is not a launch claim.

The readiness script reads local, gitignored evidence receipts from `.local/clinical-ask-evidence/`:
`hosted-migration.json`, `authority-approval.json`, `synthetic-evaluation.json`,
`protected-staging-canary.json`, `contractual-basis.json`, and `physical-iphone-acceptance.json`. A receipt counts as
supplied only when it is a JSON object whose `area` exactly matches the readiness area, whose `issuer`, `target`,
`date`, and `scope` are non-empty (`date` is ISO-shaped), and whose `status` is one of `accepted`, `applied`,
`approved`, `green`, `passed`, or `verified`. This structural validation rejects empty or unrelated files; it does not
independently establish truth, so reviewers must still inspect the receipt.

- [ ] Before reactivation, Clinical Ask master and external-search flags are explicitly set; a seven-mode launch has an empty
      `CLINICAL_ASK_DISABLED_MODES` emergency denylist and an explicit `OPENAI_TRANSCRIPTION_MODEL`.
- [ ] The feedback migration `20260822120000_expand_answer_feedback_for_clinical_ask.sql` is present locally, and a
      separate hosted-migration artefact proves it was applied to the intended project. Repository presence is not
      hosted state.
- [ ] The external authority registry has a dated clinical/source-governance approval artefact. Code presence and
      allowlist tests do not establish approval.
- [ ] A synthetic seven-mode evaluation artefact covers clarification, Evidence Gap, conflicts, review states,
      provider failure, prohibited outcomes, and leakage boundaries.
- [ ] A protected-staging live canary artefact covers provider-backed transcription, indexed retrieval, external
      authority fallback, synthesis, rollback, and source attribution without real patient data.
- [ ] Provider retention, region, cross-border, and contractual basis are recorded and approved; `store:false` and a
      requested cache lifetime are not zero-retention proof.
- [ ] Physical iPhone Safari and installed-PWA microphone acceptance is recorded separately from Chromium emulation.
- [ ] `npm run check:production-readiness` reports each item as code present, blocked, or not verified; missing live
      evidence must never be converted into a pass.
