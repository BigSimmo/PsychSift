---
name: local-test-failures-windows
description: "Some npm run test failures are environmental on this Windows machine, not real breakage — all remaining ones are load-contention timeouts; the deterministic session-start-hook one was fixed 2026-08-18"
metadata:
  node_type: memory
  type: project
  originSessionId: e184e33f-a8c2-420c-b8f0-dbb9ddd6fc4d
  modified: 2026-08-18T10:21:15.644Z
---

`npm run test` on this machine reports failures that are **not** caused by the diff under test. Verify before chasing them:

- **`tests/session-start-hook.test.ts` — FIXED 2026-08-18, no longer expect this one.** It failed deterministically at `:142`, expecting a Windows path (`C:\Users\...\.node24\node-v24.19.0-...\bin`) while the hook, running under Git Bash, wrote the POSIX view (`/tmp/.../node-v24.19.0-linux-x64/bin`). The assertion now compares the path tail using the unique `mkdtemp` basename, which holds on both platforms and loses no strength. If this file goes red again it is a real signal, not the old environmental one.
- **`tests/codex-cloud-setup.test.ts` — times out at 30s under load, passes in isolation** (`:754`, "writes managed shell policy behaviorally"). Same contention class as the entries below; observed 2026-08-18 during a `verify:pr-local` run with several other agent sessions active.
- **`tests/worker-observability.test.ts` — times out at 30s under load, passes in isolation.** Resource contention when the full suite runs alongside other heavy commands.
- **`tests/http-readiness.test.ts` — "destroys stalled requests and resumes polling" counts one extra request under load** (`:61` expects 3, gets 4). Timing race in a polling test, same contention class. It imports only `scripts/lib/http-readiness.mjs` and node builtins, so it can never be implicated by a `src/`, `worker/`, or `supabase/` diff.
- **Whole-suite failure counts swing wildly under load.** On 2026-08-18 the same commit produced **10 failures across 8 files** on one `verify:pr-local` run and **2 failures across 2 files** on a re-run 20 minutes later, including a `@testing-library` DOM assertion that did not recur. Treat a double-digit failure count as a load signal, not a break signal, until the failing set is named.

**Why:** on 2026-08-18 two full-suite runs reported 3 and then 2 failures with **completely disjoint** file sets, which is the signature of environment/flake rather than a break. Confirmed by re-running the named files alone and by checking that neither the test nor the hook it exercises appeared in the diff.

**How to apply:** when a gate reports these two, check (a) whether the failing set differs between runs, and (b) whether the file is in `git diff origin/main..HEAD`. If both say unrelated, report them as pre-existing with that evidence rather than as verification debt — and never claim a suite is green when it is not. The flake ledger (`tests/flake-ledger.json`) is Playwright-only and intentionally empty, so it will not excuse either of these. Related: [[db-remediation-coordination-state]].
