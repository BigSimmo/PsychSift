# RAG Evaluation and Retrieval Contracts

This document specifies the RAG evaluation framework, runtime retrieval row contracts, and defensive schema invariants that protect clinical answer generation and source governance across migrations and database drift.

## Overview

The Database RAG pipeline combines vector similarity and full-text keyword retrieval over verified clinical sources. Because retrieved rows directly feed ranking, citation synthesis, and clinical safety assertions, retrieval output is treated as untrusted runtime data rather than a compile-time guarantee.

Evaluation and contract enforcement operate at three distinct layers:

1. **Offline contract tests:** Deterministic unit tests and AST/runtime shape assertions (`tests/rag-*.test.ts`, `tests/rag-retrieval-row-contract.test.ts`) that guard ranking formulas, imputation rules, and schema contracts offline.
2. **Golden-set evaluation harness:** 36-case golden retrieval evaluation suite (`scripts/eval-retrieval.ts`, `scripts/fixtures/rag-retrieval-golden.json`) that verifies hit rates, recall, and reciprocal rank against reference queries.
3. **Provider-backed live evaluation:** Live quality gates (`npm run eval:quality`, `scripts/eval-quality.ts`) and Sunday canary sweeps (`.github/workflows/eval-canary.yml`) operating under approval-gated cost and rate-limit constraints with the public-owner sentinel (`00000000-0000-0000-0000-000000000000`).

---

## Runtime Retrieval Row Contracts

Retrieval rows returned by Supabase Remote Procedure Calls (`match_document_chunks_v2`, `match_document_chunks_hybrid_v2`, `match_document_chunks`) are validated at runtime via Zod schemas in `src/lib/rag/rag-row-contracts.ts` before entering the ranking or synthesis pipelines (`rag.ts`).

### Asymmetric Schema Architecture

The retrieval row contract uses an asymmetric validation strategy:

- **Strict on ranking, identity, and evidence fields:** Required fields (`id`, `document_id`, `title`, `file_name`, `chunk_index`, `content`, `image_ids`, `images`, `source_metadata`) must strictly conform to expected types. Strings must be non-empty, and numeric scores (`similarity`, `text_rank`, `hybrid_score`, `rrf_score`) must be numbers or nullish (rejecting numeric strings).
- **Loose on additive and versioned columns (`z.looseObject`):** RPC versions differ in supported columns (for example, `retrieval_synopsis` is omitted in older base functions, while `document_labels` and `document_summary` appear in newer versions). `z.looseObject` preserves unknown keys rather than stripping them, ensuring that schema additions do not cause data loss or breaking failures.

---

## Defensive `.nullable()` Source Metadata Schema Invariants (#343)

`source_metadata` carries clinical provenance, review dates, document status, clinical validation status, and authority tiers. It is governed by strict schema invariants defined in `sourceMetadataSchema` (`src/lib/rag/rag-row-contracts.ts`).

```typescript
const sourceMetadataSchema = z
  .record(z.string(), z.unknown(), {
    message: "source_metadata must be a JSON object",
  })
  .nullable();
```

### 1. `.nullable()` vs `.nullish()` (Presence Guarantee)

- **The Invariant:** `source_metadata` is explicitly pinned as `.nullable()`, **not** `.nullish()`.
- **The Rule:** The key `source_metadata` **must be present** in the RPC result row (holding either a valid JSON object `Record<string, unknown>` or explicit `null`).
- **Why Presence is Mandatory:** If an RPC function definition drifts or drops the `source_metadata` column from its `SELECT` statement, a loose `.nullish()` schema would treat the omitted key (`undefined`) as valid. Downstream citation handlers (`src/lib/citations.ts`, `src/lib/source-metadata.ts`) would then silently fall back to default "unknown" governance states (such as unknown document status or unverified review date).
- **Fail-Loud Protection:** Omitting `source_metadata` triggers an immediate `RetrievalRowShapeError`, halting synthesis loudly instead of producing silently degraded clinical citations.

### 2. Structural Object Validation vs Database Constraints

- In `supabase/schema.sql`, `documents.metadata` is defined as `not null jsonb default '{}'::jsonb`.
- However, PostgreSQL does not enforce object structure on raw `jsonb` columns without an explicit `check (jsonb_typeof(metadata) = 'object')` constraint, permitting JSON arrays (`[1, 2, 3]`), strings, booleans, or numeric scalars.
- `sourceMetadataSchema` structurally enforces that any non-null `source_metadata` must be a JSON object (`z.record(z.string(), z.unknown())`), rejecting non-object JSON values before they reach downstream components.

### 3. Accepted vs Rejected Value Matrix

