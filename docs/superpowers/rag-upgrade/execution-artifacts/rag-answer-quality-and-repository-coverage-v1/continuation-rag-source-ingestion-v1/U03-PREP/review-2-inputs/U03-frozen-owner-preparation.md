# U03 frozen owner preparation

All repository source below was read through `git show` / `git grep` at **ae500cafc661d9a06536d09d73d827726f057ffa**. The supplied `U03-frozen-task-context.md` was read first. No moving U02 source, repository writes, tests, SQL, documents, providers or untracked enumeration were used. This is preparation for a reviewed U03 brief, not a new contract freeze or acceptance.

## Owner / producer / consumer / test inventory

Line references are to the frozen commit. Existing tests named below identify useful owners; they are not claims of attempt-fencing coverage or passing execution.

| Seam and concrete producer | Mutation / downstream consumer | Existing proof owner and U03 implication |
| --- | --- | --- |
| Node claim: `worker/main.ts:436` `claimJobs`, `:456` rejected-row handler; `worker/row-contracts.ts`; `worker/types.ts`; SQL `claim_ingestion_jobs` at `supabase/schema.sql:1113` | Claim rows become `JobRow`; malformed claimed rows may be terminally failed using narrowed identity. Current failure identity omits an attempt token. | `tests/worker-row-contract.test.ts:96,197` checks parsing, valid siblings, untrustworthy identity and preserving prior indexed state. Add required UUID attempt identity and rejection behavior; do not invent an identity to fail a malformed claimed row. |
| Node progress: `worker/main.ts:104` `updateJob`, `:116` `updateJobProgress`, extraction heartbeat at `:1785`, shadow heartbeat at `:1966` | Direct `ingestion_jobs` update; progress requires current worker ownership but not a durable attempt token. Shadow progress failures are swallowed before later metadata writes. | `tests/worker-runtime-control.test.ts` covers stop/sleep/signals; `tests/worker-run-loop.test.ts:88,116` covers stop/drain/no new claim. Neither establishes stale mid-job write refusal. `tests/worker-shadow-extraction.test.ts:470` explicitly pins the old fail-open shadow progress behavior: a concrete contract conflict to resolve before changing it. |
| Node document/metadata: `worker/main.ts:157` `updateDocument`, final metadata at `:2046`, strict-completion repair metadata at `:2060` | Direct document status update; `apply_document_metadata_patch`; missing-RPC read/merge/write fallback; final quality/repair/shadow/version metadata consumed by strict completion and repair scheduling. | `tests/worker-behavior.test.ts:50,66` checks repair decision semantics; `tests/worker-shadow-extraction.test.ts` checks aggregate transport. U03 must bind both ordinary and fallback writes to current attempt/generation/policy and retain U02 field ownership. |
| Node terminal/siblings: `worker/main.ts:203` `markSupersededSiblingJobs`, `:222` `updateBatch`, `:260` `completeJob`, `:306` `completeStrictEnrichmentJob`, `:339` `failOrRetryJob` | Generic/strict completion RPCs; missing-schema completion and failure fallbacks; document demotion; sibling completion; derived `import_batches` status fallback. SQL `complete_ingestion_job` at `schema.sql:2337` marks sibling pending/processing/failed jobs complete, while the JS sibling fallback restricts `locked_by IS NULL`. | `tests/worker-behavior.test.ts:5,22,39`; `tests/worker-visual-capture.test.ts:57,66`; run-loop failure handling tests. Preserve retry budget and prior indexed data, but reconcile SQL/JS sibling eligibility. Caller success/false-result behavior and terminal writes need explicit attempt tests. |
| Node base artifacts: `worker/main.ts:547` reset; `:552` generation commit; `:600` quality upsert; `:890` image upload/caption; `:1436` document embedding fields; `:1475` chunks/fields/table facts/index units | `reset_document_index`; Storage upload and compensation; inserts into `document_images`, `document_chunks`, `document_embedding_fields`, `document_table_facts`, `document_index_units`; direct quality upsert; pages/quality/pointer commit. SQL fenced overload `schema.sql:1974` currently checks job/document/processing/worker, not a token. | `tests/worker-visual-capture.test.ts:8,43,99` covers vector guards, unavailable commit RPC and generation-scoped uploads; `tests/storage-upload-compensation.test.ts` owns exact-path cleanup. U03 must inventory pre-commit writes as well as the final RPC; final-pointer fencing alone does not prevent stale artifact writes. |
| Node summary/labels: `src/lib/document-enrichment.ts:807` `persistProjectedLabels`, `:836` `upsertDocumentEnrichment`; Node caller `worker/main.ts:1913` | Summary upsert by document, marker-false repair, per-label upsert/delete, projection-complete marker, and owned metadata patch. Generation is validated from supplied/live-read authority before these separate mutations, not an atomic claim predicate on each write. | `tests/document-enrichment.test.ts:979,1012,1077,1143,1212,1277` owns preservation, partial-label retry, projection repair, metadata retry and manual organization authority. This file/test pair is absent from the old U03 file list: explicitly review adding its persistence seam after U02 freeze; preserve the corrected formatting contract. |
| Node deep memory: `src/lib/deep-memory.ts:668` `upsertDocumentDeepMemory`; Node caller `worker/main.ts:1928` | Producer-owned staging into sections/cards/index units, artifact-generation cleanup `:770`, `commit_document_deep_memory_generation` `:842`, then `rag_aliases` upsert `:874`. RPC arguments bind document/producer/artifact generation but no ingestion attempt. | `tests/deep-memory.test.ts:699,788`; `tests/deep-memory-transaction-sql.test.ts`. Existing code deliberately never cleans after commit invocation because a lost response may mean commit succeeded. Do not break this recovery rule. This persistence owner and tests also need an explicit U03 scope decision. |
| Edge claim/stages: `supabase/functions/indexing-v3-agent/index.ts:49` `ClaimedJob`, `:2318` claim, `:571` `stageStart`, `:587` `stageFinish` | Separate `indexing_v3_agent_jobs` claim; stage insertion by job/document and update by stage id alone. Claimed shape lacks durable attempt identity; the handler's worker ID is not carried in that shape. | `tests/indexing-v3-agent.test.ts` is the Edge contract owner. `tests/worker-run-loop.test.ts:27,45` protects batch continuation when processing/failure handling throw. Decide a token contract for the separate Edge job table, not just `ingestion_jobs`. |
| Edge summary / generated artifacts: `index.ts:700` `persistSourceAnchoredSummary`, `:777` `ensureSummary`, `:1000` labels, `:1261` sections, `:1358` cards, `:1480` section units, `:1625` visuals, `:1816` core fields, `:1868` quality | Summary/labels written together in a transaction, including provisional fallback; generated family replacements/deletes, image enrichment, vectors and quality use generation visibility. A generation filter/transaction is not durable attempt fencing. | `tests/indexing-v3-agent.test.ts:352,467,1112` owns generation-bound writes/cleanup and transaction grouping; `:1204` onward owns summary/currentness/zero-label fallback. Extend those real ownership seams while retaining provisional semantics and manual labels. |
| Edge terminal/failure: `index.ts:2034` `updateAgentJobStatus`, `:2071` defer, `:2110` complete, `:2133` failure | Status RPC currently takes document/status/error/next-run; defer/failure first update document metadata by document id, then agent status; strict completion lacks token. | `tests/indexing-v3-agent.test.ts:955,973,1023,1054,1142` covers retry/defer/strict result parsing. Require zero stale side effects across both statements and no claim release preceding successful finalization. |
| SQL repair/publication: `schema.sql:4529` and later replacement `:7152` `repair_strict_enrichment_gate_batch`; strict completion `:4780`; metadata patch/deep-memory and base commit RPCs | Repair scans eligible documents and changes quality, metadata and jobs. It is not a bounded expected-state-digest plan. Latest schema function definitions and applicable migrations determine shipped behavior; do not edit only an earlier duplicate body. | `tests/check-indexing-contract.test.ts` protects indexing acceptance vocabulary; `tests/indexing-v3-agent.test.ts` covers completion/repair decisions, not runtime SQL interleavings. U03 owns deterministic plan/audit and retirement or replacement of arbitrary repair; U04/U05/U10/U13 own later lifecycle execution. |
| Cache / egress seam: `worker/main.ts:706` request-context identity, `:772` cache read, `:841` cache write; caption/embedding calls before late enrichment preflight | `image_caption_cache` writes/reuse, provider-bound work and eventual persisted image metadata; source-policy and attempt cancellation must bound continued work. | Reuse ING-F01/F16 findings. `tests/worker-visual-capture.test.ts:72,81` covers existing cache versions/redaction. U03 must expose the current-attempt guard seam; full cache-key repair remains U09/U13 and complete pre-egress clearance U07/U08. Do not silently expand U03 into model-visible-context redesign. |

