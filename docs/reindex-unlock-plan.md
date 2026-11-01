# Ingestion unlock and controlled rollout

Source review: 1 November 2026, `BigSimmo/PsychSift`, base `08fbeda5148d170f3106c80dc43c45e5f650c4b1`
(PR #3881). Source intake owns this plan. [The runbook](reindex-runbook.md) governs execution.
The owner authorized preparation; no ingestion, re-index, paid evaluation, provider operation,
database change or deployment was performed in this review.

## Findings that change the October audit

Much of ingestion exists, but rollout safety and production validation remain incomplete.
The October inventory and database observations have not been refreshed against production.
Do not infer current document counts, admission records, backup health or PITR configuration
from this source review.

| Question                             | Source evidence                                                                                                                            | Implication                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General PDFs and WA supported?       | `worker/admin-text-inspection.ts`, `current`: exact PDF digest, byte length and four-page review; catalogue jurisdiction must be Australia | Widen format inspection and jurisdiction binding separately; neither establishes rights                                                                                            |
| No scanner exists?                   | `worker/malware-inspection.ts`, `worker/clamav-inspection.ts`, `worker/admin-source-runtime.ts`                                            | Scanner implementations exist; commissioned trusted runtime configuration is missing. The [deferral](decisions/2026-10-27-defer-worker-malware-scanner.md) leaves refusal in place |
| Only fully finished indexes visible? | `worker/main.ts`, `committedCoreMetadata` and `commitDocumentIndexGeneration`                                                              | Legacy core becomes visible before enrichment. A filter requiring enrichment would hide the document after pointer movement, not retain its old index                              |
| Staged artifacts hidden?             | `src/lib/reindex-pipeline.ts`, `isCommittedGenerationMetadata`; SQL generation predicates                                                  | Stamped staged rows are hidden before commit. Unqualified legacy rows remain accepted; this is not proof of complete generation isolation                                          |
| Managed completion atomic?           | `worker/managed-generation-job.ts`; migration `20261013200007_managed_native_pdf_terminal_append.sql`                                      | TXT and exact reviewed PDF terminal scopes commit atomically; this is not general all-feature PDF support                                                                          |
| Rollback complete?                   | `src/lib/reindex-rollback.ts`; migration `20261025170000_rollback_legacy_pages_summary_and_guards.sql`                                     | Pointer, pages, metadata and quality are guarded. Summary and generated-label restoration depends on available snapshots; inspect returned restoration flags                       |
| Automatic quality approval?          | `src/lib/reindex-eval-gate.ts`; no worker caller                                                                                           | Gate core exists; no shadow driver uses it to prevent promotion. This change makes offline summary comparison available and rejects empty/invalid evaluations                      |

## Admission changes to implement before activation

Rights work and engineering can proceed in parallel. Rights approval gates only the affected
documents and uses; no WA-wide permission may be inferred from a publisher, URL or public access.

1. **Rights and current permission.** Reuse source-acquisition rights fields (`publicDisplay`,
   `aiUse`, evidence, checked date, recorder), trusted admission identity and independently
   reloaded operative grants. Resolve #HGEC4B with the owner and counsel. Bind each permitted
   operation to document/source digest, publisher, jurisdiction, purpose and current policy.
   Missing or revoked evidence must refuse before any provider request. Do not populate real
   permission records, change public visibility or alter signed fingerprints in this work.
2. **PDF inspection.** Replace the exact national PDF exception with a versioned server-owned
   inspection contract: original digest and byte count, complete page inventory and text hashes,
   active-content/encryption checks, identifier checks and hidden-text consistency evidence.
   Prove the submitted embedding batch derives from those inspected source units. Preserve
   timeouts, cancellation, byte/page limits and process isolation; document unsupported OCR or
   table/image paths explicitly. A new PDF review contract also requires replacing the SQL
   terminal's four-page/four-chunk assumptions, not just removing the TypeScript digest check.
3. **Jurisdiction.** Scope the operative grant to its exact catalogue entry and jurisdiction.
   Resolve the admission contract's country-only `Australia` field without pretending it is
   evidence of WA authority. Test national/WA mismatches and protected/link-only publishers.
   Source eligibility, permission for provider processing and permission for public display
   remain distinct decisions.
4. **Scanning.** Preserve default refusal. Present a concrete choice between a commissioned
   scanner configuration and an explicit administrator-only exception. An exception must be
   attributable, time-limited, source/admission-bound, revocable, restricted to its approved
   channel and reported as unscanned, never `clean`. The existing scanner union and safety
   evaluator require a reviewed contract change; document metadata or an environment boolean
   cannot supply an exception. This plan does not reinterpret the October deferral as approval.

Implement these changes on a feature branch with synthetic fixtures. Review stale/revoked grants,
cross-owner sources, malformed or active PDFs, hidden text, oversized files, cancellation,
scanner failure and exact provider payload binding. Draft any migration unmerged; production
application requires the owner's permission for that specific database change.

## Visibility and rollback acceptance

Define required artifacts for each supported feature set before promotion. Optional enrichment
may be deferred only when that scope is explicit in the report. Keep the old pointer while all
required work and quality checks run. Do not add a blanket enrichment filter or silently send
unsupported PDFs down the legacy auto-commit path.

Use a disposable local PostgreSQL instance and synthetic files to demonstrate failure before
commit, failure after legacy core commit, managed atomic completion, retries with stale leases,
and rollback to both typed and historical unstamped pages. Assess all serving artifact families,
including summaries, labels and legacy unqualified rows. Existing helper/static tests do not
prove deployed database behaviour.

For each pilot candidate, capture the exact current generation and digest and verify that the
next commit will preserve the intended rollback target. Repeat rollback preflight after the
candidate commits, before go/no-go. Record `summary_restored` and `labels_restored`; `ok: true`
alone does not establish whole-document restoration. Never re-queue a pilot candidate before
acceptance, because only one previous generation is retained.

Database backup evidence must include coverage, freshness and a restore demonstration; verify
Storage recovery separately. PITR status is unverified in this session. The historical pilot
accepted a particular recovery limitation; that does not authorize wider batches without PITR.

## Three-document pilot preparation

Select three current, rights-approved documents through a separately authorized metadata read:
one ordinary text document, one difficult native PDF, and one table/OCR case within the actually
implemented scope. If that scope is unavailable, hold the case rather than claim coverage.
Historical filenames are leads, not selected identities. No candidate IDs or approved run are
claimed here.

Before running, pin case IDs and expected document/passage references, corpus/index versions,
models, prompts, feature scope and quality thresholds. Include the reported fallback-only,
garbled text, table and missing-top-five cases where the selected documents support them.
Check correctness and citations independently; re-indexing is a hypothesis for those defects.

Acceptance requires no per-case reciprocal-rank regression, the existing pinned live-canary
recall bars, no citation/numeric/safety regression, and explicit review of extraction defects
and rollback eligibility. Summary averages alone are insufficient. Any unresolved missing case,
unsupported feature, incomplete evidence or regression is a hold. Revert/no-go action itself
needs the applicable live authority.

Present the exact documents, calls/token/runtime bounds, provider/model, pricing basis, TOTAL
estimate and enforceable hard spend cap including downstream/retries before requesting approval.
The historical roughly US$7 estimate is not a fresh quote or approval; retain the recorded
US$30 monthly OpenAI budget and refresh month-to-date usage before a proposal. No paid pilot or
acceptance run is authorized by this engineering request.

## Shadow re-index

Build the production driver after a successful approved pilot, before wider batches. The
[older GUC sketch](reindex-shadow-harness-design.md) needs revision:

- Use service-only, transaction-scoped evaluation wrappers with a document-to-candidate
  generation mapping. Normal retrieval must continue to use committed generations. Unchanged
  documents stay in the evaluation corpus, including their legacy rows; never filter the
  entire corpus to one candidate generation.
- Resolve generation overrides and run retrieval in the same database transaction. Separate
  PostgREST requests do not guarantee a shared session. Never expose overrides through ordinary
  authenticated/anonymous retrieval, use session-persistent GUCs on pooled connections, or allow
  an override to bypass document access controls.
- Split staging from promotion in every supported worker path. Preserve admission, lease fencing,
  current permission and retained source evidence. Leave the old pointer serving throughout.
- Bind evaluations to exact document/generation/digest and case populations. Reuse
  `decideReindexGate` plus existing per-case canary comparison; neither summary `GO` nor a chat
  approval can substitute for the other gates. A no-go leaves the old generation active.
- Promote each document atomically with expected-pointer fencing. Report partial batch outcomes;
  per-document atomicity is not batch-wide atomicity. Retain prior artifacts through the canary
  window, guard cleanup, and abort on drift or stale evidence.
- Require scratch-database ACL, rollback, generation-isolation and query-plan proof, followed by
  separately approved production migration, drift checks and live canary/profile evidence.

Only then propose bounded wider batches and the missing ADHD/valproate acquisitions. No automatic
fetch, ingestion, cleanup, promotion or library-wide run is part of this plan's execution.

## Offline commands and their limits

```sh
npm run audit:ingestion:offline -- --input <sanitized-inventory.json> --expected data/rag-expected-source-coverage.v1.json --output <local-report.json>
npm run reindex:gate:offline -- --input <local-summary-bundle.json>
```

The first wraps the existing local inventory audit; it has no live-read adapter. Synthetic
fixture results are not current-library observations. The second accepts four summary objects:
`baselineRetrieval`, `candidateRetrieval`, `baselineQuality`, `candidateQuality`, and optional
`chunkingExperiment`. Fields match `src/lib/reindex-eval-gate.ts`; when using retrieval eval JSON,
derive `failed_case_count` from `summary.failed_cases.length`. Supply governance quality metrics
explicitly; absent measurements are not zero. Both input summaries must describe nonempty,
comparable populations. Keep private artifacts outside tracked files.

The gate report is advisory and always emits `activationAuthorized: false`. It does not verify
artifact provenance, recompute summary metrics, establish per-case non-regression, stage a
generation or authorize an operation. Its `GO` means only that supplied summary metrics pass.
Use the existing `eval:retrieval:compare -- ... --fail-on-regression` for the separate per-case
canary check, and retain source/clinical acceptance.

## Worker security follow-up

#CK9GBW already requires weekly review of daily image-scan summaries. Next review: **2 November
2026**, then weekly, with remediation decisions before **2 December 2026**. Inspect the latest
`docker-image.yml` worker scan and GitHub issue #3741 after permission for that provider read;
tie findings to the image digest and compare available fixed Debian/pip versions. This session
did not retrieve findings, dispatch CI, build an image or verify that all 24 remain applicable.
The existing workflow remains unchanged; this dated next action is not an external reminder.
Preserve the owner's restriction on hand backports until after the pilot. No suppression or
advisory-window extension may be inferred from this plan.

## Checkpoint

Objective: carry out the audit recommendations without ingestion or re-index execution.
Base: `08fbeda`; branch: `rag-ingestion-safety-20261101`. Owned work: offline gate validation and
report, audit command alias, this plan, runbook/design corrections and owner decision.
Independent read-only source review confirmed the visibility/rollback findings; deployed state
is unverified. Fresh checks: 47 gate/report tests and 46 existing rollback/page/snapshot tests
passed; typecheck, owned-file lint, decisions, instructions, organisation, documentation script
references/inventory and diff checks passed. The audit command ran on six synthetic documents
and 21 expected source records only. Offline production-readiness structural checks passed with
pending legal/privacy and hosted-evidence blockers; this is not production readiness. Independent
diff review found no executable must-fix issues; its two documentation corrections are incorporated.
No PostgreSQL executable is installed here, and no database runtime proof was attempted.
Legal rights, scanner/exception design approval, implementation and integration of
the admission extension, scratch-DB runtime proof, candidate selection and bounded paid-run
approval remain outstanding. Next action: review the admission design above, implement the
selected scanning policy with the PDF/jurisdiction contract and obtain independent security review
before proposing activation. No local commit/publication/deployment or task-ledger reconciliation
is implied by this checkpoint; report those separately at handoff. The owner has been asked to
choose commissioned ClamAV scanning or a scoped administrator-only unscanned exception; neither
option is selected or implemented by elapsed time. Continue local implementation after that
answer; publication, live operations and paid runs retain their separate boundaries.
