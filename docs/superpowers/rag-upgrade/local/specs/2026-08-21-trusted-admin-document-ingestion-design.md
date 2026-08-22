# Trusted Admin/Backend Document Ingestion and RAG Activation Design

Date: 2026-08-21  
Status: Approved requirements; reconciled into the RAG planning package on 2026-08-22. No implementation from another worktree is assumed or included; every task must be revalidated and implemented from the execution package's recorded current-main base.  
Scope: Administrator/backend document admission, extraction and OCR, technical quality gating, shared-corpus activation, retrieval eligibility, review operations, and Supabase control-plane ownership

## 1. Decision summary

Clinical KB uses a trusted-admission model:

- A document uploaded by an authenticated administrator or an explicitly configured trusted backend is clinically approved by that upload event.
- Ordinary users cannot upload documents through the product, direct Supabase APIs, or Storage policies.
- There is no second clinical approval form, evidence-entry step, or publish button for trusted uploads.
- Document contents and file containers remain untrusted technical input even though the admission actor is trusted.
- Automated security, identifier, extraction, OCR, index-integrity, and freshness gates decide when an admitted document is technically ready to influence clinical answers.
- A technically failed document remains clinically admitted but quarantined from retrieval until a replacement generation passes.
- Existing owned staging and guarded public-corpus publication are retained. The pipeline generates the durable publication evidence from the trusted upload event; the administrator does not perform a second review.

The central invariant is:

```text
clinical_answer_eligible =
  trusted_admission
  AND corpus_scope = uploaded_local
  AND content_mode = indexed_content
  AND source_policy_allows_indexing
  AND security_passed
  AND identifier_screen_passed
  AND extraction_hard_gates_passed
  AND committed_generation_complete
  AND lifecycle_status = current
  AND public_activation_matches_committed_state
```

No confidence average, model response, warning banner, or administrator ownership can bypass this invariant.

### 1.1 RAG programme integration boundary

This design is the admission and technical-readiness owner for uploaded documents inside the wider RAG programme. It does not create a parallel retrieval, source-governance, evaluation, site-content, or re-index control plane.

- `uploaded_local` means an administrator/backend-admitted document that has completed the owned staging-to-shared activation. It never means an ordinary user's private upload and it never includes administrator-owned staging rows.
- `clinical_kb_site` is produced by the repository-content registry and its single active public release. Site records do not pass through document upload or document re-index merely because both paths eventually create searchable units.
- `australian_public` and `international_supplementary` use the governed public-source lifecycle. Exact source-definition, licence, version, evaluation, and activation controls remain separate from trusted local upload.
- eTG and AMH are `link_only`; their protected content cannot be uploaded, stored, extracted, chunked, embedded, summarized, or indexed. Healthdirect remains excluded from every ingestion and retrieval path.
- Evaluation owns the canonical `SourceCorpusScope`, `ClinicalSourceRole`, programme-case, hard-violation, and gate vocabularies. Ingestion imports those contracts rather than defining look-alike strings.
- The first activation of a new trusted uploaded document is automatic after all hard gates. Re-indexing an already active generation and activating a fetched public-source version are separate operational mutations with shadow evaluation, recovery evidence, and explicit promotion controls.

## 2. Goals and non-goals

### Goals

- Make administrator/backend upload the single clinical-admission action.
- Prevent ordinary-user upload at UI, API, database, and Storage layers.
- Quarantine every new object until local safety and extraction checks are complete.
- Produce reproducible, page-anchored extraction with high-quality OCR, table, diagram, and reading-order evidence.
- Activate only a complete, immutable index generation that passes explicit hard gates.
- Preserve exact lineage from an answer claim to the original file hash and extraction generation.
- Provide an exhaustive, durable administrator queue for technical exceptions, review-due sources, withdrawals, and failed reprocessing.
- Extend the existing Supabase, worker, generation, RLS, hybrid-retrieval, source-governance, and evaluation architecture rather than replace proven foundations.
- Keep model, OCR engine, embedding provider, and parser versions replaceable through recorded contracts and selective reprocessing.

