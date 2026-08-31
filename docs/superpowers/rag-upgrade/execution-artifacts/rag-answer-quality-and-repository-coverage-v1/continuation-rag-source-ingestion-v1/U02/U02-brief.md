# U02 task brief: produce one validated source-anchored summary payload

## Position and ownership

- Unit: `U02`
- Plan task: Task 2 / Ingestion Task 5 / C01
- Task base: `08df4cddce457ba016b0d31fcf7202a4b564776a`
- Worktree: `C:\Users\joshs\.codex\worktrees\rag-local-build-20260822\Database`
- Branch: `codex/rag-local-build-20260822`
- U01 accepted product head: `5895e5da45b96d0d90a42c32856cb25f2026bf36`

One fresh implementer owns every U02 write. Other agents may inspect or review only. Preserve every unrelated staged, unstaged, and untracked path. U01, C00, P00-P07, and the superseded P08A artifacts are immutable.

Read this brief in full before editing. The extracted plan task below is verbatim. The implementation-preflight resolutions after it are binding clarifications of current-code interfaces and correctness-required ownership discovered at task base.

Write the post-commit implementation report to:

`docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U02/U02-report.md`

## Binding global constraints

- Source-only work: do not process documents or corpora; access hosted Supabase, Storage, PITR, scanners, model assets, or providers; apply migrations; deploy; reindex; stage; evaluate; activate; withdraw; roll back; clean up; push; or open a pull request.
- Preserve P04 classification, P05 source-policy/preflight and recovery vocabulary, P06 site-release authority, P07 query/cache/ranking behavior, and every U01 sole-processor/generation-visibility invariant.
- The ordinary buffered Answer/search path remains unchanged and cannot import or invoke continuation retrieval code.
- Unknown policy, generation, source, lineage, replacement, or recovery authority fails closed.
- No payload may invent, infer, or substitute a generation UUID. Every persisted anchor belongs to the exact validated active generation.
- Strict RED-GREEN-REFACTOR is mandatory. Add the focused U02 tests and observe the expected missing-behavior failures before any production edit.
- Keep one writer. Modify only the final owned-file list in the preflight resolutions. Stop and report a concrete correctness need before expanding it.
- Use the exact focused selector in the extracted task. `npm run eval:rag:offline` is offline only. `npm run check:production-readiness` remains C07/approval-gated and must not run.

## Extracted plan task (verbatim)

### Task 2: Produce one validated source-anchored summary payload

**Files:**

- Create: `supabase/functions/_shared/source-anchored-summary.ts`
- Modify: `supabase/functions/indexing-v3-agent/index.ts`
- Modify: `supabase/functions/indexing-v3-agent/behavior.ts`
- Modify: `supabase/functions/indexing-v3-agent/utils.ts`
- Modify: `src/lib/document-enrichment.ts`
- Modify: `src/lib/types.ts`
- Modify: `worker/main.ts`
- Modify: `tests/indexing-v3-agent.test.ts`
- Modify: `tests/document-enrichment.test.ts`
- Modify: `tests/worker-shadow-extraction.test.ts`
- Modify: `tests/check-indexing-contract.test.ts`

**Step 1: Define the transport-neutral contract and RED cases**

