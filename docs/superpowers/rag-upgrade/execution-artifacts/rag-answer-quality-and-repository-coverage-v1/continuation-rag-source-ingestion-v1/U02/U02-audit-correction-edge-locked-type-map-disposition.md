# Locked vendor type-map disposition

**Disposition: PASS for the proposed bounded Edge type-check equivalent.** The two explicit mappings restore the real installed package's declared type exports while disabling unrelated root application package discovery. This addresses the concrete bare-import blocker in `edge-package-discovery-disposition.md`. It does not certify a successful check before the gate owner runs it, and it supplies no runtime, bundler, deployment or provider acceptance.

## Accepted route

Use process-local `DENO_NO_PACKAGE_JSON=1`, restoring its previous state afterward, with:

```text
deno check --frozen --node-modules-dir=false --import-map <outside-map-path> supabase/functions/indexing-v3-agent/index.ts supabase/functions/site-content-sync/index.ts
```

The external import map has exactly two entries:

- `entities` maps to the file URL of the inspected installed `node_modules/entities/dist/index.d.ts`.
- `entities/decode` maps to the file URL of the inspected installed `node_modules/entities/dist/decode.d.ts`.

Resolve and record real file URLs and the external map's bytes/hash before execution. Do not use wildcard/prefix mappings, substitute declarations, stubs, `any` shims, additional compiler relaxations, `--no-check`, new source exclusions, or a changed repository configuration. The same two roots and eight-file repository-local closure remain included; `public-source-policy.ts` must still compile. Other explicit npm/JSR imports retain their original resolution under the unchanged frozen Deno lock.

The imported `.d.ts` files retain their real relative references/re-exports into the same installed package. Do not flatten or rewrite those files. If Deno cannot resolve that real transitive graph, reports type errors or requires a lock change, preserve the failure. This disposition does not authorize another fallback to suppress it.

## Why this preserves the relevant check

The prior rejected proposal disabled package discovery but supplied no resolution for two required bare imports. This proposal supplies the exact `exports.types` targets that the locked package declares for those two public entrypoints. It therefore preserves the source-facing API/type contracts rather than inventing permissive declarations or omitting the policy module.

Installed `entities/package.json` version is 8.0.0, matching `package-lock.json`'s exact resolved package version. The package is ESM and declares:

```json
{
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./decode": { "types": "./dist/decode.d.ts", "default": "./dist/decode.js" }
}
```

The real declaration surface includes `decodeHTML`, the `DecodingMode` enum, the `EntityDecoder` class and `htmlDecodeTree` used by `public-source-policy.ts`. The vendor package's runtime and declaration files exist; none is fabricated. The original check is a compilation/type-check gate, not a runtime execution gate. Use of its actual declared types is a valid bounded way to establish that compilation proof, provided its observed output succeeds without reducing repository source coverage.

## Observed identity and transitive evidence

Independently read and hashed during this review:

- `package-lock.json` SHA-256: `f969c2ddd1b058437b09eb61bf16b9ecc3bfb6ebb74539ec8e62ccdd7090e063`.
- Installed `entities/package.json` SHA-256: `86e28ac6361377a9c0a82dc7ce849b16bfcc6b13d862c563bbf9b3fe9267773a`.
- Locked version: `8.0.0`; installed version: `8.0.0`.
- Locked integrity: `sha512-zwfzJecQ/Uej6tusMqwAqU/6KL2XaB2VZ2Jg54Je6ahNBGNH6Ek6g3jjNCF0fG9EWQKGZNddNjU5F1ZQn/sBnA==`.

A read-only TypeScript AST walk of the two declaration roots found a seven-file declaration closure. All relative references have both a real JS target and a declaration counterpart, remain within the installed package and introduce no external/missing dependency:

| Relative declaration path | SHA-256 |
| --- | --- |
| dist/index.d.ts | 4ac4d5bbfd8b888d1298c90249a84e29eb039980125d30748f7fe58fa8f97198 |
| dist/decode.d.ts | 6e58fb5960ba31b5b3fc2e484ee27a170373098e3b53a59b938caac97fa1e83e |
| dist/decode-codepoint.d.ts | 064b9b22b6e5123762dad859f9cef4cc9a6c42ea53b0147ce82303f4f10a4b8d |
| dist/encode.d.ts | 2d6cb47725bff7664b0d6d411a5b7f1e5ea3d513ed8c36e91ad48d449b3fbf82 |
| dist/escape.d.ts | abaa29549e4f661f437edc3c0b17d6bf1b05132380c18399ec7ea2ebe9eb07d9 |
| dist/generated/decode-data-html.d.ts | b7d93c698f801b98c48953443ce741244a695f27ff2934d135c6689730022b19 |
| dist/generated/decode-data-xml.d.ts | 29d8aa980b3ced0f40d5a1f9821cb17568f078edea29f9dcf6708e1efdf886b0 |

The controller additionally supplied `entities-locked-cache-evidence.json` and `verify-entities-cache.py`. I read both. The verifier hashes the exact cached tarball against the package-lock SHA512 integrity, then compares the installed package manifest and every tarball dist file byte-for-byte. The supplied result records all 45 files matched, with no network requests. Its key hashes agree with my independent file hashes above. This reuses the controller's tarball-verification result; I did not rerun that verifier.

The recorded original `deno.lock` SHA-256 remains `b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9`. The gate owner must verify its byte identity before and after the actual check. The effective dependency evidence now consists of that frozen Deno lock for explicit npm/JSR dependencies, the unchanged npm package lock and integrity-bound entities files for these two type exports, and the exact external map.

## Acceptance and limitations

Retain the earlier failed Edge attempt. Record the actual new command, environment override, both roots, effective import map/hash, package/lock hashes, coordinator lease, Deno version, complete result and any permitted public dependency downloads. Only an actual exit 0 without unexpected skip or type-resolution weakening supplies passing evidence.

Label that evidence **“bounded Edge type-check equivalent using locked entities type exports”**. Do not report the literal npm wrapper passed, that the original automatic package-resolution route was fixed, or that this map is suitable for running/deploying the worker. A type-only map deliberately supplies no executable deployment resolution. U02's product assertions, specialist reviews and scoped acceptance remain separate.

No product or provider behavior changes, test changes, checker/framework additions, repository config edits, lock updates or declaration edits are required by this disposition. This is the final bounded compatibility route under review, not an open-ended tooling redesign.

Reviewer: `/root/plan_execution_review`, child `01a07b83-409b-7ab1-97aa-0585d48ea177`, previously locally observed `gpt-6-astra` / `xhigh`. I performed local source/package/declaration inspection, hashing and AST parsing only. No actual Deno check, test, install, remote/provider call, repository write or child-agent dispatch occurred. Earlier reports remain unchanged; only this separate external disposition file was authored.
