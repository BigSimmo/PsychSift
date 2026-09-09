# U03 verification preparation — frozen checkpoint fd043b262

This is bounded preparation, not implementation, a new audit, a gate result or formal acceptance. I read `U03-frozen-task-context.md` and `U03-frozen-owner-preparation.md` first and reused their writer inventory. The current execution-authority record and canonical `sdd-execution.md` protected bookkeeping section govern this proposal. The controller still owns shared-contract decisions; the SQL specialist owns SQL design.

## Observed identity and limits

- Repository: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Branch: `codex/rag-local-build-20260822`; HEAD: `fd043b262ebd9b20315c2e46bc4838265787fa80`. `git status --short --untracked-files=no` returned no tracked changes at both inspections. No untracked repository inventory was requested.
- Current checkpoint records accepted U02 corrective product `876cb09405d81d9c4a8a4931b3d735fd252934ba`, 103/103 focused tests, and the accepted native Edge equivalent. These are existing recorded results, not executions in this preparation.
- Own observed local route: session `01a07bdb-921b-76e3-8b56-a117e79b539b`; parent `01a07b47-4623-7e90-825a-ec25116b8531`; agent `/root/u03_verification_preparation`; provider `openai`; model `gpt-6-astra`; effort `high`. Selected `session_meta` and first `turn_context` fields were read with shared access from the exact child log `C:/Users/joshs/.codex/sessions/2026/09/07/rollout-2026-09-07T20-33-03-01a07bdb-921b-76e3-8b56-a117e79b539b.jsonl` (timestamps `2026-09-07T12:33:05.324Z`, `2026-09-07T12:33:08.123Z`). This is resolved local configuration, not backend attestation. Its launch cwd was `D:/Repos/Database`; all repository commands here explicitly selected the frozen worktree.
- No test, arbiter, validator, compilation, SQL, provider, network, extraction, worker, install, repository write, commit or recursive agent was run. The only authored file is this report. Missing-path inspection errors concerned guessed checker/receipt filenames; I resolved the module-index filename through `package.json`. They are not product failures or RED evidence.

## Smallest credible behavioural package

The old six-file command is insufficient for complete all-writer fencing. Several existing Edge/visual/shadow tests read source text; they do not execute mutation producers. Keep useful structural guards, but the new RED must invoke actual persistence/producer functions through dependency-injected in-memory clients, with controllable pauses between mutation steps. A mock that merely matches an RPC name or returns `lease_lost` cannot prove SQL atomicity. Do not launch `worker/main.ts` or the Edge request server to get coverage: expose the real orchestration/persistence functions for import without startup side effects, or move the smallest production seam to an approved module and make the runtime call it.

Before dispatch, name those production seam modules in the allowed paths, along with `src/lib/document-enrichment.ts`, `src/lib/deep-memory.ts`, the eventual planner owner, and their tests. Suggested new exact test files are `tests/ingestion-lease-fencing.test.ts` and `tests/ingestion-repair-plan.test.ts`; these are proposals, not existing files or permission to hide production work in tests. A natural planner owner is `src/lib/ingestion-repair-plan.ts`, subject to the controller's contract freeze. Do not choose this path implicitly after RED.

| Real producer seam to exercise | Test owner and minimum failing assertions |
| --- | --- |
| `claimJobs`, rejected-row handling, `worker/row-contracts.ts`, `JobRow` | `worker-row-contract`: required canonical UUID token, absent/malformed token rejected, valid siblings retained, malformed identity cannot manufacture authority for terminal failure. Caller parsing cannot prove SQL rotates tokens; reserve that claim for SQL execution. |
| Node `updateJob`/`updateJobProgress`, extraction/shadow heartbeat, `updateDocument`, metadata RPC and old read/merge/write fallback | New lease-fencing behavioural harness plus `worker-behavior`, `worker-runtime-control`: same worker + token A followed by token B is stale; all supplied generation/source-policy fields reach the producer; `{ok:false,reason:'lease_lost'}`, malformed RPC result and missing RPC produce zero later mutations and no authority-bypassing direct fallback. Inject loss between steps, not just at initial preflight. |
| Node `completeJob`, `completeStrictEnrichmentJob`, `failOrRetryJob`, `markSupersededSiblingJobs`, `updateBatch` | `worker-behavior`, `worker-run-loop`, new harness: stale fail/complete/defer cannot clear/reopen/demote the successor or alter a live sibling; terminal false results are not success. Existing retry budget, preserved indexed state, unrelated batch continuation and stop/no-new-claim assertions remain. |
| Node `reset_document_index`, `commitDocumentIndexGeneration`, quality upsert, chunk/image/field/table-fact/index-unit writers, Storage upload and compensation | New harness, `worker-visual-capture`, `storage-upload-compensation`: loss before each writer refuses subsequent work; staged artifacts belong to the attempt/generation; compensation targets exactly its owned uploaded path, never the successor's path. Preserve vector validation and missing-commit-RPC fail-closed behavior. Storage/provider cancellation is bounded mocked proof, not an atomic database guarantee. |
| `upsertDocumentEnrichment`, `persistProjectedLabels`, projection markers, owned metadata retry | `document-enrichment` plus new harness where needed: pause G1 before each summary/label/marker/metadata step, advance authority to G2, then release G1; no later stale writes. Keep U02 strict source anchoring, exact-generation currentness, manual labels, zero-label provisional fallback, retry repair and ownership of only the five enrichment metadata keys. Never overwrite organization ownership. |
| `upsertDocumentDeepMemory`, generation cleanup, commit, `rag_aliases` upsert | `deep-memory`, `deep-memory-transaction-sql`, new harness: attempt/authority carried through staging, cleanup, commit and alias publication; stale refusal stops aliases; lost commit response never triggers cleanup of possibly committed artifacts. Preserve independent producer generations. SQL text tests are static contract evidence only. |
| Edge claim and `stageStart`/`stageFinish`; summary fallback/persistence; labels, sections, cards, units, visuals, core fields, quality; `updateAgentJobStatus`/defer/complete/fail metadata | `indexing-v3-agent` and new real-producer harness: separate Edge job-table token and worker identity; no token borrowing from Node jobs; refuse each writer including stage finish by stage id, family deletes, fallback summaries and pre-terminal metadata. Abort after stale refusal, with no later provider/native call or status release. Retain manual labels and U02 provisional semantics. |
| `planIngestionRepairs` | New repair-plan suite: 1 and 100 canonical unique document UUIDs accepted; 0/101, duplicate/noncanonical/malformed IDs, missing/extra/malformed state digests, unknown/empty reason sets rejected. Stable document/code sorting produces identical plan digest under permutation; changing any ID/reason/state digest changes it. Version and `dryRun:true` are literal; no apply/execute capability or mutation side effect. Decide duplicate-reason policy explicitly in the brief rather than silently deduplicating undocumented input. |
| Migration/schema/type contracts, repair audit and retirement of arbitrary repair | `check-indexing-contract`, relevant static SQL tests and schema-specialist-owned additions: latest effective definitions, complete guarded surface/grants, no unfenced legacy overload bypass, append-only audit contract and dry-run-only planner. Do not mistake passing source assertions for SQL schedules. |

