# Ingestion-First Continuation Implementation Plan

> **For agentic workers:** execute accepted behaviour units using the current acceleration register's coding loop. Reuse an effective implementer; use the approved disjoint writer split with one owner per file/interface. Retain independent specialist review and original-unit acceptance. Do not restart completed planning or load another execution workflow solely because a new increment begins.

**Goal:** Complete the source-only clinical ingestion system from trusted admission through technically validated, default-off retrieval while preserving all accepted P00-P07 evidence and deferring unrelated answer, presentation, rollout, provider, and connected-production work.

**Architecture (historical initial sequence; the audit amendment below governs remaining scheduling):** Anchor a new `rag-source-ingestion-continuation-v1` evidence overlay at accepted P07 commit `03aa32d731d1cb9009be55213580e9ea3994017c`. Land the sole-processor, generation, lease, shadow-reindex, admission, safety, extraction, activation, queue, retrieval, withdrawal, and reprocessing contracts in that order. Keep the ordinary buffered Answer path byte-equivalent and unable to call the new source-ingestion retrieval kernel.

**Tech stack:** Next.js 16.3 App Router, TypeScript 6 strict, Zod 4, Supabase/PostgreSQL/Storage/RLS, Node and Deno workers, Python/PyMuPDF/Tesseract, Vitest, Playwright, and the repository's migration, drift, RAG-fixture, gate-arbiter, task-brief, and immutable review-package tooling.

**Spec:** [`docs/superpowers/specs/2026-08-31-ingestion-first-continuation-design.md`](../specs/2026-08-31-ingestion-first-continuation-design.md)

**Reasoning:** The concrete plan and formal final whole-range review retain their required `xhigh` effort. Current execution uses Astra for controller architecture, difficult decisions, integration and that formal final review; Sol / Medium for bounded implementation; Sol / High for complex shared components and independent review; and Luna / Medium for worthwhile mechanical edits, inventories and static checks. Escalate only for a concrete problem. The original 2-4-hour planning estimate and 38-52-hour implementation/closure target, with a 58-hour contingency ceiling, are retained historical estimates. They are not the remaining-work forecast after the audit; re-estimate after contract and fixture sizing.

## Current execution authority

**12 September iteration refinement:** apply the concrete standing-infrastructure/delta-admission, compact-checkpoint, shared-helper and disjoint-owner rules in the [acceleration register](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/acceleration-register.md). The entire-remaining-programme table applies to U04–U13 and C01–C06 closure, with C07 residual preparation. It supersedes blanket serial dispatch, cold starts, unit-level Astra defaults, duplicate RED/full-selector runs, and unchanged full-range rereading below. Preserve unit identity, actual defect evidence, complete final coverage and all product/connected boundaries. The outside adversarial review's optional scope cuts remain unselected.

**11 September execution decision:** retain the full core scope, apply the existing acceleration policy, and complete the explicitly recorded optional runtime optimisations afterward. The [post-core deferral register](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/post-core-deferred-work.md) owns PC01–PC04 and their follow-up evidence. U11 functional UI, U12 kernel, U13 required recovery/selective planning, supported formats, fidelity and acceptance remain in core. C06 handoff must carry the open register and separate downstream Answer/connected residuals forward; it does not accept those items.

The user has authorised adoption, independent xhigh planning review, routing/checkpoint preflight, the narrow U02 correction with local commits, and dependency-driven plan continuation, with dependent integration and formal acceptance after prerequisite unit acceptance. [Execution authority](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/2026-09-07-execution-authority.md) supersedes older local implementation/agent/commit pauses. [R1–R5 evidence handoff](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/rag-evidence-handoff.md) is binding alongside A1–A7. Connected/operational and native-document-processing boundaries remain separate.

The post-U02 [shared contract freeze](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/shared-contract-freeze-v1.md) and [U03 execution contract](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md) refine these interfaces against accepted checkpoint `fd043b262ebd9b20315c2e46bc4838265787fa80`. Their independent acceptance record must precede U03 product dispatch. The source-only implementation owner and the still-unassigned clinical adjudicator are distinct; local lease work does not create clinical acceptance.

## Global constraints

- The immutable implementation anchor is `03aa32d731d1cb9009be55213580e9ea3994017c`. P00-P07 receipts and their accepted artifacts are never edited.
- The unaccepted P08A draft is superseded. Do not resume it, use its reserved migration name, or claim P08A/P14/P15/P16 acceptance under the parent manifest.
- This plan may produce only continuation states C00-C06. It cannot produce `PRODUCTION_ACCEPTED`.
- Do not process a document or corpus. Do not access hosted Supabase, Storage, PITR, scanners, model assets, or providers. Do not apply migrations, deploy, reindex, stage, evaluate, activate, withdraw, roll back, clean up, push, or open a pull request.
- Keep one exclusive owner per file and shared interface. Use up to four total agents only when ready, disjoint work makes each slot useful; do not reserve a reviewer slot or create filler work. The current U04 pattern is two disjoint writers plus a ready independent reviewer under the controller, not a general writer ceiling. Root serializes overlapping edits, shared-owner integration and expensive tests; no dependent formal acceptance is brought forward. Same-unit disjoint repository writers share that unit's immutable base. Early preparation for a successor is outside-repository only with contribution/input hashes; after predecessor acceptance, pin the successor base before any repository edit and revalidate the prepared input. Preserve unrelated staged, unstaged, and untracked work.
- Before first product dispatch, verify authority and reuse completed planning/capability evidence for unchanged scope. For each authorised unit, retain its TASK_BASE and owned paths; name the next behaviour, failing evidence and focused check in the existing brief/checkpoint. Implement and test that behaviour without a new plan/adoption/review packet for routine choices inside the accepted contract. At the original unit boundary, obtain independent Specification and Quality verdicts, correct every Critical or Important finding, and issue a whole-unit verdict using fresh correction/dependency inspection plus valid unchanged proof. Preserve the unit's authorised commit boundary: U04 has no intermediate product commit. A candidate commit elsewhere is not acceptance. Never push.
- Reuse final corrected behavior from `0f9a52f22^..03d68b3a1` and the dirty `rag-ingestion-design-20260821` worktree only as read-only semantic references. Never cherry-pick or copy either range wholesale, and never treat either as acceptance evidence.
- Preserve the accepted P04 ingestion classifier, P05 public-source policy and recovery-evidence vocabulary, P06 site-release authority, and P07 query/cache/ranking behavior unless a task below explicitly names the owner.
- All SQL functions use a fixed empty or explicit `search_path`, validate bounded inputs, serialize conflicting writes, and revoke `PUBLIC`, `anon`, and `authenticated` unless an authenticated administrator wrapper is explicitly named.
- `service_role` alone is not trusted-backend identity. Backend admission requires a distinct high-entropy capability whose digest is readable only inside a narrowly granted `SECURITY DEFINER` wrapper. Administrator admission independently verifies `auth.uid()`, the administrator claim, and staging ownership.
- The source-ingestion retrieval kernel is structurally default-off. `src/lib/rag/rag.ts`, Answer/search routes, answer-support code, and legacy cache readers/writers must neither import nor invoke it.
- Unknown admission, safety, policy, generation, lease, lineage, activation, withdrawal, or recovery state fails closed.
- Before Task 11 route/UI work, read the installed Next 16 route-handler and dynamic-route guides named in that task. Before browser work, run `npm run ensure` and use only its printed, project-verified URL.
- The approved migration reservation is the following ordered set. Before creating the first migration, prove every full filename is absent and every version sorts after the then-latest migration; if either check fails, stop before RED and record a newly allocated ordered set in the plan and task brief.

```text
20260831100000_retire_ingestion_worker.sql
20260831101000_fence_ingestion_leases_and_repairs.sql
20260831102000_stage_shadow_document_generations.sql
20260831103000_activate_retained_document_generations.sql
20260831104000_create_document_admission_events.sql
20260831105000_add_document_technical_activation.sql
20260831106000_add_source_ingestion_retrieval_kernel.sql
```

- Reconcile `supabase/schema.sql` and `src/lib/supabase/database.types.ts` in each migration-owning task. Regenerate or reconcile `supabase/drift-manifest.json` once after C01/C02 migrations stabilize and once after C03/C04 migrations stabilize; never copy generated artifacts from another worktree.
- `npm run check:production-readiness` is approval-gated by the saved workflow flightplan. Do not execute it during C00-C06 without a later explicit approval. Record it in C07, not as a local pass.
- Use `npm run arbiter -- <gate>` before any expensive final gate. A `DEFER` or `PROVEN` result is evidence, not a pass. Never rerun an unchanged successful gate.

## Continuation evidence layout

Create only concrete programme evidence, not a generalized workflow framework:

```text
docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/manifest.json
docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/C00-anchor.md
docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/C01-evidence.md
docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/C02-evidence.md
docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/C03-evidence.md
docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/C04-evidence.md
docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/C05-evidence.md
docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/C06-acceptance.md
docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/C07-connected-residuals.md
docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/
```

One canonical acceptance record per unit names the task base/head, commands/outcomes, implementer and reviewer identities/routes, final verdicts, correction heads, residuals, and immutable review-package SHA-256. Other required artifacts reference that record instead of duplicating its narrative; preserve complete machine input/result/cleanup records and immutable historical evidence. Continue using:

For active execution, the controller owns the single operational ledger outside the repository at `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U04-live-checkpoint.json`. Agents return concise handoffs; the controller records decisions, blockers and verification there. Do not create competing live ledgers.

```text
npm run plans:rag:receipts:check -- --write-review-package TASK_BASE TASK_HEAD docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/TASK_ID/TASK_ID-review.diff
```

Replace `TASK_BASE`, `TASK_HEAD`, and `TASK_ID` with observed literal values before running the command. This invocation reuses the repository-owned canonical diff writer without altering parent receipts.

## Audit amendment and revised scheduling boundary

Read the current [amendment and decision record](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/2026-09-07-audit-amendment.md), [complete findings](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/audit-findings.md), [E1-E7 acceptance matrix](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/extraction-fidelity-acceptance.md), [agent allocation](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/smart-agent-allocation.md) and [acceleration register](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/acceleration-register.md). These are the planning entry points; C00 and prior receipts remain historical.

Historical 7 September audit adoption: this update and subsequent local implementation were authorised by the execution-authority record, with the initial independent planning review and capability gates. Those completed prerequisites are reused for unchanged scope; the live checkpoint records current progress. The dated continuation amendment record owns approved source hashes, decisions and prospective route evidence. Preserve P00-P07, C00's historical manifest and every accepted U01/U02 artifact. At that audit snapshot U03 was unstarted; it has since been locally accepted, while U04 remains partial. P08A remains superseded; ordinary Answer and the kernel import prohibition remain unchanged.

The historical first packet was the narrow U02 F02 correction, followed by shared contract freeze and U03. Retain their accepted evidence; do not redispatch them or repeat their audit. U03 -> U04 -> U05 remains the lifecycle order. U07/U08 are prerequisites to real processing; U09/U10 are prerequisites to technical activation. U05 owns the single atomic generation switch; U10 supplies its exact technical verdict, not a second switch. U11/U12 consume stable task/eligibility/evidence authority; U13 consumes stable identity/recovery authority; C06 judges integration and C07 remains separate.

Permit early U09/P05/P06 fixture specification and, only with specific synthetic-testing authority, isolated pure producer/adapter experiments after shared contract freeze. This removes waiting for final U06 prose or U11 UI, not runtime or Trusted Task 0 prerequisites. Use disjoint pure-code owners under the acceleration table; retain no out-of-order formal U09/C03 acceptance, no early schema/activation path and no concurrent shared-owner edits. Integrate and formally review early work in its owning U09/P05/P06 corrective range; do not hide product changes in documentation or C06. U06 may prepare vocabulary early but its C02 runbook/review gate remains; final UI guidance must reflect actual U11 behaviour.

E1-E7 are one native PDF, one mixed/OCR PDF, one DOCX, one XLSX, one saved approved HTML, one static/registry producer family and one TXT control. Use actual serialized producer output through extraction -> structure -> chunk/index unit -> exact evidence resolver, including tail content, numeric relationship, qualification and a correctly refused counterpart. Expected evidence is authored independently. F02's 1/2/8-item cases join this milestone. These fixtures demonstrate evidence preservation, not model quality or ordinary Answer availability.

Historical U02 evidence remains 98/98 focused tests and Edge exit 0. `npm run eval:rag:offline` remains exit 1: four failed suites, 45 failed and 586 passed tests overall (the affected subset was 45 failed/56 passed). It is not green. Its accepted exception belongs only to the historical U02 scope; no automatic carry-forward to a correction, U03 or C06. A narrow F02 gate may deliberately omit unrelated Answer suites with an explicit scope rationale; omission is not a renewed exception or a pass. If a later required evaluation fails, retain its exact result and block the relevant completion pending repair or a new explicit scope decision.

Each unit brief is captured once with its producer/consumer, finding IDs, source/dependency identities, reviewer set, selected behavioural proof and residuals. Update that existing brief/checkpoint for an in-scope increment rather than creating another packet. Reuse unchanged historical proof only with its original result and limitations. Do not rerun the audit diagnostic or broad baseline on unchanged code. C06 adds no product tests: missing proof reopens the named owning task. Existing C06 final selectors and broad-gate selection remain, augmented by owning-unit E1-E7 proof; no equivalent broad gates are stacked.

For future authorised work, use the continuation-specific smart allocation in canonical sdd-execution.md. It does not alter P-phase routing or validate U/C receipts through an unknown-phase fallback. Dispatch is authorised after required preflight and review. Planned routing is not observed runtime acceptance. The original hour table is historical; measure active work, review rework, orchestration and coordinator wait before forecasting savings.