```ts
export type SourceAnchoredSummaryProfileItem = Readonly<{
  text: string;
  source_chunk_ids: readonly string[];
  source_image_ids: readonly string[];
  pages: readonly number[];
  evidence_type: "text" | "table" | "image" | "mixed" | "metadata";
  support: "direct" | "partial" | "not_found";
}>;

export type SourceAnchoredClinicalProfile = Readonly<{
  overview: string;
  applies_to: readonly SourceAnchoredSummaryProfileItem[];
  key_clinical_actions: readonly SourceAnchoredSummaryProfileItem[];
  medication_dose_monitoring: readonly SourceAnchoredSummaryProfileItem[];
  thresholds_timing: readonly SourceAnchoredSummaryProfileItem[];
  escalation_risk_warnings: readonly SourceAnchoredSummaryProfileItem[];
  required_forms_documentation: readonly SourceAnchoredSummaryProfileItem[];
  not_covered: readonly SourceAnchoredSummaryProfileItem[];
  important_tables_images: readonly SourceAnchoredSummaryProfileItem[];
  best_questions: readonly SourceAnchoredSummaryProfileItem[];
  source_quality_notes: readonly SourceAnchoredSummaryProfileItem[];
}>;

export type SourceAnchoredSummaryLabelType =
  | "site"
  | "topic"
  | "document_type"
  | "medication"
  | "risk"
  | "setting"
  | "workflow"
  | "population"
  | "service"
  | "clinical_action"
  | "care_phase"
  | "document_intent"
  | "content_feature"
  | "custom";

export type SourceAnchoredSummaryPayload = Readonly<{
  summary_kind: "structured" | "heuristic_fallback";
  summary_version: "source-anchored-summary-v1";
  document_id: string;
  index_generation_id: string;
  model: string;
  model_version: string;
  generated_at: string;
  source_chunk_ids: readonly string[];
  source_image_ids: readonly string[];
  summary: string;
  clinical_specifics: Readonly<{
    profile: SourceAnchoredClinicalProfile;
    actions: readonly string[];
    thresholds_timing: readonly string[];
    medication_monitoring: readonly string[];
    risk_escalation: readonly string[];
    documentation_forms: readonly string[];
    exceptions_gaps: readonly string[];
  }>;
  labels: readonly Readonly<{
    label: string;
    label_type: SourceAnchoredSummaryLabelType;
    confidence: number;
  }>[];
  heuristic_fallback: boolean;
}>;
```

Test invalid document/generation/chunk/image UUIDs, unordered or duplicate whole-summary anchors, non-ISO time, conflicting `summary_kind`/`heuristic_fallback`, stale-generation reuse, late-section coverage, and replacement failure preserving the prior valid summary. For every profile item, test chunk/image allowlist membership, exact page derivation, evidence type, support level, and the rule that a `direct` or `partial` item must retain at least one claim-level anchor. Whole-summary anchors supplement those claim anchors and never replace them.

Run:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts
```

Expected RED: the shared normalizer is missing and Edge still uses its first-N heuristic path.

**Step 2: Implement strict normalization**

`normalizeSourceAnchoredSummary(input)` validates bounded non-empty strings and arrays, canonical UUIDs, ordered unique whole-summary anchors, every claim-level chunk/image/page anchor against the selected source maps, profile-key completeness, evidence/support values, labels, exact version markers, ISO time, and consistent fallback/model markers. It returns a new frozen value and throws before persistence on any mismatch. Move or re-export the existing `DocumentSummaryProfileItem` and `ClinicalDocumentSummaryProfile` structural types through the shared contract so Node and Deno do not acquire divergent claim vocabularies.

Use `selectCoverageAwarePromptChunks` and `buildIndexingCoverageProfile` in Node and the same deterministic selection contract in Deno. Pass the already-created `indexGenerationId` from `worker/main.ts`. Generate and validate the complete replacement before upserting the summary; replace labels only after summary persistence succeeds. Edge skips only a current, validated structured payload and regenerates missing, fallback, old-version, or superseded-generation rows.

**Step 3: Run GREEN**

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts
npm run check:edge:functions
npm run eval:rag:offline
```

Expected: Node/Deno contract parity passes, non-first-N coverage is retained, and no provider is called by the tests.

**Step 4: Review and checkpoint**

Reviewers: `ingestion-worker-reviewer` and `clinical-governance-reviewer`. Suggested local checkpoint message: `feat(ingestion): anchor summaries to committed sources`.

---

## Implementation-preflight resolutions (binding)

### Final owned-file list

The plan's original file list remains owned and is expanded only where current callers or exact Node/Deno parity make the change correctness-required.

Create:

- `supabase/functions/_shared/source-anchored-summary.ts`
- `supabase/functions/_shared/indexing-coverage.ts`

Modify:

- `supabase/functions/indexing-v3-agent/index.ts`
- `supabase/functions/indexing-v3-agent/behavior.ts`
- `supabase/functions/indexing-v3-agent/utils.ts`
- `src/lib/document-enrichment.ts`
- `src/lib/indexing-coverage.ts`
- `src/lib/types.ts`
- `worker/main.ts`
- `scripts/backfill-smart-index.ts`
- `scripts/enrich-documents.ts`
- `tests/indexing-v3-agent.test.ts`
- `tests/document-enrichment.test.ts`
- `tests/worker-shadow-extraction.test.ts`
- `tests/check-indexing-contract.test.ts`

`src/lib/indexing-coverage.ts` must re-export the pure shared implementation so existing Node callers retain their interface while Edge imports the same algorithm. Do not duplicate the selector. The two active scripts call `upsertDocumentEnrichment`; leaving either unbound would weaken the required generation contract. Do not modify `scripts/archive/backfill-enrichment.ts` or other archived/history files.

### Shared contract and strict normalizer

`source-anchored-summary.ts` is transport-neutral and imports no Node-, Deno-, Supabase-, provider-, or UI-specific module. It owns and exports the plan's exact payload/profile/label types, literal version, fallback markers, source-authority input, deterministic projection helpers, and `normalizeSourceAnchoredSummary(...)`. `src/lib/types.ts` re-exports the existing structural type names through this owner so UI consumers keep their current imports.

The shared literal contract is:

```text
SOURCE_ANCHORED_SUMMARY_VERSION = "source-anchored-summary-v1"
SOURCE_ANCHORED_SUMMARY_METADATA_KEY = "source_anchored_summary_v1"
SOURCE_ANCHORED_SUMMARY_PROJECTION_COMPLETE_KEY = "source_anchored_summary_projection_complete_v1"
SOURCE_ANCHORED_HEURISTIC_MODEL = "deterministic-source-coverage-heuristic"
SOURCE_ANCHORED_HEURISTIC_MODEL_VERSION = "source-anchored-summary-v1"
SOURCE_ANCHORED_STRUCTURED_MODEL_VERSION = "rag-deep-memory-v1"
SOURCE_ANCHORED_SOURCE_PAGE_SIZE = 1000
SOURCE_ANCHORED_MAX_CHUNKS = 5000
SOURCE_ANCHORED_MAX_IMAGES = 1000
SOURCE_ANCHORED_MAX_PROMPT_IMAGES = 64
SOURCE_ANCHORED_FALLBACK_MESSAGE = "A deterministic source-only fallback is available; inspect the anchored source evidence before clinical use."
```

The normalization/currentness authority includes `expectedStructuredModelVersion`. Structured payloads require `model` equal to the provider result's exact model and `model_version` exactly equal to that authority. Node passes its current `ragEnrichmentVersion`; Edge passes `SOURCE_ANCHORED_STRUCTURED_MODEL_VERSION`. A direct contract test proves `ragEnrichmentVersion === SOURCE_ANCHORED_STRUCTURED_MODEL_VERSION`; do not restate either literal independently.

The normalizer accepts an unknown candidate plus exact source authority containing `documentId`, non-null canonical `indexGenerationId`, ordered selected chunks, and ordered selected images. It returns a newly allocated deeply frozen payload. It throws before persistence on any mismatch; it never silently drops, repairs, coerces, reorders, or deduplicates an invalid claim.

Validate at least:

- exact literal `summary_version = "source-anchored-summary-v1"`;
- canonical document, generation, chunk, and image UUIDs;
- exact document/generation equality to the supplied authority;
- canonical ISO `generated_at` and bounded non-empty model/model-version/summary/profile text;
- complete profile keys, bounded arrays, allowed evidence/support/label enums, label confidence in `[0,1]`, and unique `(label_type,label)` values;
- whole-summary chunk/image anchors are unique and in the same order as their selected-source authority; no unselected, stale-generation, or unknown ID is admitted;
- every claim-level ID belongs to the whole-summary allowlist; its `pages` value is exactly the ascending unique positive page union derived from those IDs;
- `direct` and `partial` items retain at least one claim-level chunk or image anchor; `not_found` may be unanchored;
- `summary_kind = "structured"` iff `heuristic_fallback = false`; `summary_kind = "heuristic_fallback"` iff it is true; fallback uses exported exact deterministic heuristic model markers, while structured payloads use the actual indexing model and model version;
- the normalizer's authority generation is non-null. Positive-legacy/null-generation input fails with a stable `source_anchored_summary_requires_active_generation` error; no UUID is synthesized.