Recommended literal RED/GREEN command, identical before and after implementation, once the two proposed tests and their production seams are in the reviewed brief:

```powershell
node scripts/run-vitest.mjs run tests/ingestion-lease-fencing.test.ts tests/ingestion-repair-plan.test.ts tests/indexing-v3-agent.test.ts tests/worker-behavior.test.ts tests/worker-run-loop.test.ts tests/worker-runtime-control.test.ts tests/worker-row-contract.test.ts tests/check-indexing-contract.test.ts tests/document-enrichment.test.ts tests/deep-memory.test.ts tests/deep-memory-transaction-sql.test.ts tests/worker-visual-capture.test.ts tests/worker-shadow-extraction.test.ts tests/storage-upload-compensation.test.ts
```

Pin RED to named product assertions: stale A-after-B permits at least one subsequent real producer mutation; one existing producer omits attempt/generation/current policy identity or falls back unsafely; required token parsing is absent; planner behavior is absent. A parser/import/dependency/coordinator error is not RED. Avoid an absent module stopping the entire selector before actual producer assertions run; use an importable test seam and an explicit missing-export assertion for planner absence, or bind an approved separate planner RED selector. Document the actual failing assertions, not simply a nonzero exit.

This same command is the final affected selector after freeze if these remain the exact affected owners. Do not run the historical six-file selector again underneath it. If the migration specialist adds another necessary static SQL test file, or an actual production seam moves into another existing owner, revise the literal selector before RED and retain that revision in the brief. Broaden only for an actual new failure path. No Answer/search suite is selected; historical U02 `eval:rag:offline` failure is not inherited evidence for U03.

### Required shadow-test change

Yes. At current `tests/worker-shadow-extraction.test.ts:470` onward, the test explicitly says to swallow lost lease and matches an empty `.catch()` before shadow execution. That contradicts U03 cancellation/all-writer fencing: the worker can proceed to expensive shadow work and final metadata after authority has moved. Replace that assertion with actual orchestration proof that lease loss skips/stops shadow work and prevents metadata/repair/status writes. Keep the committed generation sound: losing the attempt must not demote, reset or fail that already committed generation, nor rewrite the newer claim. Ordinary optional shadow extraction failure remains separate and may retain its tolerated outcome. This is an explicit supersession of an old contract, not weakening failure handling.

## Safe gate environment and compilation

The canonical protected bookkeeping instructions require process-local `GATE_RECEIPTS=off` and `GATE_ARBITER=off`, restored in `finally`. Inspection confirms `run-vitest.mjs` retains its coordinator and `offlineTestEnvironment`, which scrubs provider variables, uses inert loopback destinations and offline mode. Receipt/arbiter off paths avoid their whole-tree untracked signatures. Before the proposed selector, consult and record the conservative arbiter result:

```powershell
$u03PriorReceipts = [Environment]::GetEnvironmentVariable('GATE_RECEIPTS','Process')
$u03PriorArbiter = [Environment]::GetEnvironmentVariable('GATE_ARBITER','Process')
try {
  $env:GATE_RECEIPTS = 'off'
  $env:GATE_ARBITER = 'off'
  npm run arbiter -- test
  # Run the identical pinned RED/GREEN/final-selector command above here.
} finally {
  [Environment]::SetEnvironmentVariable('GATE_RECEIPTS',$u03PriorReceipts,'Process')
  [Environment]::SetEnvironmentVariable('GATE_ARBITER',$u03PriorArbiter,'Process')
}
```

Expected arbiter disposition is RUN/off safety override, but it was not invoked here. Do not claim a yield-derived decision or reused receipt. Honor coordinator admission/queues; never set CI or force/delete leases. A successful frozen selector is consumed by reviewers, not repeated by each reviewer.

U03 changes required claimed-row fields, persistence signatures, cross-module cancellation/authority types and generated Supabase RPC argument types. Vitest transpilation and source-text tests cannot prove all callers compile; one provider-free TypeScript check is warranted after source freeze. Edge compilation does not cover Node/worker consumers. Merely changing docs would not justify this gate, but the proposed U03 does.

**Do not blindly use the normal typecheck command in this preserved worktree.** `package.json` maps it to `tsconfig.typecheck.json`, whose `include` is `**/*.ts`, `**/*.tsx`, `**/*.mts`; its exclusions do not name protected `1/`. Turning bookkeeping off does not prevent TypeScript's own glob discovery. Before dispatch, bind a reviewed outside config containing explicit absolute `files` from tracked eligible TypeScript paths plus the exact approved new U03 paths, `include:[]`, the same compiler options/exclusions as the repository configuration, and no protected roots. All imported source/type roots must remain allowed; do not remove a failing source or use suppression. Prefer all tracked source roots to an improvised changed-file graph because database types have many consumers.

Proposed invocation after that safe config has been prepared and reviewed at `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U03-tracked.typecheck.json`:

```powershell
npm run arbiter -- typecheck
npm run typecheck -- --project C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U03-tracked.typecheck.json
```

Use the same process-local bookkeeping block. Inspect the final forwarded command before execution: the outside project option must be the effective `tsc` project, and `run-heavy.mjs` must retain its shared coordinator lease and per-worktree buildinfo. This proposal/config has not been implemented or executed; it needs a reviewed scoped-equivalence disposition before use. If that command's option forwarding cannot select exactly the reviewed roots, prepare a minimal outside coordinator wrapper instead, without changing production compiler policy. No ordinary glob-based typecheck is authorized by this report.

## Edge evidence reuse

Read and reuse U02's accepted native composite-v2 environment, its independent disposition and `U02-audit-correction-edge-native-lock-v2.txt`. The existing log records Deno 2.9.4 / TypeScript 6.0.3, both required roots checked, `DENO_EXIT_CODE=0`, and `IDENTITIES_UNCHANGED=true`. It does not prove future U03 code compiles. Do not rerun the unchanged U02 check now or repair the npm wrapper as adjacent scope.

At changed U03 Edge freeze, use a new U03-named wrapper/log with exclusive coordinator, process-local `DENO_NO_PACKAGE_JSON=1`, restored afterward; bind before/after hashes to the complete final changed source/local import closure and preserve both roots. The underlying equivalent command remains:

```text
deno check --frozen --node-modules-dir=false --lock=C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U02-edge-native-composite-v2.deno.lock --import-map=C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U02-edge-native.importmap.json supabase/functions/indexing-v3-agent/index.ts supabase/functions/site-content-sync/index.ts
```

Do not blindly reuse the old U02 wrapper's two product-file hashes. Preserve original `deno.lock` SHA256 `b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9`, npm lock `f969c2ddd1b058437b09eb61bf16b9ecc3bfb6ebb74539ec8e62ccdd7090e063`, effective v2 lock `6e5122daa4915ca299551e5f67251e910f38168a3f3ff02c8b67e693388bb6c6` and native map `be863301cacda4921a9bc2bedaba51b4caf907bfe80e8c7c216a6be98a6d6d93` unless a new reviewed disposition explicitly replaces them.

