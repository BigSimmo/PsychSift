### Task 2: Add source-definition activation and controlled acquisition

**Files:**

- Create: `src/lib/public-source-activation-manifest.ts`
- Create: `src/lib/public-source-acquisition.ts`
- Create: `scripts/plan-public-source-acquisition.ts`
- Create: `scripts/fetch-approved-public-source-versions.ts`
- Create: `scripts/check-public-source-changes.ts`
- Create: `supabase/migrations/20260820121000_create_public_source_control_plane.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Create: `tests/public-source-activation-manifest.test.ts`
- Create: `tests/public-source-acquisition.test.ts`
- Modify: `tests/function-grants.test.ts`
- Modify: `tests/supabase-schema.test.ts`

**Interfaces:** Consumes `AustralianSourceDefinition`, `australianSourcePolicyVersion`, `SourceContentMode`, and exact-document licence policy from the accepted Australian-governance phase. Produces `PublicSourceActivationManifestV1`, `PublicSourceAcquisitionPlan`, exact-version lifecycle rows, and dry-run/fetch/change-detection CLIs that cannot activate content.

**Control-plane tables:**

- `public_source_activation_events`: append-only source catalogue key, policy version/digest, decision (`activate`, `quarantine`, `retire`), operator, reason, evidence references, created time.
- `public_source_versions`: immutable catalogue key, exact canonical/version URL, content hash, retrieved time, licence evidence digest, staging document ID, extraction/index generation, lifecycle (`discovered`, `shadow`, `approved`, `active`, `quarantined`, `tombstoned`), supersedes version, activation event.

Both tables are service-role only. State transitions occur through security-definer RPCs with fixed search paths and row locks. Source-definition activation and exact document-version publication remain two distinct approvals.

- [ ] **Step 1: Write acquisition boundary tests**

```ts
// tests/public-source-acquisition.test.ts
it("rejects excluded and link-only sources before network access", async () => {
  const fetch = vi.fn();
  await expect(planAcquisition({ catalogueKey: "etg-complete", url: "https://www.tg.org.au/", fetch })).rejects.toThrow(
    /link-only/i,
  );
  await expect(
    planAcquisition({ catalogueKey: "healthdirect", url: "https://www.healthdirect.gov.au/", fetch }),
  ).rejects.toThrow(/not in the active catalogue/i);
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects redirects off the exact allowlisted host and private network targets", async () => {
  await expect(validateAcquisitionUrl("http://127.0.0.1/internal", activeDefinition())).rejects.toThrow(
    /https|private/i,
  );
  await expect(validateRedirect("https://evil.example/file.pdf", activeDefinition())).rejects.toThrow(/allowlisted/i);
});
```

Also test bounded size/type, redirect count, DNS/IP rebinding check, content hash, duplicate version, exact policy digest, staging owner requirement, and no response body in logs/errors.

Add a trusted-page fixture whose navigation/footer contains a Healthdirect link. The acquisition/extraction contract must drop the chrome and link target; if the marker is in retained main content, the document is quarantined instead of indexed.

- [ ] **Step 2: Add manifest and SQL contract tests**

Activation manifests contain policy version/digest, catalogue key, decision, operator, reason, and evidence. Unknown/historical/link-only/excluded entries cannot receive `activate`. SQL tests pin append-only triggers, service-role grants, allowed transitions, and the rule that only `active` source definitions may create a fetch manifest.

- [ ] **Step 3: Run tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts`

Expected: FAIL on absent modules/migration.

- [ ] **Step 4: Implement dry-run plan then explicit fetch**

`plan-public-source-acquisition` accepts an operator-supplied exact URL/version list; it performs no search-engine discovery. It validates against the active catalogue and emits an immutable manifest. `fetch-approved-public-source-versions` requires the manifest path, expected count, manifest SHA-256, and `--apply`; without all four it prints the plan and exits without network/storage/database writes.

Fetched content is bounded, hashed while streaming, scanned through existing upload validation, and inserted as an owned staging document with provenance metadata. Link-only/excluded policy is rechecked before network, before upload, before enqueue, and in the worker/agent contract.

- [ ] **Step 5: Implement automatic change detection without activation**

`check-public-source-changes` uses only active catalogue entries and exact approved URLs. An unchanged hash records a bounded check event. A changed hash creates a `shadow` source version and owned staging document; it cannot set `active`, null the owner, publish, or supersede the current version. A withdrawal/tombstone signal removes the old version from new retrieval immediately through the controlled state RPC and queues human review; a replacement still requires both approvals.

- [ ] **Step 6: Verify locally and checkpoint**

Run: `node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/ingestion-enqueue.test.ts tests/ingestion-mutation-safety.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts`

Expected: PASS.

Run: `npm run check:migration-role`

Expected: PASS.

Format, review SSRF/secrets/licence/RLS boundaries, and conditionally commit:

```bash
npm run format
git add src/lib/public-source-activation-manifest.ts src/lib/public-source-acquisition.ts scripts/plan-public-source-acquisition.ts scripts/fetch-approved-public-source-versions.ts scripts/check-public-source-changes.ts supabase/migrations/20260820121000_create_public_source_control_plane.sql src/lib/supabase/database.types.ts tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts
git commit -m "feat(sources): stage approved public source versions"
```

---

