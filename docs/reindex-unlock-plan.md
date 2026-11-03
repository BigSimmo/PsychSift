# Ingestion unlock and controlled rollout

## 3 November 2026 continuation

The owner authorized implementing the functional build and deferred legal review as an
internal-build prerequisite ([decision](decisions/2026-11-03-defer-legal-review-for-internal-build.md)).
For an explicitly scoped owner-bound internal draft, use the recorded `review_deferred`
policy rather than fabricating a permitted licence. Explicit prohibitions, source eligibility,
administrator identity, privacy and source-fidelity checks still apply. Historical counsel
prerequisites below apply to public/operational clearance, not to this internal engineering work.

Existing work was recovered from `codex/rag-sol61-20261027` and
`rag-ingestion-safety-20261101` and integrated into `fix/rag-preindex-readiness` rather than
reimplemented. The missing programme ledger was found at
`codex/rag-local-build-20260822`, commit `38552bafe0a82a5df2a4467afd5ba211aee5b966`,
path `.superpowers/sdd/progress.md`. Its latest entry records U04 local implementation
acceptance with later units unstarted; it is an older branch, not proof of today's main-line
operational status. Preserve those accepted artifacts; do not restart U04 or merge the entire
old branch over current code. This continuation reconciles and extends current implementation.

The new general-PDF profile is explicitly native-text-only. It must retain incidental extractor
renders privately without publishing them or claiming image/OCR fidelity. Original sources with
required visual/OCR obligations remain outside that profile. The fixed reviewed pilot retains
its original terminal. A draft generic completion migration is not deployed evidence.

### Local implementation checkpoint — 3 November

Implemented: dynamic WA/native-text PDF inspection and completion; real isolated source
inspection; actual administrator/admission/private-storage supplier; finite internal policy with
fresh permission reads and scoped claims; explicitly deferred legal review; preserved unscanned
exception semantics; byte-bounded exact Unicode chunks; and additive jurisdiction/completion SQL.
The recovered Sol candidate now retains provider-returned model/request evidence and rejects an
infeasible paid comparison before consuming approval or spending.

Observed evidence: 833 tests across the 30-suite domain selector; 43 final runtime/supplier tests
after the claim-scope guard; 17 real-reader/producer tests and 11 Python cases against locked
PyMuPDF 1.28.2; worker bundle compilation; focused lint and migration-role/instruction/decision
guards. The compiler initially found fixture type errors; those were corrected. The pinned-parser
run also found deprecated-import stdout pollution; new code now uses the supported import.

Local PostgreSQL 17/pgvector proof exercised real retained-artifact and vector writes, completion,
strict replay, partial/stale attempts, malformed/null inspection timestamps, public-scope and
revoked-administrator refusal, and preservation of an existing generation. This scratch database
uses auth/storage/cron/vault scaffolding; it is not Supabase hosted parity. The first SQL run
exposed a column ambiguity, which was corrected before the passing runs.

Remaining release gates are explicit. The standard digest-pinned Supabase image could not fit
the managed Docker VFS storage. The supported rootless path was investigated, but its image
acquisition was denied at `index.docker.io` by host network policy. No denial was bypassed.
Consequently the authoritative drift-manifest regeneration is still pending; the committed
manifest has not been hand-edited to disguise that missing replay. Both draft migrations match
their appended schema definitions, but neither is approved/applied to production here.

This is a functioning **scoped native-text internal build**, not full-library, table/image/OCR,
clinical, model-quality or operational acceptance. The exact existing library IDs/admissions and
source features still require an authorized metadata/source inspection. Source-only answer
residuals and missing corpus coverage remain unclosed pending their actual evidence. Sol is
prepared, not activated: model access/prices and the currently infeasible paid comparison scope
must be resolved under the existing bounded-spending gate. No paid inference, real-source
ingestion, re-index, public publication, production setting, merge or deployment ran.

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