- Source changes within the same locked import graph invalidate the old compilation verdict; they do not by themselves invalidate the accepted resolution workaround. Compile the new source once.
- Changed roots, added/changed local imports, changed declaration resolution, package versions/integrities/dependency edges, map/config, repository lock bytes, root package discovery or relevant package overrides invalidate at least part of the equivalence argument. Re-establish the closure and review the affected resolution evidence before execution; never omit a root, remap declarations or run an unfrozen solver to obtain green.
- A cache miss that would require network restoration remains a separate current-run boundary. The older U02 permission is not silently enlarged by this preparation; no network is permitted here. Keep failures literal and preserve all old logs.

## Migration-role staged equivalent

The provided proposal matches the current exported validator. `git diff ae500caf..fd043b262 -- scripts/check-hosted-migration-role.mjs` is empty. Current guarded exact paths and prefixes match its literal roots; the immutable SHA is `39a5f310f2207aed473b92128dd414d4fd8903d56d5802a3d749f81850cca541`. Import is CLI-safe because its main guard compares invoked path with module path. `repositoryEntries()` still enumerates `--cached --others --exclude-standard` and reads files before filtering: do not invoke that function or the default CLI.

Use the literal validator block in `U03-frozen-owner-preparation.md`, changing **only** its `frozen` constant to `fd043b262ebd9b20315c2e46bc4838265787fa80` and its required migration filename if the SQL specialist/controller resolves a different reservation. The full block ends in `| node --input-type=module -`; it reads every guarded index blob through `git ls-files --cached -z` plus `git show :path` and calls:

```js
validateMigrationRoleEntries(entries, { requireHistorical: true });
```

Before this later execution, stage the complete owned guarded candidate and verify the exact staged allowlist plus absence of unstaged overlap in those paths. Both working-tree and staged checker bytes must equal the reviewed frozen checker. Required new migration and immutable history must be present. Missing/unmerged index blobs fail closed. Retain original Buffer/binary handling and reserved-role path/content checks; do not alter hashes, validator or validation options. This proves only the staged guarded snapshot, not excluded unrelated untracked inputs and not actual migration validity/SQL behavior. Report `scoped staged migration-role equivalent`, never `npm run check:migration-role passed`. No validator was executed here.

## Fixture-only P04 safety and reuse

`scripts/audit-ingestion-corpus.ts` accepts explicit input/expected/output paths; without `--live-read` it reads two JSON files, parses them, builds a pure report and creates/writes only the exact output. Even `--live-read` currently throws before JSON I/O. Its inspected source dependency closure uses pure policy/schema/hash helpers; no provider/client/env loader or operational reindex function is imported. `run-tsx.mjs` spawns the locally resolved TSX executable plus the server-only stub; its fallback reads Git worktree registration metadata to find installed TSX, not repository untracked content. It does inherit environment, so do not generalize this safety verdict to other TSX scripts.

The exact ignored artifact `.local/rag-ingestion/audit.json` currently exists. Its observed file SHA256 is `f7421f631f846fe6570f8c0614224c2f7c0b221797b5ea3f5f891c1a0f7d3c6b`, population fingerprint is `sha256:08bf1d12e8b431f3ec2e243fcc595b743acb222cb4bb7593fd766ce0834a5083`, and summary is 3 documents / 1 targeted reprocess / 0 shadow reindex / 0 blocked. This agrees with the final P04 implementer report and full-range phase review 3 at `8dee5cc34294adfe1eb5b0e8ee267d72aa5fbc11`.

Read-only Git comparison from that accepted P04 head to current HEAD found no changes in the CLI, audit implementation, adapter, its health-document helper, catalogue/source-metadata/source-authority/coverage helpers, Australian verification data, the two explicit input fixtures, or inspected TSX/stub resolver wrappers. Reuse the accepted classifier proof and existing artifact for preparation; no audit restart or repeat command occurred. This artifact is synthetic metadata contract evidence, never live-corpus coverage.

