# Trusted Admin/Backend Document Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Ingestion, RAG, privacy, security, and Supabase migration tasks are sequential. Use one fresh implementer for one numeric task, then one task reviewer returning specification-compliance and code-quality verdicts. Do not use parallel implementers on shared schema, worker, upload, retrieval, or dashboard files.

**Goal:** Make a trusted administrator/backend upload the clinical-admission event, then automatically activate the document for shared clinical answers only after local security, identifier, OCR/extraction, index-integrity, and lifecycle hard gates pass.

**Architecture:** Reuse the current owned/private staging document, durable `ingestion_jobs` state machine, atomic generation commit, append-only publication approval, state digest, RLS, hybrid retrieval, external worker, and private Storage. Add a trusted-admission event, fail-closed ingress/egress gates, reproducible page-level OCR evidence, a persistent technical-review queue, and one digest-bound automatic activation RPC. Ordinary clinical retrieval uses active shared-corpus documents only; an administrator’s staging rows never influence clinical answers.

**Tech stack:** Next.js 16.3/App Router, TypeScript 6 strict, Zod 4, Supabase/PostgreSQL/Storage/RLS, Node worker, Python/PyMuPDF/Tesseract, Docling shadow extraction, OpenAI provider abstraction, Vitest, repository SQL replay/drift tooling.

**Spec:** [`docs/superpowers/specs/2026-08-21-trusted-admin-document-ingestion-design.md`](../specs/2026-08-21-trusted-admin-document-ingestion-design.md)

**Effort:** Architecture/migrations/retrieval/privacy plan `xhigh`; implementation `high`; final safety review `xhigh`. Provider-backed and hosted operations remain separately approved.

**Current-main reconciliation (2026-08-22):** This package includes planning documents only. The separate local worktree that originally explored the trusted-admission foundation is not an implementation dependency and none of its uncommitted source changes may be copied wholesale. Each task starts from the package manifest's exact base, reuses only contracts present on that base or produced by an accepted predecessor, and obtains its own RED/GREEN evidence.

## Global constraints

- Trusted upload means authenticated administrator or explicitly configured backend principal. It never means an arbitrary service-role caller or ordinary authenticated user.
- Upload is the clinical approval. Do not add a second clinical approval/evidence UI.
- The canonical source/evaluation vocabularies come from RAG evaluation Task 1. Import `SourceCorpusScope`, `ClinicalSourceRole`, content-mode, insufficiency, and hard-violation contracts; do not create ingestion-only aliases.
- `uploaded_local` means an activated shared administrator/backend document. Owned staging is never an Answer-mode corpus, even for an administrator. The active `clinical_kb_site` release is also public; no Answer owner overlay exists.
- Public-source acquisition is not a trusted-upload shortcut. It retains exact source-definition, licence, document-version, shadow-evaluation, and explicit activation controls.
- eTG/AMH protected content is link-only and Healthdirect is excluded. Reject these policies before network/provider access and again before Storage, extraction, embedding, indexing, and activation.
- System-generated admission IDs, hashes, reasons, manifests, and state digests remain mandatory audit/anti-race evidence.
- Append-only admission rows retain filename and Storage-key digests, not raw names or paths that may accidentally contain identifiers.
- New objects remain private and absent from clinical answers until automatic activation succeeds.
- Security, identifier, OCR, table, lineage, index-integrity, currentness, and no-active-writer checks are independent hard gates.
- No confidence average or administrator override may publish an unresolved hard-gate failure.
- Keep the existing public-corpus guard and state-digest protections. Extend them for trusted-upload evidence; do not weaken or bypass them.
- Preserve all historical rows. Reconcile legacy/public rows through a separate dry-run operator task, never through an implicit mass promotion.
- Keep `ingestion_jobs` as the source of truth. Do not introduce a second job state machine.
- Heavy OCR/Docling/scanning stays in the external worker. Do not move it into a long-running Edge Function.
- Verify the accepted P14A–P14C/P15 sole-processor, lease-fencing, recovery, and shadow-reindex commits are ancestors of the P16A phase base. If any prerequisite is absent, stop and return to those phases; do not duplicate or re-run their retirement work here.
- Do not perform live Supabase reads/writes, migrations, deployments, Storage operations, provider calls, backfills, paid evaluation, or live canaries without separate explicit authorization.
- For every migration, update `supabase/schema.sql`, regenerate `src/lib/supabase/database.types.ts` and `supabase/drift-manifest.json` through repository tooling when required, and run scratch/privilege/role checks.
- Internet-disabled Cloud may prepare reviewed expected-schema/type/drift changes for source checks, but cannot claim hosted generation or migration proof. Authoritative type regeneration, drift evidence, and target comparison remain separately authorized post-migration gates.
- RAG impact is a behavior change. Require the protected offline RAG gate and separately approved exact-tip live canary before production activation.
- Run `npm run format` and commit its result before any authorized push. This plan does not authorize commit, push, PR, migration apply, deployment, or provider activity.

## Programme ownership and dependency order

This plan is one workstream in the repository-wide RAG programme. Execute overlapping files sequentially and keep one canonical owner per contract:

| Concern                                                                 | Canonical owner                   | Ingestion responsibility                                                          |
| ----------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| Source/corpus/role types and hard programme gates                       | RAG evaluation Tasks 1–2          | Import types; add ingestion-to-answer cases and diagnostics                       |
| Australian catalogue, licence, role eligibility, and canonical conflict | Australian source-governance plan | Enforce admission/indexing policy; create bounded review targets                  |
| One first-party public release and public candidate population          | Repository content/freshness plan | Reuse generation/recovery primitives; never upload/re-index registry rows         |
| Uploaded-document audit and re-index generations                        | Governed ingestion/re-index plan  | Extend its audit, ledger, receipts, and rollback; do not build a duplicate driver |
| Uploaded-document admission, OCR, technical readiness, first activation | This plan                         | Own the trusted upload path end to end                                            |
| Combined corpus retrieval, context packing, and answer coverage         | Retrieval/composition plan        | Supply active shared uploaded units and lineage; do not own ranking               |