## Verification and review scheduling for remaining tasks

The Task 4–13 command blocks below define required coverage at the owning unit boundary. They are not a command list to execute on every edit. Use the smallest meaningful changed-behaviour RED/GREEN during implementation; preserve earlier actual failure proof rather than recreating it. Complete the unit's required coverage once through its selected checks or demonstrably equivalent executed coverage, with exact-input reuse for unchanged constituents. Uncertain dependency identity requires fresh relevant proof. Protected-path equivalents and all original failure/cleanup checks remain mandatory; no command here overrides the protected-worktree or provider boundaries.

Trusted Task 0 consumes the accepted C01/C02 evidence and checks ancestry/current input identity, running only missing or changed coverage. Unit, tranche and C06 review may share inspection where the inputs and prerequisites permit, with separate full-range verdicts at the required floors, every named specialist and independence from all code being judged. At C06 select the broad gate before the fallback; never pre-run its constituent suites merely for reassurance. Documentation-only preparation receives scoped static checks, not product baselines, builds or server setup.

The acceleration register owns the concrete U04–U13 parallel-work and proof table. Keep separate unit identities and authorised commit boundaries, full U11 UI, U12 default-off kernel, required U13 recovery, E1–E7 and F01–F16. Native/SQL/provider/hosted/clinical proof stays explicit and separately authorised.

## Historical task order and time budget

| Unit | Parent mapping            | Outcome                                           | Target hours |
| ---- | ------------------------- | ------------------------------------------------- | ------------ |
| 1    | Ingestion Task 4 / C01    | sole processor and generation-visible reads       | 2-3          |
| 2    | Ingestion Task 5 / C01    | source-anchored summaries                         | 2.5-3.5      |
| 3    | Ingestion Task 6 / C01    | lease fencing and bounded repair                  | 3-4          |
| 4    | Ingestion Task 7 / C02    | exact-generation shadow staging and evaluation    | 3.5-5        |
| 5    | Ingestion Task 8 / C02    | activation, rollback, retention, and cleanup      | 3-4          |
| 6    | Ingestion Task 9 / C02    | operator truth and wave runbooks                  | 0.75-1.25    |
| 7    | Trusted Task 1 / C03      | administrator/backend admission                   | 2.5-3.5      |
| 8    | Trusted Task 2 / C03      | ingress and provider-egress safety                | 2.5-3.5      |
| 9    | Trusted Task 3 / C03      | reproducible OCR/layout evidence                  | 2.5-3.5      |
| 10   | Trusted Task 4 / C03      | technical eligibility and atomic activation       | 3.5-4.5      |
| 11   | Trusted Task 5 / C04      | durable administrator queue and complete UI       | 2.5-3.5      |
| 12   | Trusted Task 6 / C04      | default-off retrieval kernel and withdrawal proof | 4-5          |
| 13   | Trusted Task 7 / C05      | selective reprocessing and recovery controls      | 2-3          |
| —    | C00, tranche reviews, C06 | anchors, integration review, final acceptance     | 4-5          |

## Exact file map

| Area                      | Files                                                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Processor and summaries   | `supabase/functions/ingestion-worker/**`, `supabase/functions/indexing-v3-agent/{index,behavior,utils}.ts`, `supabase/functions/_shared/{ingestion-generation-visibility,source-anchored-summary}.ts`, `src/lib/document-enrichment.ts`, `worker/main.ts`                  |
| Lease and repair          | `worker/{types,row-contracts,behavior,main}.ts`, `supabase/schema.sql`, `src/lib/supabase/database.types.ts`, migrations `20260831100000` and `20260831101000`                                                                                                             |
| Shadow lifecycle          | `scripts/reindex-shadow.ts`, `scripts/lib/reindex-eval-session.ts`, `src/lib/{reindex-eval-gate,reindex-pipeline}.ts`, `scripts/{eval-retrieval,eval-quality,cleanup-abandoned-reindex-generations}.ts`, migrations `20260831102000` and `20260831103000`                  |
| Admission and safety      | `src/lib/{trusted-document-admission,document-ingress-safety}.ts`, `src/app/api/upload/route.ts`, `scripts/import-documents.ts`, `src/lib/{upload-structure,privacy,env}.ts`, migration `20260831104000`                                                                   |
| Extraction and activation | `worker/python/extract_pdf_assets.py`, `src/lib/extractors/document.ts`, `src/lib/types.ts`, `worker/shadow-extraction.ts`, `src/lib/{index-quality,document-technical-eligibility,publication-manifest}.ts`, migration `20260831105000`                                   |
| Queue UI                  | `src/app/api/ingestion/quality/route.ts`, `src/app/api/ingestion/quality/tasks/[id]/route.ts`, `src/components/clinical-dashboard/{document-manager-contracts,clinical-dashboard-payloads,DocumentManagerPanel}.tsx`, `src/components/ClinicalDashboard.tsx`               |
| Retrieval and lifecycle   | `src/lib/owner-scope.ts`, `src/lib/rag/source-ingestion-retrieval.ts`, `src/app/api/documents/[id]/route.ts`, `src/lib/{ingestion-audit,document-reprocessing}.ts`, `scripts/{audit-document-pipeline-versions,plan-document-reprocessing}.ts`, migration `20260831106000` |
| Documentation             | `docs/{ingestion-state-machine,worker-deploy-runbook,reindex-runbook,reindex-shadow-harness-design,disaster-recovery-runbook,search-rag-master-context,openai-rag-operations}.md`, `docs/rag-improvement/data-flow-register.md`                                            |

## C00: Anchor the continuation before product work

**Files:**

- Create: `docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/manifest.json`
- Create: `docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/C00-anchor.md`
- Modify: `.superpowers/sdd/progress.md`

Checkpoint the already approved planning inputs without changing their reviewed bytes:

- `docs/superpowers/specs/2026-08-31-ingestion-first-continuation-design.md`
- `docs/superpowers/plans/2026-08-31-ingestion-first-continuation.md`
- `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/C00/C00-brief.md`

They are untracked at the implementation base; omitting them would leave the committed `designPath` and `planPath` dangling.

**Step 1: Record immutable imports**

The manifest contains `programmeId`, `designPath`, `planPath`, `implementationBase`, the accepted P00-P07 receipt paths and SHA-256 digests, ordered phases C01-C06, the 13 unit identifiers, reviewer routing, migration reservations, C07 residuals, and `ordinaryAnswerServingChanged: false`.

**Step 2: Prove the anchor and migration reservation**

Run:

```text
git rev-parse HEAD
git merge-base --is-ancestor 03aa32d731d1cb9009be55213580e9ea3994017c HEAD
rg --files supabase/migrations | rg "20260831100000|20260831101000|20260831102000|20260831103000|20260831104000|20260831105000|20260831106000"
node -e "const fs=require('node:fs');const reserved=['20260831100000_retire_ingestion_worker.sql','20260831101000_fence_ingestion_leases_and_repairs.sql','20260831102000_stage_shadow_document_generations.sql','20260831103000_activate_retained_document_generations.sql','20260831104000_create_document_admission_events.sql','20260831105000_add_document_technical_activation.sql','20260831106000_add_source_ingestion_retrieval_kernel.sql'];const existing=fs.readdirSync('supabase/migrations').sort();const latest=existing.at(-1);for(const name of reserved){if(existing.includes(name))throw new Error('reserved migration exists: '+name);if(name.localeCompare(latest)<=0)throw new Error(name+' does not sort after '+latest)}if([...reserved].sort().join()!==reserved.join())throw new Error('reservations are unordered');console.log(JSON.stringify({latest,reserved}))"
```

Expected: HEAD equals the accepted P07 metadata commit at the initial anchor, ancestry exits 0, the migration search exits 1 with no matches, the latest existing migration is reported, and all seven absent reservations sort after it in the planned order.

**Step 3: Capture the dry-run gate route**

Run:

```text
node scripts/ci-change-scope.mjs --json --files worker/main.ts,supabase/schema.sql,src/app/api/upload/route.ts,src/lib/document-ingress-safety.ts,src/app/api/ingestion/quality/route.ts,src/lib/rag/source-ingestion-retrieval.ts
npm run verify:pr-local -- --dry-run --files worker/main.ts,supabase/schema.sql,src/app/api/upload/route.ts,src/lib/document-ingress-safety.ts,src/app/api/ingestion/quality/route.ts,src/lib/rag/source-ingestion-retrieval.ts
npm run verify:pr-local -- --dry-run --extended --files worker/main.ts,supabase/schema.sql,src/app/api/upload/route.ts,src/lib/document-ingress-safety.ts,src/app/api/ingestion/quality/route.ts,src/lib/rag/source-ingestion-retrieval.ts,src/components/ClinicalDashboard.tsx
```

Expected: the scope mapper reports `ingestion_sast_changed: true`, `db_changed: true`, and `rag_eval_changed: true`. The exact primary preview prints its fail-closed source gate plan without running it. The extended preview adds `verify:ui` for the later administrator queue surface, still without running a verification command. The selector has no separate privacy or clinical categories; those risks are represented by the task's explicit privacy, clinical-governance, schema, ingestion, retrieval, and UI reviewer routing rather than falsely claimed as dry-run flags.

**Step 4: Review and checkpoint C00 metadata**

A fresh reviewer verifies the exact parent receipt digests, no parent-file mutation, migration order, retained/deferred list, and C07 boundaries. Create one local metadata checkpoint. Product implementation begins only after that review is clean.

---

## Task 1: Retire the duplicate processor and enforce committed-generation reads

**Files:**

- Create: `supabase/functions/_shared/ingestion-generation-visibility.ts`
- Create: `supabase/migrations/20260831100000_retire_ingestion_worker.sql`
- Delete: `supabase/functions/ingestion-worker/index.ts`
- Delete: `supabase/functions/ingestion-worker/auth.ts`
- Delete or replace: `tests/ingestion-edge-function-auth.test.ts`
- Modify: `supabase/config.toml`
- Modify: `supabase/functions/indexing-v3-agent/index.ts`
- Modify: `supabase/functions/indexing-v3-agent/behavior.ts`
- Modify: `supabase/functions/indexing-v3-agent/utils.ts`
- Modify: `supabase/schema.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `tests/indexing-v3-agent.test.ts`
- Modify: `tests/worker-run-loop.test.ts`
- Modify: `tests/worker-row-contract.test.ts`
- Modify: `tests/supabase-schema.test.ts`
- Modify: `docs/worker-deploy-runbook.md`

**Step 1: Write RED ownership and visibility tests**

Add this exact matrix to `tests/indexing-v3-agent.test.ts`:

```ts
it("admits only legacy rows or the exact active committed generation", () => {
  const visibility = {
    activeGenerationByDocument: new Map([["doc-a", "gen-active"]]),
    committedGenerationIds: new Set(["gen-active", "gen-other"]),
    knownLegacyDocumentIds: new Set(["doc-legacy"]),
  };

  expect(isVisibleCommittedGenerationRow({ document_id: "doc-a", generation_id: null }, visibility)).toBe(false);
  expect(isVisibleCommittedGenerationRow({ document_id: "doc-legacy", generation_id: null }, visibility)).toBe(true);
  expect(isVisibleCommittedGenerationRow({ document_id: "doc-unknown", generation_id: null }, visibility)).toBe(false);
  expect(isVisibleCommittedGenerationRow({ document_id: "doc-a", generation_id: "gen-active" }, visibility)).toBe(true);
  expect(isVisibleCommittedGenerationRow({ document_id: "doc-a", generation_id: "gen-other" }, visibility)).toBe(false);
  expect(isVisibleCommittedGenerationRow({ document_id: "doc-missing", generation_id: "gen-active" }, visibility)).toBe(
    false,
  );
});
```

Add source-query assertions proving stale rows are filtered before `ORDER BY` and `LIMIT`, plus a loop case in which both job processing and failure recording throw but the next claimed job still runs.

Run:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/supabase-schema.test.ts
```

Expected RED: the shared predicate and retirement migration are absent; the duplicate function/config/invoker and stale-generation reads remain observable.

**Step 2: Add the shared predicate**

Create:

```ts
export type GenerationVisibleRow = Readonly<{
  document_id: string;
  generation_id: string | null;
}>;

export type GenerationVisibility = Readonly<{
  activeGenerationByDocument: ReadonlyMap<string, string>;
  committedGenerationIds: ReadonlySet<string>;
  knownLegacyDocumentIds: ReadonlySet<string>;
}>;

export function isVisibleCommittedGenerationRow(row: GenerationVisibleRow, visibility: GenerationVisibility): boolean {
  if (row.generation_id === null)
    return (
      visibility.knownLegacyDocumentIds.has(row.document_id) &&
      !visibility.activeGenerationByDocument.has(row.document_id)
    );
  return (
    visibility.activeGenerationByDocument.get(row.document_id) === row.generation_id &&
    visibility.committedGenerationIds.has(row.generation_id)
  );
}
```

Project the validated generation alias for chunks, sections, cards, index units, summaries, and labels. Apply the predicate before sorting or truncating. Preserve the P05 protected-source preflight before provider or artifact work.

Null-generation compatibility is document-scoped and positive: it is allowed only when a complete authority scan explicitly classifies the document as legacy and no active mapping exists. Absence from the active map is unknown, not legacy. Reject overlapping legacy/active authority, malformed generation IDs, and incomplete authority scans before constructing `GenerationVisibility`. Once a document has an active generation, every null or non-matching generation row is stale and excluded.

**Step 3: Retire only the recovered processor**

