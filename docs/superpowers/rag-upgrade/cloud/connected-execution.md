# Local connected execution contract

This contract begins only after P17 and the immutable offline `PROGRAMME.json` are accepted and published. It does not extend Cloud authority. Run each L phase in a fresh local session and preserve the accepted Cloud programme tip exactly.

## Entry and lineage

L00 creates a new isolated Windows worktree from the exact remote commit that atomically introduced the accepted `PROGRAMME.json`. It must not use, rebase, merge or cherry-pick the occupied `codex/rag-local-build-20260822` worktree. That older P00/P01 lineage is quarantined reference evidence because its package identity and draft receipt chain are obsolete.

Record the accepted Cloud branch, remote tip, package hash, `PROGRAMME.json` path/hash/commit and every P00–P17 receipt before comparing current `origin/main`. Current-main overlap is classified, never silently absorbed. A mismatch in accepted code, source contracts, generated types or runtime behaviour is `NO_GO` and starts a separately reviewed remediation programme; it never rewrites the accepted Cloud lineage.

L00 is offline and read-only. It runs setup, runtime/lock parity, package parity and receipt validation, including `npm run plans:rag:receipts:check -- --before-local L00`. Later local phases use the same checker with that phase id. `--before-local` belongs to `scripts/check-rag-phase-receipts.mjs`; `scripts/rag-phase-launch-check.mjs` is Cloud P00–P17 only. L00 also proves the local controller/reviewer route and resolved skills. No hosted or provider action is permitted.

## Ordered local phases

| Phase | Purpose                                                                       | Controller / review effort | Authority boundary                                                                  | Gate closure                |
| ----- | ----------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- | --------------------------- |
| L00   | Immutable Cloud takeover and drift classification                             | high / high                | Local read-only and isolated worktree                                               | none                        |
| L01   | Official URL, publisher, licence and content-mode verification                | high / xhigh               | Exact approved public metadata only; no protected content                           | official source/licence     |
| L02   | Hosted Supabase identity, schema, types, RLS, grants and migration inspection | xhigh / xhigh              | Named-project read-only approval                                                    | none                        |
| L03   | Migration/main deployment and hosted post-apply acceptance                    | xhigh / xhigh              | Separate merge/deploy approval; merging migrations to main can deploy live Supabase | hosted Supabase/migrations  |
| L04   | Targeted shadow reindex staging                                               | xhigh / xhigh              | Exact operation manifest and stage approval                                         | none                        |
| L05   | Shadow retrieval and paired evaluation                                        | xhigh / xhigh              | Exact case set, provider/cost and evaluation approval                               | targeted reindex/evaluation |
| L06   | Provider canaries and blinded generation acceptance                           | high / xhigh               | Exact provider, case set, exposure, cost and abort approval                         | provider/generation         |
| L07   | Dark deployment and release verification                                      | xhigh / xhigh              | Exact deployment target/window approval; no activation                              | none                        |
| L08   | Controlled activation and rollback proof                                      | xhigh / xhigh              | Promotion and rollback are separately approved actions                              | none                        |
| L09   | Production parity, SLO observation and release acceptance                     | xhigh / xhigh              | Exact production observation/acceptance approval                                    | deployment/production       |
| L10   | Retention-qualified bounded cleanup and final operational acceptance          | xhigh / xhigh              | Exact count, digest, target and destructive approval                                | activation/rollback/cleanup |

L10 may resume across the retention period, but no watcher remains running. It cannot pass merely because cleanup is waiting. It passes only when the approved manifest proves either that zero objects are eligible or that the exact eligible set was deleted and independently verified.

## Approval and evidence contract

The original programme request never counts as connected authority. Before each connected action, record the service, exact target identity, literal actions/commands, scope, data exposure, expected state change, cost ceiling, rollback, stop conditions, authorization identity/time and expiry. Read-only access, mutation, deployment, activation, rollback and destructive cleanup require distinct approvals whenever they are distinct rows above.

Every phase produces one connected-phase receipt and redacted tracked evidence. Raw source content, document identifiers, patient/protected data, provider payloads, credentials and unredacted hosted dumps remain in approved ignored secure output. Tracked files contain sanitized aggregates, hashes and exact outcomes only.

Each manifest phase declares required operation classes. Every accepted `GO` receipt contains every required class with outcome `passed`; failed, blocked and unrun operations cannot close a gate. Each approval names exact action classes, service and target, and each operation must bind to that approval. L08 uses different approvals for promotion and rollback proof; L10 binds bounded cleanup to an explicitly destructive approval. L00 records its local drift-classification operation with no invented external approval.

Each operation also records command/action, expected result, pre-state hash, post-state hash and rollback evidence. A fresh reviewer validates an immutable `phaseStartSha..phaseEndSha` diff package with separate specification and quality verdicts. The receipt, route/capability evidence and review package are then one add-only metadata commit; operational evidence must already exist at `phaseEndSha`. The receipt decision is `GO`, `NO_GO` or `BLOCKED`. P19-style gate shortcuts do not exist: L phases chain in manifest order, and each owned residual gate closes exactly once.

## Required evidence by phase

- L00: Cloud handover identity, full accepted receipt check, current-main drift classification and quarantined-local-WIP comparison.
- L01: sanitized `data/australian-source-verification.v1.json` currentness/licence report. eTG and AMH remain link-only; Healthdirect remains excluded.
- L02: hosted project identity, schema/types/RLS/grants/migration inventory, read-only and redacted.
- L03: approved deployment record plus authoritative live drift and migration-history evidence. Generated-type differences are `NO_GO`.
- L04: dry-run plan, recovery-readiness evidence and exact staged shadow manifest.
- L05: paired offline/shadow evaluation and reindex gate report.
- L06: sanitized provider-canary aggregates, citation/timeout/abort/fallback evidence and blinded usefulness review.
- L07: P17-produced runbook commands, dark deployment identity and no-activation proof.
- L08: promotion evidence, rollback execution and recovery confirmation.
- L09: anonymous/authenticated/administrator read parity, adaptive answer quality and SLO observation.
- L10: retention eligibility, exact count/digest, cleanup or zero-eligible proof, empty residual set and a fresh whole-operational review.

`PROGRAMME.json` remains immutable with all connected gates open. After accepted L10, one fresh Sol/xhigh reviewer validates the complete `PROGRAMME`-commit-to-L10-receipt range with both verdicts. `OPERATIONAL.json`, its parsed route record and its exact review artifacts form one add-only atomic metadata commit; it never edits or replaces the offline or local acceptance receipts.