### Non-goals

- No ordinary-user private document library or user upload workflow.
- No unrestricted web crawling, search-engine discovery, or automatic acquisition of third-party sources.
- No ingestion of first-party repository/site records; deterministic registry adapters and release pointers own that corpus.
- No second human clinical approval after a trusted upload.
- No automatic clinical judgment about whether an administrator-selected source is authoritative.
- No blanket corpus re-index.
- No immediate replacement of the mature `ingestion_jobs` state machine with a new queue product.
- No live Supabase mutation, provider call, deployment, migration application, backfill, or canary as part of the design/plan phase.

## 3. Current repository position

The repository already provides strong foundations:

- `src/app/api/upload/route.ts` requires an administrator, applies admission/rate limits, validates content signatures and structure, writes to private Storage, and atomically creates the document and ingestion job.
- `src/lib/upload-structure.ts` guards supported containers against malformed signatures, unsafe OOXML relationships, macros, traversal, and decompression abuse.
- `ingestion_jobs`, heartbeat/lease helpers, one-open-job constraints, mutation-safety checks, retry RPCs, and generation commits provide a mature durable control plane.
- `commit_document_index_generation` prevents partial generations from becoming active.
- The worker refuses an empty replacement generation and preserves the prior usable generation on failure.
- Chunking is page-, heading-, and table-aware; retrieval is hybrid and includes structured index units and table facts.
- Source-review and publication events are append-only, service-role only, and bound to a reviewed state digest.
- RLS and server mediation protect Storage and document tables.
- Docling is available in measured shadow mode with a kill switch.
- Offline retrieval, answer-quality, numeric-faithfulness, adversarial, privacy, and production-readiness gates already exist.

The design closes these confirmed gaps:

- administrator upload currently creates an owned document but does not automatically activate it for the shared corpus;
- current publication expects a separate evidence manifest and operator action;
- quality review examines a bounded newest-document window and truncates its response/UI;
- the quality console cannot persist a technical disposition;
- per-page `needsOcr` and richer OCR evidence are not preserved by the worker page write;
- Tesseract currently returns plain text rather than word confidence and geometry;
- identifier screening is an unenforced upload assumption;
- provider/data-residency decisions and abnormal temporary-path cleanup remain operator debt;
- two ingestion processors remain represented in current code/plans and must not both own the final workflow.

## 4. Trust and authority model

### 4.1 Trusted admission actors

Two actor kinds may admit a source:

1. `administrator`: a current authenticated account that passes the existing administrator authorization contract;
2. `trusted_backend`: a named server-side importer or internal service principal configured by the operator.

Both actor kinds use the same admission service and database RPC. A service-role key alone is not an admission policy: the caller must provide a stable configured backend principal and source channel. Direct table insertion is not a supported admission path.

### 4.2 What upload approval means

Admission records the administrator/backend decision that the source is suitable clinical reference material. It does not claim that OCR succeeded, tables were recovered, the file is malware-free, or an index generation is complete.

The upload event therefore sets clinical admission to approved while keeping technical activation quarantined. The UI may say “Approved source — processing” but must not say “Available in answers” until activation succeeds.

### 4.3 What remains untrusted

The following remain hostile or fallible regardless of actor:

- file bytes, archives, PDF actions and attachments;
- hidden, overlaid, white-on-white, malformed, or conflicting text layers;
- embedded instructions intended to manipulate a model;
- OCR output, layout predictions, table reconstruction, captions, and summaries;
- metadata inferred from document content;
- provider output and confidence scores.

Content is always delimited as source evidence, never executable instruction.

## 5. State model

Clinical admission, technical processing, publication, and lifecycle are separate axes.

### 5.1 Admission