At final U03 freeze, if these files/input identities and classification semantics remain unchanged, reuse this evidence and record that explicitly. If the literal U03 acceptance contract requires fresh fixture output, or an audit input/dependency changes, run once to a new exact task-owned output (after controller binds the output substitution; preserve P04's file):

```powershell
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U03-p04-audit.json
```

Compare population fingerprint and per-document action/reason classification with the accepted artifact. Do not add `--live-read`, use real documents, regenerate expected data to clear a mismatch, or call it GREEN merely because it exits zero. If the classifier itself changes, add `tests/ingestion-audit.test.ts` to the affected selector and assess the actual delta; U03 should not normally change it.

## Scoped bookkeeping and remaining gates

- Formatting: use installed Prettier on the exact owned candidate paths, never `npm run format`/`prettier .`. Literal pattern: `node node_modules/prettier/bin/prettier.cjs --check <reviewed explicit owned TS/MD/JSON paths>` after formatting those same paths if needed; SQL needs only the repository-supported formatter, not an added plugin. Replace the placeholder with the final allowlist before dispatch. Use `git diff --check fd043b262ebd9b20315c2e46bc4838265787fa80 -- <same explicit owned paths>` for whole-range whitespace. Neither is executed here.
- Module index: the pre-commit hook triggers on schema/`src/lib` changes. The append-only repair audit adds a schema table, so `docs/codebase-index.md` needs its table entry. A new top-level module directory requires its group entry; a flat helper alone does not require a per-file index row. `check-codebase-index-coverage.mjs` exports pure `schemaTableGaps`, `coverageGaps` and `trackedRootDirectoryNames`. Its CLI also lists directories, so bind a tracked-input scoped equivalent using these exports and reviewed index/schema text if protected enumeration restrictions remain. Do not mark the hook obligation satisfied merely by setting the skip flag.
- Adoption: the hook triggers broadly on tests because the generator follows actual import/export/dynamic-import reachability. Compare changed tests' import edges against adoption/visual-bound source files; ordinary worker/ingestion tests with no path to UI proof do not justify adoption regeneration. If a changed test belongs to a pinned adoption proof or its reachable imports change that proof, use a reviewed explicit-input equivalent before acceptance. The default generator's visual source-binding code calls `git ls-files --others`; do not run it here. No UI/route/design token/visual-baseline work is presently implied.
- Local commit bridge remains controller-owned: process-local `SKIP_DOCS_SYNC_HOOK=1`, restore immediately; inspect exact staged ownership, formatting and applicable index/adoption obligations. Do not use `--no-verify` as a substitute or bypass any push guard. No commit was made here.
- Domain readiness: `npm run check:production-readiness` remains an applicable later gate for ingestion/privacy/source changes, but this preparation did not run it. Its current script calls `loadEnvConfig(process.cwd())` and inspects environment/configuration; do not conflate that with provider-free unit proof or expose environment values. Bind a permitted configuration-only execution/equivalent before acceptance, or record its exact unresolved scope. Do not fabricate a Cloud/CI mode to downgrade failures. No full `verify:cheap`, `verify:pr-local`, build, UI, drift regeneration or offline RAG evaluation is justified by this preparation. Preserve the planned single drift regeneration at the stable C01/C02 boundary.
- Required unit reviewers after the writer freezes are ingestion, schema and clinical governance; retain independent Specification and Quality verdicts over the full original U03 range. This scout report replaces none of them.
- Runtime SQL schedules remain separately authorized and unrun: same-worker reclaim/token rotation, stale heartbeat/progress/terminal, sibling isolation, cancellation, stale metadata and G1-after-G2 summary races, plus audit privilege/append-only enforcement. Caller mocks/static SQL tests prove neither lock ordering nor actual concurrent refusal. Actual provider/native cancellation, hosted parity, extraction, migrations, workers, activation and deployment remain separately gated. U03 code readiness must not be described as demonstrated database concurrency or production readiness while those proofs remain absent.

Memory was used only as a lead for U02 boundary preservation and then superseded by the current frozen authority/checkpoint. Relevant memory pointer: `MEMORY.md:1156-1159`; rollout `01a05afa-d773-7ff3-a6f3-c64b6b76d1aa`. Historical test counts in memory are not this preparation's current evidence.

## Concrete protected-safe compilation proposal (controller follow-up)

**SUPERSEDED FOR EXECUTION.** This draft and the earlier tentative outside-config `npm run typecheck` command are retained only as preparation history. The sole current proposed recipe is the corrected v2 section below. Do not create or run this v1 wrapper.

This section refines and supersedes the earlier tentative `npm run typecheck -- --project ...` invocation. Use the following outside wrapper as the reviewable proposal; do not execute the tentative invocation as well. The wrapper/config do not yet exist and were not executed. Save the reviewed wrapper only outside the repository as `U03-tracked-typecheck.mjs`. Its companion `U03-approved-new-compile-paths.json` must be a controller-frozen JSON string array of **every exact owned new U03 repository file** which may participate in compilation; include the reviewed planner, lease seam and tests, and any new JSON/type inputs. An empty array is valid only if every intended new path is already staged. Never derive this list through an untracked scan.

This checks all tracked current application (`src/`), worker (`worker/`), script (`scripts/` except its excluded archive), test (`tests/`) TypeScript roots and the named root configs. That captures existing database-type/function-signature callers within these production/test surfaces without guessing a narrow changed-file closure. Imported tracked dependencies elsewhere remain allowed, and imported Edge helpers are still typechecked as TypeScript dependencies. Standalone Edge entrypoints retain their separate native Deno gate. This is **tracked application/worker/script/test compilation**, not repository-wide TypeScript compilation: standalone TypeScript under historical docs/evidence, scratch, worktrees, untracked unrelated files, other root configs and non-imported Edge roots are deliberately not root files. The JSON output records the exact roots so reviewers can identify any meaningful omitted owner before accepting the selection.

The compiler options are inherited unchanged from the repository source-health config; only explicit roots replace glob discovery, and the buildinfo output moves outside the repo. The host refuses reads outside tracked/explicit-owned repository files, except the existing dependency installation. Config parsing may not glob. This prevents an accidental source import/reference into protected `1/` from reading it; such an attempted dependency becomes a failure, not omitted silently to get green. The current wrapper imports no product code and never calls a provider or installs anything.

Proposed literal `U03-tracked-typecheck.mjs` contents:

```js
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = 'C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database';
const out = 'C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation';
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript');
const { acquireHeavyRunLock } = await import(pathToFileURL(resolve(root, 'scripts/test-run-lock.mjs')).href);
if (process.env.GATE_RECEIPTS !== 'off' || process.env.GATE_ARBITER !== 'off') {
  throw new Error('Protected bookkeeping settings must be process-local off.');
}
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const tracked = git(['ls-files', '--cached', '-z']).split('\0').filter(Boolean);
const approvedNew = JSON.parse(readFileSync(resolve(out, 'U03-approved-new-compile-paths.json'), 'utf8'));
if (!Array.isArray(approvedNew) || approvedNew.some(p => typeof p !== 'string')) throw new Error('Invalid exact new-file allowlist.');
const localPath = p => {
  const rel = relative(root, resolve(root, p)).replaceAll('\\', '/');
  if (!rel || rel.startsWith('../') || isAbsolute(rel) || rel === '1' || rel.startsWith('1/')) throw new Error('Disallowed compile path.');
  return rel;
};
const allowedRepoPaths = new Set([...tracked, ...approvedNew].map(localPath));
const rootConfigs = new Set(['next-env.d.ts', 'next.config.ts', 'playwright.config.ts', 'playwright.visual.config.ts', 'vitest.config.mts']);
const roots = [...allowedRepoPaths].filter(p =>
  /\.(?:ts|tsx|mts)$/.test(p) &&
  (/^(?:src|worker|scripts|tests)\//.test(p) || rootConfigs.has(p)) &&
  !p.startsWith('scripts/archive/')
).sort().map(p => resolve(root, p));
if (!roots.length) throw new Error('No compiler roots.');
const configPath = resolve(out, 'U03-tracked.typecheck.json');
const buildInfoPath = resolve(out, 'U03-tracked.typecheck.tsbuildinfo');
writeFileSync(configPath, JSON.stringify({
  extends: resolve(root, 'tsconfig.typecheck.json'),
  compilerOptions: { tsBuildInfoFile: buildInfoPath },
  files: roots,
  include: [],
}, null, 2) + '\n');

const dependencies = resolve(root, 'node_modules');
const realDependencies = realpathSync(dependencies);
const sameOrBelow = (base, p) => {
  const r = relative(base, resolve(p));
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};
const mayRead = p => {
  if (resolve(p) === configPath || resolve(p) === buildInfoPath) return true;
  if (sameOrBelow(dependencies, p) || sameOrBelow(realDependencies, p)) return true;
  if (!sameOrBelow(root, p)) return false;
  return allowedRepoPaths.has(relative(root, resolve(p)).replaceAll('\\', '/'));
};
const safeRead = p => {
  if (!mayRead(p)) throw new Error('Compiler attempted a file outside the reviewed tracked/owned/dependency scope.');
  return ts.sys.readFile(p);
};
const safeExists = p => mayRead(p) && ts.sys.fileExists(p);
const configHost = {
  ...ts.sys,
  readFile: safeRead,
  fileExists: safeExists,
  readDirectory: () => { throw new Error('Compiler config attempted forbidden glob discovery.'); },
  onUnRecoverableConfigFileDiagnostic: d => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); },
};
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, configHost);
if (!parsed || parsed.errors.length) throw new Error('Tracked compiler configuration failed to parse.');
const diagnosticsHost = {
  getCanonicalFileName: p => p,
  getCurrentDirectory: () => root,
  getNewLine: () => '\n',
};
const lock = acquireHeavyRunLock({ projectRoot: root, command: 'U03 tracked application typecheck', mode: 'shared' });
try {
  const host = ts.createCompilerHost(parsed.options);
  host.readFile = safeRead;
  host.fileExists = safeExists;
  // Override getSourceFile as well: a default host can close over its original reader.
  host.getSourceFile = (file, languageVersion, onError) => {
    try {
      const text = safeRead(file);
      return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true);
    } catch (error) {
      if (onError) onError(String(error));
      throw error;
    }
  };
  host.getDirectories = p => {
    if (!sameOrBelow(dependencies, p) && !sameOrBelow(realDependencies, p)) {
      throw new Error('Compiler attempted directory traversal outside dependencies.');
    }
    return ts.sys.getDirectories(p);
  };
  host.writeFile = () => { throw new Error('No compiler emit is permitted.'); };
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) process.stderr.write(ts.formatDiagnostics(diagnostics, diagnosticsHost));
  const record = { kind: 'U03 tracked application/worker/script/test compilation', head: git(['rev-parse', 'HEAD']).trim(), roots: parsed.fileNames, diagnostics: diagnostics.length, sourceFiles: program.getSourceFiles().map(f => f.fileName) };
  writeFileSync(resolve(out, 'U03-tracked-typecheck-result.json'), JSON.stringify(record, null, 2) + '\n');
  process.exitCode = diagnostics.length ? 1 : 0;
} finally {
  lock.release();
}
```

Before use, review the wrapper's TypeScript API compatibility against the installed version and confirm all intended new roots are in the explicit allowlist. Path case/canonicalization and dependency junction handling are environment concerns to diagnose if they fail; do not interpret them as product RED or loosen protected read boundaries. If the compiler requires an additional legitimate tracked config/root, add its exact reviewed path. Never add `1/`, general workspace ancestors or untracked directory globs. Source/hash freeze still belongs to the gate owner; no writer may overlap compilation.

Proposed literal invocation, inside the process-local bookkeeping `try/finally` block above:

```powershell
npm run arbiter -- typecheck
node C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U03-tracked-typecheck.mjs
```

Report the actual diagnostics and root-scope label. Do not call this `npm run typecheck passed`, claim excluded roots compile, rerun a broader glob-based check, or accept it as the native Edge result.

## Corrected compilation recipe v2 — sole current proposal

This bounded correction supersedes **every earlier compilation recipe** in this report. No wrapper/config/compiler was executed. Independent documentation review must assess this complete recipe before the controller commissions its outside-file creation and actual gate. The source inventory, behavioural selector and other dispositions above remain unchanged.

### Corrections and observed compiler semantics

- Exclude protected `1/` in the Git pathspec **before Git returns any paths**: `git ls-files --cached -z -- . ':(top,exclude)1' ':(top,exclude)1/**'`. Rejection after enumeration is not the protection.
- Keep `tsconfig.typecheck.json` as the compiler's original config location. Supply its explicit root list in memory; do not relocate the effective config. Installed TypeScript 6.0.3's `getEffectiveTypeRoots` derives default type roots from `options.configFilePath`, then visits each ancestor's `node_modules/@types`. Moving the config outside silently changes that discovery. V2 preserves the config path, inherited compiler options, original working directory, module resolution and default type discovery; it does not set `types`/`typeRoots` to an invented list.
- Use the installed compiler's ordinary `getSourceFile`; its current implementation dynamically calls `compilerHost.readFile`, preserving the compiler's `languageVersionOrOptions`/implied module format. Override the host reader rather than rebuilding source files manually. That reader records forbidden I/O attempts so the compiler cannot swallow an exception and still produce an apparent pass.
- Model repository directories from allowed paths. `directoryExists`/`getDirectories` do not visit physical repository directories. Absent ordinary package/file probes return false/undefined. Only existing dependency directories under the original root's and real installation's ancestor `node_modules` paths are physically queried; these are the places normal package/type discovery can use. Do not enumerate their parent directories. Record those dependency roots and preserve the native `@types` discovery; additional installed types must not disappear silently.
- Resolve permitted existing paths through `realpath` and allow only the verified repository mapping or dependency roots. Reject a tracked symlink/junction escaping that scope before reading its target. Compare Windows paths case-insensitively; normal absent probes remain absent, not fatal. A protected path attempt records an I/O violation without stat/read/realpath traversal of that protected path.

There is an additional observed input requirement. `next-env.d.ts` is not tracked, although the original source-health config explicitly includes it. Its exact current content retains the Next and image-global type references and imports:

```text
.next-playwright/43040-1787960860981/dist/types/routes.d.ts
.next-playwright/43040-1787960860981/dist/types/root-params.d.ts
```

I read only the exact named `next-env.d.ts`, not these generated files or their directories. The gate must not quietly drop this root, strip its imports or synthesize replacement Next declarations. Before execution, the controller must classify/review these exact existing generated dependencies for inclusion in the explicit input manifest, and any exact transitive declaration inputs they require. If they cannot be included under current ownership/safety boundaries, compilation remains blocked on input scope. No framework build/generation or untracked directory inventory is proposed. Preserve that limitation rather than call a reduced pass equivalent.

### Explicit scope and files to prepare outside the repository

Create only after this recipe's review:

- `U03-reviewed-compile-inputs.json`: a frozen JSON array of exact repository-relative paths. It contains every approved new U03 compiler dependency not yet staged, plus `next-env.d.ts` and the two observed generated declaration paths above **only after their exact-input review**. Never derive it from an untracked scan. A new import requiring another untracked input is a scope blocker, not an automatic allowlist addition.
- `U03-tracked-typecheck-v2.mjs`: the following complete proposed wrapper.
- Wrapper-produced `U03-tracked-typecheck-v2-inputs.json` and `U03-tracked-typecheck-v2-result.json` are evidence files, not relocated TypeScript project configs. No config or source is written into the repository.

All tracked `src/`, `worker/`, `scripts/` (except `scripts/archive/`) and `tests/` TypeScript roots plus named root TypeScript configs are checked, covering existing signature/database-type callers in those surfaces. Exact `next-env.d.ts` remains a root. Tracked imported dependencies elsewhere, and explicitly approved existing generated declaration dependencies, remain part of the program. Non-imported historical documentation/evidence TypeScript, scratch/worktree code, unrelated untracked files and standalone Edge roots are excluded from root selection. This is a **tracked application/worker/script/test source-health compilation equivalent with explicit Next ambient inputs**, not repository-wide compilation or native Edge proof. The exclusions are intentional scope, never permission to omit a changed production caller.

```js
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname, basename, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = 'C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database';
const out = 'C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation';
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript');
const { acquireHeavyRunLock } = await import(pathToFileURL(resolve(root, 'scripts/test-run-lock.mjs')).href);
if (process.env.GATE_RECEIPTS !== 'off' || process.env.GATE_ARBITER !== 'off') throw new Error('Required process-local bookkeeping settings missing.');
const key = p => resolve(p).replaceAll('\\', '/').toLowerCase();
const realRoot = realpathSync(root);
const within = (base, p) => key(p) === key(base) || key(p).startsWith(key(base) + '/');
const protectedPath = p => within(resolve(root, '1'), p) || within(resolve(realRoot, '1'), p);
const violations = new Set();
const forbidden = p => {
  if (!protectedPath(p)) return false;
  violations.add('Attempted protected repository path');
  return true;
};
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const tracked = git(['ls-files', '--cached', '-z', '--', '.', ':(top,exclude)1', ':(top,exclude)1/**']).split('\0').filter(Boolean);
const explicit = JSON.parse(readFileSync(resolve(out, 'U03-reviewed-compile-inputs.json'), 'utf8'));
if (!Array.isArray(explicit) || explicit.some(p => typeof p !== 'string')) throw new Error('Invalid exact input manifest.');
const safeRelative = p => {
  if (isAbsolute(p)) throw new Error('Input must be repository-relative.');
  const r = relative(root, resolve(root, p)).replaceAll('\\', '/');
  if (!r || r.startsWith('../') || isAbsolute(r) || forbidden(resolve(root, r))) throw new Error('Disallowed exact input.');
  return r;
};
const files = [...new Set([...tracked, ...explicit].map(safeRelative))];
const requiredAmbient = [
  'next-env.d.ts',
  '.next-playwright/43040-1787960860981/dist/types/routes.d.ts',
  '.next-playwright/43040-1787960860981/dist/types/root-params.d.ts',
];
for (const p of requiredAmbient) if (!files.includes(p)) throw new Error('Original Next ambient dependency lacks exact reviewed input scope.');
const allowedFiles = new Set(files.flatMap(p => [key(resolve(root, p)), key(resolve(realRoot, p))]));
const repoDirs = new Set();
const children = new Map();
for (const p of files) for (const base of [root, realRoot]) {
  let d = dirname(resolve(base, p));
  while (within(base, d)) {
    repoDirs.add(key(d));
    if (key(d) === key(base)) break;
    const parent = dirname(d);
    if (!children.has(key(parent))) children.set(key(parent), new Set());
    children.get(key(parent)).add(basename(d));
    d = parent;
  }
}
// Probe only exact conventional package roots, never their parent directory contents.
const dependencyCandidates = new Set();
for (const start of [root, realRoot]) {
  let d = resolve(start);
  for (;;) {
    dependencyCandidates.add(resolve(d, 'node_modules'));
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
}
const dependencyRoots = new Set();
for (const p of dependencyCandidates) {
  if (forbidden(p)) throw new Error('Protected dependency root.');
  if (!ts.sys.directoryExists(p)) continue;
  const actual = realpathSync(p);
  if (forbidden(actual)) throw new Error('Dependency root resolves into protected content.');
  dependencyRoots.add(p);
  dependencyRoots.add(actual);
}
const inDependencies = p => [...dependencyRoots].some(base => within(base, p));
const allowedLexicalFile = p => allowedFiles.has(key(p)) || inDependencies(p);
const allowedLexicalDir = p => repoDirs.has(key(p)) || inDependencies(p);
function canonicalExisting(p, directory = false) {
  if (forbidden(p)) return undefined;
  if (!(directory ? allowedLexicalDir(p) : allowedLexicalFile(p))) return undefined;
  if (!(directory ? ts.sys.directoryExists(p) : ts.sys.fileExists(p))) return undefined;
  const actual = realpathSync(p);
  if (forbidden(actual)) return undefined;
  if (!(directory ? allowedLexicalDir(actual) : allowedLexicalFile(actual))) {
    violations.add('Permitted path resolved outside tracked/explicit/dependency scope');
    return undefined;
  }
  return actual;
}
const safeRead = p => {
  const actual = canonicalExisting(p);
  return actual === undefined ? undefined : ts.sys.readFile(actual);
};
const safeExists = p => canonicalExisting(p) !== undefined;
const safeDirectoryExists = p => {
  if (forbidden(p)) return false;
  if (repoDirs.has(key(p))) return true; // virtual tracked directory; no disk traversal
  return inDependencies(p) && canonicalExisting(p, true) !== undefined;
};
const safeDirectories = p => {
  if (forbidden(p)) return [];
  if (repoDirs.has(key(p))) return [...(children.get(key(p)) ?? [])].sort();
  const actual = inDependencies(p) ? canonicalExisting(p, true) : undefined;
  return actual === undefined ? [] : ts.sys.getDirectories(actual);
};
const safeRealpath = p => canonicalExisting(p) ?? resolve(p);
const rootConfigs = new Set(['next-env.d.ts', 'next.config.ts', 'playwright.config.ts', 'playwright.visual.config.ts', 'vitest.config.mts']);
const roots = files.filter(p => /\.(?:ts|tsx|mts)$/.test(p) && (/^(?:src|worker|scripts|tests)\//.test(p) || rootConfigs.has(p)) && !p.startsWith('scripts/archive/')).sort().map(p => resolve(root, p));
const configPath = resolve(root, 'tsconfig.typecheck.json');
const configText = safeRead(configPath);
if (configText === undefined) throw new Error('Original compiler config unavailable.');
const decoded = ts.parseConfigFileTextToJson(configPath, configText);
if (decoded.error) throw new Error('Original compiler config failed to parse.');
// Preserve original config origin, extends and every compiler option; replace roots only.
const effectiveText = JSON.stringify({ ...decoded.config, files: roots, include: [] });
const parseHost = {
  ...ts.sys,
  getCurrentDirectory: () => root,
  readFile: p => key(p) === key(configPath) ? effectiveText : safeRead(p),
  fileExists: safeExists,
  directoryExists: safeDirectoryExists,
  getDirectories: safeDirectories,
  realpath: safeRealpath,
  readDirectory: () => { throw new Error('Forbidden config glob discovery.'); },
  onUnRecoverableConfigFileDiagnostic: d => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); },
};
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, parseHost);
if (!parsed || parsed.errors.length || violations.size) throw new Error('Compiler input/configuration safety failed.');
if (key(parsed.options.configFilePath) !== key(configPath) || !parsed.options.noEmit) throw new Error('Original source-health compiler semantics changed.');
for (const p of explicit.map(safeRelative)) if (!safeExists(resolve(root, p))) throw new Error('An explicitly reviewed compiler input is absent.');
const inputs = {
  kind: 'tracked application/worker/script/test source-health with explicit Next ambient inputs',
  configOrigin: configPath,
  configSha256: createHash('sha256').update(configText).digest('hex'),
  roots: parsed.fileNames,
  explicitInputs: explicit,
  dependencyRoots: [...dependencyRoots],
};
writeFileSync(resolve(out, 'U03-tracked-typecheck-v2-inputs.json'), JSON.stringify(inputs, null, 2) + '\n');
const lock = acquireHeavyRunLock({ projectRoot: root, command: 'U03 tracked source-health typecheck v2', mode: 'shared' });
try {
  const host = ts.createCompilerHost(parsed.options);
  Object.assign(host, {
    getCurrentDirectory: () => root,
    readFile: safeRead,
    fileExists: safeExists,
    directoryExists: safeDirectoryExists,
    getDirectories: safeDirectories,
    realpath: safeRealpath,
    readDirectory: () => { violations.add('Forbidden compiler glob discovery'); return []; },
    writeFile: () => { throw new Error('No emit or buildinfo write is permitted.'); },
  });
  // Native getSourceFile is retained; installed TS reads through host.readFile dynamically.
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) process.stderr.write(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: p => p, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  const result = {
    ...inputs,
    head: git(['rev-parse', 'HEAD']).trim(),
    diagnostics: diagnostics.length,
    ioViolations: [...violations],
    sourceFiles: program.getSourceFiles().map(f => f.fileName),
  };
  writeFileSync(resolve(out, 'U03-tracked-typecheck-v2-result.json'), JSON.stringify(result, null, 2) + '\n');
  process.exitCode = diagnostics.length || violations.size ? 1 : 0;
} finally {
  lock.release();
}
```

### Current literal invocation and acceptance limits

After independent review and exact-input disposition, use the original process-local bookkeeping `try/finally` block with **only**:

```powershell
npm run arbiter -- typecheck
node C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U03-tracked-typecheck-v2.mjs
```

The gate owner freezes sources before reading the inputs and retains hashes of the final changed source/config/input set alongside the result. Preserve the original default `@types` population and DOM libraries; no declaration remapping, silent type omission, compiler-option relaxation or generated Next replacement is permitted. Existing dependency roots are recorded, not downloaded or installed. Unexpected dependency resolution, absent required generated input, native filesystem/junction issue or attempted protected I/O is an environment/input-scope failure requiring diagnosis; it is neither product RED nor permission to narrow away errors. The wrapper performs diagnostics without calling emit, so it does not produce/reuse incremental buildinfo.

This recipe still requires review; it is not validated executable evidence. The exact generated Next inputs remain an explicit pre-execution scope decision because their bytes and transitive references were not read here. The final result must retain the narrower scope label and residual native Edge/SQL/provider proof boundaries. No change has been made to U03 implementation authority, the shared-contract freeze or any moving controller document.

## Missing Next declarations — chosen local generation remedy

The controller subsequently checked the two exact old generated declaration paths and found both absent. This section resolves the remedy: generate fresh ambient declarations with the **installed Next.js 16.3.0 generators**, from a tracked route-name inventory, into a U03-owned output directory. Use those complete generated declarations as the source-health ambient root instead of the stale generated root. Do not drop route/root-param declarations or hand-author substitutes. Routine in-scope local generation is already authorized; this report adds no new permission requirement. No generation, compiler, server, install, provider or repository edit occurred during this investigation.

### Why not invoke the stock CLI here

Installed documentation `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md:177-212` documents `next typegen`, its `<distDir>/types` output, generation of `next-env.d.ts`, and production-phase config loading. Installed `next-typegen.js:76-133` confirms it does not start a server or build the application, but it loads the real config, calls `installBindings`, verifies TypeScript setup, and discovers route directories. The current `next.config.ts` imports project helpers (security headers, Sentry release, Supabase project identity and generated therapy assets), and permits `NEXT_DIST_DIR` only under `.next-playwright/<run-id>/dist`. TypeScript setup can auto-install missing dependencies and rewrites the selected tsconfig plus root `next-env.d.ts`. `collectAppFiles`/`collectPagesFiles` recursively enumerate their physical directories. Therefore raw `next typegen` does not meet the narrower no-application-import/no-unrelated-untracked-enumeration/preserved-root boundary of this gate, even with `NEXT_DIST_DIR` set. Do not call `npm run ensure`, `build`, or change production config to solve this.

The chosen scoped generator directly uses the installed framework's existing route mapping/normalization, manifest generation and declaration writers. It bypasses config loading, environment-file loading, TypeScript setup, native-binding installation and directory discovery. It imports framework modules and the repository's coordinator/offline-environment helpers only; it does not import/evaluate application modules. It does not run an application server or route handler.

### Frozen type-generation facts and limits

- Current installed Next version is `16.3.0`. Its defaults are `pageExtensions = ['tsx','ts','jsx','js']`, `typedRoutes = false`, and `experimental.strictRouteTypes = false`; the current config does not override these or disable static images. No tracked `src/pages/`, `pages/` or root `app/` files were found; the current router is `src/app/` only.
- The current config defines no redirects. The only rewrite source patterns are `/therapy-compass-data/therapies.json`, `/therapy-compass-data/therapies-index.json`, and `/therapy-compass-data/therapies-home.json`. The installed `createRouteTypesManifest` reads only `source` from rewrite entries, not destination asset bytes. Passing exactly those sources preserves their type contribution without executing the config or importing application asset modules.
- Required non-strict `routes.d.ts` and `root-params.d.ts` depend on route keys/parameters, layouts and slots. The installed manifest excludes metadata-only non-page files from `appRoutes`; their source paths otherwise serve the separate validator, which is not imported by non-strict `next-env.d.ts`. Metadata-only files need not be parsed for these two declaration outputs. The recipe fails closed if such a file appears in a parallel slot, because metadata could then affect slot discovery; the bounded tracked-name check found no such current paths. Regular `route.ts` handlers remain fully included, including custom routes with metadata-like directory names.
- The recipe generates only what non-strict `next-env.d.ts` imports: core/image type references, route globals and root-param types. It does not claim to generate or check Next's whole route-export validator, strict-route/link/cache-life outputs, or a build. If Next version/config/router ownership changes, update this scoped equivalence before reuse. No settings may be changed to make generation pass.
- Existing native SWC binary presence was observed at its exact installed path, but this chosen path does not call metadata AST parsing or native-binding loading at all. No native parser or download proof is needed or claimed.

### Actionable outside wrapper and exact command

Prepare the following wrapper outside the repository at `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U03-generate-next-ambient.mjs`. It writes only its newly created task directory `.next-playwright/u03-typegen-fd043b262/` and the named outside evidence file. It refuses to reuse a pre-existing output directory; a legitimate repeat uses a newly named owned directory, not deletion or overwriting. The input generator uses Git's index for a tracked filename allowlist and does not inspect untracked contents. U03 changes no routes; the final gate owner still records the final tracked route inventory and relevant config hashes and freezes writers before generation.

```js
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = 'C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database';
const out = 'C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation';
const taskRelative = '.next-playwright/u03-typegen-fd043b262';
const taskRoot = resolve(root, taskRelative);
const dist = resolve(taskRoot, 'dist/types');
const require = createRequire(resolve(root, 'package.json'));
const { acquireHeavyRunLock } = await import(pathToFileURL(resolve(root, 'scripts/test-run-lock.mjs')).href);
const { offlineTestEnvironment } = await import(pathToFileURL(resolve(root, 'scripts/test-environment.mjs')).href);
Object.assign(process.env, offlineTestEnvironment(process.env, { NEXT_TELEMETRY_DISABLED: '1', ANALYZE: 'false' }));
if (require('next/package.json').version !== '16.3.0') throw new Error('Reviewed Next version changed.');
if (existsSync(taskRoot)) throw new Error('Task output already exists; use a separately named owned attempt.');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const routeFiles = git(['ls-files', '--cached', '-z', '--', 'src/app/', 'src/pages/', 'pages/', 'app/', ':(top,exclude)1', ':(top,exclude)1/**']).split('\0').filter(Boolean).sort();
if (routeFiles.some(p => !p.startsWith('src/app/'))) throw new Error('Router ownership changed; review generation scope.');
const appDir = resolve(root, 'src/app');
const extensions = ['tsx', 'ts', 'jsx', 'js'];
const { createValidFileMatcher } = require('next/dist/server/lib/find-page-file');
const { createPagesMapping, processAppRoutes, processLayoutRoutes } = require('next/dist/build/route-discovery');
const { extractSlotsFromRoutes, combineSlots } = require('next/dist/build/file-classifier');
const { UNDERSCORE_NOT_FOUND_ROUTE_ENTRY, UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY } = require('next/dist/shared/lib/entry-constants');
const { createRouteTypesManifest, writeRouteTypesManifest } = require('next/dist/server/lib/router-utils/route-types-utils');
const { writeRootParamsTypes } = require('next/dist/server/lib/router-utils/root-params-type-utils');
const { writeAppTypeDeclarations } = require('next/dist/lib/typescript/writeAppTypeDeclarations');
const matcher = createValidFileMatcher(extensions, appDir);
const candidates = routeFiles.map(p => relative(appDir, resolve(root, p))).filter(p => !p.split(sep).some(part => part.startsWith('_')));
const metadataOnly = candidates.filter(p => matcher.isMetadataFile(resolve(appDir, p)));
if (metadataOnly.some(p => p.split(sep).some(part => part.startsWith('@')))) throw new Error('Metadata-only slot requires a revised exact generation route.');
const ordinary = candidates.filter(p => !matcher.isMetadataFile(resolve(appDir, p)));
const pages = ordinary.filter(p => matcher.isAppRouterPage(resolve(appDir, p)) || matcher.isRootNotFound(resolve(appDir, p)));
const layouts = ordinary.filter(p => matcher.isAppLayoutPage(resolve(appDir, p)));
const defaults = ordinary.filter(p => matcher.isAppDefaultPage(resolve(appDir, p)));
if (!pages.length || !layouts.length) throw new Error('Unexpected empty app/layout route inventory.');
const map = pagePaths => createPagesMapping({ isDev: false, pageExtensions: extensions, pagePaths, pagesType: 'app', appDir, appDirOnly: true });
const lock = acquireHeavyRunLock({ projectRoot: root, command: 'U03 tracked Next ambient declaration generation', mode: 'exclusive' });
try {
  const [mappedPages, mappedLayouts, mappedDefaults] = await Promise.all([map(pages), map(layouts), map(defaults)]);
  const { appRoutes, appRouteHandlers } = processAppRoutes(mappedPages, matcher, root, true);
  const layoutRoutes = processLayoutRoutes(mappedLayouts, root, true);
  const slots = combineSlots(extractSlotsFromRoutes(mappedPages, new Set([UNDERSCORE_NOT_FOUND_ROUTE_ENTRY, UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY])), extractSlotsFromRoutes(mappedDefaults));
  const manifest = await createRouteTypesManifest({
    dir: root, appRoutes, appRouteHandlers, layoutRoutes, slots,
    pageRoutes: [], pageApiRoutes: [],
    rewrites: async () => ({ beforeFiles: [], fallback: [], afterFiles: [
      { source: '/therapy-compass-data/therapies.json' },
      { source: '/therapy-compass-data/therapies-index.json' },
      { source: '/therapy-compass-data/therapies-home.json' },
    ] }),
    validatorFilePath: resolve(dist, 'validator.ts'),
  });
  mkdirSync(dist, { recursive: true });
  await writeRouteTypesManifest(manifest, resolve(dist, 'routes.d.ts'), { experimental: { strictRouteTypes: false }, typedRoutes: false });
  await writeRootParamsTypes(manifest, resolve(dist, 'root-params.d.ts'));
  await writeAppTypeDeclarations({ baseDir: taskRoot, distDir: 'dist', imageImportsEnabled: true, hasPagesDir: false, hasAppDir: true, strictRouteTypes: false, typedRoutes: false });
  const outputs = ['next-env.d.ts', 'dist/types/routes.d.ts', 'dist/types/root-params.d.ts'].map(p => `${taskRelative}/${p}`);
  const sha = p => createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex');
  const evidence = {
    nextVersion: '16.3.0', head: git(['rev-parse', 'HEAD']).trim(), routeFiles,
    selected: { pages, layouts, defaults }, metadataOnly,
    configHashes: Object.fromEntries(['next.config.ts', 'tsconfig.json', 'tsconfig.typecheck.json', 'package.json', 'package-lock.json', 'next-env.d.ts'].map(p => [p, sha(p)])),
    outputs: Object.fromEntries(outputs.map(p => [p, sha(p)])),
    limits: 'Next ambient declarations only; no CLI/build/server/native parser/application imports/providers or route-export validator',
  };
  writeFileSync(resolve(out, 'U03-next-ambient-generation.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write('Generated exact U03-owned Next ambient declarations.\n');
} finally {
  lock.release();
}
```

Exact proposed invocation from the verified worktree:

```powershell
node C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U03-generate-next-ambient.mjs
```

Before that invocation, the controller/gate owner compares the frozen `next.config.ts` and installed defaults with the above literal type-relevant settings. If a source change has added routes, route settings, redirects/rewrites, private/parallel routing edge cases or a pages router, do not use stale literals. This is a bounded local input check, not a new approval ceremony or broad baseline. The wrapper has not run and its output does not yet exist; report any actual setup/generation failure literally.

### Integrating the generated roots into the current v2 compiler recipe

This is the sole amendment to v2's earlier **absent-generated-input** disposition. Replace its three `requiredAmbient` entries with:

```text
.next-playwright/u03-typegen-fd043b262/next-env.d.ts
.next-playwright/u03-typegen-fd043b262/dist/types/routes.d.ts
.next-playwright/u03-typegen-fd043b262/dist/types/root-params.d.ts
```

Put these three exact generated files and their output hashes in the reviewed input manifest. In root selection, replace the literal `next-env.d.ts` root-config entry with the new task-owned ambient path; do not include the stale root ambient file as a second root. This is a real framework-generated replacement of a stale generated artifact, retaining both missing declaration families and core/image globals. It is not deletion, suppression or removal of application type checks. The original root file remains untouched, and both compiler configs retain their original bytes and config origin/default `@types` discovery. The generated file lives inside the same repository ancestry, so its package type references still resolve through the normal installed dependency roots. Its two relative imports resolve directly to the generated files in its own task directory; no compiler import remapping is needed.

If successful, report generation separately from the following compiler diagnostics; generation alone is not a typecheck pass. The existing v2 protected-host/explicit-root/compiler/coordinator requirements and separate native Edge gate remain. Do not introduce a global `next-env.d.ts` rewrite, a new production route, full Next build, native extraction, provider or install to close this local prerequisite.

At the final bounded status inspection, HEAD was still `fd043b262ebd9b20315c2e46bc4838265787fa80`; three controller-owned planning/handoff documents were modified. I did not read their moving contents or alter them. Only this report was appended.
