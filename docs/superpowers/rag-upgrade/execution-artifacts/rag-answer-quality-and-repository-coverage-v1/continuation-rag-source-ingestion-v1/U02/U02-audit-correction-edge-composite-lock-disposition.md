# Native Edge composite-lock disposition

**Disposition: PASS for the prepared bounded native-resolver route.** The external composite lock combines existing locked identities without selecting a new version, changing a product import, supplying substitute declarations or importing the root application's dependency set. The actual Deno check remains unrun by this reviewer and must succeed before Edge verification is accepted.

The earlier direct declaration-map attempt failed with the controller-reported TS2749 involving `DecodingMode` through a relative `.js` reference. Preserve that failed attempt and its earlier route review. It is not passing verification. This proposal restores native npm package export/type resolution instead of adding more declaration remaps.

## Prepared inputs reviewed

Under `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/`:

- `U02-edge-native-composite.deno.lock`
- `U02-edge-native.importmap.json`
- `U02-edge-composite-lock-evidence.json`
- `prepare-edge-composite-lock.py`

The exact import map is:

```json
{
  "imports": {
    "entities": "npm:entities@8.0.0",
    "entities/decode": "npm:entities@8.0.0/decode"
  }
}
```

The only additions to the copied version-5 Deno lock are:

```json
{
  "specifiers": {
    "npm:entities@8.0.0": "8.0.0"
  },
  "npm": {
    "entities@8.0.0": {
      "integrity": "sha512-zwfzJecQ/Uej6tusMqwAqU/6KL2XaB2VZ2Jg54Je6ahNBGNH6Ek6g3jjNCF0fG9EWQKGZNddNjU5F1ZQn/sBnA=="
    }
  }
}
```

This excerpt shows only the additions within the existing objects. I independently parsed the prepared file and confirmed that deleting exactly `specifiers['npm:entities@8.0.0']` and `npm['entities@8.0.0']` reproduces the original lock object exactly. Neither key was present in the original. All pre-existing field values, package resolutions, integrity data, workspace metadata and sections remain semantically unchanged. The original repository lock bytes remain unchanged; the external composite is intentionally a different artifact.

## Native package and lock compatibility

I inspected the current installed entities package and both repository locks locally:

- Installed version and `package-lock.json`'s exact package version are both **8.0.0**.
- The package has no dependencies, optional dependencies, peer dependencies, peer-dependency metadata or bundled dependencies. There is no additional package resolution to infer for this addition.
- Its `.` and `./decode` exports retain both real `types` and `default` targets. Mapping to `npm:` specifiers lets Deno apply those exports and its native package-internal module/type resolution together.
- The package's scripts include authoring commands and `prepublishOnly`; there are no preinstall/install/postinstall scripts in the inspected manifest. This check must not invoke package scripts or enable `--allow-scripts` regardless.
- The integrity is copied verbatim from the existing npm lock, not fabricated. The already reviewed `entities-locked-cache-evidence.json` binds the installed package manifest and 44 dist files to that exact SHA512-verified cached tarball. This disposition reuses that evidence rather than downloading or rerunning its verifier.
- The original Deno lock already represents dependency-free `postgres@3.4.7` with an integrity-only npm package object. The proposed entities entry follows that existing version-5 shape. Package subpath `/decode` selects an export from the same package; it is not a separate package or version.

Independently confirmed SHA-256 identities:

| Artifact | SHA-256 |
| --- | --- |
| Original repository deno.lock | b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9 |
| Original repository package-lock.json | f969c2ddd1b058437b09eb61bf16b9ecc3bfb6ebb74539ec8e62ccdd7090e063 |
| Installed entities/package.json | 86e28ac6361377a9c0a82dc7ce849b16bfcc6b13d862c563bbf9b3fe9267773a |
| External composite Deno lock | 975139820ebc3f6c3d6ceadf810f485b194cb8ac9321d5bf1c5c201b8e3c5779 |
| External native import map | be863301cacda4921a9bc2bedaba51b4caf907bfe80e8c7c216a6be98a6d6d93 |

## Authorized check boundary

With the assigned ingestion worktree as cwd and process-local `DENO_NO_PACKAGE_JSON=1`, the gate owner may use:

```text
deno check --frozen --node-modules-dir=false --lock=<absolute external composite lock> --import-map=<absolute external native map> supabase/functions/indexing-v3-agent/index.ts supabase/functions/site-content-sync/index.ts
```

Resolve those two placeholders to the prepared files above. Installed help documents both `--lock` and `--frozen`; the latter remains mandatory. Preserve the same two roots, eight-file local source closure and remaining configuration. Restore the prior environment value in finally. Normal public restoration of these already locked dependencies remains within current user authority; no source document, provider/application call, credentialed registry or lifecycle execution is included.

Before and after the run, bind the actual source head/diff, both repository locks, composite lock and import map to their hashes. Retain the coordinator lease, Deno version, literal command, full output and exit status. Both original locks and the effective composite must remain unchanged. A requested additional resolution, lock mutation, package-integrity mismatch, remaining resolver problem or type error stays a failure; do not use unfrozen solving, further remaps, type suppression, changed tests or broader dependency installation to clear it under this disposition.

This is a reviewed composition of two existing dependency authorities, not a claim that the original deno.lock alone covered entities. Report a successful actual result as **“native Edge type-check equivalent using the reviewed composite of existing locked dependencies.”** Do not call the literal npm wrapper passed or claim runtime/bundler/deployment/provider acceptance. The earlier failed checks, U02 product evidence and independent product reviews remain distinct.

## Review limits

Reviewer: `/root/plan_execution_review`, child `01a07b83-409b-7ab1-97aa-0585d48ea177`, previously locally observed `gpt-6-astra` / `xhigh`. This review inspected prepared external files, original locks, installed package metadata, help text and local hash/object comparisons. No actual Deno check, test, install, package download, remote/provider call, repository write or child-agent dispatch occurred. Earlier reports remain unchanged. Only this separate external disposition was authored.