At least one selected exact-generation chunk or image and at least one whole-summary anchor are required. Either individual whole-summary source array may be empty, but their union may not. Empty clinical-fact arrays and an empty label array are valid. A fallback must contain at least one anchored `direct` or `partial` `source_quality_notes` item and cannot consist only of `not_found` items. `not_found` text is allowed only in `not_covered` or `source_quality_notes`, uses the exact prefix `Not established by selected source evidence:`, is never projected into a clinical fact or label, and expresses a coverage gap rather than a negative clinical inference.

Use existing product limits where they exist: coverage selection caps prompt chunks at 36; labels cap at 32; ordinary profile lists cap at 6 and `best_questions` at 8. The source loading and prompt-image constants above are exact ceilings. Add the smallest explicit bounds for remaining strings and derived arrays and test their boundaries. Do not create a schema framework.

Structural validation proves claimed IDs, pages, enum values, and support/anchor presence. Do not pretend to infer semantic truth from prose or reclassify `text`/`table`/`image`/`mixed`/`metadata` beyond the supplied, validated enum.

Claim-bearing projections are deterministic and cannot be independently model-authored:

- In fixed profile-key order, collect only `direct`/`partial` items with validated anchors from `applies_to`, `key_clinical_actions`, `medication_dose_monitoring`, `thresholds_timing`, `escalation_risk_warnings`, `required_forms_documentation`, and `important_tables_images`.
- Every persisted item/summary/label string must already equal its canonical text: Unicode `NFKC`, every Unicode whitespace run collapsed to one ASCII space within an item, and leading/trailing whitespace removed. The normalizer rejects non-canonical input rather than rewriting it.
- For a structured payload, take the first eight anchored fact items in that fixed key/item order. Each item text is at most 600 characters. The exact projection is `- ${text}` for each item joined with `\n`, with no trailing newline and no truncation. `profile.overview` and top-level `summary` must equal that projection byte-for-byte. At least one projected fact item is required; the construction is therefore bounded below 5,000 characters.
- For a fallback payload, `profile.overview` and top-level `summary` equal `SOURCE_ANCHORED_FALLBACK_MESSAGE` byte-for-byte. Exactly one `source_quality_notes` item contains that same text with `support = "partial"`. When any selected chunk exists, that item's `evidence_type` is exactly `"text"`, its `source_chunk_ids` contains exactly the first selected chunk ID, and its `source_image_ids` is empty. Otherwise its `evidence_type` is exactly `"image"`, its `source_image_ids` contains exactly the first selected image ID, and its `source_chunk_ids` is empty. Mixed-source fallback therefore prefers the first selected chunk. In every case `pages` is the exact ascending unique positive page union derived from that one anchor. Every other profile array and every flattened clinical-specifics array, including `not_covered`, `best_questions`, and `exceptions_gaps`, is empty; no additional fallback prose is permitted. Cover exact chunk-only, image-only, and mixed-source fallback objects.
- Flattened arrays are exact text projections: `actions` from `key_clinical_actions`; `thresholds_timing` from the same profile key; `medication_monitoring` from `medication_dose_monitoring`; `risk_escalation` from `escalation_risk_warnings`; `documentation_forms` from `required_forms_documentation`; and `exceptions_gaps` from `not_covered`. Reject any independently supplied divergence.
- Label phrase canonicalization is `NFKC` → collapse Unicode whitespace to ASCII spaces → trim → JavaScript `toLowerCase()`. Matching transforms each canonical item-text haystack with that same JavaScript `toLowerCase()` while preserving the original canonical item text for persistence. A candidate label is valid only when that complete canonical phrase occurs in the lowercase haystack at Unicode letter/number boundaries: `^`/`$` or a character outside `\p{L}\p{N}` on each side. Substrings inside a larger letter/number token do not match. Associate the label deterministically with the first match in fixed profile-key/item order and persist that item's chunk/image/page anchors in label metadata. Sort unique labels by `(label_type, canonical phrase)`. Reject duplicates or labels with no anchored match. Fallback labels are empty. Put the normalization, boundary matcher, bullet projection, and fallback projection in the shared module and cover them with identical Node/Deno vector fixtures, including uppercase source text, acronyms, punctuation boundaries, and Unicode letter/number cases.