```text
approved_by_trusted_upload | withdrawn
```

There is no `unverified` state for newly trusted uploads. Legacy rows retain their historical state until separately reconciled.

### 5.2 Technical processing

```text
quarantined
  -> safety_scanning
  -> extracting
  -> validating
  -> indexing_candidate
  -> quality_passed
  -> active

Any state -> technical_review | failed
technical_review -> reprocess -> safety_scanning
```

### 5.3 Lifecycle

```text
current | review_due | superseded | withdrawn
```

Only `current` may support a new clinical answer. Review due, superseded, and withdrawn sources stay auditable and viewable by administrators but are excluded before ranking.

### 5.4 Existing owned-to-public transition

The current safe publication shape is retained:

1. trusted upload creates an owned/private staging row;
2. extraction and indexing operate on the owned row;
3. the pipeline computes the committed-state digest;
4. a service-role activation RPC verifies trusted admission, technical gates, no active writer, artifact ownership, current lifecycle, and exact digest;
5. the existing guarded publication transition moves the document and its derived artifacts into the null-owner shared corpus atomically;
6. cache invalidation occurs only after successful activation.

The current `document_publication_approvals` record remains an immutable anti-race control. For this path its reason/evidence are generated from the trusted admission event and file hash. Administrator admissions retain the admitting administrator UUID; trusted-backend admissions use a configured system-operator UUID rather than borrowing the staging owner's identity. No administrator is asked to enter evidence or perform a second action.

## 6. Data and audit contracts

### 6.1 Trusted admission event

Add an append-only, service-role-only `document_admission_events` table containing:

- document ID and original file SHA-256;
- actor kind (`administrator` or `trusted_backend`);
- administrator UUID or configured backend principal;
- source channel (`admin_api`, `backend_import`, or a future allowlisted channel);
- admission policy version and digest;
- upload request/manifest correlation ID;
- original-filename digest, MIME type, byte count, and Storage object-key/version digest; the append-only event does not retain raw filenames or object keys;
- decision (`approved_by_trusted_upload`, `withdrawn`);
- created time.

Events cannot be updated or deleted. Withdrawal is a new event.

### 6.2 Technical review task

Add a persistent `document_technical_review_tasks` table containing:

- document and generation IDs;
- task type, severity, hard-gate code, page numbers, and bounded structured metrics;
- state (`open`, `in_progress`, `resolved_by_generation`, `dismissed`, `withdrawn`);
- assignee and resolution actor when present;
- replacement generation or disposition;
- created, updated, and resolved times.

No document text, OCR excerpts, or identifiers are copied into task rows. Reviewers open the private source/page through existing signed access.

### 6.3 OCR evidence

Persist bounded page-level evidence in `document_pages.metadata`:

- extractor and OCR engine/version;
- languages and orientation;
- OCR-used and needs-review flags;
- confidence summary and low-confidence word count;
- image coverage, render scale, preprocessing steps, and warnings;
- source-text-layer and OCR hashes;
- path and SHA-256 for a private compressed word/bounding-box artifact when generated.

Large word-level evidence belongs in private Storage under a generation-addressed path, not directly in Postgres. It follows the original document’s access and deletion policy.

### 6.4 Provenance and version fields

Every derived artifact records:

- original content hash;
- extraction pipeline version;
- extractor/OCR/table model and configuration versions;
- chunker/index-unit version;
- embedding provider/model/dimensions;
- generation ID;
- source page and bounding box when available;
- provider-egress policy version.

Every activated document and searchable unit also carries the RAG programme's canonical source contract:

- `corpus_scope = uploaded_local`;
- an explicit `source_role` supplied by the administrator upload template or trusted-backend manifest, never inferred as authority from document prose;
- `content_mode = indexed_content` and the applicable source/licence policy version;
- canonical publisher/jurisdiction plus publication, effective, review, and expiry dates when known;
- supersession/currentness identifiers and the immutable admission/activation receipt digests; and
- active generation/release identity needed by the per-answer context snapshot and cache namespace.