The migration drops `public.invoke_ingestion_worker(integer)`, revokes its grants first, and does not edit historical migrations. Remove the `ingestion-worker` function directory and config stanza. Remove the current schema/type entry, while retaining historical documentation that accurately describes the past state. Nest failure-recording in its own `try/catch` so it cannot abort sibling jobs.

**Step 4: Run GREEN and static gates**

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/supabase-schema.test.ts
npm run check:edge:functions
npm run check:migration-role
```

Expected: focused tests pass; the sole surviving processor is `worker/main.ts` for core processing plus `indexing-v3-agent` for bounded enrichment; current schema/types/config contain no retired invoker.

**Step 5: Review and checkpoint**

Primary reviewer: `ingestion-worker-reviewer`. Mandatory migration/grant reviewer: `supabase-schema-guardian`. Suggested local checkpoint message: `fix(ingestion): retire duplicate processor`.

---

## Task 2: Produce one validated source-anchored summary payload

**Audit acceptance requirements (under current authority and unit gates):** F02 corrective acceptance uses the actual provider-response adapter, projection and validator for one, two and eight supported items. Canonical individual text and aggregate formatting must agree, with strict projection equality and existing bounds intact. Reject wrong aggregate, noncanonical item, invalid nested anchors/generation and field shapes. Keep this correction separate from F03 semantic-support design, F08 persistence/schema work and Answer/search. Use the new audit-correction brief; preserve the accepted original brief and exception record.

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

## Task 3: Fence every lease mutation and produce bounded repair plans

**Concrete execution supplement:** use [U03 execution contract](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md) for the reviewed all-writer inventory, atomic authority predicates, bounded domain mutations, lost-response handling, precise selectors and protected-safe verification equivalents. It explicitly includes the enrichment/deep-memory persistence owners omitted from the original list below. Keep one original U03 range across its serial implementation increments; do not accept an increment that leaves another writer unfenced as complete U03.

**Audit acceptance requirements (under current authority and unit gates):** F08/F01 require an inventory of every job, heartbeat, terminal, artifact, summary, label, metadata, fallback and repair writer. Bind each mutation to durable attempt identity, expected generation and current source/policy authority. Same worker ID is not attempt identity. Missing-RPC fallback cannot bypass fencing; cancellation/lease loss bounds further work. Preserve U02-owned metadata boundaries. Caller mocks prove arguments only; separately authorised disposable SQL schedules must prove reclaim, stale heartbeat, sibling isolation, cancellation and G1-after-G2 summary races before concurrency is claimed.

**Files:**

- Create: `supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql`
- Modify: `worker/types.ts`
- Modify: `worker/row-contracts.ts`
- Modify: `worker/behavior.ts`
- Modify: `worker/main.ts`
- Modify: `supabase/functions/indexing-v3-agent/index.ts`
- Modify: `supabase/schema.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `tests/indexing-v3-agent.test.ts`
- Modify: `tests/worker-behavior.test.ts`
- Modify: `tests/worker-run-loop.test.ts`
- Modify: `tests/worker-runtime-control.test.ts`
- Modify: `tests/worker-row-contract.test.ts`
- Modify: `tests/check-indexing-contract.test.ts`
- Modify: `docs/ingestion-state-machine.md`
- Modify: `docs/worker-deploy-runbook.md`
- Modify: `docs/reindex-runbook.md`

**Step 1: Pin stale-owner RED behavior**

Add a required UUID `lease_token` to claimed-row parsing. Test that each claim rotates it; missing or malformed tokens fail parsing; old worker/token pairs cannot report progress, heartbeat, commit, complete, defer, or fail/retry after a newer claim; and lease loss does not reopen or clear the newer claim.

Define and test:

```ts
export type IngestionRepairReasonCode =
  | "missing_committed_generation"
  | "generation_mismatch"
  | "summary_missing"
  | "summary_invalid"
  | "summary_fallback_growth"
  | "lease_abandoned";

export type IngestionRepairPlan = Readonly<{
  version: "ingestion-repair-plan-v1";
  dryRun: true;
  documents: readonly Readonly<{
    documentId: string;
    reasonCodes: readonly IngestionRepairReasonCode[];
    expectedStateDigest: `sha256:${string}`;
  }>[];
  planDigest: `sha256:${string}`;
}>;
```

Run:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/worker-behavior.test.ts tests/worker-run-loop.test.ts tests/worker-runtime-control.test.ts tests/worker-row-contract.test.ts tests/check-indexing-contract.test.ts
```

Expected RED: tokens are absent from at least one mutation path and the repair planner does not exist.

**Step 2: Implement atomic token fencing**

Claims set `lease_token = gen_random_uuid()` and return it. Every mutation matches `id`, `document_id`, `status = 'processing'`, `locked_by`, and `lease_token` in the same statement. Return exactly `{ "ok": false, "reason": "lease_lost" }` when no row matches. Implement these service-only RPCs:

```text
update_ingestion_job_progress(p_job_id,p_document_id,p_worker_id,p_lease_token,p_stage,p_progress)
heartbeat_ingestion_job(p_job_id,p_document_id,p_worker_id,p_lease_token)
complete_ingestion_job(p_job_id,p_document_id,p_batch_id,p_stage,p_worker_id,p_lease_token)
fail_or_retry_ingestion_job(p_job_id,p_document_id,p_batch_id,p_retry,p_document_status,p_stage,p_error_message,p_next_run_at,p_worker_id,p_lease_token)
```

Fence strict-agent status and generation commits equivalently. Remove direct-update fallback paths that can bypass the token. Revoke or replace the current arbitrary `repair_strict_enrichment_gate_batch(integer)` mutator.

**Step 3: Implement the deterministic repair planner and append-only audit**

`planIngestionRepairs` accepts 1-100 unique canonical document UUIDs, a non-empty fixed reason-code set, and exactly one `sha256:` state digest per document. It stable-sorts documents and codes before hashing. The migration creates an append-only service-role repair audit. Applying a plan is not exposed by this task.

**Step 4: Run GREEN and preserve the P04 classifier**

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/worker-behavior.test.ts tests/worker-run-loop.test.ts tests/worker-runtime-control.test.ts tests/worker-row-contract.test.ts tests/check-indexing-contract.test.ts
npm run check:edge:functions
npm run check:migration-role
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/audit.json
```

Expected: all focused tests pass; audit output retains the accepted P04 action classification and population fingerprint contract.

**Step 5: Review and checkpoint the C01 source changes**

Reviewers: `ingestion-worker-reviewer`, `supabase-schema-guardian`, and `clinical-governance-reviewer` for fail-closed quality semantics. Keep schema and types aligned in this task; defer the single drift regeneration to the stable C01/C02 tranche boundary. Suggested local checkpoint message: `fix(ingestion): fence leases and repair plans`.

---

## Task 4: Stage and evaluate an exact shadow generation without committing it

Local implementation and source/offline acceptance completed 13 September 2026. See [U04 acceptance](C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U04-local-acceptance-1.md); connected SQL/provider/native proof remains separately gated. “Without committing” in this task title refers to generation activation; the authorised whole-unit source checkpoint is a local Git commit.

**Audit acceptance requirements (under current authority and unit gates):** F06/F08/F09 extend staging/evaluation to the complete immutable artifact inventory: pages, native/structural evidence, chunks/index units, images, summaries, labels and generation metadata. Reconcile expected/retained/failed/skipped units and all cap/conflict reasons. A candidate remains invisible to ordinary readers; failure preserves the prior valid set. Include controlled boundary failure fixtures and later executable SQL evidence.

**Files:**

- Create: `supabase/migrations/20260831102000_stage_shadow_document_generations.sql`
- Create: `scripts/reindex-shadow.ts`
- Create: `scripts/lib/reindex-eval-session.ts`
- Create: `tests/reindex-shadow.test.ts`
- Modify: `worker/main.ts`
- Modify: `src/lib/reindex-eval-gate.ts`
- Modify: `scripts/eval-retrieval.ts`
- Modify: `scripts/eval-quality.ts`
- Modify: `supabase/schema.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `tests/reindex-eval-gate.test.ts`
- Modify: `tests/profile-retrieval-rpcs.test.ts`
- Modify: `tests/supabase-schema.test.ts`
- Modify: `tests/worker-behavior.test.ts`
- Reuse unchanged: `src/lib/ingestion-audit.ts`
- Reuse unchanged: `src/lib/recovery-readiness-evidence.ts`

**Step 1: Pin the staging correction in RED tests**

Continuation note — 12 September 2026: this is the historical initial defect specification, not a command to restart the RED baseline. Resume the saved implementation and existing evidence. Add or run a focused regression only for a newly changed or unresolved failure path. Apply the active iteration policy in ../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/acceleration-register.md.

The current worker always calls destructive generation commit and `document_pages` is generation-blind. Add tests that require standard jobs to commit, shadow jobs to stage without changing the active pointer, and exact rollback to retain generation-addressed page rows.

Use one candidate generation UUID for the whole wave:

```ts
export type ShadowReindexPlanV1 = Readonly<{
  version: 1;
  targetProjectRef: string;
  sourcePolicyVersion: string;
  auditDigest: `sha256:${string}`;
  populationFingerprint: `sha256:${string}`;
  candidateGenerationId: string;
  documents: readonly Readonly<{
    documentId: string;
    expectedStateDigest: string;
    baselineGenerationId: string | null;
  }>[];
  chunkingExperiment: boolean;
  digest: `sha256:${string}`;
}>;

export type ShadowReindexStageReceiptV1 = Readonly<{
  version: 1;
  planDigest: `sha256:${string}`;
  projectRef: string;
  recoveryEvidenceDigest: `sha256:${string}`;
  candidateGenerationId: string;
  stagedAt: string;
  documents: readonly Readonly<{
    documentId: string;
    expectedStateDigest: string;
    baselineGenerationId: string | null;
    pageCount: number;
    chunkCount: number;
    imageCount: number;
  }>[];
  digest: `sha256:${string}`;
}>;

export type ReindexOperationManifestV1 = Readonly<{
  version: 1;
  operation: "stage" | "evaluate" | "promote" | "rollback" | "cleanup";
  targetProjectRef: string;
  planPath: string;
  reportOrReceiptPath: string | null;
  recoveryEvidencePath: string;
  recoveryEvidenceSha256: `sha256:${string}`;
  expectedDocumentIds: readonly string[];
  expectedDocumentCount: number;
  confirmationSha256: `sha256:${string}`;
  authorizedAt: string;
  expiresAt: string;
}>;
```

Test that every staged document uses `candidateGenerationId`, the plan contains an explicit eligible document list and exact P04 state digests, baseline evaluation precedes stage, post-stage state drift returns `NO_GO`, incomplete generations cannot evaluate, missing metrics fail closed, and evaluate cannot promote.

Run:

```text
node scripts/run-vitest.mjs run tests/reindex-shadow.test.ts tests/reindex-eval-gate.test.ts tests/worker-behavior.test.ts tests/profile-retrieval-rpcs.test.ts tests/supabase-schema.test.ts
```

Expected RED: the stage driver/RPC is absent, the worker has no non-committing branch, and pages cannot coexist across generations.

**Step 2: Add staged-generation persistence**

The migration:

- creates the canonical `document_index_generations` ledger with `staged` state;
- adds generation identity to `document_pages` and replaces `unique(document_id,page_number)` with `unique(document_id,index_generation_id,page_number)`;
- adds shadow-operation and requested-generation identity to `ingestion_jobs`;
- updates every committed-generation helper overload consistently; and
- adds service-only, fixed-search-path `enqueue_shadow_reindex_generation` and lease-fenced `stage_document_index_generation` RPCs.

The worker branches only on a validated persisted operation mode. Standard mode retains `commit_document_index_generation`; shadow mode writes a complete generation through `stage_document_index_generation` and never calls commit.

**Step 3: Add exact-generation evaluation wrappers**

Create service-role-only, fixed-search-path `eval_match_document_chunks_text_v2` and `eval_match_document_chunks_hybrid_v2`. Both accept one `p_eval_generation_id`, filter all requested documents to that generation, and keep unset production GUC behavior byte-equivalent.

Use one report name consistently:

```ts
export type ShadowReindexReportV1 = Readonly<{
  version: 1;
  planDigest: `sha256:${string}`;
  stageReceiptDigest: `sha256:${string}`;
  recoveryEvidenceDigest: `sha256:${string}`;
  populationFingerprint: `sha256:${string}`;
  candidateGenerationId: string;
  baseline: { retrieval: RetrievalGateSummary; quality: QualityGateSummary };
  candidate: { retrieval: RetrievalGateSummary; quality: QualityGateSummary };
  decision: ReindexGateDecision;
  digest: `sha256:${string}`;
}>;
```

The pure driver validates `plan`, `stageReceipt`, and `evaluate` transitions. Its connected adapters remain present but unusable without explicit operation-manifest authorization and configured clients; tests use injected fakes only.

**Step 4: Run GREEN**

Run this as the final coherent U04 acceptance package, not after each edit. During iteration select only affected tests. Reuse unchanged passing evidence with its original scope and date; after corrections rerun the affected coverage, not the entire successful package. The admitted explicit-path equivalents remain required where a default wrapper would enumerate protected inputs. Include changed producer/runner regressions and the necessary focused compiler without stacking an unrelated broad gate. Production-readiness retains its existing separate authorisation boundary. All 26 fixed offline operations and original U04 functional requirements remain covered. The offline wrapper already validates fixtures, so do not run that validation separately.

```text
node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-shadow.test.ts tests/reindex-eval-gate.test.ts tests/worker-behavior.test.ts tests/profile-retrieval-rpcs.test.ts tests/reindex-pipeline.test.ts tests/supabase-schema.test.ts
npm run check:migration-role
npm run check:function-grants
npm run eval:rag:offline
```

Expected: all local tests and static checks pass; no hosted session, document, embedding, or provider evaluation occurs.

**Step 5: Review and checkpoint**

Reviewers: `ingestion-worker-reviewer`, `supabase-schema-guardian`, and `rag-retrieval-reviewer`. Suggested local checkpoint message: `feat(reindex): stage exact shadow generations`.

Provide one shared coherent package to these specialists, partitioned by their actual risk areas, then review correction deltas against the original task base. Do not restart the audit or rereview unchanged inputs for each small edit. Original-range coverage remains mandatory. The suggested commit is for accepted whole U04 only; no intermediate slice is accepted by this scheduling change.

---

## Task 5: Activate, roll back, retain, and clean exact generations

**Audit acceptance requirements (under current authority and unit gates):** F09: this unit owns the sole atomic publication/rollback mechanism, consuming U10's exact generation-bound gate verdict. Switch the complete artifact set. Retain permitted prior evidence for governed rollback; withdrawal excludes immediately and cannot be undone by rollback. Cleanup may remove only unreferenced, deletion-authorised artifacts, never active/retained/newly referenced objects; test activation/cleanup and rollback/cleanup races later with actual SQL.

The [U05 execution contract](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U05-execution-contract.md) records the reviewed implementation decisions and local evidence boundary. Existing typed legacy generations and null G0 require exact immutable baseline/operation/snapshot proof; they must not be fabricated as shadow-wave members. U05 keeps the private U10 technical-receipt gate refusing until Task 10 supplies authoritative lookup. Local completion is not operational activation.

**Files:**

- Create: `supabase/migrations/20260831103000_activate_retained_document_generations.sql`
- Create: `tests/reindex-generation-lifecycle.test.ts`
- Modify: `src/lib/reindex-pipeline.ts`
- Modify: `scripts/reindex-shadow.ts`
- Modify: `scripts/cleanup-abandoned-reindex-generations.ts`
- Modify: `supabase/schema.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `tests/reindex-pipeline.test.ts`
- Modify: `tests/reindex-shadow.test.ts`
- Modify: `tests/supabase-schema.test.ts`

