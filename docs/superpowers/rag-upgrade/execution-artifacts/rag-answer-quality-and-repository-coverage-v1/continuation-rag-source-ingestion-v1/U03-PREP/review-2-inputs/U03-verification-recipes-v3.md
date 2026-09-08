# U03 concrete verification recipes v3 — 8 September 2026

Authorship for independent review, not approval or execution. These concrete files supersede the executable sketches in `U03-verification-preparation.md` and `U03-tracked-typecheck-v2.mjs`; those earlier files remain untouched. The filename `U03-reviewed-compile-inputs.json` names the intended reviewed input contract and does not assert that review has occurred.

## Authored files and exact SHA-256

All four assigned files are under `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/`.

| File | SHA-256 |
| --- | --- |
| `U03-generate-next-ambient.mjs` | `5e030753100ff2c7fbc51a5893ba751e806f7b5a0a9b80a505a936a68b78caf4` |
| `U03-tracked-typecheck-v3.mjs` | `76b7d36588738e7db9edd60c146026e1771455315278ed495b07d97386b72879` |
| `U03-reviewed-compile-inputs.json` | `edd5a7bba598532082fe69049cbcf3d3a09d126258f6ee29713e57a5e4d29643` |

The report's own final hash is supplied separately in the handoff, avoiding a self-referential hash. The generator pins the manifest hash. The compiler pins the generator hash before importing its shared helpers, and subsequently verifies the same manifest. Relevant configuration/framework/helper bytes are pinned in the manifest and checked before loading their implementations and again before success is recorded. A change requires a reviewed rebind; scripts do not refresh expected hashes automatically.

## Current context and actual evidence

