# Edge offline gate feasibility — Deno 2.9.4

## Verdict

**BLOCKED for the proposed full-entrypoint offline command.** The proposed flags cannot compile the repository's actual Edge import graph. Two bounded synthetic probes establish concrete tooling incompatibilities, without running repository tests/typechecking or contacting providers.

1. `deno check` rejects `--no-prompt` in installed Deno 2.9.4. The flag does not appear in `deno check --help=full`. The general Deno help documents `DENO_NO_PROMPT` as the environment equivalent.
2. After replacing the flag with `DENO_NO_PROMPT=1`, `--no-npm` rejects `npm:postgres@3.4.7` outright. It is not a cached-only mode. The real strict Edge entrypoint requires that exact import.

Do not report `check:edge:functions` as passing, infer that cache availability fixes this rejection, remove required imports/types, or call a narrower local-module check equivalent to the complete Edge gate.

## Inspected scope

Repository `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`; root instructions and earlier preflight remain applicable. Read only the existing Edge checker, tracked function paths, relevant function import headers, and root `deno.lock`; consulted installed `deno check --help`, `deno check --help=full`, and general Deno help. No repository edits or native document processing occurred.

Tracked entrypoints:

```text
supabase/functions/indexing-v3-agent/index.ts
supabase/functions/site-content-sync/index.ts
```

`indexing-v3-agent/index.ts:1-2`:

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
```

Tracked `deno.lock` version 5 binds the JSR Supabase functions package at 2.108.2, postgres at 3.4.7, and includes an npm OpenAI dependency of the JSR package. Lock presence establishes pinned dependency identities, not local cache completeness.

The checker calls `deno check --node-modules-dir=false` over the entrypoints. Installed help says this mode resolves npm packages from global cache; it does not promise to prohibit acquisition on cache miss. `--deny-import` documents denial of remote host imports; the inspected help does not establish it as a complete cache-only constraint for npm registry metadata/tarball acquisition. Do not remove `--no-npm` and assume the remaining flags prove no network. `--no-remote` is documented as disabling remote module resolution, not as allowing cached remote imports while blocking downloads.

Although the source includes provider `fetch` calls, `deno check` does not execute application code. The uncertainty concerns dependency acquisition during graph construction, not execution of ingestion or provider calls inside these modules.

## Actual synthetic evidence

Probe files are outside the repository, in:

`C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/edge-offline-probe/`

`pure.ts` contains only `export const value: number = 1;`.

`npm.ts` contains only `import postgres from "npm:postgres@3.4.7"; export const client = postgres;`.

First attempted command shape:

```text
deno check --deny-import --no-npm --no-prompt --no-config --no-lock --node-modules-dir=false <synthetic file>
```

Both files exited 1 with:

```text
error: unexpected argument '--no-prompt' found
```

This is parser failure and provides no typechecking evidence.

Corrected probe used process-local `DENO_NO_PROMPT=1`, `DENO_NO_UPDATE_CHECK=1`, and `DENO_NO_PACKAGE_JSON=1`, restoring prior values in `finally`, with:

```text
deno check --deny-import --no-npm --no-config --no-lock --node-modules-dir=false <synthetic file>
```

Actual results:

```text
Check edge-offline-probe/pure.ts
PURE_EXIT=0
error: npm specifiers were requested; but --no-npm is specified
    at file:///C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/edge-offline-probe/npm.ts:1:22
NPM_EXIT=1
```

The pure probe establishes accepted syntax and local checking. The npm probe establishes a required dependency class is prohibited by the proposed safety flag before its contents can be checked. No external package download was requested by this probe. No real function entrypoint was passed to Deno.

## Safe disposition

Retain the full Edge gate as **blocked: no verified supported cache-only acquisition mode for the required JSR/npm graph** under the current no-network authority. Installed local help and these probes do not establish a full offline equivalent. The parent can continue only according to its accepted gate/blocker policy; this report does not waive the gate.

A future exact full check requires a separately verified environment-level network-denied Deno execution that permits reading its already complete cache, or a separately reviewed complete local dependency mapping/vendor arrangement. Neither is established here; neither should be improvised by copying declarations, stubbing packages, weakening checks, or altering product imports. A narrowed check of only local shared modules could provide partial compilation evidence if explicitly selected, but would leave this complete gate unclosed.

This report and two tiny synthetic probe files are the only artifacts authored by this follow-up. No repository tests/typecheck, worker, SQL, install, fetch, browser, provider, configuration changes, or untracked repository enumeration were performed.

## Follow-up: deny-import alone does not block npm acquisition

The earlier artifact/no-fetch statement applies to the initial probe only. A subsequently authorized bounded loopback probe established a decisive counterexample: **`--deny-import` does not prohibit npm registry acquisition in installed Deno 2.9.4.** Therefore dropping `--no-npm` cannot be certified as a safe offline full-graph solution.

The follow-up created a new outside-repository file `edge-offline-probe/npm-deny-import/fake-npm.ts` with only:

```typescript
import value from "npm:codex-offline-permission-probe-never-published@0.0.0";
export { value };
```

It used a previously nonexistent isolated `DENO_DIR` under that directory, fixed the unscoped npm registry to `http://127.0.0.1:1`, disabled update checking, package-json discovery and prompts, disabled inherited proxies, set `NO_PROXY=*`, and cleared selected package/import token variables without printing values. All process-local settings were restored afterward. No server was started; the loopback port refused connection.

Exact Deno argument shape:

```text
deno check --deny-import --no-config --no-lock --node-modules-dir=false <outside-path>/fake-npm.ts
```

Decisive observed output:

```text
Download http://127.0.0.1:1/codex-offline-permission-probe-never-published
error: Failed loading http://127.0.0.1:1/codex-offline-permission-probe-never-published for package "codex-offline-permission-probe-never-published"
... tcp connect error: No connection could be made because the target machine actively refused it. (os error 10061)
FAKE_NPM_EXIT=1
```

The result is a refused loopback acquisition attempt, not an import-permission denial. No external registry or provider was requested. This single npm counterexample is sufficient to reject the combined no-acquisition claim, so no additional JSR probe was performed. Cached npm/JSR graph acceptance is still unproven; this result does not establish whether any particular cached graph would compile.

The full Edge gate remains blocked unless a separately verified network-denied execution boundary or reviewed complete local mapping supplies the missing guarantee. No real Edge graph, repository test/typecheck, installation, document processing, or repository mutation was performed. The fake module and isolated temporary Deno cache remain outside the repository as bounded probe artifacts.
