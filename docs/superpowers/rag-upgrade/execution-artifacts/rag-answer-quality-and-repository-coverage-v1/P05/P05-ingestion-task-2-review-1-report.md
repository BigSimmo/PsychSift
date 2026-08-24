# P05 ingestion Task 2 review 1

## Findings

### P1 — DNS validation does not bind the actual outbound connection, so the fetch remains SSRF/rebinding-capable

Evidence: `src/lib/public-source-acquisition.ts:317-330` resolves the allowlisted hostname before `deps.fetch(...)`, performs the request through an independent fetch implementation, then resolves again and compares the two separately observed address sets. The live adapter supplies `globalThis.fetch` independently from `dns.lookup` (`scripts/fetch-approved-public-source-versions.ts:89-96`). Nothing forces the HTTP/TLS socket to connect to one of the vetted addresses or proves its remote address. An attacker-controlled resolver can therefore answer public to the explicit pre/post lookups and private to the fetch transport's lookup. The handwritten non-global classifier is also incomplete: its IPv4 list ends at multicast `224.0.0.0/4` and its IPv6 list omits other non-global ranges (`src/lib/public-source-acquisition.ts:77-106`). A provider-free probe confirmed that `240.0.0.1` and `2001:db8::1` are both accepted as resolved targets.

Trigger/failure path: use an exact allowlisted HTTPS hostname whose authoritative DNS changes answers per query, or returns a reserved/non-global address outside the local list. The explicit lookups pass while the independently resolved fetch connects somewhere the control did not authorize.

Expected: every redirect hop must connect only to a validated global-unicast address, with hostname/SNI/certificate verification retained, and the response must be attributable to that address.

Actual risk: the acquisition runner can reach link-local/private/internal services despite the apparent SSRF gate. This is a blocking security boundary defect.

Smallest proof/fix: add a transport test in which the resolver used by validation remains public while the fetch transport attempts a different/private address, and require rejection. Use a validated-address-aware transport/dispatcher whose lookup callback is pinned to the vetted address set (or connect to a vetted IP with correct Host/SNI and verify the remote address), repeat that binding for every redirect, and replace the partial CIDR list with a reviewed global-unicast classifier.

### P1 — Retained eTG/AMH protected content crosses the storage and enqueue boundaries, and there is no worker backstop

Evidence: the retained-page guard checks only `/healthdirect/i` (`src/lib/public-source-acquisition.ts:525-550`). It contains no eTG, Therapeutic Guidelines, AMH, or Australian Medicines Handbook rejection. The live `scan` implementation accepts every input (`scripts/fetch-approved-public-source-versions.ts:97-98`), and its enqueue adapter discards the source-policy arguments and sends only document identity/owner/status (`scripts/fetch-approved-public-source-versions.ts:160-166`). No worker or `indexing-v3-agent` source-policy check exists; a repository search for Healthdirect/eTG/AMH/source-catalogue/licence/content-mode guards in those owners returned no matches.

Provider-free proof: `evaluateTrustedPageContent` returned `eligibleForIndex: true` for both synthetic retained AMH and eTG main text. A full mocked `acquirePublicSourceVersion` call using a valid WA Health plan and retained `Australian Medicines Handbook protected excerpt` completed both staging and enqueue (`{"staged":true,"enqueued":true}`).

Expected: Healthdirect remains excluded and eTG/AMH protected content remains link-only at every discoverable boundary. Declared protected identities must fail before networking; locally discovered protected identity/content must fail before Storage and enqueue; the worker must independently fail closed before extraction/provider/index artifacts.

Actual risk: protected link-only content can be stored, queued, extracted, embedded, and indexed under an otherwise approved catalogue key. The accepted P02 catalogue-key guard is necessary but not sufficient for content discovered after fetch.

Smallest proof/fix: centralize/reuse the accepted forbidden-source identity matcher, apply it to locally retained/extracted content and provenance before Storage and enqueue, implement a worker/agent policy recheck before provider/index work, and add synthetic HTML/plain/PDF-extraction tests for Healthdirect, eTG/Therapeutic Guidelines, AMH/Australian Medicines Handbook, plus chrome-only Healthdirect acceptance.

### P1 — A source-version row is not bound to the exact staged bytes or the exact P02 publication receipt