The administrator upload UI may prefill `local_guideline`, but role is stored explicitly and remains correctable governance metadata. Correcting role does not constitute a second clinical approval.

## 7. End-to-end pipeline

### Stage A — admission and quarantine

1. Authenticate an administrator or configured backend principal.
2. Apply rate, file-size, decompression, and workload admission controls.
3. Stream the object while hashing; validate file signature and container structure.
4. Store the original in a private quarantine prefix.
5. Atomically create the owned document, trusted admission event, and initial ingestion job.
6. Return an admitted/processing result; do not expose it to RAG.

Duplicate content is idempotent within the target corpus. A byte-identical upload returns the existing document and does not create duplicate generations or approval events unless the lifecycle requires a deliberate re-admission event.

### Stage B — local security and identifier screening

Before any document content or page image can reach an external model provider:

1. run malware/active-content scanning through a pluggable fail-closed adapter;
2. extract enough content locally to detect prohibited patient identifiers and hidden/conflicting layers;
3. run local OCR on image-only regions needed for the identifier screen;
4. quarantine on a positive or unavailable mandatory scanner;
5. record bounded reason codes only.

False positives are resolved by an administrator through the technical queue. Resolution permits reprocessing; it does not mutate the original scan result.

### Stage C — adaptive extraction

1. Prefer native digital text and layout where they are trustworthy.
2. Use the existing legacy extractor as the baseline path.
3. Use Tesseract TSV/structured output for word confidence and geometry rather than plain text only.
4. Apply orientation, deskew, contrast/noise, and page-segmentation preprocessing only when measured page signals require it; record every transform.
5. Route difficult layout/table/image classes through Docling shadow extraction.
6. Compare normalized outputs for page coverage, reading order, tables, headings, critical numeric spans, and source geometry.
7. Automatically select a candidate only when deterministic class-specific gates pass; otherwise create a technical review task.

Docling promotion remains document-class-specific and evidence-based. The existing 1–5% shadow cohort and kill switch remain until harder fixtures demonstrate improvement over legacy extraction.

### Stage D — normalization and index candidate

1. Normalize pages, headings, tables, figures, lists, footnotes, and reading order without destroying source coordinates.
2. Repair only deterministic formatting artifacts; never silently rewrite clinical meaning.
3. Create versioned chunks and multi-resolution index units.
4. Generate embeddings and provider-backed enrichment only after the egress gate passes.
5. Write a complete candidate generation isolated from the active generation.
6. Validate counts, ownership, embeddings, structured artifacts, and lineage.
7. Emit deterministic, generation-addressed retrieval units with stable IDs, canonical source-role/corpus metadata, page/span geometry, table/header continuity, and source-lineage hashes required by the combined RAG pipeline.

### Stage E — hard-gate evaluation

Hard gates are independent; a weighted average cannot cancel a failure. At minimum:

- scanner and identifier-screen completion;
- content-mode, licence, excluded-source, and source-policy eligibility;
- non-empty safe extraction;
- page coverage and page-number continuity;
- OCR-needed pages resolved or explicitly reviewed;
- critical low-confidence numeric/unit tokens absent;
- table cell/row coverage for detected clinical tables;
- heading/reading-order continuity;
- no hidden-text or extractor-disagreement danger result;
- all chunks and index units linked to a committed page/span;
- embedding model/dimension completeness;
- source lifecycle current;
- no active competing writer;
- candidate generation state digest stable.

Excluded/link-only policy is enforced before network/provider access, before Storage admission where identifiable, and again before extraction, embedding, indexing, and activation. A publisher marker discovered only after local extraction quarantines the candidate and records a bounded policy reason; it never turns protected content into telemetry or a searchable artifact.

Soft quality metrics remain useful for diagnostics and routing but cannot publish a hard-gate failure.

