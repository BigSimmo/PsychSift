# U02 Edge verification addendum

This additive execution note preserves the original U02 corrective brief/base and all previous failed check artifacts. It changes no product, dependency, lockfile, repository config or acceptance outcome by itself.

The frozen-lock attempt failed because Deno 2.9.4 discovered the unrelated root application dependency set. Disabling that discovery alone is insufficient: the Edge public-source-policy module imports entities and entities/decode. Independent Astra/xhigh execution review accepts the bounded type-check equivalent in edge-locked-type-map-disposition.md, with the exact installed entities 8.0.0 export declarations bound to package-lock and to the integrity-verified cached tarball (45 matching files). No fabricated declarations or skipped type failures.

Run once, through a new outside copy of the existing exclusive coordinator wrapper, using process-local DENO_NO_PACKAGE_JSON=1 and restoring the prior value afterward. Preserve the earlier wrapper/log unchanged. Exact Deno command:

```text
deno check --frozen --node-modules-dir=false --import-map=C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U02-edge-locked-types.importmap.json supabase/functions/indexing-v3-agent/index.ts supabase/functions/site-content-sync/index.ts
```

Both original Edge roots and their full local/explicit npm/jsr closure remain checked. The outside map contains only entities and entities/decode, mapped to their actual installed package exports.types entries. Keep the original root deno.lock frozen, SHA256 b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9, and package-lock.json SHA256 f969c2ddd1b058437b09eb61bf16b9ecc3bfb6ebb74539ec8e62ccdd7090e063. Verify both before and after. Record map and vendor declaration hashes and the unchanged product hashes; preserve actual Deno output/exit and any dependency download events. Do not retry unfrozen, edit locks/config/product, suppress compiler errors, or claim runtime/bundler/provider acceptance.

Report success only as the independently reviewed locked-type-map Edge compilation equivalent. The literal npm wrapper remains unrun for the accepted check; the earlier unmapped frozen-lock attempt remains failed. This equivalent is local compilation evidence, not application execution. Normal locked public dependency restoration is already authorised; no providers, private registry, real documents or lifecycle scripts.

Use output prefix U02-audit-correction-edge-type-map for the new wrapper and raw log. Append the result and precise route to the existing implementation report, retaining the previous failure section. If it passes with unchanged product/lock identities, the existing GREEN and 103/103 selector evidence remain valid: do not rerun them. Complete the authorised two-file candidate commit using the existing scoped pre-commit override and return its exact head for independent full-range product review. If it fails, retain the literal failure and report; no further ad hoc compatibility attempt is authorised by this addendum.
