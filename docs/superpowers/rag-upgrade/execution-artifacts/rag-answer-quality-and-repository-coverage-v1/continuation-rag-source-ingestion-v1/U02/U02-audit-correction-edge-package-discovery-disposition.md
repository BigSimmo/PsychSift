# Edge package discovery disposition

**Disposition: BLOCKED for the proposed single-variable equivalent.** `DENO_NO_PACKAGE_JSON=1` is supported by the installed Deno, but this exact Edge graph has two required bare imports resolved through the root package manifest. Disabling discovery without replacing that resolution is not a coverage-preserving equivalent. No actual Deno check was run for this disposition.

## Observed failure and scope

Reviewed code reference: `ae500cafc661d9a06536d09d73d827726f057ffa`, in `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database` on `codex/rag-local-build-20260822`.

The supplied `U02-audit-correction-edge.txt` records:

```text
deno check --frozen --node-modules-dir=false supabase/functions/indexing-v3-agent/index.ts supabase/functions/site-content-sync/index.ts
```

Deno 2.9.4 exited 1 because the lockfile was out of date. Its proposed changes expand the dependency set to root application dependencies including Next, React and Playwright; the report omits approximately 5,942 further proposed lines. Before/after lock hashes are identical and the captured output has no Download lines. That last observation is not a general claim of zero registry requests.

Installed `deno --help=full` documents `DENO_NO_PACKAGE_JSON` as disabling automatic package.json resolution. Installed check help also describes automatic installation of package.json npm dependencies when npm lazy caching is disabled. These support root application discovery as the reason for the broad proposed expansion. They do not establish that every package obtained from the root manifest is irrelevant to the Edge graph.

At inspection HEAD matched the reference above, with the controller/writer's expected uncommitted changes in `supabase/functions/_shared/source-anchored-summary.ts` and `tests/document-enrichment.test.ts`. This disposition inspected committed import structure; the shared source's current diff introduced no import declaration changes. It is not a review or acceptance of those product changes.

## Concrete required dependency

The frozen local chain is:

```text
supabase/functions/indexing-v3-agent/index.ts
  -> ./behavior.ts
  -> ../_shared/public-source-policy.ts
```

`supabase/functions/_shared/public-source-policy.ts:1-2` imports:

```ts
import { decodeHTML } from "entities";
import { DecodingMode, EntityDecoder, htmlDecodeTree } from "entities/decode";
```

These are bare specifiers, not `npm:` or `jsr:` imports. At the frozen reference:

- Root `package.json.dependencies.entities` is `^8.0.0`.
- No tracked `deno.json`, `deno.jsonc` or import-map file was found in the targeted tracked inventory.
- `deno.lock.specifiers` contains no entities entry.
- `deno.lock.npm` contains no entities package entry.
- `deno.lock.workspace.packageJson.dependencies` contains `npm:entities@8`. That is a workspace dependency declaration, not a resolved entities package/integrity entry.

With root package discovery disabled and the same unmodified configuration, these bare imports no longer have the explicit mapping supplied by the root manifest. The likely result is resolution failure; an actual failure was not run or claimed. More importantly, the requested claim that all required Edge dependency resolution remains unchanged cannot be established. A passing check that instead skips this policy module or masks its dependency would be unacceptable.

## Import-closure evidence

A read-only TypeScript AST walk parsed committed blobs via `git show` from the two exact roots. It followed relative imports and inspected static imports, export-from declarations, import-equals, import types, dynamic imports, require/createRequire calls and triple-slash references. It executed no application module.

The complete local closure was eight files:

- `supabase/functions/indexing-v3-agent/index.ts`
- `supabase/functions/indexing-v3-agent/behavior.ts`
- `supabase/functions/indexing-v3-agent/utils.ts`
- `supabase/functions/_shared/indexing-coverage.ts`
- `supabase/functions/_shared/ingestion-generation-visibility.ts`
- `supabase/functions/_shared/public-source-policy.ts`
- `supabase/functions/_shared/source-anchored-summary.ts`
- `supabase/functions/site-content-sync/index.ts`

External imports found were `jsr:@supabase/functions-js/edge-runtime.d.ts`, `npm:postgres@3.4.7`, `entities` and `entities/decode`. No dynamic literal import, nonliteral import/require expression or triple-slash dependency was found in that local closure. `site-content-sync/index.ts` adds no local import edge. This is repository-local graph inspection; it does not assert a fresh audit of all cached third-party package internals.

The observed root `deno.lock` SHA-256 remains `b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9`.

## Smallest next boundary

Do not run the single-variable route as if equivalence were established. A defensible next proposal needs an explicit Deno-only resolution for both entities exports, with the appropriate resolved version/integrity and transitive dependency evidence, while retaining both Edge roots and the public-source-policy module. The existing original Deno lock does not currently contain that resolved dependency, so merely adding the environment variable or asserting the old lock covers it is insufficient.

Any mapping/effective-lock reconciliation must be a separately scoped and reviewed tooling disposition; it must not relax `--frozen`, remove policy imports, change shared Node/Edge product import semantics, suppress type errors or absorb the whole root application dependency graph just to obtain green. Keep the original failed attempt and exact lock unchanged. The writer/gate owner owns any next authorized check after the equivalent is concrete.

This is a tooling/resolution blocker, not evidence that the U02 product correction failed. The controller-reported one focused GREEN and 103/103 affected-selector passes were not rerun or independently certified here. Edge remains failed/unaccepted until a valid equivalent actually passes.

Reviewer: `/root/plan_execution_review`, child `01a07b83-409b-7ab1-97aa-0585d48ea177`, previously observed locally as `gpt-6-astra` / `xhigh`. Only read-only source/log/lock/help inspection and AST parsing occurred. No repository writes, tests/type checks, installs, remote calls, workers, SQL or subagents were performed. Earlier reports remain unchanged; only this separate external disposition was authored.