**Step 1: Add lifecycle RED tests**

Pin these invariants:

- at most one active generation per document;
- reindex promotion locks an already-active document and validates its exact baseline pointer, state, candidate generation, plan, evaluation, recovery, and authorization-manifest digests;
- `GO` is necessary but insufficient without an authorized promote manifest;
- reindex promotion cannot perform first publication and retains the previous generation without deleting it;
- rollback restores the exact retained pointer and retains the failed candidate;
- rollback remains usable after recovery-evidence freshness expires but still validates the promotion-bound evidence digest;
- active or not-yet-expired retained generations cannot be cleaned; and
- cleanup requires exact document/generation pairs, exact count, manifest digest, and explicit apply mode;
- cleanup can call only the private deletion core, and that core cannot mutate an active pointer; and
- only promotion, receipt-bound rollback, and the later trusted-activation wrapper can call the pointer transition core.

Run:

```text
node scripts/run-vitest.mjs run tests/reindex-generation-lifecycle.test.ts tests/reindex-pipeline.test.ts tests/reindex-shadow.test.ts tests/supabase-schema.test.ts
```

Expected RED: generation operations and retained-state cleanup guards are absent.

**Step 2: Implement pure promotion and cleanup assertions**

```ts
export function assertPromotableShadowGeneration(input: {
  plan: ShadowReindexPlanV1;
  stageReceipt: ShadowReindexStageReceiptV1;
  report: ShadowReindexReportV1;
  actualStateDigests: Readonly<Record<string, string>>;
}): void {
  if (input.report.decision.decision !== "GO") throw new Error("shadow evaluation did not pass");
  if (input.plan.digest !== input.report.planDigest) throw new Error("plan digest mismatch");
  if (input.stageReceipt.digest !== input.report.stageReceiptDigest) throw new Error("stage receipt mismatch");
  if (input.plan.candidateGenerationId !== input.stageReceipt.candidateGenerationId)
    throw new Error("candidate generation mismatch");
  for (const document of input.plan.documents) {
    if (input.actualStateDigests[document.documentId] !== document.expectedStateDigest)
      throw new Error(`state changed for ${document.documentId}`);
  }
}
```

Add `planDocumentGenerationCleanup`, which accepts only `abandoned` or retention-expired non-active rows, stable-sorts exact pairs, and emits a digest-bound dry-run plan.

```ts
export type DocumentGenerationCleanupPlanV1 = Readonly<{
  version: 1;
  projectRef: string;
  targets: readonly Readonly<{ documentId: string; generationId: string }>[];
  expectedCount: number;
  createdAt: string;
  digest: `sha256:${string}`;
}>;
```

**Step 3: Implement append-only lifecycle SQL**

The migration creates append-only `document_index_generation_operations`, a unique partial index enforcing one active generation, a private fixed-search-path pointer-only `transition_document_index_generation_core`, and a separate private fixed-search-path `delete_document_index_generations_core`; neither core has API-role grants. Only narrow wrappers may call them:

```text
promote_shadow_document_generation
rollback_document_index_generation
cleanup_document_index_generations
```

`promote_shadow_document_generation` requires an existing active baseline matching the shadow plan, so it cannot first-publish a staging document. It changes that baseline to `retained`, activates the exact staged candidate, and records the receipt atomically through the pointer core. Rollback is a receipt-bound wrapper around that same pointer core. Cleanup defaults to dry-run, refuses active, premature-retained, unknown, count-mismatched, or manifest-mismatched targets, and may call only the deletion core after rechecking that no target is active. The deletion core cannot update an active pointer or generation state. The script is import-safe and has no broad all-eligible apply mode. No generic pointer-mutating or deletion core is granted to an API role.

**Step 4: Run GREEN**

```text
node scripts/run-vitest.mjs run tests/reindex-generation-lifecycle.test.ts tests/reindex-pipeline.test.ts tests/reindex-shadow.test.ts tests/supabase-schema.test.ts
npm run check:migration-role
npm run check:function-grants
```

Expected: lifecycle tests pass with prior pages/chunks/artifacts still available after activation and rollback.

**Step 5: Review and checkpoint**

Reviewers: `supabase-schema-guardian` and `ingestion-worker-reviewer`. Suggested local checkpoint message: `feat(reindex): retain rollback generations`.

---

## Task 6: Replace operator guidance with the exact dry-run lifecycle

**Audit acceptance requirements (under current authority and unit gates):** F11/F15: define admitted, processing, extracted, indexed, technically eligible, active, kernel evidence available and available to Answer as distinct states. An inferred recent view cannot claim queue emptiness. Document actionable failure/repair reasons and policy-bound retention. Keep the C02 runbook gate; defer only final UI-specific wording until U11 behaviour is known, with a recorded owner.

Document U05's `privateObjectReferenceInventory` as non-authoritative, with `physicalDeletionAuthorized: false`. Its cleanup receipt covers exact SQL artifact rows only. Physical storage disposal requires a separate manifest revalidating current rights and live/shared/new references at deletion time; U13 owns the recovery/cleanup proof. Explain the U10 gate dependency and manifest-bound retention deadlines without inventing a fixed retention policy.

**Files:**

- Modify: `docs/reindex-runbook.md`
- Modify: `docs/reindex-shadow-harness-design.md`
- Modify: `docs/ingestion-state-machine.md`
- Modify: `docs/worker-deploy-runbook.md`
- Modify: `docs/disaster-recovery-runbook.md`
- Modify: `docs/search-rag-master-context.md`

**Step 1: Update the canonical sequence**

Document exactly: audit -> local plan -> authorized stage -> exact-generation evaluate -> authorized promote -> observation -> receipt-bound rollback if required -> delayed manifest-bound cleanup. Distinguish worker image rollback from document-generation rollback. State that a connected dry run is still a connected operation.

**Step 2: Record crash windows and recovery truth**

Cover lease loss before stage completion, process death after complete artifact writes but before the atomic receipt/activation-or-task finalizer, finalizer transaction failure, process death after atomic activation, rollback after recovery-evidence expiry, and cleanup interruption. State explicitly that a trusted-admission job cannot become completed between artifact writes and receipt-bound activation or task creation. Keep PITR and Storage restore evidence separate.

**Step 3: Run documentation checks**

```text
npm run docs:check-links
npm run docs:check-scripts
npm run docs:check-index
npm run docs:check-inventory
git diff --check
```

Expected: all documentation references resolve and no destructive/default-live command is presented as source-only.

**Step 4: Review and checkpoint**

Reviewer: `clinical-governance-reviewer`. Suggested local checkpoint message: `docs(reindex): define targeted generation waves`.

### Core-ingestion tranche review after C02

Obtain independent `ingestion-worker-reviewer`, `supabase-schema-guardian`, and `rag-retrieval-reviewer` verdicts on the full C01-through-C02 range in bounded parallel waves. Reuse eligible unit inspection under the shared-review rule; retain a distinct tranche verdict and assess cross-unit integration. Require one processor, generation-aware enrichment reads, non-destructive summaries, token-fenced mutations, bounded repair, a real non-committing stage path, generation-addressed pages, one candidate generation per wave, baseline/candidate population identity, digest-bound promotion, exact retained rollback, delayed cleanup, and no connected execution. Correct findings in one packet, inspect the corrections and affected dependencies, and issue the corrected whole-tranche verdict with unchanged reviewed evidence explicitly reused. Reconcile schema, types, and drift for the C01/C02 migrations once the corrected range is stable.

### Trusted Task 0 entry gate

Before Task 7 integration or formal acceptance, verify that accepted C01/C02 heads are ancestors of the current head and that their source/dependency identities still cover these prerequisites. Reuse the recorded passing checks for unchanged inputs; execute only missing or changed coverage from the fallback below. Ancestry alone, a failed historical exception or a DEFER verdict is not proof. The final dry-run is needed only if its selected scope/tooling changed or has not already been established:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/reindex-shadow.test.ts tests/reindex-generation-lifecycle.test.ts tests/supabase-schema.test.ts
npm run check:edge:functions
npm run check:migration-role
npm run verify:pr-local -- --dry-run --files src/app/api/upload/route.ts,src/lib/trusted-document-admission.ts,supabase/schema.sql
```

Expected: the retired function/config/invoker remain absent; the sole processor, anchored summary, lease token, staged-generation, activation, rollback, and cleanup contracts exist. This gate makes no product change. Stop if any prerequisite is missing.

---

## Task 7: Unify administrator and backend admission under one durable event

**Corrected local completion — 13 September 2026:** product `e55614203649f240c19e7fa7e91c0aa453661bda` closes the reopened U07-R1 metadata-authority and U07-R2 uncertain-retry defects; 218 composed correction passes, clean focused compilation and independent schema/ingestion/clinical review. [U07 evidence](../rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U07-evidence.md) retains the initial `9918841ee520c4d82287ce229b07a5e14b208171` acceptance, its 265 historical passes, failed attempts and the separate SQL-runtime, hosted, provider and production acceptance boundaries. The steps below remain the retained implementation contract; U08 is unstarted.

**Audit acceptance requirements (under current authority and unit gates):** F10/F01: admission records explicit source role/authority, rights/currentness, owner/staging identity, policy/purpose and supported features; never derive authority from document prose. Preserve the distinct backend capability and human administrator/MFA/recent-reauth requirement. Establish where assurance is enforced before duplicating controls. Prove idempotent event creation, invalid-template/insufficient-assurance/user denial and trusted-service cases offline. Hosted enforcement remains separate.

R1 distinguishes primary preference from restriction and requires passage readiness. RAG owns request resolution; admission owns source/access/policy authority. H1/H2/H7 do not enable international sources or treat link-only catalogue entries as factual evidence.

**Files:**

- Create: `src/lib/trusted-document-admission.ts`
- Create: `tests/trusted-document-admission.test.ts`
- Create: `tests/trusted-document-admission-schema.test.ts`
- Create: `supabase/migrations/20260831104000_create_document_admission_events.sql`
- Modify: `src/app/api/upload/route.ts`
- Modify: `scripts/import-documents.ts`
- Modify: `src/lib/publication-manifest.ts`
- Modify: `supabase/schema.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `tests/upload-admission.test.ts`
- Modify: `tests/upload-duplicate-cleanup-ledger.test.ts`
- Modify: `tests/storage-upload-compensation.test.ts`
- Modify: `tests/private-access-routes.test.ts`
- Modify: `tests/publication-manifest.test.ts`
- Modify: `tests/function-grants.test.ts`

**Step 1: Add RED actor, replay, and authority tests**

```ts
export type TrustedAdmissionActor =
  | Readonly<{ kind: "administrator"; administratorId: string }>
  | Readonly<{ kind: "trusted_backend"; principal: string }>;

export type TrustedAdmissionInput = Readonly<{
  actor: TrustedAdmissionActor;
  sourceChannel: "admin_api" | "backend_import";
  documentId: string;
  stagingOwnerId: string;
  contentSha256: `sha256:${string}`;
  storagePath: string;
  originalFileName: string;
  mimeType: string;
  byteCount: number;
  correlationId: string;
  admissionPolicyVersion: string;
}>;

export type TrustedDocumentAdmission = Readonly<{
  documentId: string;
  stagingOwnerId: string;
  sourceChannel: "admin_api" | "backend_import";
  contentSha256: `sha256:${string}`;
  fileNameSha256: `sha256:${string}`;
  storagePathSha256: `sha256:${string}`;
  mimeType: string;
  byteCount: number;
  correlationId: string;
  admissionPolicyVersion: string;
}>;

export type TrustedAdmissionRpcPayload = Readonly<{
  document_id: string;
  staging_owner_id: string;
  source_channel: "admin_api" | "backend_import";
  content_sha256: `sha256:${string}`;
  file_name_sha256: `sha256:${string}`;
  storage_path_sha256: `sha256:${string}`;
  mime_type: string;
  byte_count: number;
  correlation_id: string;
  admission_policy_version: string;
}>;
```

