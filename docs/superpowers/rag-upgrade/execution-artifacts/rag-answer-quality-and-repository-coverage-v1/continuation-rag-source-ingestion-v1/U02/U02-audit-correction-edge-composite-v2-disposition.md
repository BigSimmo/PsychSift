# Composite-lock v2 supplemental disposition

**PASS for the bounded outside-lock metadata correction.** This is a compatibility disposition, not a passing Edge check. The gate owner retains responsibility for the actual frozen-check result.

I read the failed native attempt, the v2 preparation script/evidence and both external lock files. The captured failure requests canonical key placement and removal of root package discovery metadata before compilation; it does not show a product type error.

Independent read-only comparison confirms:

- V1's `workspace` contains only `packageJson`; v2 omits that workspace metadata.
- Ignoring object-key order, v2 equals v1 with exactly that workspace object removed.
- `specifiers` and `npm` keys are sorted.
- Every npm/JSR package identity, integrity, dependency edge and specifier resolution remains identical.
- None of the excluded top-level app override package names occurs in the Edge lock. The comparison normalizes version-qualified selectors such as `brace-expansion@1`, `@2` and `@5`. The nested overrides sit under `exceljs`, which is also absent, so they cannot affect this graph.
- The native two-entry import map is byte-identical to the previously reviewed map. Both prescribed Edge roots and the eight-file local closure remain required; no source exclusion or declaration remap is approved.
- Both repository locks retain their recorded hashes.

This metadata removal is consistent with the already approved `DENO_NO_PACKAGE_JSON=1` route: root application discovery is disabled, while the explicit Edge dependency resolutions remain preserved. It does not select new package versions or weaken the frozen check. The preparation script performs deterministic JSON normalization, not unfrozen dependency solving.

Verified SHA-256 values:

- V2 external lock: `6e5122daa4915ca299551e5f67251e910f38168a3f3ff02c8b67e693388bb6c6`.
- Unchanged native map: `be863301cacda4921a9bc2bedaba51b4caf907bfe80e8c7c216a6be98a6d6d93`.
- Original deno.lock: `b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9`.
- Original package-lock.json: `f969c2ddd1b058437b09eb61bf16b9ecc3bfb6ebb74539ec8e62ccdd7090e063`.

Keep the earlier failed attempt. Preserve the previous native-route boundaries, including the same roots/configuration, explicit external map/lock, `--frozen`, process-local environment restoration and no scripts, provider calls, type suppression or lock mutation. Record the actual v2 output and after-run identities separately. This disposition does not predict the result or establish runtime/deployment acceptance.

Reviewer: `/root/plan_execution_review`. No gate, test, network call, repository write or repeated broad inspection was performed. Only this separate external supplemental report was authored; previous reports remain unchanged.