Evidence: `stage_public_source_version` validates owner plus a small metadata subset (`supabase/migrations/20260820121000_create_public_source_control_plane.sql:267-283`) but inserts caller-supplied canonical URL, exact URL/version, content hash, retrieved time, and licence digest without comparing them with the document row/metadata (`:285-312`). `staging_document_id` has only a non-unique index and the sole uniqueness constraint is `(source_catalogue_key, exact_version_url, content_hash)` (`:41-48`), so one staged document can back multiple contradictory version rows. On activation, `transition_public_source_version` accepts any approved publication row for the same document/catalogue/policy (`:374-382`); it does not bind the version to the document's exact `publication_approval_id`, reviewed state digest, reviewed generation, manifest digest, exact URL/version/hash, or licence evidence. This is weaker than the accepted P02 owner, which binds approval ID, reviewed state digest, source identity, and reviewed generation (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:446-460`).

Trigger/failure path: while an owned document is staged, call `stage_public_source_version` twice with the same document/event but different valid exact URL/hash/licence payloads. Advance both rows to `approved`, publish the document once through P02, then transition both rows to `active` with the same source activation event. The current constraints and checks permit the second, unreviewed exact-version claim to reuse the first document publication approval.

Expected: source-definition activation and exact-version publication are distinct and both exact. A version row must be immutable in identity, one-to-one with its staged document/receipt, and activatable only by the exact P02 approval/state/generation that reviewed it.

Actual risk: the control plane can label an unreviewed URL/hash/licence tuple active even though only another state of the document was published, defeating provenance and licence evidence.

Smallest proof/fix: add a scratch-Postgres regression for the two-row/reused-approval sequence; make `staging_document_id` unique or introduce an explicit immutable acquisition receipt identity; validate every inserted version field against document metadata/content hash and the latest source event; store/bind the exact publication approval ID, reviewed state digest, and reviewed generation; and protect immutable identity columns with a trigger while allowing only controlled lifecycle fields to change.

### P1 — HTML staging declares the upstream hash for different, transformed bytes

Evidence: `readBoundedBody` hashes the raw response bytes (`src/lib/public-source-acquisition.ts:286-314`). For HTML, `validateFetchedContent` replaces those bytes with decoded main text but returns the original raw `contentHash` (`:489-509`). The live adapter uploads the transformed `candidate.bytes` while writing `candidate.contentHash` to `documents.content_hash` (`scripts/fetch-approved-public-source-versions.ts:110-130`).

Provider-free proof: a full synthetic HTML acquisition produced `storedType: "text/plain"` and `storedHashMatchesDeclared: false`.

Expected: the immutable original-source hash must verify the stored original bytes, while any retained/extracted derivative has its own generation/content hash and lineage back to the original.

Actual risk: the Storage object cannot be verified by `documents.content_hash`; exact-version deduplication and later P02 state review attest to bytes that are not present; original HTML evidence/chrome is discarded; and citation lineage to the original file hash is false.

Smallest proof/fix: preserve the bounded raw response as the owned source object with its raw hash, feed retained text as a separately hashed extraction artifact/generation, and add a test that hashes the exact staged Storage payload plus a lineage assertion between original and derivative hashes.

### P2 — Change detection trusts an unbound `--current` file and can tombstone a different catalogue source

Evidence: apply confirmation binds only the acquisition manifest count and SHA; the current-version file has no digest/receipt confirmation (`scripts/check-public-source-changes.ts:118-130`). The code trusts the file's `catalogueKey -> versionId` pairing (`:120-124`), then the live tombstone path calls `transition_public_source_version` using only that supplied version ID and lifecycle (`:88-94`). The SQL transition selects by ID and checks lifecycle, but never checks an expected catalogue key/URL/hash from the plan (`supabase/migrations/20260820121000_create_public_source_control_plane.sql:336-341`).

Trigger/failure path: supply a `current.json` row keyed as `wa-health` whose version ID belongs to an active TGA row. A 404/410 from the WA URL authorizes the WA plan but tombstones the TGA version if its lifecycle matches.

Expected: change detection must derive and lock the current version from persisted state by exact catalogue/document identity, or cryptographically bind reviewed current-state evidence and revalidate that complete identity in SQL immediately before mutation.

Actual risk: stale, mistaken, or tampered local evidence can withdraw unrelated active source content and create a false audit trail.

Smallest proof/fix: move current-version lookup and tombstone into one security-definer RPC keyed by catalogue key plus exact URL/version/hash and expected lifecycle, or at minimum require a current-evidence SHA and have the RPC assert the version belongs to the supplied plan identity under lock. Add a cross-key version-ID regression.

### P2 — Scanner/provider diagnostic text is copied verbatim into CLI errors

Evidence: `scan.reasonCode` is an unrestricted string and is interpolated directly into the thrown error (`src/lib/public-source-acquisition.ts:476-483,506-508`). The CLI prints `error.message` verbatim. The existing response-body test does not exercise scanner/provider diagnostics.