Test that an ordinary user, missing admin claim, wrong staging owner, generic service-role caller, unknown backend principal, wrong backend capability, replay with changed metadata, raw filename/path audit storage, direct table insert, and duplicate active content are rejected. Test exact replay returns the same document/admission/job identities without another job.

Run:

```text
node scripts/run-vitest.mjs run tests/trusted-document-admission.test.ts tests/trusted-document-admission-schema.test.ts tests/function-grants.test.ts tests/private-access-routes.test.ts
```

Expected RED: the shared contract and protected admission wrappers do not exist, and upload/import still own separate writes.

**Step 2: Implement pure admission construction**

`createTrustedDocumentAdmission` validates canonical identifiers, size/type bounds, actor/channel compatibility, exact policy version, content hash, and correlation ID. It emits filename and Storage-path SHA-256 digests for audit and keeps raw values only in the bounded private RPC input needed to create the object row.

```ts
export function toTrustedDocumentAdmissionRpcPayload(admission: TrustedDocumentAdmission): TrustedAdmissionRpcPayload {
  return Object.freeze({
    document_id: admission.documentId,
    staging_owner_id: admission.stagingOwnerId,
    source_channel: admission.sourceChannel,
    content_sha256: admission.contentSha256,
    file_name_sha256: admission.fileNameSha256,
    storage_path_sha256: admission.storagePathSha256,
    mime_type: admission.mimeType,
    byte_count: admission.byteCount,
    correlation_id: admission.correlationId,
    admission_policy_version: admission.admissionPolicyVersion,
  });
}
```

**Step 3: Implement two narrow SQL wrappers and one private core**

The migration creates append-only admission events and a private admission core that atomically creates or reuses the document, event, and ingestion job under a content-digest lock.

- `admit_administrator_document` runs in authenticated context, derives `auth.uid()`, verifies the administrator claim and matching staging owner, and never accepts a caller-supplied administrator identity.
- `admit_backend_document` accepts a configured principal plus high-entropy capability. It compares the capability digest inside a fixed-search-path `SECURITY DEFINER` wrapper against a principal table on which `service_role` has no direct `SELECT`, `INSERT`, `UPDATE`, or `DELETE` grant.
- The private core has no grant to API roles. Exact replay is idempotent; conflicting replay fails closed.

Backend-principal provisioning is a C07 connected operation. Source-only tests seed synthetic transaction-local fixtures and never expose capability values.

**Step 4: Route both adapters through the same contract**

Replace the upload route's direct `create_uploaded_document_with_ingestion_job` ownership and the importer's separate document/job inserts. Preserve upload compensation when Storage succeeds but admission fails. Retain v1 RPC compatibility only as a denied or delegating wrapper with no new authority.

**Step 5: Run GREEN**

```text
node scripts/run-vitest.mjs run tests/trusted-document-admission.test.ts tests/trusted-document-admission-schema.test.ts tests/upload-admission.test.ts tests/upload-duplicate-cleanup-ledger.test.ts tests/storage-upload-compensation.test.ts tests/private-access-routes.test.ts tests/publication-manifest.test.ts tests/function-grants.test.ts
npm run check:migration-role
npm run check:function-grants
```

Expected: both trusted channels share one atomic event; arbitrary service role and ordinary users cannot admit; tests use no live Storage or database.

**Step 6: Review and checkpoint**

Reviewers: `supabase-schema-guardian` and `clinical-governance-reviewer`. Suggested local checkpoint message: `feat(ingestion): unify trusted admission`.

---

## Task 8: Quarantine unsafe input before any provider egress

**Audit acceptance requirements (under current authority and unit gates):** F01/F10: current content-bound safety, owner, rights, policy and purpose clearance precedes every actual caption, embedding and enrichment producer, including fallback/retry/cache paths. Enqueue-time approval alone is insufficient. Test denied/revoked-after-enqueue/stale/unsafe/late-content inputs with zero provider spy calls, plus a cleared positive and revocation before finalisation. Rejection must remain actionable without reopening an unguarded fallback. No real disclosure or universal sanitisation guarantee is inferred.

**Files:**

- Create: `src/lib/document-ingress-safety.ts`
- Create: `tests/document-ingress-safety.test.ts`
- Create: `tests/document-provider-egress-gate.test.ts`
- Modify: `src/lib/upload-structure.ts`
- Modify: `src/lib/privacy.ts`
- Modify: `src/lib/env.ts`
- Modify: `worker/main.ts`
- Modify: `worker/row-contracts.ts`
- Modify: `src/lib/validation/row-contracts.ts`
- Modify: `src/app/api/upload/route.ts`
- Modify: `scripts/import-documents.ts`
- Modify: `tests/upload-structure.test.ts`
- Modify: `tests/privacy.test.ts`
- Modify: `tests/extracted-document-validation.test.ts`
- Modify: `tests/ingestion.test.ts`
- Modify: `tests/indexing-v3-agent.test.ts`
- Modify: `docs/rag-improvement/data-flow-register.md`

**Step 1: Add RED hard-gate and call-order tests**

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

export type ProviderEgressBinding = Readonly<{
  admissionEventId: string;
  documentId: string;
  generationId: string;
  contentSha256: `sha256:${string}`;
}>;

export type DocumentIngressSafetyResult =
  | Readonly<{
      verdict: "pass";
      binding: ProviderEgressBinding;
      policyVersion: string;
      checks: readonly string[];
      evidenceDigest: string;
    }>
  | Readonly<{
      verdict: "quarantine";
      binding: ProviderEgressBinding;
      policyVersion: string;
      codes: readonly IngressHardGateCode[];
      evidenceDigest: string;
    }>;

export interface DocumentScanner {
  scan(input: {
    bytes: Uint8Array;
    mimeType: string;
    contentSha256: string;
  }): Promise<{ verdict: "clean" | "malware" | "unavailable"; scannerVersion: string }>;
}
```

Test clean, unavailable, malicious, active-content, encrypted, identifier, hidden/native-text conflict, Healthdirect, eTG/AMH protected, disallowed licence, and source-policy mismatch cases. For every failing case, injected caption, embedding, summary, and deep-memory spies remain at zero calls. Add cross-document, cross-admission, stale-generation, changed-content-hash, and wrong-provider-purpose permit reuse tests; each must throw before its provider spy runs.

Run:

```text
node scripts/run-vitest.mjs run tests/document-ingress-safety.test.ts tests/document-provider-egress-gate.test.ts
```

Expected RED: there is no opaque permit and at least one worker provider branch can be reached without it.

**Step 2: Implement one reusable local safety evaluation**

```ts
const providerEgressPermitBrand = Symbol("provider-egress-permit");
export type ProviderEgressPurpose = "caption" | "embedding" | "summary" | "deep_memory";

export type ProviderEgressPermit = Readonly<{
  binding: ProviderEgressBinding;
  evidenceDigest: string;
  policyVersion: string;
  purpose: ProviderEgressPurpose;
  [providerEgressPermitBrand]: true;
}>;

function assertExactProviderEgressBinding(actual: ProviderEgressBinding, expected: ProviderEgressBinding): void {
  if (
    actual.admissionEventId !== expected.admissionEventId ||
    actual.documentId !== expected.documentId ||
    actual.generationId !== expected.generationId ||
    actual.contentSha256 !== expected.contentSha256
  )
    throw new Error("provider egress binding mismatch");
}

export function assertProviderEgressAllowed(
  result: DocumentIngressSafetyResult,
  expectedBinding: ProviderEgressBinding,
  purpose: ProviderEgressPurpose,
): ProviderEgressPermit {
  assertExactProviderEgressBinding(result.binding, expectedBinding);
  if (result.verdict !== "pass") throw new Error("provider egress denied");
  return Object.freeze({
    binding: Object.freeze({ ...result.binding }),
    evidenceDigest: result.evidenceDigest,
    policyVersion: result.policyVersion,
    purpose,
    [providerEgressPermitBrand]: true as const,
  });
}

export function assertProviderEgressPermit(
  permit: ProviderEgressPermit,
  expectedBinding: ProviderEgressBinding,
  purpose: ProviderEgressPurpose,
): void {
  if (permit[providerEgressPermitBrand] !== true || permit.purpose !== purpose)
    throw new Error("provider egress permit purpose mismatch");
  assertExactProviderEgressBinding(permit.binding, expectedBinding);
}
```

Run order is bytes/download -> scanner and active-content/source-policy checks -> one local extraction/OCR result -> identifier and hidden-text comparison -> permit -> captions/embeddings/summaries. Reuse that extraction result; do not OCR twice. Upload/import perform the pre-Storage checks available at admission, and the worker repeats all current-policy checks before egress.

Make every provider wrapper accept the expected admission/document/generation/content binding plus `ProviderEgressPermit`, and call `assertProviderEgressPermit` at runtime before egress. Add an architecture test that inventories calls to `classifyAndCaptionImageFromBase64`, `embedTexts`, `upsertDocumentEnrichment`, and `upsertDocumentDeepMemory` and requires the permit at each call site.

**Step 3: Run GREEN**

```text
node scripts/run-vitest.mjs run tests/document-ingress-safety.test.ts tests/document-provider-egress-gate.test.ts tests/upload-structure.test.ts tests/privacy.test.ts tests/extracted-document-validation.test.ts tests/ingestion.test.ts tests/indexing-v3-agent.test.ts
```

Expected: all fail-closed cases quarantine before provider spies; no real scanner or provider executes.

**Step 4: Review and checkpoint**

Reviewers: `ingestion-worker-reviewer` and `clinical-governance-reviewer`. Suggested local checkpoint message: `feat(ingestion): quarantine unsafe provider egress`.

---

## Task 9: Persist reproducible page-level OCR and layout evidence

**Audit acceptance requirements (under current authority and unit gates):** F03-F07/F12/F16: extend existing supported producers, not formats. Actual E1-E7 serialized fixtures preserve critical atoms, row/header/unit/footnote and image/caption relationships, hrefs, late material and source family. Preserve DOCX native relationships and XLSX formula/cached-result/format distinctions without evaluation/fetch; separate preview from full repository evidence. Version persisted coordinates/mappings; resolve real spans after Unicode/whitespace transforms. Independently account for every cap/skip/failed unit and native/OCR disagreement. Reproduce heuristic normalisation concerns before changing behaviour. Preserve originals; optional interpretation is not verified evidence. Full effective cache context is specified here; U13 owns reuse integration.

R2/R3/R5 require supported paraphrase versus invented nonnumeric causal relations, late-source evidence, typed fallback capabilities and the shared source-to-answer reference case. Preserve originals outside bounded summaries. Supplier proof ends at resolved evidence; RAG owns every displayed-claim check.

**Files:**

- Create: `tests/ocr-evidence-contract.test.ts`
- Modify: `worker/python/extract_pdf_assets.py`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/extractors/document.ts`
- Modify: `worker/main.ts`
- Modify: `worker/shadow-extraction.ts`
- Modify: `src/lib/index-quality.ts`
- Modify: `tests/pdf-extractor.test.ts`
- Modify: `tests/pdf-extraction-budget.test.ts`
- Modify: `tests/index-quality.test.ts`
- Modify: `tests/worker-shadow-extraction.test.ts`
- Modify: `tests/docling-lab-contract.test.ts`
- Modify: `eval/docling/fixtures/manifest.v1.json`
- Modify: `eval/docling/harness/score.py`
- Modify: `eval/docling/report/lab-config.json`
- Modify: `eval/docling/report/lab-contract.mjs`
- Modify: `eval/docling/report/gate-b-decision-record.template.json`

**Step 1: Add RED extraction-evidence tests**

```ts
export type PageExtractionEvidence = Readonly<{
  extractor: Readonly<{ name: string; version: string; configurationDigest: string }>;
  ocr: null | Readonly<{
    engine: string;
    version: string;
    languages: readonly string[];
    orientationDegrees: number | null;
    confidenceMean: number | null;
    confidenceP10: number | null;
    lowConfidenceWordCount: number;
    evidenceObjectPath: string | null;
    evidenceSha256: string | null;
  }>;
  imageCoverage: number;
  needsReview: boolean;
  warnings: readonly string[];
}>;

export type TrustedExtractionInput = Readonly<{
  documentId: string;
  generationId: string;
  contentSha256: string;
  admittedStoragePath: string;
  extractionPolicyVersion: string;
}>;
```

Test native-text pages, OCR pages, mixed pages, blank pages, malformed confidences, inconsistent object path/digest, unsupported language/orientation values, critical numeric low-confidence spans, table ancestry, and generation/original-hash lineage.

Run:

```text
node scripts/run-vitest.mjs run tests/ocr-evidence-contract.test.ts tests/pdf-extractor.test.ts tests/pdf-extraction-budget.test.ts tests/index-quality.test.ts tests/worker-shadow-extraction.test.ts tests/docling-lab-contract.test.ts
```

Expected RED: the Python extractor emits only text for OCR and the TypeScript contract lacks reproducibility fields.

**Step 2: Emit and validate structured OCR evidence**

Replace `image_to_string` with bounded `image_to_data` processing. Compute orientation, language set, mean and P10 confidence, low-confidence word count, preprocessing/configuration digest, engine version, and content hash. Do not place unbounded word geometry in row metadata.

Persist bounded evidence in generation-addressed `document_pages.metadata`. Store compressed word/geometry evidence in a private generation-addressed object only when required, and persist its object path plus SHA-256. Retrieval units carry document, generation, unit, page, span/geometry, heading/table ancestry, corpus/role/content mode, source policy, original hash, and pipeline versions.