### Stage F — automatic activation

On hard-gate success, the worker/control-plane service:

1. derives publication evidence from the trusted admission event;
2. records the append-only technical-gate outcome and publication approval state digest;
3. invokes one atomic activation RPC;
4. moves the document/artifact ownership into the shared corpus through the existing guarded transition;
5. marks technical state active;
6. resolves generation-addressed technical tasks;
7. invalidates affected RAG caches.

There is no second administrator interaction.

## 8. Retrieval and answer behavior

- Ordinary clinical answers use the active shared corpus only. Administrator-owned staging documents are not included in clinical answer retrieval.
- The active shared uploaded-document lane and active `clinical_kb_site` release use one public Answer candidate population for anonymous, authenticated, and administrator readers. User/administrator/legacy-owner IDs are audit data only and cannot partition retrieval, cache, release, or answer evidence. Owner-private uploaded-document evidence remains ineligible.
- The existing hybrid vector, text, alias, table-fact, embedding-field, and index-unit retrieval stays in place.
- Eligibility is enforced before candidate ranking, not by a warning after selection.
- Every citation resolves to the immutable document version, page, and exact source span or visual region where available.
- Numeric claims, doses, intervals, thresholds, and table-derived actions require exact source support.
- Weak, conflicting, or insufficient evidence returns a source-only or insufficient-evidence result; the generator does not fill gaps from model memory.
- Current WA/Australian sources receive applicability preference, while material jurisdiction/population conflicts remain visible.
- Cache keys include corpus generation, retrieval policy, prompt/verification version, and relevant source lifecycle digest.

## 9. Administrator experience

### Upload

The administrator sees:

- admitted/processing confirmation;
- current stage and bounded progress;
- security, extraction, OCR, table, indexing, and activation outcomes;
- the exact reason when activation is withheld.

The interface does not ask for clinical evidence or a second approval.

### Technical review queue

The queue is persistent, cursor-paginated, filterable, and exhaustive. It supports:

- open source/page evidence;
- retry or targeted reprocess;
- assign/unassign;
- resolve a false-positive quarantine with reason;
- withdraw or supersede;
- view event and generation history.

It never silently limits review to the newest documents or the first twelve cards.

### Ordinary users

Ordinary users have no upload button, drop target, import action, or upload API capability. They may use active clinical sources according to existing product access controls.

## 10. Supabase and worker ownership

- Supabase Postgres remains the durable control plane for admissions, jobs, leases, generations, technical tasks, activation, audit, RLS, and retrieval metadata.
- Supabase Storage remains private for originals and OCR evidence.
- Heavy OCR, Docling, malware scanning, and model processing remain in the external worker, not a long-running Edge Function.
- Existing `ingestion_jobs` remains the source of truth. Supabase Queues/`pgmq` may later become a dispatch transport only after a measured migration proves value; it must not create a second job state machine.
- Exactly one ingestion processor may claim document jobs. The existing edge-ingestion retirement plan is a prerequisite to final rollout.
- Every SQL change uses a forward migration, canonical `supabase/schema.sql` update, drift manifest/types regeneration where required, scratch replay, privilege checks, and production-readiness verification.

## 11. Security, privacy, licensing, and recovery

- Administrator accounts require MFA and recent reauthentication for upload, withdrawal, and quarantine override.
- Service-role credentials remain server-only; trusted backend principals are explicit and revocable.
- Document bodies, OCR text, source excerpts, identifiers, and page images never enter logs, telemetry, task rows, or error responses.
- Document-level licensing and provider-egress policy may prevent external captioning/embedding while still allowing local processing.
- Original Storage objects require independent backup and restore evidence because database backup alone does not prove object recovery.
- Abnormal worker termination must be tested to remove temporary extracted content.
- Deletion/withdrawal invalidates caches and retrieval immediately, preserves an audit tombstone, and removes Storage/derived artifacts through the existing cleanup ledger.
- A restore exercise verifies original hashes, database generations, private Storage paths, and retrieval exclusion/activation state.

