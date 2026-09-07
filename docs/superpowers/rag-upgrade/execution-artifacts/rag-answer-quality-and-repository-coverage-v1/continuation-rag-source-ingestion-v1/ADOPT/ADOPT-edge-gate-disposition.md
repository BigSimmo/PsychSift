# Edge verification route disposition

**Disposition: PASS for the proposed frozen-lock verification route's consistency with current local-check authority.** The actual check remains unrun by this reviewer. This resolves the route-compatibility uncertainty in item 1 of `plan-execution-review-1.md`; it does not alter that immutable report or claim a product/test pass.

The user's current supplied AGENTS instructions expressly permit normal dependency restoration from an existing lockfile. Their current execution request authorizes focused local verification. A check that restores only the public dependencies pinned by the existing lock, without running application code or lifecycle scripts, falls within that authority. The earlier blanket no-network interpretation was broader than this instruction. Downloading a public provider SDK dependency does not itself call that provider's application API.

The accepted invocation shape is:

```text
deno check --frozen --node-modules-dir=false <the exact sorted entrypoints discovered by scripts/check-edge-functions.mjs>
```

Use the assigned ingestion worktree as cwd, the same configuration/import resolution as the existing wrapper, and the same complete immediate `supabase/functions/*/index.ts` entrypoint set. Resolve the placeholder to observed paths before the check. Do not add `--reload`, `--allow-scripts`, run/test/task execution, a different config/import map, or a lock update to clear a failure.

Local evidence inspected for this disposition:

- `scripts/check-edge-functions.mjs` discovers the roots at lines 6-11 and invokes `check --node-modules-dir=false` at line 19; adding `--frozen` strengthens dependency identity without reducing its type-check root coverage.
- `deno check --frozen --node-modules-dir=false --help` exited 0. This was help-only parsing, not compilation or network access. Installed help documents `--frozen` as an error when the lockfile is out of date and describes check as downloading/type-checking without execution.
- Root `deno.lock` exists and is tracked, format version 5. At inspection its working-tree bytes match HEAD's Git blob `3ce6adee7b776149e45333ffb88c12b99d97f573`.
- Observed `deno.lock` SHA-256: `b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9`.
- Its explicit specifier records use public JSR/npm packages; no remote document or source acquisition is required by this route. The normal registry request exposure is public package identifiers and ordinary download metadata, not document contents, prompts, credentials or application/provider payloads.

Before and after execution, the gate owner must compare the exact lock bytes/hash and retain the actual command, Deno version, root list, exit status and output. A lock mismatch, missing pinned dependency, unsupported resolution, compilation error or permission failure remains a failure/blocker. Do not regenerate the lock or expand access to a private registry, credentialed endpoint, source document, model asset or application service under this disposition. Existing capability and coordinator rules still apply; this does not authorize installs overlapping another protected repository run.

Report a successful result as **“frozen-lock equivalent of check:edge:functions passed”**, with the actual command and whether public locked dependency downloads occurred. Do not call it the literal npm wrapper passing or claim that it was network-free when downloads occurred. It is provider-free application verification with specifically permitted dependency restoration.

The controller may now complete this local-check capability gate using that route without another routine authorization request. Only an actual successful check on the corrective code and unchanged lock can supply the required Edge verification evidence. The U02 product reviews, focused regression results, immutable original-range review and acceptance record remain mandatory.

Reviewer identity remains `/root/plan_execution_review`, child `01a07b83-409b-7ab1-97aa-0585d48ea177`, locally observed `gpt-6-astra` / `xhigh` as recorded in the original review. This bounded disposition used read-only local source/lock/help inspection. No repository edits, tests/type checks, installs, dependency downloads, remote/provider calls, SQL, workers or subagents were performed. Only this separate external disposition file was authored.