## Decisions required before U03 dispatch

These are unclosed contract decisions, not instructions to implement a particular design:

- **All-writer scope:** explicitly include or safely route the Node enrichment and deep-memory persistence/alias seams, Storage compensation, quality writes, stages, Edge job table and terminal metadata. The original four named RPCs do not cover this inventory.
- **Authority tuple and atomicity:** bind job-table identity, job/document, worker, fresh durable token, expected generation, and current source/policy authority at mutation time. Specify transaction/lock ordering, stale refusal result shape, where authoritative policy lives, and what cancellation does during provider/native work. A preflight read or model assertion is insufficient.
- **Sibling and repair semantics:** preserve live siblings; define exactly which unowned jobs may be superseded. Specify missing-RPC refusal instead of fallback authority bypass. Preserve rejected-claim safety and retry limits. Keep repair planning dry-run-only, bounded canonical IDs/reasons/digests, and append-only audit; applying repair is not automatically U03 scope.
- **U02 integration:** wait for accepted U02 correction and rebind final persistence inputs before writing; do not rereview moving code. Preserve its owned metadata keys, exact summary validation, manual labels and provisional fallback.
- **Lifecycle/typed limits:** ING-F06/F09 and adopted R3 require truthful incomplete/optional-failure status and preservation of independent sound evidence. U03 supplies fence/authority seams; it must not prematurely implement U04 staging, U05 activation/rollback, U10 technical eligibility or U13 retention. Preserve the lost-response/no-cleanup deep-memory invariant.
- **Tests:** the six-file historical selector does not cover all newly identified callers. Add exact affected enrichment/deep-memory/visual/shadow/SQL contract tests only after ownership is selected. Runtime SQL schedules, real egress refusal and provider parity remain unproven and separately gated. The existing shadow test's swallowed lease error requires explicit disposition, not silent test weakening.