**Step 3: Apply deterministic class-specific promotion rules**

`assessDocumentIndexQuality` evaluates page coverage, reading order, tables, critical numeric OCR uncertainty, and lineage as independent hard gates. `runShadowExtraction` records class metrics but cannot override a hard failure through an average score.

**Step 4: Run GREEN**

```text
node scripts/run-vitest.mjs run tests/ocr-evidence-contract.test.ts tests/pdf-extractor.test.ts tests/pdf-extraction-budget.test.ts tests/index-quality.test.ts tests/worker-shadow-extraction.test.ts tests/docling-lab-contract.test.ts
npm run check:docling-lab
```

Expected: synthetic fixtures pass and the Docling contract validates. Do not run the full model-asset lab.

**Step 5: Review and checkpoint**

Reviewer: `ingestion-worker-reviewer`. Suggested local checkpoint message: `feat(ingestion): persist reproducible OCR evidence`.

---

## Task 10: Evaluate hard gates and atomically activate or queue the exact generation

**Audit acceptance requirements (under current authority and unit gates):** F03/F06/F08/F09: consume generation-bound completeness, safety, source/permission, support/limitation and fencing verdicts. Unknown or critically incomplete evidence cannot pass its relevant hard gate. Optional unsupported enrichment is withheld without deleting usable originals. Pass one immutable verdict to U05's activation mechanism or create the durable U11 task; no competing switch or clinical-approval inference. Test incomplete/capped/conflicted/stale artifacts and all-writer atomicity, with actual SQL proof separately authorised.

Replace U05's private, always-refusing `require_document_generation_technical_gate_v1` with authoritative immutable technical-receipt resolution for every exact document/generation and expected digest. Caller-supplied `GO`, scalar digests, or historical promotion receipts are insufficient. Preserve validation before replay, private grants, the single pointer core, and refusal of absent, stale, mismatched, withdrawn or superseded evidence. Add focused producer/consumer proof and separately authorised SQL race/role proof before claiming activation works.

R3 keeps typed extraction/provider cause, capability/completeness, authority and support distinct through finalisation. Optional enrichment failure preserves sound originals; no partial path bypasses a hard gate.

**Files:**

- Create: `src/lib/document-technical-eligibility.ts`
- Create: `tests/document-technical-eligibility.test.ts`
- Create: `supabase/migrations/20260831105000_add_document_technical_activation.sql`
- Create: `tests/trusted-document-activation-schema.test.ts`
- Modify: `worker/main.ts`
- Modify: `worker/types.ts`
- Modify: `worker/row-contracts.ts`
- Modify: `src/lib/index-quality.ts`
- Modify: `src/lib/publication-manifest.ts`
- Modify: `supabase/schema.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `tests/publication-manifest.test.ts`
- Modify: `tests/source-review-schema.test.ts`
- Modify: `tests/function-grants.test.ts`
- Modify: `tests/index-quality.test.ts`
- Modify: `tests/ingestion-mutation-safety.test.ts`
- Modify: `tests/worker-behavior.test.ts`
- Modify: `tests/worker-run-loop.test.ts`
- Modify: `tests/worker-row-contract.test.ts`
- Modify: `tests/reindex-pipeline.test.ts`
- Modify: `tests/reindex-generation-lifecycle.test.ts`
- Modify: `tests/supabase-schema.test.ts`
- Modify: `scripts/sql/verify-publication-approval.sql`

**Step 1: Add RED hard-gate tests**

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

type TechnicalEvidenceBindingV1 = Readonly<{
  version: "document-generation-technical-evidence-v1";
  jobId: string;
  documentId: string;
  generationId: string;
  admissionEventId: string;
  policyVersion: string;
  stateDigest: `sha256:${string}`;
  evidenceDigest: `sha256:${string}`;
}>;

export type DocumentGenerationTechnicalEvidenceV1 =
  | Readonly<
      TechnicalEvidenceBindingV1 & {
        verdict: "activate";
        codes: readonly [];
        receiptDigest: `sha256:${string}`;
      }
    >
  | Readonly<
      TechnicalEvidenceBindingV1 & {
        verdict: "technical_review";
        codes: readonly [TechnicalHardGateCode, ...TechnicalHardGateCode[]];
        receiptDigest: `sha256:${string}`;
      }
    >;

export type FinalizeTrustedDocumentIngestionInput = Readonly<{
  jobId: string;
  documentId: string;
  generationId: string;
  admissionEventId: string;
  workerId: string;
  leaseToken: string;
  receipt: DocumentGenerationTechnicalEvidenceV1;
}>;
```

Test every code individually, multiple simultaneous failures, stable code ordering and receipt digest, one hard failure amid otherwise strong metrics, a foreign or stale active writer, state change after evaluation, duplicate exact activation, conflicting activation, and failure preserving the prior active generation. Prove the exact current job/worker/lease-token owner is accepted for finalization while a stale token, foreign owner, second claim, or claim rotation is rejected. Prove both verdict branches persist the same complete job/document/generation/admission/policy/state/evidence binding; `activate` has exactly zero codes, and `technical_review` has at least one canonical code. Add worker tests proving normal processing finalizes without moving the active pointer early and that receipt persistence, activation-or-task creation, and job completion happen without an unleased interval. Add schema tests proving only the private transition core changes the active pointer; first activation and reindex promotion are narrow wrappers; the old direct commit/promotion signatures have no executable API-role grant; direct `service_role` evidence-table insertion is denied; and manually changing a task status cannot erase hard-gate evidence.

Run:

```text
node scripts/run-vitest.mjs run tests/document-technical-eligibility.test.ts tests/trusted-document-activation-schema.test.ts tests/function-grants.test.ts tests/source-review-schema.test.ts
```

Expected RED: evaluator, durable technical tasks, and trusted activation authority are absent.

**Step 2: Implement the pure evaluator**

`evaluateTechnicalEligibility` consumes only exact job, admission, safety, extraction, index, generation, source-policy, currentness, lease, and state-digest evidence. Its lease input names the expected current job, worker, and lease token. That exact owner is the required finalizer and does not produce `active_writer_present`; the code means a different, additional, stale, or otherwise non-owning claim exists. It returns `DocumentGenerationTechnicalEvidenceV1` for both outcomes. `evidenceDigest` is the canonical aggregate digest of those exact immutable inputs without storing the raw lease token; `receiptDigest` is the canonical digest of every receipt field except itself. It canonicalizes codes before hashing, so reevaluating identical evidence produces the same receipt digest. Missing or ambiguous evidence yields `technical_review`; no confidence average can erase a hard code.

**Step 3: Implement durable tasks and lifecycle authority in one coherent migration**

Create append-only `document_generation_technical_evidence` and persist one immutable receipt row for every evaluator outcome, including successful activation candidates and technical-review outcomes. The row contains the complete `DocumentGenerationTechnicalEvidenceV1` binding, canonical codes, receipt digest, and database-recorded timestamp; it permits no update or delete path. Revoke direct `INSERT`, `UPDATE`, and `DELETE` from `service_role` and all API roles: only the lease-fenced finalization function may append a receipt. Create persistent, privacy-minimized `document_technical_review_tasks` with opaque IDs, document/generation IDs, the current technical-evidence receipt ID, fixed gate codes, priority, lifecycle, assignment, optimistic version, receipt digest, and bounded diagnostics. Do not store document text.

Add fixed-search-path RPCs:

```text
upsert_document_technical_review_tasks
mutate_document_technical_review_task
request_document_technical_reprocess
finalize_trusted_document_ingestion
activate_trusted_document_generation
withdraw_trusted_document
```