## 12. Evaluation and promotion gates

Evaluation is class-specific and source-safe:

- clean digital prose;
- scanned prose and photocopies;
- medication/dose tables;
- algorithms and flowcharts;
- forms and multi-column layouts;
- image-heavy pages;
- multilingual/rotated/password/truncated/oversized failure cases;
- hidden-text and document-origin prompt injection;
- identifier and malware/quarantine cases.

Before any extraction, chunking, embedding, or retrieval behavior changes, the shared RAG programme case/gate contract and privacy-safe telemetry contract are established. Each candidate generation is evaluated against an identical case-set and population fingerprint. Per-document audits include expected-versus-actual page/chunk/table/image/searchable-unit counts, unit-quality defects, embedding contract completeness, heading/table continuity, and bound must-pass retrieval cases.

Required evidence includes:

- character/word exactness where ground truth exists;
- page, heading, reading-order, and table-cell fidelity;
- exact numeric/unit retention;
- citation/source-span correctness;
- retrieval recall/MRR and protected-case non-regression;
- zero cross-owner or pre-activation retrieval;
- complete queue coverage and state-transition invariants;
- crash, retry, lease fencing, withdrawal, rollback, and restore exercises.

Offline tests do not prove hosted provider behavior. Live Supabase reads, migrations, deployments, provider calls, backfills, paid evaluation, and live canaries remain separately authorized and reported.

## 13. Rollout and rollback

Roll out sequentially:

1. shared RAG evaluation/type and privacy-safe telemetry contracts;
2. trusted-admission audit contract plus canonical source metadata;
3. Australian source governance/read-only audit and first-party registry/manifest contracts;
4. local quarantine, excluded/link-only, identifier, and provider-egress gates;
5. shared recovery, generation-ledger, lease-fencing, and rollback primitives;
6. page-level OCR evidence and harder extraction fixtures;
7. technical eligibility gate in shadow/report-only mode;
8. persistent technical review/governance-conflict queue;
9. automatic first activation for a small administrator/backend cohort;
10. repository synchronization and corpus-scoped retrieval after legacy projections are classified;
11. shared-corpus staging exclusion, withdrawal, snapshot, and cache proof; and
12. targeted re-index/public acquisition waves followed by controlled broader activation.

Each stage has a kill switch. Failure before activation leaves the current shared corpus unchanged. Candidate generations are never promoted partially. Rollback disables automatic activation, restores the prior worker deployment, and retains admission/task evidence for diagnosis.

## 14. Definition of done

The design is implemented only when:

- only authenticated administrators and configured backend principals can admit documents;
- trusted upload creates clinical approval without a second human action;
- every new document remains absent from clinical answers until all technical hard gates pass;
- ordinary users cannot upload through UI, API, database, or Storage;
- OCR/table/layout evidence is page-anchored, versioned, and reviewable;
- the technical queue is persistent and exhaustive;
- activation is atomic, digest-bound, and automatically derived from the admission event;
- active retrieval excludes staging, failed, review-due, superseded, and withdrawn sources before ranking;
- every answer citation traces to a source generation and original file hash;
- activated units use the canonical RAG corpus/role/content-mode/currentness metadata and participate in one immutable per-answer context snapshot;
- anonymous, ordinary-user, and administrator Answer requests return identical active public site/shared-uploaded candidate IDs and cannot retrieve owned document staging or legacy owner-private rows;
- eTG/AMH protected content and Healthdirect are rejected before any searchable or provider-visible artifact is created;
- withdrawal, cache invalidation, rollback, and Storage/database restore are proven;
- offline clinical/RAG/privacy gates pass and any approved live canary is pinned to the deployed commit;
- code readiness, migration status, hosted Supabase state, provider evidence, and production rollout are reported separately.