Store the complete normalized payload under `document_summaries.metadata[SOURCE_ANCHORED_SUMMARY_METADATA_KEY]` and project its summary, clinical specifics, whole-source IDs, model, generated time, and labels to existing columns/tables. Existing-row currentness is decided by reading that stored complete payload and running the same normalizer against current exact-generation source authority, then comparing the exact generated-label projection. Version strings, a completion marker, or scattered metadata flags alone are not proof.

### Exact-generation source loading

`worker/main.ts` must pass the already-created `indexGenerationId` into both `loadEnrichmentRows` and `upsertDocumentEnrichment`. Chunk and image queries project typed `index_generation_id` and constrain it to the exact UUID before ordering, paging, selection, or counts. The enrichment function validates every input row against that same UUID before constructing allowlists.

`scripts/backfill-smart-index.ts` must not use `repairChunkIndexingMetadata()` or its `randomUUID()` fallback as U02 authority. It selects typed `documents.index_generation_id` plus raw metadata authority, requires canonical non-null typed/raw equality, constrains chunk/image queries to that value before order/page, and passes it to enrichment. `scripts/enrich-documents.ts` does the same. Null, malformed, mismatched, mixed, overflowed, or incomplete authority fails closed. Do not execute either connected script.

Immediately after complete bounded exact-generation source loading, both connected scripts run the local P05 metadata/content preflight before image classification, embedding, currentness reuse, summary generation, or any other provider/persistence call. `worker/main.ts` runs the same preflight immediately after its exact-generation source load and before summary currentness/provider work. `upsertDocumentEnrichment` repeats the defensive local P05 recheck over document metadata plus the complete bounded exact-generation source before currentness reuse, provider, or persistence. Preserve the existing Edge protected-source scan as the first `processJob` operation. Tests prove zero image-classifier, embedding, and summary-provider calls for denied/unknown policy, null/malformed/mismatched generation, mixed source rows, empty source, or source-limit overflow.

The U01 positive-legacy Edge path cannot produce a conforming U02 payload. After the existing protected-source preflight, `indexing-v3-agent` must fail before source selection or summary persistence with `source_anchored_summary_requires_active_generation`; it must not retain or bless a legacy/null row as current, invent a UUID, or call a provider. Existing bounded job retry/failure handling remains the recovery path until an authorized generation-producing reindex.

### Deterministic Node/Deno coverage parity

Move the current pure `selectCoverageAwarePromptChunks`, `buildIndexingCoverageProfile`, `buildCoveragePromptNote`, and `compactPromptChunk` implementation to `_shared/indexing-coverage.ts`; re-export it from `src/lib/indexing-coverage.ts`. Preserve the current algorithm and public Node signatures. All three active callers and Edge page at exactly 1,000 rows, constrain generation before every order/range, and fail before generation/persistence if chunks exceed 5,000 or images exceed 1,000. Overflow throws `source_anchored_summary_source_limit_exceeded`; no silent truncation is allowed. Edge must load the complete bounded exact-generation chunk set before the shared selector and may not retain the first-24/first-N path. Only selected prompt chunks may become whole-summary chunk anchors.