| Value in RPC Row                                               | Contract Result | Downstream Handling                                                |
| :------------------------------------------------------------- | :-------------- | :----------------------------------------------------------------- |
| `{"document_status": "current", "review_date": "2026-12-01"}`  | **Accepted**    | Parsed via `normalizeSourceMetadata()`; governance badges rendered |
| `{}`                                                           | **Accepted**    | Empty object normalized with fallback governance defaults          |
| `null`                                                         | **Accepted**    | Handled via `normalizeOptionalSourceMetadata() -> null`            |
| Key omitted (`withoutColumn("source_metadata")` / `undefined`) | **REJECTED**    | Throws `RetrievalRowShapeError` (RPC column drift detected)        |
| Non-object JSON: array (`[1, 2, 3]`)                           | **REJECTED**    | Throws `RetrievalRowShapeError` ("must be a JSON object")          |
| Non-object JSON: primitive string, number, boolean             | **REJECTED**    | Throws `RetrievalRowShapeError` ("must be a JSON object")          |

---

## Privacy-Preserving Error Handling

Retrieval rows contain confidential clinical text and document extracts. To protect patient privacy and clinical source confidentiality:

- `RetrievalRowShapeError` formats error messages containing **only** Zod issue paths, error codes, and the RPC name.
- Raw row values, titles, file names, and snippet contents are strictly excluded from error messages to prevent leakage into error logs or client error responses.
- Reported issues are capped at `MAX_REPORTED_ISSUES = 5` with an `"and X more"` summary to prevent log flooding during structural outages.

---

## Provenance and Derived Similarity Tagging

When document summaries or synthetic results are constructed outside vector retrieval (such as `buildDocumentSummaryResults` in `rag-row-contracts.ts`), similarity is tagged with explicit provenance:

- `similarity: 1` is assigned alongside `similarity_origin: "document_context"`.
- This ensures constant document-context similarity is transparently distinguished from measured vector similarity or `synthetic_text` (which carries medium confidence caps per clinical hazard analysis H5a).

---

## Verification and Testing

Schema contracts and `.nullable()` invariants are verified by:

- `tests/rag-retrieval-row-contract.test.ts`: Comprehensive unit tests covering valid rows, missing columns, dropped `source_metadata`, non-object metadata payloads, and score type invariants.
- `npm run verify:pr-local`: PR verification gate ensuring all RAG contracts and fixture checks pass before handoff.

---

## RAG Improvement Programme Board & Lifecycle

The Clinical RAG Improvement Programme coordinates enhancements to answer quality, retrieval precision, and safety infrastructure across multi-session workflows.

### Programme Documentation Hierarchy

1. **Programme Design & Architecture Guide:** `docs/rag-improvement/README.md`
   - Defines track architecture (Track A: Answer Quality, Track B: Evaluation & Safety Infrastructure), promotion criteria, Gate A–F definitions, and binding constraints from refuted approaches.
2. **Multi-Session Handover & Packet Status Table:** `docs/rag-improvement/HANDOVER.md`
   - Serves as the primary operational board. Tracks packet status (S0–S7+, G1), work packet specifications, branch/PR assignments, session-start/end checklists, and paste-ready worker prompts.
3. **Coordination & Babysit Manual:** `docs/rag-improvement/COORDINATION.md`
   - Details the coordinator role, wave scheduling, approvals map, canary execution protocols, and babysit-to-merge playbook.
4. **Safeguards & Historical Refutations:** `docs/rag-behaviour/safeguards.md` and `docs/rag-behaviour/refuted-approaches.md`
   - Pin protected code surfaces, PR gate rules, and empirically refuted architectures (e.g. governance metadata ranking penalties/boosts, raw token streaming, comparator key ordering above relevance).

### Programme Lifecycle & Execution Discipline

- **Wave & Track Sequencing:**
  - **Track A (Answer Quality):** Sequenced strictly consecutively (A1 fallback diagnosis `#231` -> A2 composition menu + A3 moderate length -> A4 follow-up suggestions) due to shared files and evidence dependencies.
  - **Track B (Safety & Eval Infrastructure):** Executed in parallel work streams (B0 adversarial fixtures, B1 telemetry, B2 offline adversarial harness, B3–B4 Docling lab/shadow, B5 Ragas, B6 reranker, B7 DSPy).
- **Single-Packet Session Boundary:** Each worker session implements exactly one packet from `docs/rag-improvement/HANDOVER.md`, opens a PR with the required evidence, updates its row in the status table, appends a review record to `docs/branch-review-ledger.md`, and stops at the open PR. Worker sessions never self-merge or dispatch unapproved provider-backed canaries.
- **Canary Pair Protocol:** Any behavioral change on protected RAG ranking/answer surfaces requires a pre-merge baseline canary run on default `main` and a post-merge dispatch (`gh api repos/BigSimmo/PsychSift/dispatches -f event_type=eval-canary`), compared via `npm run eval:retrieval:compare`. Regressions require immediate single-commit revert.

---

## Preflight Checks for RAG Surface Changes

Before implementing any changes to RAG ranking, retrieval, synthesis, or evaluation surfaces, authors and agents must complete the following preflight checks:

### 1. Board & Open PR Check