1. **Rights and current permission for public/operational clearance.** Internal build work uses
   the 3 November deferral above and does not wait for counsel. For later clearance, reuse
   source-acquisition rights fields (`publicDisplay`,
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
4. **Scanning.** The owner selected a source-scoped administrator-only unscanned exception on
   1 November; see [the decision](decisions/2026-11-01-administrator-source-unscanned-exception.md).
   The local implementation is described below. Default refusal, real-scanner paths and all
   non-malware checks remain. This selection does not activate a runtime module or grant any
   document rights, ingestion, provider-call or rollout approval.

Implement these changes on a feature branch with synthetic fixtures. Review stale/revoked grants,
cross-owner sources, malformed or active PDFs, hidden text, oversized files, cancellation,
scanner failure and exact provider payload binding. Draft any migration unmerged; production
application requires the owner's permission for that specific database change.

## Administrator unscanned exception contract

Local implementation: `supabase/functions/_shared/admin-unscanned-exception.ts`,
`worker/admin-text-inspection.ts` and the existing ingress safety authority. The trusted mounted
module can explicitly return `backend: admin_unscanned_exception` from `loadScannerConfiguration`.
It must independently reload both the current exception grant and the administrator admission
provenance on every call. The callback receives the job, source binding, exact checked-byte hash,
purpose and source/payload phase so it can look up that exact scope. It must not synthesize a grant
or an admission from document metadata, a role label or a caller-supplied boolean.

The strict evidence contract contains:

- An active exception ID and version, responsible administrator and owner IDs, current complete
  source/attempt/lease/authority binding, admission digest, catalogue key, MIME type, byte count,
  `embedding` purpose, hashed approval reference, issue time and expiry. Validity is at most
  24 hours. Missing, revoked, future, expired or malformed evidence refuses.
- Separate current admission provenance: `admin_api` channel, administrator actor and current
  administrator status, matching administrator/owner/document/admission IDs, admission digest
  and original source hash. Current authority facts alone do not expose actor/channel. A backend
  import, ordinary upload or country-level authority declaration cannot establish this scope.

The module is a trusted server boundary: these contracts do not cryptographically authenticate
the supplier or implement a database admission reader. Before separately authorized activation,
review its actual data access and prove that provenance comes from admission events/current role
state and that grants/revocations come from the operative server-owned exception store. No such
module, real grant or exception store is provisioned by this change. Existing deployed modules
that only return scanner configurations remain compatible.

After the existing complete-source, rights, licence, catalogue, identifier, active-content and
source-derived-payload checks pass, the adapter validates the grant against the freshly loaded
facts and mints separate opaque in-process receipts for original bytes and exact payload bytes.
The gate rejects raw records, cloned/serialized receipts, different bindings/purposes and expired
receipts. Source and payload evidence are pinned together; changed grants cannot renew a permit.
An unavailable scanner never falls back to this mode. Revocation is detected by fresh supplier
reads before each provider assertion, not by a background revocation subscription.

Successful safety evidence explicitly says `scanner:unscanned` with the policy and evidence digest,
never `scanner:clean`. Permits cannot outlive the exception, including issuance from an earlier
evaluation result. Receipt validity is process-local; restart requires fresh evidence and new
receipts. No unscanned-upload authority crosses a network through serialized JSON.

This exception does not extend the current supported formats: national plain text and the exact
reviewed native PDF remain the only supported inspection paths. General PDFs, WA jurisdiction
support, rights decisions and shadow promotion remain separate implementation/acceptance work.

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

#CK9GBW was rechecked on **1 November 2026** against the existing completed daily image scan,
[run 41334653850](https://github.com/BigSimmo/PsychSift/actions/runs/41334653850), at main `08fbeda`.
The [sanitized report](audit/worker-image-recheck-2026-11-01.json) pins the image digest and
artifact identity. It records **69 unsuppressed rows: 60 HIGH and 9 CRITICAL**. All original
24 issue #3741 rows remain, with no fixed version listed for those exact entries. These are
scanner observations, not independent exploitability or source-backport determinations.

A separate NLTK advisory lists `3.10.4`. Compare that release with the repository's pinned
upstream security commit before proposing an upgrade; the authentic `3.10.3` version alone
does not establish which source repairs are present. The report also retains the fixed-version
leads for Pillow and the two new SQLite rows since the 31 October scan. The green image job
uses the existing advisory policy and is not security acceptance or permission to ingest.

Next weekly review: **by 8 November 2026**, with remediation decisions before **2 December 2026**.
No scan was dispatched, package changed, image built, suppression added or deployed image
verified for this recheck. The existing workflow remains unchanged; this date is not an external reminder.
Preserve the owner's restriction on hand backports until after the pilot. No suppression or
advisory-window extension may be inferred from this plan.

## Checkpoint

Objective: carry out the audit recommendations without ingestion or re-index execution.
Original base: `08fbeda`; preparation commit: `daadb4f62`; branch: `rag-ingestion-safety-20261101`.
Continuation: implement the owner-selected source-scoped administrator-only unscanned exception
locally, with synthetic tests and independent review. Owned work: offline gate validation and
report, audit command alias, this plan, runbook/design corrections and owner decision.
Independent read-only source review confirmed the visibility/rollback findings; deployed state
is unverified. Fresh checks: 47 gate/report tests and 46 existing rollback/page/snapshot tests
passed; typecheck, owned-file lint, decisions, instructions, organisation, documentation script
references/inventory and diff checks passed. The audit command ran on six synthetic documents
and 21 expected source records only. Offline production-readiness structural checks passed with
pending legal/privacy and hosted-evidence blockers; this is not production readiness. Independent
diff review found no executable must-fix issues; its two documentation corrections are incorporated.
No PostgreSQL executable is installed here, and no database runtime proof was attempted.
Legal rights, implementation and integration of the general PDF/jurisdiction admission extension,
trusted runtime exception commissioning, scratch-DB runtime proof, candidate selection and bounded paid-run
approval remain outstanding. Next action after this exception implementation: extend the PDF and
jurisdiction contracts locally, then obtain their independent security review before proposing
activation. No publication, deployment or task-ledger reconciliation is implied by this checkpoint;
report those separately at handoff. Ingestion, re-index, paid evaluation, merge and deployment
require separate approval under the owner's latest instruction.

Exception continuation verification (1 November): 249 focused tests across ingress safety,
exception receipts, inspection/runtime composition and Node/Edge provider boundaries passed.
Typecheck, owned-file lint, formatting, worker bundle compilation, repository links, organisation,
instructions, decisions and diff checks passed. The type check initially caught test-fixture digest
types; these were corrected before the passing check. Independent source/security review found
no must-fix issues. Tests used synthetic inputs and scanner/provider stubs only; bundle compilation
did not execute the worker. No ingestion, re-index, paid evaluation, provider operation, database
change, merge or deployment occurred. The source changes remain local until separately authorized
publication; no canonical task-ledger reconciliation is claimed.

Publication continuation (1 November): the owner subsequently approved the recommended PR,
deployment and small-pilot steps. General operational permission is recorded; existing rights,
clinical/privacy, exact database-change and bounded-spending controls still apply. No priced,
source-pinned pilot has been approved in this continuation, and no operational grant is inferred
from document metadata.

The reviewed feature branch was published at `1e312aba98fb435d96452c8d7c6d7824f32ab2b3`.
The initial PR-local run stopped on a stale generated documentation snapshot; it was corrected,
and all remaining selected static checks passed. The full unit run had 34,339 passes, three
failures and two skips. All three failures were unchanged cloud-bootstrap tests requiring
npm 11.17.0 rather than this host's 11.9.0. All 23 tests in that suite then passed through the
documented staged-real-npm selector; no global runtime or tests changed, and no full-suite rerun
is claimed. The explicit demo/offline application build passed, including compilation,
TypeScript, static generation and the client-bundle secret check; its normal prebuild/postbuild
issue-cache cycle finished with the tracked cache restored. This proves local compilation, not
production readiness or activation.

PR creation is held because another draft PR (#3866) created a paid Supabase preview despite
reported disablement. Current metadata confirms that preview is inactive and production is
healthy, but available tools do not expose the integration's automatic-preview setting. The
owner has been asked to verify the current setting. Publishing this feature branch created no
new Supabase preview. No PR, merge, deployment, new scan, ingestion, re-index or paid evaluation
has been initiated by this continuation. The exact PR text is prepared locally; no canonical
task-ledger reconciliation is claimed.