- Worktree: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`; branch `codex/rag-local-build-20260822`.
- Preparation began at accepted U02 checkpoint `fd043b262ebd9b20315c2e46bc4838265787fa80`. During authorship the controller created planning candidate `481270d8b4267d479bc78d58815b365439f8a2ec`; its HEAD was observed, with empty `git status --short --untracked-files=no`. No controller-owned document was edited here. The recipes permit descendant heads on this same branch so later U03 product candidates can be checked; they bind/check the actual head for each execution.
- Own resolved local route: `/root/u03_verification_preparation`, session `01a07bdb-921b-76e3-8b56-a117e79b539b`, parent `01a07b47-4623-7e90-825a-ec25116b8531`. Exact child-log selected-field observation at `2026-09-08T12:42:13.077Z`: `gpt-6-astra`, effort `high`; matching collaboration settings. This is local configuration evidence, not backend attestation or independent acceptance.
- `node --check C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U03-generate-next-ambient.mjs` — exit 0 on the final bytes.
- `node --check C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U03-tracked-typecheck-v3.mjs` — exit 0 on the final bytes.
- These were syntax checks only. No script import/runtime, Next generator, TypeScript compiler, arbiter, test/domain gate, provider, SQL, source acquisition, native extraction, server, worker, install, network, repository write or commit ran. The manifest and scripts contain future paths; their presence is not claimed. Existing v2, prior reports and pause artifacts were preserved.

## Installed API inspection and generator compatibility

Current installed versions are Next.js `16.3.0` and TypeScript `6.0.3`; both package manifests and the relevant implementation files are pinned. Installed Next CLI documentation and `next-typegen.js` confirm that stock typegen loads production-phase config, invokes binding/TypeScript setup, writes ambient/config files and discovers physical route directories. The current config imports application helpers. The scoped recipe therefore uses framework generators directly instead of invoking the stock CLI, a server or build.

The generator uses the installed `createValidFileMatcher`, `createPagesMapping`, `processAppRoutes`, `processLayoutRoutes`, slot helpers, `createRouteTypesManifest`, `writeRouteTypesManifest`, `writeRootParamsTypes` and `writeAppTypeDeclarations`. The inspected `recursiveReadDir` output retains a leading path separator after removing the app directory; the concrete recipe now supplies exactly that shape to `createPagesMapping` without calling recursive discovery. This corrects the earlier sketch's unprefixed mapping input.

Tracked input is obtained with positive route-root pathspecs and exclusions for `1`/`1/**` before Git returns filenames. The frozen inventory has 295 paths, SHA-256 `4687951bd3b4490040053fc0fa847bd2268d527d6897584a20039c6cc1860788`, computed from ordinal-sorted paths joined with LF and one final LF. The generator refuses count/hash/router-owner drift. It never reads or evaluates application modules; it uses tracked filenames and pinned framework code. It does not scan physical route directories.

Current pinned type-relevant facts are app-only `src/app`, default `tsx/ts/jsx/js` extensions, non-strict route types, `typedRoutes:false`, image globals enabled, no redirects, and the three exact therapy alias rewrite sources. `createRouteTypesManifest` uses rewrite `source` values only, so their type contribution is preserved without loading application configuration/assets. Config hash drift refuses rather than guessing new settings.

Metadata-only non-page sources do not contribute to these non-strict ambient route unions; their source-path sets serve the separate route-export validator. The generator omits metadata AST parsing and explicitly rejects metadata-only parallel slots. It also checks the precise metadata branch predicate used inside `createPagesMapping` before calling it, so a classifier disagreement cannot trigger native parsing. This remains a scoped equivalence for the required ambient declarations, not a full typegen/validator/build result. A changed version, strict/typed-route setting, page router, metadata slot or relevant configuration requires a revised recipe.

Generation writes a newly reserved `.next-playwright/u03-typegen-fd043b262/` directory only:

```text
.next-playwright/u03-typegen-fd043b262/next-env.d.ts
.next-playwright/u03-typegen-fd043b262/dist/types/routes.d.ts
.next-playwright/u03-typegen-fd043b262/dist/types/root-params.d.ts
```

The actual installed Next writer produces the ambient file, including both relative declaration imports and the core/image type references. Existing root `next-env.d.ts` and both compiler configs remain untouched. No replacement declarations are handwritten, no import is suppressed, and no empty route/root-param payload is invented. The original stale ambient file is replaced only in the compiler's explicit root list by the complete framework-generated artifact.

The generator assigns the pinned offline helper's returned environment to its own process. The unchanged helper copies source keys, explicitly neutralizes each listed provider key with an inert URL or empty string, and sets offline controls; it does not scrub arbitrary unlisted keys. Assignment is sufficient for that actual listed-key scope. No environment values are printed and the parent process is unaffected. Provider-free scope principally comes from the invoked code path: no config loader, application evaluation, network/provider function, dependency installer, native parser or worker is invoked. No runtime claim about that path has yet been verified.

## Compiler scope and semantic preservation

The six exact future U03 TypeScript inputs are:

```text
supabase/functions/_shared/ingestion-attempt.ts
src/lib/ingestion-repair-plan.ts
scripts/lib/ingestion-operator-compatibility.ts
tests/ingestion-lease-fencing.test.ts
tests/ingestion-repair-plan.test.ts
tests/ingestion-operator-compatibility.test.ts
```

These names come from the current brief plus the controller's completed compatibility disposition. No nonexistent implementation is fabricated. All six must exist before compilation; absence is an input/setup failure, not a product RED. The planned migration is not a TypeScript root.

The compiler checks tracked TypeScript roots under `src/`, `worker/`, `scripts/` and `tests/`, and the named Next/Playwright/Vitest TypeScript configs. It requires the three operator callers `scripts/backfill-smart-index.ts`, `scripts/enrich-documents.ts` and `scripts/archive/backfill-enrichment.ts`. The last is forcibly included despite the inherited archive exclusion; the pure shared attempt module is also an explicit root. Imported tracked dependencies remain available. Existing script bodies are parsed/typechecked only: their `loadEnvConfig`, provider code and main functions are not executed.

This is **tracked application/worker/script/test source-health compilation, with the explicit archived caller/shared attempt root and generated Next ambient replacement**. It is not repository-wide compilation. Standalone historical docs/evidence TypeScript, other archived entrypoints, scratch/worktree code, unrelated untracked files and standalone Edge servers are not root files; any imported tracked dependency is still checked according to unchanged compiler options. The complete root list, actual program source files and text hashes are recorded. No changed caller may be omitted merely to obtain green.

The effective config is an in-memory explicit-file variant at the original `tsconfig.typecheck.json` location, retaining `extends`, compiler options and its original `configFilePath`. Installed TypeScript inspection confirms default `@types` discovery derives from that path, and native `getSourceFile` dynamically reads through the host reader while retaining language-version/implied-module-format options. V3 retains that native source-file creation, original working directory, default libraries, configured/default types and type roots. It does not manufacture a `types`/`typeRoots` list or relocate the compiler project. It calls diagnostics only; no emit or incremental buildinfo write occurs.

The host models repository directories from tracked/explicit paths; Git excludes protected `1/` before returning names. Normal missing package probes return false/undefined without unrelated-file reads. Physical package discovery is limited to exact conventional `node_modules` roots in the original/canonical ancestry and their dependency contents, preserving automatic type discovery. Repository file reads use an explicit allowlist plus canonical/junction checks. Protected attempts and escaping targets are recorded as I/O violations and block success, including when TypeScript catches a reader exception. Actual read-text hashes and final HEAD/index membership detect change during the check.

The compiler requires a successful generation record with the same manifest and generator hashes, all three expected output identities, and exact matching bytes. It verifies all three generated files actually enter the TypeScript program. Thus it cannot silently drop a missing route/root-param declaration. The generator and compiler evidence are separate results; generation alone never means compilation passed.

## Literal future commands and preserving attempts

After independent recipe review, the gate owner may run the already-authorized local generation from the verified worktree:

```powershell
node C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U03-generate-next-ambient.mjs
```

It refuses an existing task directory or `U03-next-ambient-generation-v3.json` and reserves the directory atomically. A partial failed output remains intact; a retry requiring generation uses a separately reviewed attempt name/pinned manifest, never deletion or overwrite. An unchanged successful generation is reused for subsequent compiler attempts while all pinned identities remain valid.

After U03 source freeze, the six future inputs exist, and generation evidence is available:

```powershell
$u03OldReceipts = [Environment]::GetEnvironmentVariable('GATE_RECEIPTS','Process')
$u03OldArbiter = [Environment]::GetEnvironmentVariable('GATE_ARBITER','Process')
try {
  $env:GATE_RECEIPTS = 'off'
  $env:GATE_ARBITER = 'off'
  npm run arbiter -- typecheck
  if ($LASTEXITCODE -ne 0) { throw 'Arbiter consultation failed.' }
  node C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U03-tracked-typecheck-v3.mjs --attempt=final
  if ($LASTEXITCODE -ne 0) { throw 'Tracked source-health compilation failed; preserve diagnostics.' }
} finally {
  [Environment]::SetEnvironmentVariable('GATE_RECEIPTS',$u03OldReceipts,'Process')
  [Environment]::SetEnvironmentVariable('GATE_ARBITER',$u03OldArbiter,'Process')
}
```

Record the actual conservative arbiter verdict; no invocation/result exists here. The compiler retains the shared coordinator, and generation retains an exclusive lease. No `CI`/lease bypass is used. A correction uses a new bounded label such as `--attempt=correction-1`; input/result evidence uses exclusive-create semantics and refuses any existing attempt filename before compilation. There is no watcher, cleanup, overwrite or automatic retry loop. The gate owner preserves raw failed logs as well as the named JSON evidence.

## Integration notes and remaining gates

- The controller's current domain decisions are duplicate-reason rejection and claim duration 1–1440 minutes, default 45. These recipes do not define or implement those contracts; the six-file input binding includes the compatibility helper/suite needed for their owners.
- The controller selected 15 focused test files (the previous 14 plus `tests/ingestion-operator-compatibility.test.ts`); no tests ran here. Existing check-indexing source assertions remain part of that selector.
- The new scripts helper affects the staged scripts-index count. The compatibility owner reports `node scripts/update-docs-inventory.mjs --check` as the tracked-scripts-only scoped check after the staged count is updated. I did not rerun or independently survey that script; keep it under that owner's disposition rather than invoking a full docs generator.
- No additional installed static Edge closure helper is asserted safe by this authorship. Before the unchanged two-root native Deno equivalent executes, the controller must freeze/review the complete local import closure and source hashes, including the new shared attempt module, and retain the existing outside composite lock/import map. Existing U02 resolution evidence is reusable only within its approved identities; changed dependencies invalidate affected proof. No Edge check ran here.
- Recipes are concrete and syntax-valid but not runtime-tested or independently accepted. Potential filesystem/package/API compatibility failures remain diagnosable input/environment failures, never product RED or permission to narrow checks. `createPagesMapping`/writer usage relies on pinned installed internal APIs; the scope-limited metadata disposition requires independent review.
- A final passing compiler outcome would establish only its recorded input scope. SQL schedules, runtime atomicity, Storage/provider/native cancellation, source acquisition, hosted/provider parity, deployment, activation, workers and ordinary Answer acceptance remain separate and unrun. Historical U02 offline evaluation is not inherited.

No existing reports, v2 scripts, pause copies or repository files were rewritten by this authorship. Only the four assigned outside files were created.
