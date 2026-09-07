# U02 native dependency-resolution verification addendum

This controller disposition supersedes only the failed type-only map execution route in U02-edge-type-map-addendum.md. Preserve that route, its TS2749 failure, and the earlier frozen-lock failure. No product edits or successful Vitest reruns are needed. The type-only map did not reproduce Deno's internal npm type resolution; this route uses Deno's native npm resolver and the exact identities already pinned by both existing repository lockfiles.

Independent Astra/xhigh approval is in edge-composite-lock-disposition.md. Read it and U02-edge-composite-lock-evidence.json before execution. The outside composite retains every original Deno lock field and adds exactly one dependency-free entities 8.0.0 identity and integrity from the existing npm lock. The native map has only the two required bare imports. No new version was selected, no declaration substituted, and no repository lock/config was changed.

Run a new outside exclusive-coordinator wrapper with process-local DENO_NO_PACKAGE_JSON=1 and restore it afterward. Exact Deno command:

```text
deno check --frozen --node-modules-dir=false --lock=C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U02-edge-native-composite.deno.lock --import-map=C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U02-edge-native.importmap.json supabase/functions/indexing-v3-agent/index.ts supabase/functions/site-content-sync/index.ts
```

Require unchanged before/after hashes for:

- Original deno.lock: b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9.
- Original package-lock.json: f969c2ddd1b058437b09eb61bf16b9ecc3bfb6ebb74539ec8e62ccdd7090e063.
- Outside composite lock: 975139820ebc3f6c3d6ceadf810f485b194cb8ac9321d5bf1c5c201b8e3c5779.
- Outside native map: be863301cacda4921a9bc2bedaba51b4caf907bfe80e8c7c216a6be98a6d6d93.
- The already checked two product files.

Use U02-audit-correction-edge-native-lock as the new wrapper/log prefix. Keep both original Edge roots and every actual compiler error. Normal public restoration of these already locked packages is authorised. No reload, unfrozen solve, lifecycle script, private registry/provider, real document, source exclusion or repository dependency/config edit. If the check still fails, report its actual cause before any further change.

Report an actual successful result as the independently reviewed Edge compilation equivalent using native npm resolution and a composite of the two existing locks. Do not say the literal npm wrapper passed or that its automatic application-package resolution was repaired. This is compilation evidence, not runtime/provider/deployment acceptance. Preserve all earlier failed attempts and output, and record any observed package downloads accurately.

On exit 0 with all hashes unchanged, complete the two-file product candidate commit already authorised by the original corrective brief. Use its exact staged allowlist and process-local pre-commit bridge; no extra files or successful-test repeats. Append the new result, native route and candidate SHA to the existing report, then return the frozen head for the two independent full-range product reviews.