`activate_trusted_document_generation` and the evidence/task insertion helpers are private, ungranted functions invoked only by the lease-fenced finalizer (or, for later reindex promotion, by that task's separately authorized wrapper). Use the receipt-bound public mutation signatures:

```text
request_document_technical_reprocess(task_id, expected_version, technical_evidence_receipt_id, reason_code, idempotency_key)
finalize_trusted_document_ingestion(job_id, document_id, generation_id, admission_event_id, worker_id, lease_token, submitted_receipt)
```

Neither exposes independent caller-supplied state, evidence, case-set, or population digest parameters. The finalizer accepts the complete typed receipt but treats it as a claim: under row locks it reconstructs the exact server-owned job/document/generation/admission/policy/state/evidence binding, canonical codes, and digests before appending anything. `mutate_document_technical_review_task` permits assignment only; it cannot clear codes or resolve evidence. A task reaches `reprocessing` only through `request_document_technical_reprocess`, which locks the task/version, requires the supplied receipt ID to equal the task's current immutable receipt, derives and verifies its exact state digest and document/generation binding, creates or returns one idempotency-keyed `ingestion_jobs` row bound to the task/receipt/generation/reason, and appends the canonical Task 3 repair audit. A task becomes `resolved` only when a newer successful evidence receipt supersedes it or withdrawal closes it.

`finalize_trusted_document_ingestion` is the sole normal-worker terminal authority for a trusted-admission job. In one transaction it locks the job, document, generation, and admission; requires `status = 'processing'` plus the exact Task 3 `(job_id, document_id, worker_id, lease_token)` claim; rejects claim rotation, a foreign/additional active writer, or state drift; reconstructs and validates the submitted receipt; and appends it. For `activate`, it calls the private `activate_trusted_document_generation`, which requires an empty code set, current policy, and exact current state/evidence binding, then delegates the pointer change to Task 5's private `transition_document_index_generation_core`. For `technical_review`, it requires a non-empty code set and invokes the private task upsert. The same transaction then marks the job complete and clears its claim. There is no release-before-activation/task window. Any failure rolls back all receipt, pointer/task, and completion writes while retaining the still-current claim for the existing failure/retry path.

For the server-owned `shadow_reindex` operation mode from Task 4, the same finalizer retains the deliberately different lifecycle: it appends the validated receipt and completes the exactly claimed shadow job but leaves the generation staged and ineligible. It never calls the pointer core in that mode; later `promote_shadow_document_generation` consumes the exact successful receipt set plus the GO/recovery/manifest authority. The caller cannot select or override operation mode. A technical-review verdict in either mode writes the receipt and task atomically before completing the job.

The exact current owning lease is required and is not itself an activation failure. The finalizer rejects only stale, foreign, additional, unknown, or rotated claims regardless of mutable task status. Activation is idempotent only for the exact generation and receipt digest. Case-set and population digests belong to C06 offline acceptance and shadow-wave comparison, not per-document activation. Failure retains staging and the prior active source. `complete_ingestion_job` is changed to reject trusted-admission jobs requiring technical finalization, so the worker cannot create a completed-but-unactivated gap through the older generic route.

Replace `promote_shadow_document_generation` so its final form also requires an exact set of successful technical-evidence receipt IDs covering every document in the candidate population while retaining its already-active baseline, GO-report, recovery, and operation-manifest requirements. Retire the worker's old pointer-mutating normal completion: it writes all generation-addressed artifacts under its lease while the generation remains staged, evaluates their completeness, and uses the atomic finalizer above. Revoke or drop API-role execution of the old `commit_document_index_generation` pointer-mutating path. In the final schema, only `activate_trusted_document_generation`, strengthened `promote_shadow_document_generation`, and receipt-bound rollback can invoke the private transition core; there is no generic alternate activation route.

Withdrawal validates exact active generation and state digest, makes the source ineligible, writes an append-only event, and invalidates affected snapshot/cache eligibility in the same transaction. Cleanup remains asynchronous and cannot restore eligibility.

**Step 4: Wire the worker after exact generation completion**

After all generation-addressed artifact writes and completeness evidence succeed, the generation remains staged and the worker evaluates once while retaining its exact current claim. It calls `finalize_trusted_document_ingestion` once with `FinalizeTrustedDocumentIngestionInput`. The worker never inserts the receipt, invokes activation/task helpers, clears the lease, or completes the job directly. For a normal trusted-admission job the RPC atomically persists the receipt, activates or creates/updates the review task, and completes the job; for a persisted shadow job it atomically persists the receipt, leaves the generation staged, creates/updates a review task when required, and completes the job for later authorized promotion. Lease loss, claim rotation, or state drift rejects the whole transaction; neither branch may construct or substitute receipt fields inside SQL.

**Step 5: Run GREEN**

```text
node scripts/run-vitest.mjs run tests/document-technical-eligibility.test.ts tests/trusted-document-activation-schema.test.ts tests/publication-manifest.test.ts tests/source-review-schema.test.ts tests/function-grants.test.ts tests/index-quality.test.ts tests/ingestion-mutation-safety.test.ts tests/worker-behavior.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/reindex-pipeline.test.ts tests/reindex-generation-lifecycle.test.ts tests/supabase-schema.test.ts
npm run check:migration-role
npm run check:owner-scope
```

Expected: exact eligible generations activate in synthetic SQL/source tests; ineligible generations create tasks; no live migration or document operation occurs.

**Step 6: Review and checkpoint**

Reviewers: `supabase-schema-guardian`, `ingestion-worker-reviewer`, and `clinical-governance-reviewer`. Suggested local checkpoint message: `feat(ingestion): activate technically eligible generations`.

---

## Task 11: Replace inferred quality results with a persistent administrator queue

**Audit acceptance requirements (under current authority and unit gates):** F10/F11: replace bounded inferred results with durable task identity and complete authorised pagination. Define a cursor snapshot/order and count semantics that cannot skip or duplicate tasks during updates. Include >200 documents/>80 tasks, older tasks and backend-owned tasks. Repair actions are stage-specific, assured and fenced; dismissal never waives safety/fidelity/clinical gates. Retain full administrator UI and focused browser acceptance; no API-only scope reduction is selected.

**Files:**

- Create: `src/app/api/ingestion/quality/tasks/[id]/route.ts`
- Create: `tests/ingestion-quality-task-route.test.ts`
- Create: `tests/ingestion-quality-console.dom.test.tsx`
- Create: `tests/ui-ingestion-quality.spec.ts`
- Modify: `src/app/api/ingestion/quality/route.ts`
- Modify: `src/components/clinical-dashboard/document-manager-contracts.ts`
- Modify: `src/components/clinical-dashboard/clinical-dashboard-payloads.ts`
- Modify: `src/components/clinical-dashboard/DocumentManagerPanel.tsx`
- Modify: `src/components/ClinicalDashboard.tsx`
- Modify: `tests/ingestion-quality-route.test.ts`
- Modify: `tests/document-admin.dom.test.tsx`
- Modify: `tests/api-route-coverage.test.ts`
- Modify: `tests/api-validation-contract.test.ts`

**Step 1: Read the installed Next 16 contracts**

Read completely:

```text
node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md
docs/wiring-conventions.md
```

**Step 2: Add RED route and pagination tests**

```ts
export type TechnicalTaskPage = Readonly<{
  items: readonly IngestionTechnicalTask[];
  nextCursor: string | null;
  counts: Readonly<Record<TechnicalTaskStatus, number>>;
}>;

export type TechnicalTaskMutation = Readonly<{
  action: "assign" | "reprocess" | "withdraw";
  expectedVersion: number;
  assigneeId?: string | null;
  reason?: string;
}>;
```

Test administrator-only access, bounded `limit`, invalid cursor/filter rejection, stable ordering by priority descending then creation time and ID ascending, no duplicates across cursor pages, complete traversal beyond 200 tasks, optimistic-version conflicts, bounded reprocess/withdraw reasons, exact targeted reprocess idempotency, and absence of both manual resolve and clinical-approval actions. An attempted `resolve` payload must be rejected and must not change task codes, evidence, or lifecycle.

Run:

```text
node scripts/run-vitest.mjs run tests/ingestion-quality-route.test.ts tests/ingestion-quality-task-route.test.ts tests/ingestion-quality-console.dom.test.tsx tests/document-admin.dom.test.tsx tests/api-route-coverage.test.ts tests/api-validation-contract.test.ts
```

Expected RED: GET still infers and truncates at 80, UI truncates at 12, and the mutation route is absent.

**Step 3: Implement the persistent page and mutation adapters**

GET accepts `cursor`, `limit`, `status`, `gateCode`, and `assignee`, queries the Task 10 table through a narrowly granted RPC, and returns `TechnicalTaskPage`. The cursor is an opaque versioned encoding of the exact sort tuple. PATCH parses `TechnicalTaskMutation`; assignment delegates to the assignment-only task RPC, `reprocess` delegates to Task 10's exact `request_document_technical_reprocess` authority, and `withdraw` calls the one withdrawal authority. Reprocess remains open or reprocessing until superseding successful evidence arrives; no administrator action can clear hard-gate evidence or mark the task resolved.

Remove `buildReviewItems`, `.slice(0, 80)`, and `.slice(0, 12)`. The dashboard loads the first page, exposes filters/counts, appends or replaces pages without duplicate IDs, and renders assign/reprocess/withdraw actions with transient native-disabled states. It never renders manual resolve or clinical approval controls.

**Step 4: Run GREEN and typecheck**

```text
node scripts/run-vitest.mjs run tests/ingestion-quality-route.test.ts tests/ingestion-quality-task-route.test.ts tests/ingestion-quality-console.dom.test.tsx tests/document-admin.dom.test.tsx tests/api-route-coverage.test.ts tests/api-validation-contract.test.ts
npm run typecheck
```

Expected: focused route/DOM tests and typecheck pass.

**Step 5: Run one focused browser journey**

```text
npm run ensure
node scripts/run-playwright.mjs tests/ui-ingestion-quality.spec.ts --project=chromium
```

Use the URL printed by `ensure`. The journey stubs administrator/task/document/reprocess APIs, crosses the 200-task boundary, exercises all three actions, checks that neither manual resolve nor approval controls exist, and covers desktop plus phone widths.

**Step 6: Review and checkpoint**

Reviewers: `frontend-ui-reviewer` and `supabase-schema-guardian`. Suggested local checkpoint message: `feat(ingestion): add durable technical review queue`.

---

## Task 12: Add the structurally default-off public retrieval kernel and withdrawal proof

**Audit acceptance requirements (under current authority and unit gates):** F03/F07/F12/F13: add a versioned candidate-plus-evidence resolver returning original text/structure/qualifications, exact versioned anchors, policy/role/currentness, source family and support/limitation/invalidation identity from one immutable snapshot. Unavailable/stale/withdrawn evidence fails closed without substitution. Exercise actual upload, approved-source and repository producers. Source and derivative are one corroboration family; independent evidence stays distinct. Preserve public-only scope, Healthdirect exclusion, eTG/AMH link-only rules, P05/P06 authority and structural default-off. Record the separate RAG consumer handoff; this unit does not wire ordinary Answer.

R1–R5 in the evidence-handoff contract bind this unit. Safe independent evidence may be retained only with complete snapshot/access/qualification binding; unknown/mismatched snapshots fail the whole request. Reviewed conflict inputs need a governance creation/review/persistence/loading/expiry owner. An empty list is not proof of no conflict. Ingestion owns source bindings; separate RAG owners own request scope, packing, composition, DTOs, every displayed claim, follow-up and delivery.

**Files:**

- Create: `src/lib/rag/source-ingestion-retrieval.ts`
- Create: `supabase/migrations/20260831106000_add_source_ingestion_retrieval_kernel.sql`
- Create: `tests/source-ingestion-retrieval.test.ts`
- Create: `tests/source-ingestion-retrieval-schema.test.ts`
- Create: `tests/source-ingestion-retrieval-default-off.test.ts`
- Create: `tests/staging-document-retrieval-exclusion.test.ts`
- Create: `tests/document-withdrawal-propagation.test.ts`
- Modify: `src/lib/owner-scope.ts`
- Modify: `src/app/api/documents/[id]/route.ts`
- Modify: `supabase/schema.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `tests/owner-scope.test.ts`
- Modify: `tests/retrieval-access-scope.test.ts`
- Modify: `tests/function-grants.test.ts`
- Modify: `tests/document-mutation-routes.test.ts`
- Modify: `tests/source-review-policy.test.ts`
- Modify: `src/lib/rag/rag-eval-cases.ts`
- Modify: `scripts/fixtures/rag-retrieval-golden.json`
- Modify: `scripts/fixtures/rag-adversarial-cases.v1.json`
- Modify: `tests/rag-eval-cases.test.ts`
- Modify: `tests/rag-adversarial-fixtures.test.ts`
- Assert unchanged and unreferenced: `src/lib/rag/rag.ts`
- Assert unchanged and unreferenced: `src/app/api/answer/route.ts`
- Assert unchanged and unreferenced: `src/app/api/answer/stream/route.ts`
- Assert unchanged and unreferenced: `src/app/api/search/route.ts`
- Assert unchanged and unreferenced: `src/lib/rag/rag-answer-support.ts`
- Assert unchanged and unreferenced: `src/lib/rag/rag-cache.ts`

**Step 1: Add RED source-scope and default-off tests**

```ts
export const SOURCE_INGESTION_RETRIEVAL_KERNEL_VERSION = "source-ingestion-retrieval-v1" as const;

export type SourceIngestionRetrievalResult =
  | Readonly<{
      verdict: "ready";
      namespace: string;
      candidates: readonly SourceIngestionCandidate[];
    }>
  | Readonly<{
      verdict: "partial";
      namespace: string;
      candidates: readonly SourceIngestionCandidate[];
      unresolved: readonly { reason: "material_conflict" | "evidence_unavailable"; conflictIds: readonly string[] }[];
    }>
  | Readonly<{
      verdict: "insufficient";
      namespace: string;
      reason: "no_evidence" | "snapshot_mismatch" | "material_conflict";
      conflictIds: readonly string[];
    }>;

export type SourceIngestionCandidateCommon = Readonly<{
  candidateId: string;
  indexUnitId: string;
  chunkId: string | null;
  pageNumber: number | null;
  spanStart: number | null;
  spanEnd: number | null;
  originalSha256: string;
  policyVersion: string;
  sourceRole: ClinicalSourceRole;
  contentMode: Extract<SourceContentMode, "indexed_content">;
  conflictFamilyId: string | null;
}>;

export type SourceIngestionCandidate =
  | (SourceIngestionCandidateCommon &
      Readonly<{
        corpusScope: "uploaded_local";
        documentId: string;
        generationId: string;
        activationReceiptId: string;
      }>)
  | (SourceIngestionCandidateCommon &
      Readonly<{
        corpusScope: "clinical_kb_site";
        logicalId: string;
        releaseId: string;
        releaseDigest: string;
        changeEpoch: string;
        registryVersion: string;
      }>)
  | (SourceIngestionCandidateCommon &
      Readonly<{
        corpusScope: "australian_public";
        sourceKey: string;
        sourceVersionId: string;
        indexGeneration: string;
        releaseDigest: string;
      }>);
```

Test exact active uploaded generation, active site release/change epoch, active governed Australian version, anonymous/user/administrator public candidate-ID parity, every discriminated lineage field above, review-due/superseded/withdrawn/staging/private/link-only/excluded/non-canonical exclusion before ranking, material-conflict refusal, zero legacy cache access, and synchronous withdrawal exclusion. Add the source-ingestion retrieval, conflict-family, protected-content, parity, and default-off synthetic cases to the existing RAG fixture owners in this task so C06 does not introduce later behavior changes.

`tests/source-ingestion-retrieval-default-off.test.ts` statically walks production imports and fails if `src/lib/rag/rag.ts`, Answer routes, search routes, or answer-support modules import `source-ingestion-retrieval` or call its RPC.

Run:

```text
node scripts/run-vitest.mjs run tests/source-ingestion-retrieval.test.ts tests/source-ingestion-retrieval-schema.test.ts tests/source-ingestion-retrieval-default-off.test.ts tests/staging-document-retrieval-exclusion.test.ts tests/document-withdrawal-propagation.test.ts
```

Expected RED: source-only kernel/RPC are absent and withdrawal route does not use the new authority.

**Step 2: Freeze the public-only access scope and namespace**

```ts
import { ragContextSnapshotCacheKey } from "./rag-context-snapshot";
import type { ResolvedRagContextSnapshot } from "./rag-context-snapshot";
import type { SourceContentMode } from "../australian-source-catalogue";
import type { ClinicalSourceRole } from "../types";

export interface SourceIngestionRetrievalAdapter {
  matchSourceIngestionCandidates(input: {
    query: string;
    snapshot: ResolvedRagContextSnapshot;
    limit: number;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export function governedPublicRetrievalAccessScope() {
  return Object.freeze({
    includePublic: true as const,
    corpusScopes: Object.freeze(["uploaded_local", "clinical_kb_site", "australian_public"] as const),
  });
}

export function sourceIngestionCandidateNamespace(snapshot: ResolvedRagContextSnapshot): string {
  return `${SOURCE_INGESTION_RETRIEVAL_KERNEL_VERSION}:${ragContextSnapshotCacheKey(snapshot)}`;
}

export type ResolveActiveSharedClinicalCandidates = (args: {
  adapter: SourceIngestionRetrievalAdapter;
  query: string;
  snapshot: ResolvedRagContextSnapshot;
  limit: number;
  signal?: AbortSignal;
}) => Promise<SourceIngestionRetrievalResult>;
```

Implement `resolveActiveSharedClinicalCandidates` with `ResolveActiveSharedClinicalCandidates`. The kernel accepts an injected adapter, a normalized query, exact immutable `ResolvedRagContextSnapshot`, bounded limit, and optional abort signal. It performs no cache read/write. It returns `insufficient` for empty evidence or a mismatched/unknown snapshot. Materially conflicting evidence is never ready. A `partial` result requires non-empty independently eligible candidates and explicit unresolved reasons in the same complete immutable snapshot; prove the candidates share no affected claim, required qualification or authority dependency with the excluded group. If safe partition is not proved, return insufficient. Consumers preserve limitations and never infer no conflict from missing reviewed inputs.

**Step 3: Implement the service-only snapshot-bound RPC**

Patch-port only final corrected public-scope, sanitization, lineage, and test patterns from `0f9a52f22^..03d68b3a1`; rewrite every join for the C02 generation ledger and Task 10 activation authority.

The RPC joins:

- `uploaded_local` to the exact active document generation and trusted activation receipt;
- `clinical_kb_site` to the exact active site release and change epoch; and
- `australian_public` to the exact active governed source version.

It returns document, generation, chunk/index-unit, page/span, original-hash, policy, corpus, role, content-mode, release/version, and conflict-family lineage. Original/derivative family rows collapse without double-counting; a site derivative cannot overrule its uploaded parent. It is fixed-search-path and service-role-only.

Do not port broad subquestion allocation, supplementary/international ranking, rollout cohorts, canary logic, or `rag.ts` integration.

**Step 4: Wire withdrawal without serving integration**

For an active shared source, `DELETE /api/documents/[id]` calls Task 10's exact withdrawal RPC. Private idle staging retains its existing delete behavior. The response acknowledges eligibility removal separately from asynchronous cleanup.

**Step 5: Run GREEN and static access gates**

```text
node scripts/run-vitest.mjs run tests/source-ingestion-retrieval.test.ts tests/source-ingestion-retrieval-schema.test.ts tests/source-ingestion-retrieval-default-off.test.ts tests/staging-document-retrieval-exclusion.test.ts tests/document-withdrawal-propagation.test.ts tests/owner-scope.test.ts tests/retrieval-access-scope.test.ts tests/function-grants.test.ts tests/document-mutation-routes.test.ts tests/source-review-policy.test.ts tests/rag-eval-cases.test.ts tests/rag-adversarial-fixtures.test.ts
npm run check:migration-role
npm run check:owner-scope
```

Expected: public technical retrieval and full lineage pass; ordinary buffered Answer remains unchanged and cannot reach the kernel.

**Step 6: Review and checkpoint**

Reviewers: `rag-retrieval-reviewer`, `supabase-schema-guardian`, and `clinical-governance-reviewer`. Suggested local checkpoint message: `feat(rag): add default-off ingestion retrieval`.

---

## Task 13: Plan selective reprocessing and close recovery/incident controls

**Audit acceptance requirements (under current authority and unit gates):** F05/F09/F16: stage-selective repair and reuse require exact source/artifact/owner/policy identity and current attempt/generation. Key image cache from the same complete canonical model-visible request/settings, not a 900-character prefix when longer context is sent. Test tail-context invalidation, exact-input reuse, model/prompt/detail/schema/policy changes and revoked/cross-owner refusal. Reuse P06 unchanged-content authority without clipped-preview identity. Page reuse, batching and concurrency expansion require measured bottlenecks and failure-isolation evidence; no broad cache framework is a prerequisite to correct extraction.

R3/R4 bind replacement, withdrawal and policy changes to invalidation of evidence, fallback reuse and reviewed-difference references. Missing review remains unknown. H3/H4 cover dependent exclusion and independent safe evidence.

**Files:**

- Create: `src/lib/document-reprocessing.ts`
- Create: `scripts/audit-document-pipeline-versions.ts`
- Create: `scripts/plan-document-reprocessing.ts`
- Create: `tests/document-pipeline-version-audit.test.ts`
- Modify: `src/lib/ingestion-audit.ts`
- Modify: `src/lib/reindex-pipeline.ts`
- Modify: `scripts/reindex-shadow.ts`
- Modify: `scripts/cleanup-abandoned-reindex-generations.ts`
- Modify: `tests/reindex-pipeline.test.ts`
- Modify: `tests/reindex-shadow.test.ts`
- Modify: `tests/reindex-generation-lifecycle.test.ts`
- Modify: `tests/storage-cleanup-safety.test.ts`
- Modify: `tests/ingestion-recovery.test.ts`
- Modify: `docs/reindex-runbook.md`
- Modify: `docs/openai-rag-operations.md`
- Modify: `docs/ingestion-state-machine.md`
- Modify: `docs/rag-improvement/data-flow-register.md`

**Step 1: Add RED version-audit and recovery tests**

```ts
export type SelectiveReprocessingManifest = Readonly<{
  version: 1;
  auditDigest: `sha256:${string}`;
  targetVersions: DocumentPipelineTargetVersions;
  documents: readonly Readonly<{
    documentId: string;
    expectedStateDigest: string;
    baselineGenerationId: string | null;
    action: "metadata_only" | "targeted_reprocess" | "shadow_reindex";
    reasonCodes: readonly IngestionAuditReason[];
    estimatedPages: number;
    estimatedProviderCalls: number;
    rollbackGenerationId: string | null;
  }>[];
  digest: `sha256:${string}`;
}>;
```

Test stable selection, no-op current documents, metadata-only changes, extraction/index version changes, missing expected-state digest, unsupported reason, provider-call estimate bounds, exact rollback pointer, retry exhaustion into the existing dead-letter state, active/retained cleanup refusal, worker death leaving only generation-addressed temporary paths, and interrupted cleanup remaining ineligible for reactivation.

Run:

```text
node scripts/run-vitest.mjs run tests/document-pipeline-version-audit.test.ts tests/reindex-pipeline.test.ts tests/reindex-shadow.test.ts tests/reindex-generation-lifecycle.test.ts tests/storage-cleanup-safety.test.ts tests/ingestion-recovery.test.ts
```

Expected RED: the selective version planner and CLI are absent.

**Step 2: Extend the canonical classifier rather than creating another**

Add pipeline-version evidence to `IngestionDocumentAudit`, `auditDocument`, and `assertAuditTargetState`. Preserve accepted action precedence and existing reason values. `planDocumentReprocessing` consumes those audits and target versions, stable-sorts documents, emits the least invasive action, binds state and rollback identities, and hashes the complete manifest.

**Step 3: Add dry-run-only CLIs**

`audit-document-pipeline-versions.ts` reads a supplied offline inventory. `plan-document-reprocessing.ts` accepts only `--audit`, `--target-versions`, and `--out`. Neither CLI has an apply flag, client construction, provider adapter, or hosted fallback.

Reuse C02 staging/evaluation/promotion/rollback/cleanup primitives. Do not add a second reindex driver, cleanup owner, or audit vocabulary.

**Step 4: Update incident and restore guidance**

Document targeted reprocessing, worker-kill recovery, rapid withdrawal, exact rollback, cleanup delay, PITR versus Storage restore, and source-only versus connected evidence. Never include document text in an incident record.

**Step 5: Run GREEN and documentation checks**

```text
node scripts/run-vitest.mjs run tests/document-pipeline-version-audit.test.ts tests/reindex-pipeline.test.ts tests/reindex-shadow.test.ts tests/reindex-generation-lifecycle.test.ts tests/storage-cleanup-safety.test.ts tests/ingestion-recovery.test.ts
npm run docs:check-scripts
npm run docs:check-links
```

Expected: deterministic dry-run manifests and recovery fixtures pass; no connected adapter runs.

**Step 6: Review and checkpoint**

Reviewers: `ingestion-worker-reviewer` and `supabase-schema-guardian` for any cleanup/RPC delta. Suggested local checkpoint message: `feat(ingestion): plan selective lifecycle repairs`.

### Trusted-ingestion tranche review after C05

Obtain independent `clinical-governance-reviewer`, `supabase-schema-guardian`, `ingestion-worker-reviewer`, `rag-retrieval-reviewer`, and `frontend-ui-reviewer` verdicts on the full C03-through-C05 range in bounded waves, each constrained to its specialist surface. Where matching inputs and prerequisites permit, share inspection with the final unit and C06 review; retain a separately labelled tranche verdict and all integration questions. Require:

- one administrator/backend admission core with non-spoofable channel authority and exact replay semantics;
- zero provider egress before all local gates pass;
- reproducible generation-bound extraction evidence;
- fail-closed technical activation or durable task creation;
- exhaustive cursor pagination with no 80/12 truncation and no approval control;
- public caller parity, staging/private/withdrawn exclusion, full lineage, conflict refusal, and ordinary-Answer default-off proof; and
- dry-run-only selective reprocessing with exact rollback and cleanup owners.

Return one combined correction packet; correct with one writer per affected file/interface, inspect corrections and affected dependencies, and issue the corrected whole-tranche verdict using unchanged reviewed evidence. Reconcile schema, types, and drift once for the C03/C04 migrations after corrections are stable.

## C06 evidence extension from the audit

F13-F15: inspect the owning-unit E1-E7 actual-producer records and all F01-F16 dispositions; no unresolved Critical/Important requirement may disappear through ownership mapping. Separate positive fidelity, safe refusal, static/caller proof, native extraction, SQL schedules, provider, hosted and clinical evidence. Local SQL not run means concurrency remains unproved, even with static source completion. Preserve the existing full-range review and required C06 selector; the historical U02 exit-1 exception cannot satisfy it. C07 and the separately implemented ordinary Answer handoff remain unclosed.

## C06: Whole-continuation acceptance

Trusted Task 8 is an acceptance gate, not a fourteenth behavior unit.

**Step 1: Verify the owning-task acceptance matrix without changing behavior**

C06 is read-only apart from its evidence records. Verify that the already reviewed Task 7-13 ranges contain synthetic cases proving:

- administrator/backend admission and ordinary-user denial;
- scanner/identifier quarantine with zero provider calls;
- dose-table or critical-numeric OCR uncertainty refusal;
- private/staging exclusion and exact activation;
- review-due, superseded, withdrawn, link-only, excluded, and non-canonical exclusion;
- anonymous/user/administrator candidate-ID parity;
- Healthdirect exclusion and eTG/AMH protected-content rejection;
- exact lineage, conflict-family handling, cache invalidation, lease recovery, dead-letter behavior, and duplicate-activation protection;
- queue completeness beyond 200 rows; and
- ordinary buffered Answer inability to invoke the source-ingestion kernel.

Task 7 owns admission/ordinary-user-denial cases; Task 8 owns scanner/identifier/no-provider cases; Task 9 owns OCR/table cases; Task 10 owns activation/lease/idempotency cases; Task 11 owns queue-scale cases; Task 12 owns retrieval/parity/protected-content/lineage/default-off RAG fixtures; and Task 13 owns recovery/dead-letter/cleanup cases. If any case is absent, reopen that owning task, add and review it there, then return to C06. Do not make a late C06 fixture change, create another vocabulary, or run a provider comparison.

**Step 2: Run the focused acceptance selector once**

Before executing this fallback, perform Step 3's dry-run and arbiter selection. When the selected RUN gate demonstrably includes these tests and the fixture/offline gates, execute that gate once and reuse its constituent results here. Otherwise run only uncovered coverage below; a deferred gate supplies no passing proof. Keep this fallback complete if the broad gate is not run or its coverage changes. The offline wrapper performs fixture validation and includes rag-adversarial-fixtures, so neither is repeated separately.

```text
node scripts/run-vitest.mjs run tests/trusted-document-admission.test.ts tests/document-ingress-safety.test.ts tests/document-provider-egress-gate.test.ts tests/ocr-evidence-contract.test.ts tests/document-technical-eligibility.test.ts tests/ingestion-quality-route.test.ts tests/ingestion-quality-task-route.test.ts tests/source-ingestion-retrieval.test.ts tests/staging-document-retrieval-exclusion.test.ts tests/document-withdrawal-propagation.test.ts tests/document-pipeline-version-audit.test.ts tests/rag-eval-cases.test.ts
npm run eval:rag:offline
```

Expected: all source-only cases pass with zero hard violations. If a covered selector already has an unchanged successful receipt, report the reused receipt instead of rerunning it.

**Step 3: Select one broad local handoff gate**

```text
npm run verify:pr-local -- --dry-run
npm run arbiter -- verify:pr-local
```

If the arbiter says `RUN`, execute `npm run verify:pr-local` exactly once. If it says `DEFER` or `PROVEN`, record that exact verdict and evidence. Do not stack `verify:cheap`, full tests, lint, typecheck, build, or UI after the selected gate unless a distinct uncovered failure class is identified.

**Step 4: Perform final whole-range reviews**

Obtain independent xhigh `clinical-governance-reviewer`, `supabase-schema-guardian`, `rag-retrieval-reviewer`, and `ingestion-worker-reviewer` verdicts against the immutable C00-base-through-C05-head package. Reuse suitable independent specialists and eligible inspection from the trusted tranche; each must still judge the complete final range and its additional integration questions. Obtain `verification-router` coverage when selecting the gate, reusing that verdict at closure if inputs are unchanged rather than dispatching the same check twice. Any Critical or Important finding reopens the owning product task and requires its authorised correction commit. Fresh review covers corrections and affected dependencies; the final whole-range verdict explicitly incorporates unchanged valid proof instead of rereading every unchanged file. Broaden fresh inspection only where the change invalidates that proof.

**Step 5: Record source completion and residuals**

`C06-acceptance.md` may state `SOURCE_COMPLETE` only when all 13 task reviews, both tranche reviews, final reviews, focused acceptance, selected handoff evidence, migration uniqueness, schema/type/drift reconciliation, and documentation checks pass at exact heads.

`C07-connected-residuals.md` must remain unclosed and list:

- hosted project and migration-history inspection;
- authoritative hosted type generation and drift comparison;
- migration application and grant/RLS verification;
- backend admission capability provisioning;
- real scanner, OCR/model-asset, upload, Storage, and document processing;
- worker/edge deployment;
- exact shadow stage/evaluation, provider calls, promotion, observation, rollback drill, and cleanup;
- activation/withdrawal against live data;
- PITR, database backup, Storage backup, and isolated restore evidence;
- `npm run check:production-readiness` under explicit approval;
- provider canary and end-user Answer integration; and
- deployment and production observation.

No C07 item is implied by source completion.

## Final self-review checklist for this plan

- Every approved design objective maps to a numbered task or C06 acceptance item.
- Every deferred parent behavior appears only in C07 or the design's non-goals.
- All seven migration names are exact, ordered, and guarded by preflight.
- All 13 behaviour units retain meaningful defect/requirement proof, required passing coverage, immutable range, independent specialist review, correction rules and local checkpoint identity. Remaining units use narrow iterative RED/GREEN and exact proof reuse, not repeated full selectors.
- Both integration verdicts (core after C02, trusted after C05) and the final whole-range verdict remain required; eligible shared inspection avoids duplicate review work without merging away their scopes or prerequisites.
- C06 is read-only apart from evidence records; every synthetic case is added and reviewed in its owning Task 7-13 range.
- Schema/types/drift reconciliation occurs once per stable migration tranche.
- The only browser run is the focused queue journey.
- The only broad local handoff run is arbiter-selected `verify:pr-local`.
- No command processes documents, calls providers, reaches hosted Supabase, applies migrations, deploys, activates, withdraws, reindexes, cleans up, pushes, or publishes.
- `src/lib/rag/rag.ts` and ordinary Answer/search serving remain outside the implementation diff.
- `npm run check:production-readiness` remains explicit C07 work because the saved flightplan classifies it as connected/approval-gated.