- Review `docs/rag-improvement/HANDOVER.md` §2 status table and the open PR list (per `#292`) to verify the active packet state, dependencies, and avoid duplicate implementations.

### 2. Protected Surface Identification

- Verify whether the changed files touch protected RAG ranking surfaces (`scripts/pr-policy.mjs` `ragRankingPatterns` and authored clinical datasets in `clinicalRiskPatterns`):
  - `src/lib/rag/**` (retrieval pipeline, candidate sources, composition, routing, synthesis)
  - `src/lib/clinical-search.ts`, `src/lib/retrieval-selection.ts`, `src/lib/released-search-order.ts`, `src/lib/ranking-config.ts`, `src/lib/evidence.ts`, `src/lib/result-sort.ts`, `src/lib/answer-ranking.ts`, `src/lib/evidence-relevance.ts`, `src/lib/semantic-rerank.ts`, `src/lib/eval-document-matching.ts`
  - `src/lib/source-authority-registry.ts`, `src/lib/australian-source-priority.ts` (source authority and Australian clinical context ordering)
  - `src/lib/chunking.ts`, `src/lib/extractors/**`, `worker/python/extract_pdf_assets.py` (ingestion and PDF extraction producers)
  - `src/lib/document-index-units.ts`, `src/lib/model-index-extraction.ts`, `src/lib/deep-memory.ts` (index-unit and memory-card producers/boosts)
  - `src/lib/retrieval-rpc-rollout.ts`, `src/lib/clinical-evidence-haystack.ts`, `src/lib/cross-document-synthesis.ts`, `src/lib/corpus-grounding.ts`, `src/lib/keyword-query.ts`
  - `src/lib/document-enrichment.ts`, `src/lib/visual-intelligence.ts`, `src/lib/image-filtering.ts`
  - `worker/embedding-fields.ts`, `worker/table-facts.ts`, `worker/assertion-tagging.ts`
  - Hand-authored clinical datasets in `src/lib/` (`src/lib/dictionary-data.ts`, `src/lib/factsheets-data.ts`, `src/lib/specifiers.ts`, `src/lib/differential*.ts`, `src/lib/registry-records.ts`, `tests/calculator-mockup-clinical-safety.test.ts`, per `scripts/pr-policy.mjs:89-150`)
  - `scripts/eval-retrieval.ts`, `scripts/build-ranking-snapshot.ts`, `scripts/tune-search-weights.ts`
  - `scripts/lib/clinical-aliases.ts`, `scripts/lib/ranking-tuning.ts`, `scripts/lib/ranking-snapshot-builder.ts`
  - `scripts/fixtures/rag-retrieval-golden.json`, `scripts/fixtures/rag-ranking-candidate-snapshot.v1.json`
  - Contract test pins: `tests/rag-fast-path-ordering.test.ts`, `tests/ranking-tuning.test.ts`, `tests/retrieval-selection.test.ts`, `tests/rag-second-stage-ranking.test.ts`, `tests/eval-retrieval.test.ts`, `tests/rag-imputation-contract.test.ts`
  - Database schema & retrieval RPCs in `supabase/schema.sql` and `supabase/migrations/`

### 3. Refuted Approaches Review

- Check `docs/rag-behaviour/refuted-approaches.md` to confirm the proposed change does not re-walk known failure modes:
  - Do not add `review_due`, `unknownCurrentness`, or governance metadata score boosts/penalties to ranking (Refutation 3).
  - Do not reintroduce unverified raw token streaming (Refutation 6).
  - Ensure all ranking score discriminators sit strictly below `relevance.score` in comparator chains.

### 4. Offline Verification Ladder

Execute the local offline verification ladder before opening a PR:

- `npm run check:rag:fixtures` — validate golden retrieval fixture (36 cases) and ranking snapshot.
- `npm run check:rag:adversarial-fixtures` — validate adversarial case fixtures and canary-string integrity.
- `npm run eval:rag:offline` — run deterministic offline RAG test suites.
- `npm run eval:rag:adversarial:offline` — execute offline adversarial regression harness.
- `npm run test:focused -- --files <paths>` — run directly affected unit and contract tests.
- `npm run verify:pr-local` — run full PR-local validation gate.

### 5. PR Impact Declaration

- Contributors and agents opening a PR touching protected RAG surfaces should declare its impact under `## Risk and rollout` (alongside `## Clinical Governance Preflight` on clinical-risk diffs) in the PR body. Since 2026-09-17 (`docs/process-hardening.md`), missing `## Clinical Governance Preflight` and `RAG impact:` declarations no longer block a PR merge — `scripts/pr-policy.mjs` emits **advisory warnings** (`warnings.push`) while the eval canary and source-pin contract tests remain the fail-closed gates:
  - `RAG impact: no retrieval behaviour change — <reason>` (for refactors, tests, docs, or tooling)
  - `RAG impact: behaviour change — canary pair <baseline run> -> <post run>` (for intentional ranking/retrieval changes)
  - Non-RAG PRs may specify `RAG impact: none` or omit the line.