Provider-free proof: a synthetic rejected scanner result with reason `SENTINEL-PROTECTED-CONTENT` produced an error containing that exact sentinel (`{"sentinelLeaked":true}`).

Expected: logs and errors contain only fixed bounded reason codes; no document text, source excerpt, provider detail, identifier, URL credential, or secret can be echoed.

Actual risk: a scanner/provider adapter that includes an excerpt or operational detail in `reasonCode` leaks it through stderr/controller logs.

Smallest proof/fix: change the scan result to a closed reason-code enum, map unknown values to `blocked`, redact all Supabase/Storage/provider failures through an existing safe-error helper, and add sentinel tests for scanner, Storage, database, and enqueue error surfaces.

## Reviewed range and artifacts

- TASK_BASE: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- TASK_HEAD/current HEAD: `38bef52bf7c0c41466f2a0a9cd9a6f8635e2c0a9`
- Merge base: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- Complete range: one commit, `38bef52bf feat(sources): stage approved public source versions`; 13 files, 2,520 insertions, 2 deletions.
- Task brief SHA-256: `9bb4012ec1cd5b1db1c7dbd6eae405eb08766c496562336fdc36567bb24dfcf7`
- Implementer report SHA-256: `ca6aec9fc7cce64746c23123dc856faf35dee9c2dc1cabb54bddb9af2596db11`
- Repository-canonical full-range review package SHA-256: `b0e64185bf0162ecac4918d3443096d99ab721b6313d9d3cec4f760967d2fd76`
- Governing ingestion/re-index plan SHA-256: `044d1a6bcae3a26425afb58fa4d0f4f9136c68d3c7043d56049245c352ba7b91`
- Governing trusted-ingestion design SHA-256: `b313cda8e7d27ebdc8c4b14942daf31722de95ba6f8ea00f87769ddc1eb9ca1b`
- Accepted P02 phase-review report SHA-256: `8072a760455f7c08b60b00a6bb274e2cf15769c52321e4aa173db2584fbe135b`
- Accepted P04 phase-review report SHA-256: `91abc19ac8c85de5aba9eb95855dfbd3aeecff0fc7b6bc54e4fdcda78427eef5`

The brief, implementer report, repository-canonical review package, governing plan, governing design, accepted P02/P04 phase reports, P02 catalogue/source metadata/publication owners, P04 ingestion-audit source-policy owner, and exact-head changed source/tests were read. `npm run ledger:lookup -- 38bef52bf7c0c41466f2a0a9cd9a6f8635e2c0a9 --scope "P05/ingestion/task-2 SDD review-1"` reported `NOT REVIEWED at this HEAD and scope`.

## Commands and results

- Artifact SHA-256 verification — PASS; all three supplied hashes matched exactly.
- `git cat-file`, `git merge-base`, `git log`, full `git diff --name-status`, `git diff --stat`, and complete canonical package inspection — PASS for the requested immutable range.
- `git diff --check 0d5bb6a5012bd762bb53790ac24de16c7e3078c8..38bef52bf7c0c41466f2a0a9cd9a6f8635e2c0a9` — PASS; no output.
- `node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/ingestion-enqueue.test.ts tests/ingestion-mutation-safety.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts` — PASS; 6 files, 122/122 tests, exit 0. This passing selector does not cover the failures above.
- `npm run check:migration-role` — PASS; hosted migration role guard reported `postgres` usage and unchanged immutable applied history.
- Provider-free protected-content probe — FAIL as a product boundary: AMH/eTG retained text was eligible; full mocked acquisition staged and enqueued AMH text.
- Provider-free address-classifier probe — FAIL as a product boundary: `240.0.0.1` and `2001:db8::1` were accepted.
- Provider-free HTML lineage probe — FAIL as a product boundary: staged bytes did not match the declared content hash.
- Provider-free diagnostic-redaction probe — FAIL as a product boundary: the synthetic scanner sentinel was copied into the error.

No broad duplicate gate, browser/server check, live/provider gate, network-backed evaluation, or database replay was run.

## No-live and no-document confirmation

This review performed only local repository reads, static checks, the repository test wrapper, and synthetic in-memory probes. No actual document, PDF, corpus payload, source site, user data, OCR/extraction output, embedding, or index was read or processed. No source fetch, network request, provider call, Supabase/database connection, Storage operation, queue mutation, migration apply/replay, re-index, activation, tombstone, deployment, hosted CI action, commit, push, stage, or PR action occurred. The migration remains source-only and unapplied.

## Verdicts

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