This plan executes only as programme phases P16A–P16D. P16A consumes the accepted outputs of P01/P02 source/evaluation foundations, P11 Australian link/governance handoff, P13A–P13C verified delivery, and P14A–P14C/P15 sole-processor/recovery/shadow-reindex contracts. Execute Tasks 0–8 strictly in numeric order across those four bounded phases with one fresh implementer and review range per task. Task 0 records the current baseline and prerequisite disposition; no task is pre-completed by local worktree state, and only evidence produced on the execution package's recorded base counts as proof. P18, not P16A–P16D, owns every live re-index, acquisition, provider canary, migration apply, activation, rollback, or cleanup operation.

## File map

| File                                                                            | Responsibility                                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/lib/trusted-document-admission.ts`                                         | **New.** Pure actor/channel/admission contract and audit payload builder.                   |
| `supabase/migrations/20260821143000_create_document_admission_events.sql`       | **New.** Append-only trusted admission events and atomic admitted-upload RPC.               |
| `src/app/api/upload/route.ts`                                                   | Administrator upload adapter; delegates admission atomically.                               |
| `scripts/import-documents.ts`                                                   | Trusted backend adapter; uses the same admission contract.                                  |
| `src/lib/document-ingress-safety.ts`                                            | **New.** Pure scanner, identifier, hidden-text, and provider-egress gate.                   |
| `worker/python/extract_pdf_assets.py`                                           | Structured OCR evidence, preprocessing, confidence, geometry.                               |
| `src/lib/extractors/document.ts`                                                | Normalized page extraction/evidence contract and fallback behavior.                         |
| `worker/main.ts`                                                                | Stage orchestration, page evidence persistence, hard-gate evaluation, automatic activation. |
| `worker/shadow-extraction.ts`                                                   | Class-specific Docling comparison and bounded shadow evidence.                              |
| `src/lib/document-technical-eligibility.ts`                                     | **New.** Pure hard-gate evaluator and stable reason codes.                                  |
| `supabase/migrations/20260821144000_create_document_technical_review_tasks.sql` | **New.** Persistent technical review queue and service-only state RPCs.                     |
| `supabase/migrations/20260821145000_activate_trusted_document_generation.sql`   | **New.** Admission-bound, digest-bound automatic activation RPC.                            |
| `src/app/api/ingestion/quality/route.ts`                                        | Cursor-paginated task API backed by persistent tasks.                                       |
| `src/app/api/ingestion/quality/tasks/[id]/route.ts`                             | **New.** Assign/reprocess/resolve/withdraw technical task actions.                          |
| `src/components/clinical-dashboard/DocumentManagerPanel.tsx`                    | Exhaustive admin technical queue; no clinical approval control.                             |
| `src/lib/owner-scope.ts`                                                        | Explicit clinical-corpus retrieval scope excluding owned staging.                           |
| `src/lib/rag/rag.ts` and answer/search routes                                   | Thread clinical-corpus scope and preserve source lineage.                                   |
| `src/app/api/documents/[id]/route.ts`                                           | Withdrawal/deletion/cache/cleanup behavior.                                                 |
| `docs/ingestion-state-machine.md`                                               | Final admission, technical, activation, retry, and rollback states.                         |
| `docs/openai-rag-operations.md`, `docs/reindex-runbook.md`                      | Provider egress, selective reprocessing, restore, and operator workflow.                    |

---

## Final acceptance checklist

- [ ] Authenticated administrator upload creates trusted admission automatically.
- [ ] Configured backend import creates the same admission contract.
- [ ] Ordinary users cannot upload through UI, route, Data API, RPC, or Storage.
- [ ] Trusted upload requires no second clinical approval action.
- [ ] New documents remain private and absent from clinical answers until hard gates pass.
- [ ] Provider egress cannot occur before scanner/identifier checks pass.
- [ ] Page OCR evidence includes confidence, geometry, language, orientation, preprocessing, versions, and hashes.
- [ ] A single hard-gate failure cannot be averaged away.
- [ ] Automatic activation is service-only, admission-bound, generation-bound, state-digest-bound, and idempotent.
- [ ] The technical queue is persistent, cursor-paginated, exhaustive, and administrator-only.
- [ ] Administrator clinical answers cannot retrieve owned staging documents.
- [ ] Review-due, superseded, withdrawn, and failed sources are excluded before ranking.
- [ ] Citations retain exact generation/page/span/original-hash lineage.
- [ ] Withdrawal invalidates retrieval/cache before asynchronous cleanup.
- [ ] Reprocessing is targeted, dry-run-first, reversible, and version-driven.
- [ ] Reprocessing extends the canonical ingestion audit/generation ledger/recovery contracts; no parallel classifier, cutover driver, or cleanup owner exists.
- [ ] Shared uploaded retrieval and the active site release form one public candidate population with anonymous/authenticated/administrator parity; no owner overlay or owner-private document can enter Answer.
- [ ] Healthdirect is excluded and eTG/AMH protected content cannot cross acquisition, Storage, extraction, provider, indexing, or answer boundaries.
- [ ] Every activated unit carries canonical corpus, role, content mode, lifecycle, source-policy, generation, and source-lineage metadata.
- [ ] Original and OCR-evidence Storage backup/restore is independently proven.
- [ ] Exactly one ingestion processor owns the final workflow.
- [ ] Focused/offline RAG, privacy, migration, and production-readiness gates pass.
- [ ] Hosted migration/deployment/provider/canary evidence is separately authorized and accurately reported.

---

### Task 0: Verify the accepted sole-processor and recovery baseline

**Files:**

- Revalidate: `docs/plans/edge-ingestion-overhaul-3pr-plan.md`
- Assert absent: `supabase/functions/ingestion-worker/**`
- Inspect: `supabase/functions/indexing-v3-agent/**`
- Inspect: `supabase/config.toml`
- Inspect: `supabase/schema.sql`
- Inspect: `scripts/ingestion-autopilot.ts`
- Inspect: `worker/main.ts`

**Interfaces:** Consumes the exact P16A phase-base SHA plus accepted P14A–P14C/P15 phase receipts and their sole-processor/lease/recovery contracts. Produces: no runtime interface. It records a checked-in baseline disposition naming the sole surviving processor, proving the retired function/config/SQL invoker are absent, recording prerequisite ancestry, and pinning protected offline fixture counts.

- [ ] **Step 1: Re-run the review throttle on the exact implementation head**

Run:

```text
npm run ledger:lookup -- HEAD --scope "trusted admin document ingestion"
```

Expected: explicit `NOT REVIEWED` or a prior result whose scope/head is deliberately reused. Never infer this from the Markdown ledger.

- [ ] **Step 2: Build the processor inventory without provider access**

Record every code/config/SQL path capable of claiming, invoking, retrying, or completing ingestion. Confirm which path owns extraction and which owns enrichment. Treat the pasted cron/function report as historical, not current evidence.

- [ ] **Step 3: Verify accepted edge-retirement and recovery prerequisites before this programme writes activation code**

Validate the accepted P14A–P14C/P15 receipts, commit ancestry, single-processor contract, deleted function path, config, schema invoker removal, lease fencing, generation ledger, and recovery/rollback owners against the P16A phase base. Stop if any prerequisite is missing or altered. The focused ownership test must fail if the retired function/config/invoker returns; Task 0 never recreates, rebases, or repeats the retirement change.

- [ ] **Step 4: Capture the offline baseline**

Run the dry-run selector for the expected Task 1 files:

```text
npm run verify:pr-local -- --dry-run --files src/app/api/upload/route.ts,src/lib/trusted-document-admission.ts,supabase/schema.sql
```

Record current protected RAG fixture counts and Docling Gate B evidence from committed reports. Do not call providers.

**Gate:** exactly one planned ingestion job owner; current-main SHA recorded; no live-state claim.

---

### Task 1: Create trusted admission and unify administrator/backend upload

**Files:**

- Create: `src/lib/trusted-document-admission.ts`
- Create: `tests/trusted-document-admission.test.ts`
- Create: `supabase/migrations/20260821143000_create_document_admission_events.sql`
- Modify: `src/app/api/upload/route.ts`
- Modify: `scripts/import-documents.ts`
- Modify: `src/lib/publication-manifest.ts`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `supabase/schema.sql`
- Modify: `supabase/drift-manifest.json`
- Modify: `tests/upload-admission.test.ts`
- Modify: `tests/private-access-routes.test.ts`
- Modify: `tests/publication-manifest.test.ts`
- Modify: `tests/function-grants.test.ts`
- Create: `tests/trusted-document-admission-schema.test.ts`

**Interfaces:**

Consumes an administrator or trusted-backend actor plus staged upload identity, digest, storage, type, size, correlation, and policy metadata. Produces the durable `TrustedAdmissionInput` contract and administrator/backend-only admission outcome.

```ts
export type TrustedAdmissionActor =
  { kind: "administrator"; administratorId: string } | { kind: "trusted_backend"; principal: string };

export type TrustedAdmissionInput = {
  actor: TrustedAdmissionActor;
  sourceChannel: "admin_api" | "backend_import";
  documentId: string;
  stagingOwnerId: string;
  contentSha256: string;
  storagePath: string;
  originalFileName: string;
  mimeType: string;
  byteCount: number;
  correlationId: string;
  admissionPolicyVersion: string;
};
```

- [ ] **Step 1: Write failing pure-contract tests**

Test that:

- an authenticated administrator maps to `administrator` admission;
- only an allowlisted configured backend principal maps to `trusted_backend`;
- ordinary authenticated users, missing principals, arbitrary service-role callers, unknown channels, and malformed hashes fail closed;
- the audit payload contains no document content;
- a duplicate `(document_id, content_sha256, decision)` is idempotent.

Run:

```text
node scripts/run-vitest.mjs run tests/trusted-document-admission.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Write failing migration/privilege tests**

Pin:

- append-only `document_admission_events`;
- service-role-only table and RPC grants;
- actor-kind constraints requiring exactly the matching actor identifier;
- SHA-256, channel, policy-version, and decision constraints;
- one atomic RPC that creates document + admission event + ingestion job;
- direct public insert remains rejected;
- no direct `anon`/`authenticated` table or Storage write grant.

Run:

```text
node scripts/run-vitest.mjs run tests/trusted-document-admission-schema.test.ts tests/function-grants.test.ts tests/private-access-routes.test.ts
```

Expected: FAIL on the missing migration/RPC.

- [ ] **Step 3: Implement the pure admission contract and forward migration**

The migration extends/replaces `create_uploaded_document_with_ingestion_job` through a new versioned RPC rather than breaking the current signature. It inserts the private owned document, admission event, and job in one transaction. Keep the v1 RPC during a compatibility window.

Use `SECURITY DEFINER`, empty/fixed `search_path`, explicit row values, bounded JSON, and service-role-only execution. The caller supplies a prevalidated actor; SQL independently validates actor shape/channel and never trusts content metadata as authority.

- [ ] **Step 4: Route both admission channels through the same service**

`src/app/api/upload/route.ts` keeps administrator authentication and current structural validation. `scripts/import-documents.ts` identifies a configured backend principal and uses the same RPC. Neither path inserts directly into `documents` or `ingestion_jobs`.

Remove no current duplicate/cleanup compensation behavior. Update duplicate detection so corpus-level byte identity is deterministic and cannot create two active copies.

- [ ] **Step 5: Generate automatic publication evidence, not a second form**

Extend `publication-manifest.ts` with a trusted-admission builder that derives reason/evidence from the immutable admission event and original hash. Keep manual manifests for legacy/operator workflows. Do not relax manual publication safeguards globally.

- [ ] **Step 6: Verify Task 1**

Run:

```text
node scripts/run-vitest.mjs run tests/trusted-document-admission.test.ts tests/trusted-document-admission-schema.test.ts tests/upload-admission.test.ts tests/upload-duplicate-cleanup-ledger.test.ts tests/storage-upload-compensation.test.ts tests/private-access-routes.test.ts tests/publication-manifest.test.ts tests/function-grants.test.ts
npm run check:migration-role
npm run check:owner-scope
```

Expected: all focused tests/checks pass; no ordinary-user admission path exists.

**Checkpoint:** inspect migration/schema/types/drift diffs; no provider call or live migration.

---

### Task 2: Add fail-closed quarantine, malware/active-content, identifier, and provider-egress gates

**Files:**

- Create: `src/lib/document-ingress-safety.ts`
- Create: `tests/document-ingress-safety.test.ts`
- Modify: `src/lib/upload-structure.ts`
- Modify: `src/lib/privacy.ts`
- Modify: `src/lib/env.ts`
- Modify: `worker/main.ts`
- Modify: `worker/row-contracts.ts`
- Modify: `src/lib/validation/row-contracts.ts`
- Modify: `docs/rag-improvement/data-flow-register.md`
- Modify: `tests/upload-structure.test.ts`
- Modify: `tests/privacy.test.ts`
- Modify: `tests/extracted-document-validation.test.ts`
- Create: `tests/document-provider-egress-gate.test.ts`

**Interfaces:**

Consumes quarantined staged bytes, scanner/identifier/active-content/source/licence evidence, and policy version. Produces the fail-closed `DocumentIngressSafetyResult` and typed hard-gate codes below before any external extraction or activation.

```ts
export type IngressHardGateCode =
  | "scanner_unavailable"
  | "malware_detected"
  | "active_content_detected"
  | "identifier_detected"
  | "hidden_text_conflict"
  | "unsupported_encrypted_document"
  | "excluded_source"
  | "link_only_content"
  | "index_licence_not_permitted"
  | "source_policy_mismatch";

export type DocumentIngressSafetyResult =
  | { verdict: "pass"; policyVersion: string; checks: string[] }
  | { verdict: "quarantine"; policyVersion: string; codes: IngressHardGateCode[] };
```

- [ ] **Step 1: Write the fail-closed tests**

Cover scanner success/unavailable/malware, unsafe PDF action/attachment fixtures, encrypted/password documents, identifier positives, clinical numeric false positives, hidden-text disagreement, Healthdirect exclusion, eTG/AMH link-only content, exact-document licence denial, and bounded redacted diagnostics. Assert the provider client is never created when the egress gate is not `pass`.

Run:

```text
node scripts/run-vitest.mjs run tests/document-ingress-safety.test.ts tests/document-provider-egress-gate.test.ts
```

Expected: FAIL because the gate does not exist.

- [ ] **Step 2: Implement a pluggable scanner boundary**

Define an adapter contract suitable for an operator-selected local ClamAV/ICAP/container scanner without hard-wiring a hosted provider. In production, missing mandatory scanner configuration quarantines; local/test fixtures use a deterministic fake. Never log filenames plus content, scanner raw output, or extracted text.

- [ ] **Step 3: Extend structural and hidden-content checks**

Keep current OOXML protections. Add bounded PDF inspection for active actions, embedded files, unsafe launches, encryption, suspicious text-layer/visual-layer mismatch, and parser-budget failure. Every rejection has a stable code and no content echo.

- [ ] **Step 4: Perform local identifier screening before provider egress**

Use local native extraction and local OCR needed for screening. Reuse privacy primitives where safe, but keep clinical numbers/doses from being mislabeled as patient identifiers. A positive creates a technical task; it does not delete the original.

- [ ] **Step 5: Fence every provider-backed ingestion call**

Place one provider-egress assertion before captions, embeddings, summaries, or any future model call. Tests must prove a newly added provider call cannot bypass it through an alternate worker branch.

- [ ] **Step 5A: Enforce governed content mode and licence at every boundary**

Import the Australian/source-governance catalogue contract. Reject excluded/link-only/non-indexable content before acquisition or upload when the source is declared, then repeat the check after local metadata extraction and before Storage persistence, provider egress, chunk creation, embedding, and activation. Do not infer permission from `.gov.au`, publisher identity, filename, or document prose. A late publisher-policy match quarantines without copying text into the task row.

- [ ] **Step 6: Verify Task 2**

Run:

```text
node scripts/run-vitest.mjs run tests/document-ingress-safety.test.ts tests/document-provider-egress-gate.test.ts tests/upload-structure.test.ts tests/privacy.test.ts tests/extracted-document-validation.test.ts tests/ingestion.test.ts tests/indexing-v3-agent.test.ts
npm run check:production-readiness
```

Expected: focused checks pass. Production readiness may remain provider/operator gated; report exact status.

---

### Task 3: Persist reproducible OCR/layout evidence and promote extraction by document class

**Files:**

- Modify: `worker/python/extract_pdf_assets.py`
- Modify: `src/lib/extractors/document.ts`
- Modify: `worker/main.ts`
- Modify: `worker/shadow-extraction.ts`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/index-quality.ts`
- Modify: `eval/docling/fixtures/manifest.v1.json`
- Modify: `eval/docling/harness/score.py`
- Modify: `eval/docling/report/lab-config.json`
- Modify: `tests/pdf-extractor.test.ts`
- Modify: `tests/pdf-extraction-budget.test.ts`
- Modify: `tests/index-quality.test.ts`
- Modify: `tests/worker-shadow-extraction.test.ts`
- Modify: `tests/docling-lab-contract.test.ts`
- Create: `tests/ocr-evidence-contract.test.ts`

**Interfaces:** Consumes `{ documentId, generationId, contentSha256, admittedStoragePath, extractionPolicyVersion }` plus the sole Task 0 processor. Produces `extractTrustedDocument(input: TrustedExtractionInput): Promise<TrustedExtractionResult>`, generation-addressed `PageExtractionEvidence`, optional private evidence-object digest, and stable retrieval units carrying page/geometry/heading/table ancestry and source-policy lineage. It does not activate a document.

**Page evidence contract:**

```ts
export type PageExtractionEvidence = {
  extractor: { name: string; version: string; configurationDigest: string };
  ocr: null | {
    engine: string;
    version: string;
    languages: string[];
    orientationDegrees: number | null;
    confidenceMean: number | null;
    confidenceP10: number | null;
    lowConfidenceWordCount: number;
    evidenceObjectPath: string | null;
    evidenceSha256: string | null;
  };
  imageCoverage: number;
  needsReview: boolean;
  warnings: string[];
};
```

The resulting candidate generation also emits the shared RAG retrieval-unit contract: stable unit ID, document/generation ID, page/span or visual geometry, heading/table ancestry, canonical `corpus_scope`, `source_role`, `content_mode`, source-policy version, original-content hash, extractor/chunker/index-unit versions, and embedding contract. Ingestion creates these fields; retrieval owns eligibility, merging, ranking, and context packing.

- [ ] **Step 1: Add failing OCR evidence tests**

Assert that:

- Tesseract structured/TSV output retains word confidence and bounding boxes;
- language, orientation, render scale, preprocessing, and engine version are recorded;
- unsafe geometry/timeouts remain bounded;
- page metadata persists `needsOcr`/`needsReview` instead of `{}`;
- large word evidence uses a generation-addressed private object path and digest;
- no OCR text appears in logs or task records.

- [ ] **Step 2: Replace plain `image_to_string` with structured OCR output**

Use Tesseract data output with explicit language/PSM/OEM configuration selected by measured page class. Add orientation/deskew/contrast/noise preprocessing behind deterministic signals. Preserve both native and OCR hashes and prevent naïve duplicate text append.

- [ ] **Step 3: Extend page persistence**

Update `buildDocumentPageRows` in `worker/main.ts` to persist bounded evidence. Store compressed word geometry privately only when OCR ran or confidence requires review. Ensure cleanup/reindex removes obsolete evidence by generation without deleting the active generation early.

- [ ] **Step 4: Expand the hard Docling corpus**

Add synthetic/licensed fixtures for dense medication tables, merged cells, multi-column reading order, flowcharts, rotated scans, image bleed, footnotes, and low-quality photocopies. Version the corpus and scorer.

- [ ] **Step 5: Add class-specific shadow decisions**

Keep `WORKER_DOCUMENT_EXTRACTOR_MODE=legacy|shadow` and the cohort kill switch. Add deterministic document-class metrics and store only bounded aggregate comparison plus task reason codes. Promotion is allowed only for a class whose exactness/table/reading-order gate improves with no protected regression and acceptable latency budget.

- [ ] **Step 6: Bind document-class retrieval probes**

For each fixture/candidate class, bind one or more privacy-reviewed must-pass retrieval cases and preserve the shared case-set fingerprint. Extraction promotion requires page/table/numeric fidelity and retrieval non-regression on the same evaluated population; OCR metrics alone cannot approve a chunking/indexing change.

- [ ] **Step 7: Verify Task 3**

Run:

```text
node scripts/run-vitest.mjs run tests/ocr-evidence-contract.test.ts tests/pdf-extractor.test.ts tests/pdf-extraction-budget.test.ts tests/index-quality.test.ts tests/worker-shadow-extraction.test.ts tests/docling-lab-contract.test.ts
npm run check:docling-lab
```

Expected: focused tests and the offline Docling contract gate pass. The full benchmark is `bash eval/docling/run-lab.sh`; it requires the repository container/runtime and model assets, so run it only when that benchmark is intentionally authorized and report it as environment-gated otherwise.

---

### Task 4: Add technical hard gates and automatic digest-bound activation

**Files:**

- Create: `src/lib/document-technical-eligibility.ts`
- Create: `tests/document-technical-eligibility.test.ts`
- Create: `supabase/migrations/20260821144000_create_document_technical_review_tasks.sql`
- Create: `supabase/migrations/20260821145000_activate_trusted_document_generation.sql`
- Modify: `worker/main.ts`
- Modify: `src/lib/index-quality.ts`
- Modify: `src/lib/publication-manifest.ts`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `supabase/schema.sql`
- Modify: `supabase/drift-manifest.json`
- Modify: `tests/publication-manifest.test.ts`
- Modify: `tests/source-review-schema.test.ts`
- Modify: `tests/function-grants.test.ts`
- Create: `tests/trusted-document-activation-schema.test.ts`
- Modify: `scripts/sql/verify-publication-approval.sql`

**Interfaces:**

Consumes security/identifier/source/currentness/extraction/lineage/embedding/generation evidence bound to one candidate state digest. Produces `TechnicalEligibilityDecision` and atomic activate-or-review behavior through the typed hard gates below.

```ts
export type TechnicalHardGateCode =
  | "security_not_passed"
  | "identifier_screen_not_passed"
  | "content_mode_ineligible"
  | "source_policy_ineligible"
  | "empty_extraction"
  | "page_coverage_failed"
  | "ocr_review_required"
  | "critical_numeric_ocr_uncertain"
  | "table_coverage_failed"
  | "reading_order_failed"
  | "lineage_incomplete"
  | "embedding_incomplete"
  | "generation_incomplete"
  | "source_not_current"
  | "active_writer_present"
  | "state_digest_changed";

export type TechnicalEligibilityDecision =
  | { verdict: "activate"; policyVersion: string; stateDigest: string }
  | { verdict: "technical_review"; policyVersion: string; codes: TechnicalHardGateCode[] };
```

- [ ] **Step 1: Write failing pure decision tests**

Test each gate independently and in combination. Assert an excellent aggregate score cannot cancel one hard failure. Assert deterministic sorted reason codes and no extracted text in output.

- [ ] **Step 2: Write failing SQL activation tests**

The new RPC must reject:

- no trusted admission event;
- mismatched content hash/document/admission actor;
- non-current lifecycle;
- missing or open hard-gate task;
- incomplete/mismatched artifact ownership;
- active worker/agent job;
- stale state digest;
- direct public insertion or ordinary-role execution;
- double activation with a different generation.

It must also reject missing/unknown canonical corpus/role/content-mode metadata, link-only or excluded content, source-policy drift, and a generation that was evaluated against a different case-set/population fingerprint.

It must idempotently return the already-active result for the exact same document/generation/digest.

- [ ] **Step 3: Create persistent technical tasks**

Use append/update RPCs with fixed search paths and row locks. Hard-gate evaluation upserts one open task per `(document, generation, gate code)`. A passing replacement generation resolves matching older tasks as `resolved_by_generation`; history is never deleted.

- [ ] **Step 4: Implement automatic activation**

After a candidate generation commits and the pure decision returns `activate`, derive the current publication evidence from the trusted admission event, compute/verify the publication state digest, and call the activation RPC. Reuse the existing guarded owned-to-public transition and artifact-ownership checks. Administrator admissions use the admitting administrator UUID; trusted-backend admissions use an explicitly configured system-operator UUID and never mislabel the staging owner as the approver. This is system evidence, not a second human action. Do not add a UI approval call.

Activation failure must leave the document owned/private and the previous public corpus unchanged. It records a bounded technical task and never retries a digest mismatch blindly.

Keep the three promotion paths explicit:

| Path                                                      | Clinical admission                                     | Technical/evaluation gate                                                                  | Promotion authority                                                     |
| --------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| New administrator/backend `uploaded_local` document       | Trusted upload event                                   | All ingestion hard gates plus complete first generation                                    | Automatic digest-bound first activation; no second administrator action |
| Re-index/reprocess of an already active uploaded document | Existing admission remains valid                       | Exact-generation baseline/candidate comparison, recovery evidence, no protected regression | Explicit operational promote command; not a second clinical approval    |
| Fetched `australian_public`/supplementary version         | Governed source-definition and exact-version approvals | Licence, extraction, index, programme evaluation, recovery evidence                        | Human approval bound to exact hash/generation/report/policy             |

The activation receipt records source-policy version, corpus scope, role, content mode, case-set/population fingerprints, generation/state digest, prior generation when present, and cache/snapshot invalidation identity.

- [ ] **Step 5: Verify Task 4**

Run:

```text
node scripts/run-vitest.mjs run tests/document-technical-eligibility.test.ts tests/trusted-document-activation-schema.test.ts tests/publication-manifest.test.ts tests/source-review-schema.test.ts tests/function-grants.test.ts tests/index-quality.test.ts tests/ingestion-mutation-safety.test.ts tests/reindex-pipeline.test.ts
npm run check:migration-role
npm run check:owner-scope
npm run check:production-readiness
```

Expected: focused tests pass; hosted application/migration state remains unverified.

---

### Task 5: Replace bounded quality discovery with a durable administrator technical queue

**Files:**

- Modify: `src/app/api/ingestion/quality/route.ts`
- Create: `src/app/api/ingestion/quality/tasks/[id]/route.ts`
- Modify: `src/components/clinical-dashboard/DocumentManagerPanel.tsx`
- Modify: `src/components/ClinicalDashboard.tsx`
- Modify: `tests/ingestion-quality-route.test.ts`
- Create: `tests/ingestion-quality-task-route.test.ts`
- Modify: `tests/document-admin.dom.test.tsx`
- Create: `tests/ingestion-quality-console.dom.test.tsx`
- Create: `tests/ui-ingestion-quality.spec.ts`
- Modify: `tests/api-route-coverage.test.ts`
- Modify: `tests/api-validation-contract.test.ts`

**Interfaces:** Consumes persistent Task 4 technical-review rows plus `{ cursor, limit, filters }` and an administrator claim. Produces `GET /api/ingestion/quality` cursor pages and `PATCH /api/ingestion/quality/tasks/[id]` actions `{ action: "assign" | "reprocess" | "resolve" | "withdraw"; expectedVersion: number; reason?: string }`, plus the existing dashboard projection. It exposes no document text and no clinical-approval action.

- [ ] **Step 1: Write the pagination/exhaustiveness tests**

Seed more than 200 documents/tasks and prove cursor traversal returns every open task exactly once in stable priority order. Assert no `.slice(0, 80)` API truncation and no `.slice(0, 12)` UI truncation.

- [ ] **Step 2: Write action/authorization tests**

Only administrators may list or mutate tasks. Cover assign, targeted reprocess, false-positive resolution with reason, withdraw, stale task version, active job conflict, and missing task. There is no clinical approve action.

The same administrator surface may list canonical source-governance conflict review targets produced by the Australian/retrieval plans, but those are a distinct task type. Store only conflict ID, source/chunk opaque IDs, reason codes, lifecycle, and assignment/disposition. A conflict flag never automatically withdraws, supersedes, changes currentness, or changes the clinical approval of the uploaded guideline.

- [ ] **Step 3: Implement cursor-paginated task reads**

Read persistent task rows with bounded page size, stable `(priority, created_at, id)` cursor, filters, counts, and no document text. Preserve links to the existing private document/page viewer.

- [ ] **Step 4: Implement the administrator queue UI**

Render all loaded pages with explicit Load more/pagination, filters, task history, technical reasons, and wired actions. Keep retry/reindex/enrich only where their semantics remain correct. Add assignment and withdrawal; do not add a second clinical approval control.

- [ ] **Step 5: Verify Task 5**

Run:

```text
node scripts/run-vitest.mjs run tests/ingestion-quality-route.test.ts tests/ingestion-quality-task-route.test.ts tests/ingestion-quality-console.dom.test.tsx tests/document-admin.dom.test.tsx tests/api-route-coverage.test.ts tests/api-validation-contract.test.ts
npm run typecheck
```

Expected: all focused checks pass. Browser QA is required only if the production dashboard UI changed as planned.

Run the repository-safe server and the new focused administrator journey:

```text
npm run ensure
node scripts/run-playwright.mjs tests/ui-ingestion-quality.spec.ts --project=chromium
```

The journey stubs the administrator, quality-task, retry/reprocess, and document APIs; proves cursor loading, task actions, no clinical-approval control, and desktop/phone rendering; and uses the URL printed by `npm run ensure` rather than assuming a port.

---

### Task 6: Enforce active shared-corpus retrieval, evidence lineage, conflict, and withdrawal

**Files:**

- Modify: `src/lib/owner-scope.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `src/app/api/answer/route.ts`
- Modify: `src/app/api/search/route.ts`
- Modify: `src/lib/rag/rag-answer-support.ts`
- Modify: `src/lib/source-governance.ts`
- Modify: `src/app/api/documents/[id]/route.ts`
- Modify: `src/lib/rag/rag-cache.ts`
- Modify: `tests/owner-scope.test.ts`
- Modify: `tests/retrieval-access-scope.test.ts`
- Modify: `tests/api-search.test.ts`
- Modify: `tests/rag-answer-support.test.ts`
- Modify: `tests/source-review-policy.test.ts`
- Modify: `tests/document-mutation-routes.test.ts`
- Create: `tests/staging-document-retrieval-exclusion.test.ts`
- Create: `tests/document-withdrawal-propagation.test.ts`

**Interfaces:** Consumes Task 4 `ActivationReceipt`, Australian/source-governance decisions, and the immutable `RagContextSnapshot`. Produces `clinicalAnswerAccessScope(): { includePublic: true; corpusScopes: readonly ["uploaded_local", "clinical_kb_site", "australian_public"] }`, `resolveActiveSharedClinicalCandidates(scope, snapshot): Promise<SearchResult[]>`, complete citation lineage, staging/private/withdrawn exclusion, and withdrawal invalidation for the affected snapshot keys.

- [ ] **Step 1: Write the staging-exclusion tests**

Prove anonymous, ordinary-authenticated, and administrator clinical-answer requests retrieve identical active shared `uploaded_local` and active public `clinical_kb_site` candidate IDs. Administrator-owned admitted/processing/failed rows and all legacy owner-private document uploads must remain absent even if `status='indexed'`. Preserve separate administrator document-management reads; they never alter Answer candidates.

- [ ] **Step 2: Introduce an explicit clinical-corpus access scope**

Add a named scope that maps to one public Answer candidate call containing active shared `uploaded_local`, the active public `clinical_kb_site` release, and eligible Australian scopes; thread it through answer/search entry points. User, administrator, and legacy `owner_id` values cannot select another Answer population or cache namespace. Do not change tenant-safe owner-plus-public helpers used only by document management without a caller-by-caller audit.

- [ ] **Step 3: Pin answer lineage**

Ensure answer/citation structures retain document ID, generation ID, chunk/index-unit ID, page/span, original content hash, and policy versions. Persist only bounded opaque identifiers/aggregates in telemetry; no excerpt content.

The active uploaded generation, source-policy version, and single public site release/change epoch are resolved into the RAG programme's immutable public request snapshot before cache lookup. An in-flight answer remains pinned; the next answer resolves the newest snapshot.

- [ ] **Step 4: Enforce source lifecycle/conflict before generation**

Review due, superseded, withdrawn, technical-failed, or non-active sources never enter the answer context. Current WA/Australian applicability preference remains ranking policy, not silent contradiction resolution. Material conflicts produce a bounded caveat or insufficient-evidence behavior.

- [ ] **Step 5: Make withdrawal atomic from the user’s perspective**

Withdrawal creates an immutable event, removes retrieval eligibility immediately, invalidates every affected public snapshot/cache entry, blocks new answer use, and then drives Storage/derived cleanup through the existing ledger. Cleanup failure must not restore retrieval.

- [ ] **Step 6: Verify Task 6**

Run:

```text
node scripts/run-vitest.mjs run tests/staging-document-retrieval-exclusion.test.ts tests/document-withdrawal-propagation.test.ts tests/owner-scope.test.ts tests/retrieval-access-scope.test.ts tests/api-search.test.ts tests/rag-answer-support.test.ts tests/source-review-policy.test.ts tests/document-mutation-routes.test.ts tests/rag-trust.test.ts tests/answer-verification.test.ts
npm run eval:rag:offline
npm run check:rag:adversarial-fixtures
npm run check:production-readiness
```

Expected: protected offline RAG cases have zero regression; provider/live evidence remains pending approval.

---

### Task 7: Add selective reprocessing, lifecycle, backup/restore, and incident controls

**Files:**

- Modify: `src/lib/reindex-pipeline.ts`
- Modify: `scripts/reindex.ts`
- Modify: `scripts/cleanup-abandoned-reindex-generations.ts`
- Modify: `scripts/cleanup-storage.ts`
- Create: `scripts/audit-document-pipeline-versions.ts`
- Create: `scripts/plan-document-reprocessing.ts`
- Create: `tests/document-pipeline-version-audit.test.ts`
- Modify: `tests/reindex-pipeline.test.ts`
- Modify: `tests/storage-cleanup-safety.test.ts`
- Modify: `docs/reindex-runbook.md`
- Modify: `docs/openai-rag-operations.md`
- Modify: `docs/ingestion-state-machine.md`
- Modify: `docs/rag-improvement/data-flow-register.md`

**Interfaces:** Consumes canonical `IngestionDocumentAudit`, `ShadowReindexPlan`, `RecoveryReadinessEvidence`, and generation receipts. Produces `planDocumentReprocessing(audits, targetVersions): SelectiveReprocessingManifest`, CLI `scripts/plan-document-reprocessing.ts` with required `--audit`, `--target-versions`, and `--out` path arguments, `isGenerationCleanupEligible(generation, retention): boolean`, and operator incident/restore procedures. It cannot activate, roll back, clean up, or call a provider without a separately authorized operation.

- [ ] **Step 1: Write version-audit and dry-run tests**

Extend the governed ingestion/re-index plan's canonical `IngestionDocumentAudit`; do not create a second classifier. Record expected-versus-actual pages, chunks, tables, images, searchable units, and embeddings; empty/oversized/undersized/low-information/duplicate/orphaned units; heading/table continuity; extraction quality; embedding model/dimensions/strategy/completeness; source-governance/currentness; generation completeness; and bound must-pass retrieval outcomes. Produce `no_change`, `metadata_only`, `targeted_reprocess`, or `shadow_reindex` plus an independent quarantine/tombstone disposition. Default is read-only; a stale state digest fails closed.

- [ ] **Step 2: Implement selective reprocessing plans**

Reuse the shared `ShadowReindexPlan`, stage receipt, exact-generation evaluation wrappers, and report contracts. The planner emits an immutable manifest with exact document IDs, expected generation/state digests, reason, target pipeline versions, case-set/population fingerprints, estimated pages/provider calls, and rollback generation. It never calls `npm run reindex` as a blanket repair.

- [ ] **Step 3: Preserve active generation and rollback**

Use the canonical `document_index_generations` ledger and non-destructive activate/rollback RPCs from the governed re-index plan. Stage/evaluate a candidate without deleting the active generation. Promotion requires a GO report, exact state/report/recovery digests, explicit scoped apply confirmation, and Task 4 technical eligibility. Retain the prior generation through the canary window and make cleanup a later exact-ID manifest operation.

- [ ] **Step 4: Add backup/restore and abnormal-cleanup runbooks/tests**

Reuse the project-bound `RecoveryReadinessEvidence` contract: current PITR/RPO, database backup evidence, separate Storage inventory/recovery evidence, and a recent isolated restore drill. Stage and promotion require fresh evidence; rollback verifies the immutable promotion-bound evidence digest without becoming unavailable solely because its freshness window later elapsed. Add a worker-kill fixture that verifies temporary paths are removed or positively reported for cleanup. Restore proof compares hashes, generations, private Storage paths, and retrieval state.

- [ ] **Step 5: Add rapid withdrawal incident steps**

Document identity confirmation, exact source selection, retrieval tombstone, cache invalidation, affected-evaluation/answer-lineage report, Storage cleanup, rollback, and post-incident audit. No raw answer/source text belongs in the report.

- [ ] **Step 6: Verify Task 7**

Run:

```text
node scripts/run-vitest.mjs run tests/document-pipeline-version-audit.test.ts tests/reindex-pipeline.test.ts tests/storage-cleanup-safety.test.ts tests/ingestion-recovery.test.ts
npm run docs:check-scripts
npm run docs:check-links
npm run check:production-readiness
```

Expected: offline contracts pass; real backup/PITR/Storage restore remains operator/live evidence.

---

### Task 8: Close evaluation, governance, and approval-gated rollout

**Files:**

- Modify: `eval/docling/fixtures/manifest.v1.json`
- Modify: `scripts/fixtures/rag-retrieval-golden.json`
- Modify: `src/lib/rag/rag-eval-cases.ts`
- Modify: `scripts/fixtures/rag-adversarial-cases.v1.json`
- Modify: `scripts/fixtures/rag-adversarial-baseline.v1.json`
- Modify: `tests/rag-eval-cases.test.ts`
- Modify: `tests/rag-adversarial-fixtures.test.ts`
- Modify: `docs/rag-evaluation.md`
- Modify: `docs/rag-improvement/README.md`
- Modify: `docs/rag-improvement/HANDOVER.md`
- Modify: `.github/pull_request_template.md`

**Interfaces:** Consumes Tasks 0–7 plus the programme case, rollout, and governance owners. Produces: no runtime interface. It adds synthetic must-pass ingestion-to-answer fixtures, exact offline evidence, and an approval request for any hosted/provider canary; it performs no live operation and cannot declare production acceptance from offline evidence.

- [ ] **Step 1: Add must-pass ingestion-to-answer cases**

Cover trusted admin/backend admission, ordinary-user denial, scanner/identifier quarantine, scanned dose table exactness, low-confidence numeric refusal, Docling/legacy disagreement, staging exclusion, automatic activation, review-due exclusion, supersession, withdrawal, and cache invalidation.

These extend the canonical RAG programme case registry established before behavioural ingestion work. Include corpus scope/role/content mode, expected active generation/snapshot, required/forbidden facts and numbers, conflict/currentness behavior, exact gap reason, and hard violations. Add explicit cases for Healthdirect exclusion, eTG/AMH link-only enforcement, identical anonymous/authenticated/administrator public candidate IDs, no owner-partitioned site content, no owner-private uploaded-document retrieval, and source-lineage collapse when a site summary derives from an uploaded guideline.

- [ ] **Step 2: Add scale and queue cases**

Prove cursor completeness beyond 200 documents/80 tasks/12 rendered items, bounded memory for large PDFs, lease recovery, dead-letter behavior, and no duplicate activation.

- [ ] **Step 3: Run the selected offline domain gate once**

Run `npm run verify:pr-local -- --dry-run` on the final changed worktree, then run the selected plan once. Do not stack equivalent full gates.

Likely final handoff gate for this cross-cutting executable change:

```text
npm run verify:pr-local
```

Also required by domain policy:

```text
npm run check:production-readiness
```

Read outputs, including lock/admission messages; exit code alone is not evidence.

- [ ] **Step 4: Complete clinical governance preflight**

State:

- `RAG impact: behaviour change`;
- offline exact results;
- hosted Supabase migration/deployment status;
- provider/canary status;
- privacy/licensing/residency status;
- rollback and withdrawal evidence;
- unresolved physical/operational acceptance.

- [ ] **Step 5: Seek separate authorization for live evidence**

Before any live operation, present exact service/project identity, read/write action, document scope, expected state change, content/provider exposure, estimated cost, rollback, and stop conditions. Sequence:

1. read-only project/function/cron/queue/drift identity inventory;
2. reviewed migration dry run/scratch replay;
3. migration apply;
4. worker/app deployment;
5. one bounded synthetic/non-identifiable administrator upload;
6. exact-tip retrieval/answer canary pair;
7. limited cohort, then broader activation.

- [ ] **Step 6: Record final review**

Run the review protocol against the exact head and append one immutable ledger record with `npm run ledger:append`. Do not hand-edit the ledger and do not push a tip whose sole change is a review record.