## Literal guarded-input validator proposal

The original CLI calls `repositoryEntries`, which enumerates and reads untracked files before filtering. Its exported `validateMigrationRoleEntries` performs the actual path/content and immutable-history checks; `isGuardedMigrationRolePath` owns its exact scope. The following **unexecuted proposal** validates all staged guarded inputs after writer freeze, including every newly staged task file, using index blobs. It never enumerates untracked paths or reads protected content. Stage every intended guarded file first and inspect the exact staged file allowlist. This is an index-scoped equivalent, not proof about unstaged/untracked files and not the literal `npm run check:migration-role` invocation.

Run from the verified task root, only after final U03 source freeze and migration reservation is reconciled. If the migration name changes, change the explicit requirement below to its reviewed literal name. Do not relax the validator or immutable hash.

```powershell
@'
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const frozen = "ae500cafc661d9a06536d09d73d827726f057ffa";
const checker = "scripts/check-hosted-migration-role.mjs";
const git = (args) => execFileSync("git", args, {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024,
});
const approvedChecker = git(["show", `${frozen}:${checker}`]);
if (!readFileSync(resolve(root, checker)).equals(approvedChecker)) {
  throw new Error("Checker changed; review the validator before scoped use.");
}
if (!git(["show", `:${checker}`]).equals(approvedChecker)) {
  throw new Error("Staged checker differs from the reviewed validator.");
}
const {
  isGuardedMigrationRolePath,
  validateMigrationRoleEntries,
  IMMUTABLE_HISTORICAL_MIGRATION,
} = await import(pathToFileURL(resolve(root, checker)).href);
const guardedRoots = [
  "AGENTS.md", "package.json", "supabase/schema.sql", "supabase/roles.sql",
  "docs/disaster-recovery-runbook.md", ".github/actions/", ".github/workflows/",
  "scripts/", "supabase/migrations/",
];
const paths = [...new Set(git([
  "ls-files", "--cached", "-z", "--", ...guardedRoots,
]).toString("utf8").split("\0").filter(Boolean))]
  .filter(isGuardedMigrationRolePath).sort();
const required = [
  IMMUTABLE_HISTORICAL_MIGRATION,
  "supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql",
];
for (const name of required) {
  if (!paths.includes(name)) throw new Error(`Required staged input missing: ${name}`);
}
const entries = paths.map((name) => ({ path: name, content: git(["show", `:${name}`]) }));
const failures = validateMigrationRoleEntries(entries, { requireHistorical: true });
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`Scoped staged migration-role PASS: ${entries.length} guarded inputs; immutable history checked.`);
}
'@ | node --input-type=module -
```

Why this retains the relevant gate: the original validator receives every guarded staged tracked path, including new staged files, its original binary handling, reserved-role filename/content rules, and `requireHistorical: true` with the unchanged built-in SHA-256. No `repositoryEntries`/`validateRepository` call occurs. Importing the unchanged module does not invoke its CLI because the module's file path differs from the stdin script invocation. Unmerged index entries or missing blobs fail through Git. Concurrent unstaged changes are intentionally outside this snapshot; the controller must verify the staged candidate matches the reviewed final diff before commit. No claim about undiscovered unrelated untracked guarded files is made.

No proposed validator command was executed. This report is the only authored artifact for this preparation.