Chunks order by `(chunk_index ASC, id ASC)`. Images order by `(clinical_relevance_score DESC NULLS LAST, page_number ASC NULLS LAST, id ASC)`. The prompt uses the first 64 images in that exact order after the complete bounded load. Whole-summary image anchors are exactly those prompt images. Source maps derive pages from typed rows, not model output.

### Generation and persistence behavior

Node is the existing structured-generation/provider path. Tests must mock it; no live provider is permitted. Node provider or parsing failure throws `source_anchored_summary_generation_failed`, preserves the prior summary and labels, persists no fallback, and enters the caller's existing bounded job/script retry handling. Edge adds no summary-provider call: it constructs and validates a deterministic `heuristic_fallback` payload from the same selected-source contract. Provider, parsing, or validation uncertainty therefore cannot become unanchored structured clinical content.

The Edge order is literal: `assertPublicSourceWorkerPolicy` → require non-null active generation → load/validate complete bounded exact-generation sources → revalidate or regenerate the summary payload → first completion-gate decision. This order also applies when the gate was already complete or core embeddings were already current. Reuse the validated summary projection later if embeddings need it; do not repeat generation.

Build and normalize the entire replacement before the summary upsert. A generation, parsing, validation, or summary-upsert failure leaves the prior valid summary and labels untouched. A current, same-generation, successfully revalidated structured payload with an exact label projection is reused without provider or payload persistence work. Missing, fallback, old-version, malformed, superseded-generation, projection-incomplete, or label-mismatched rows are not accepted as fully current. A valid stored structured payload with incomplete/mismatched labels repairs labels from the stored payload without a provider call; only missing/invalid payloads enter applicable Node structured or Edge deterministic-fallback generation.

Persist the summary first with `SOURCE_ANCHORED_SUMMARY_PROJECTION_COMPLETE_KEY = false`, then change generated labels. Labels are projections of the normalized payload, not a separately inferred vocabulary. Replacement must avoid the current delete-first gap: establish every desired label before deleting stale generated labels, or use the existing Edge SQL transaction so a label-write failure cannot erase the previous generated-label set. After exact desired-label write and stale generated-label removal succeed, update the summary marker to `true`. Preserve manual labels. Every generated label carries exact generation, summary-version, and deterministic claim-anchor metadata.

Currentness always revalidates the stored payload and exact projected generated-label set, even when the completion marker is true. A label failure leaves the marker false; retry repairs labels from the stored payload without calling the provider, removes stale generated labels only after desired labels exist, and then marks projection complete. Add a failure-after-N-label-writes test followed by a retry proving exact repair and manual-label preservation.

Do not treat label-write failure as proof that summary persistence failed. The explicit replacement-preservation requirement covers candidate generation/normalization and summary-upsert failure; label replacement has its own non-destructive ordering above.

### RED, GREEN, report, and review handoff

Before production edits, the exact focused RED must prove the shared normalizer/selector owner is absent, Node does not pass exact generation authority, both active scripts lack typed/raw exact-generation binding, Edge still permits complete-gate/embedding-current bypasses and the first-N path, invalid anchors are permissively filtered, claim-bearing projections can diverge, source-free/all-`not_found` fallback is not rejected, zero-call fail-closed provider ordering is absent, and destructive/unrecoverable label ordering remains observable. Capture exact expected failures and confirm the runner otherwise loads existing tests.

The GREEN selector and static/offline gates remain exactly those in the extracted task. Do not add a broad suite. Consult the arbiter before any expensive additional gate. If repository coordinator capacity is busy, wait without bypassing or force-releasing it.

Self-review the final owned diff for source-policy ordering, no provider-before-preflight path, exact generation filtering before order/limit, deterministic selection parity, strict normalization, non-destructive replacement, UI type compatibility, ordinary Answer isolation, test meaning, and stray/generated output.

Stage explicit owned paths plus this brief only and create one local candidate commit:

```text
feat(ingestion): anchor summaries to committed sources
```

Never push. The report must name task base/head, implementer identity, exact RED/GREEN commands and outcomes, every changed file, generation/source/clinical-safety assessment, replacement/rollback behavior, self-review, concerns, and an attestation that no prohibited action occurred.
