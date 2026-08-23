### Task 1: Define the versioned Australian catalogue

**Files:**

- Create: `src/lib/australian-source-catalogue.ts`
- Modify: `src/lib/types.ts`
- Create: `data/australian-source-verification.v1.json`
- Create: `tests/australian-source-catalogue.test.ts`
- Modify: `tests/check-indexing-contract.test.ts`
- Modify: `tests/registry-corpus.test.ts`

**Interfaces:**

Consumes the canonical evaluation-owned source scope/role vocabularies and reviewed official-source metadata manifest. Produces `AustralianSourceDefinition`, `australianSourcePolicyVersion`, lookup/indexability functions, and the fail-closed catalogue assertion below.

```ts
// Import the canonical SourceCorpusScope and ClinicalSourceRole aliases seeded
// by evaluation Task 1; do not redefine either vocabulary here.
export type SourceContentMode = "indexed_content" | "link_only";
export type SourceLifecycle = "active" | "historical" | "retired";
export type SourceLicencePolicy =
  "review_required" | "public_index_permitted" | "metadata_link_only" | "index_forbidden";

export type AustralianSourceDefinition = Readonly<{
  key: string;
  publisherCode: string;
  publisher: string;
  canonicalUrl: string;
  jurisdiction: string;
  corpusScope: "australian_public";
  roles: readonly ClinicalSourceRole[];
  contentMode: SourceContentMode;
  licencePolicy: SourceLicencePolicy;
  lifecycle: SourceLifecycle;
  fallbackRank: number;
}>;

export const australianSourcePolicyVersion = "australian-source-policy-v1" as const;
export function australianSourceByKey(key: string): AustralianSourceDefinition | null;
export function isIndexableAustralianSource(key: string, exactDocumentLicence: SourceLicencePolicy): boolean;
export function assertIndexableCatalogueEntry(
  source: AustralianSourceDefinition | null,
): asserts source is AustralianSourceDefinition;
```

- [ ] **Step 1: Write the catalogue invariants first**

```ts
// tests/australian-source-catalogue.test.ts
import { describe, expect, it } from "vitest";
import {
  australianSourceByKey,
  australianSourceCatalogue,
  australianSourcePolicyVersion,
  assertIndexableCatalogueEntry,
  isIndexableAustralianSource,
} from "@/lib/australian-source-catalogue";
import { sourceAuthorityForPublisherCode } from "@/lib/source-authority-registry";

describe("Australian source catalogue", () => {
  it("keeps Healthdirect completely outside the catalogue", () => {
    expect(
      australianSourceCatalogue.some((source) =>
        /healthdirect/i.test(`${source.key} ${source.publisher} ${source.canonicalUrl}`),
      ),
    ).toBe(false);
  });

  it("makes eTG and AMH authenticated link-only references", () => {
    for (const key of ["etg-complete", "australian-medicines-handbook"]) {
      expect(australianSourceByKey(key)).toMatchObject({
        roles: ["reference_link"],
        contentMode: "link_only",
        licencePolicy: "metadata_link_only",
        lifecycle: "active",
      });
      expect(isIndexableAustralianSource(key, "public_index_permitted")).toBe(false);
    }
  });

  it("forbids link-only references from every content-bearing index projection", () => {
    for (const key of ["etg-complete", "australian-medicines-handbook"]) {
      expect(() => assertIndexableCatalogueEntry(australianSourceByKey(key))).toThrow(/link-only/i);
    }
  });

  it("marks NPS MedicineWise historical rather than current", () => {
    expect(australianSourceByKey("nps-medicinewise")).toMatchObject({ lifecycle: "historical" });
    expect(isIndexableAustralianSource("nps-medicinewise", "public_index_permitted")).toBe(false);
  });

  it("contains unique stable keys, codes, URLs, and a versioned policy", () => {
    expect(australianSourcePolicyVersion).toBe("australian-source-policy-v1");
    expect(new Set(australianSourceCatalogue.map((source) => source.key)).size).toBe(australianSourceCatalogue.length);
    expect(australianSourceCatalogue.every((source) => new URL(source.canonicalUrl).protocol === "https:")).toBe(true);
  });

  it("reuses exactly one existing authority identity per indexed catalogue entry", () => {
    for (const source of australianSourceCatalogue.filter((entry) => entry.contentMode === "indexed_content")) {
      expect(sourceAuthorityForPublisherCode(source.publisherCode)?.key).toBeTruthy();
    }
  });

  it("does not treat an official publisher root as document-level indexing permission", () => {
    expect(australianSourceByKey("wa-health")?.licencePolicy).toBe("review_required");
    expect(isIndexableAustralianSource("wa-health", "review_required")).toBe(false);
    expect(isIndexableAustralianSource("wa-health", "public_index_permitted")).toBe(true);
  });
});
```

- [ ] **Step 2: Prove the new module is absent**

Run: `node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts`

Expected: FAIL because the catalogue module does not exist.

- [ ] **Step 3: Implement the explicit catalogue**

Include these keys and canonical roots:

| Key                                   | Canonical URL                                                                       | Role/lifecycle                                |
| ------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| `wa-health`                           | `https://www.health.wa.gov.au/About-us/Policy-frameworks`                           | service policy, active                        |
| `wa-chief-psychiatrist`               | `https://www.chiefpsychiatrist.wa.gov.au/laws-and-rights/standards-and-guidelines/` | clinical guideline/quality standard, active   |
| `wa-legislation`                      | `https://www.legislation.wa.gov.au/`                                                | legal, active                                 |
| `tga`                                 | `https://www.tga.gov.au/`                                                           | regulatory/safety alert, active               |
| `acsqhc`                              | `https://www.safetyandquality.gov.au/`                                              | quality standard, active                      |
| `australian-health-disability-ageing` | `https://www.health.gov.au/`                                                        | official programme/guideline roles, active    |
| `nhmrc`                               | `https://www.nhmrc.gov.au/guidelines`                                               | clinical guideline, active                    |
| `ranzcp`                              | `https://www.ranzcp.org/clinical-guidelines-publications`                           | clinical guideline, active                    |
| `racgp`                               | `https://www.racgp.org.au/clinical-resources/clinical-guidelines`                   | clinical guideline within scope, active       |
| `pbs`                                 | `https://www.pbs.gov.au/`                                                           | subsidy, active                               |
| `australian-prescriber`               | `https://australianprescriber.tg.org.au/`                                           | professional review, active                   |
| `etg-complete`                        | `https://www.tg.org.au/`                                                            | reference link, link-only                     |
| `australian-medicines-handbook`       | `https://shop.amh.net.au/`                                                          | reference link, link-only                     |
| `nps-medicinewise`                    | `https://www.medicinewise.org.au/`                                                  | historical only                               |
| `nsw-health`                          | `https://www.health.nsw.gov.au/`                                                    | NSW-labelled service/clinical fallback        |
| `queensland-health`                   | `https://www.health.qld.gov.au/`                                                    | Queensland-labelled service/clinical fallback |
| `sa-health`                           | `https://www.sahealth.sa.gov.au/`                                                   | SA-labelled service/clinical fallback         |
| `victoria-health`                     | `https://www.health.vic.gov.au/`                                                    | Victoria-labelled service/clinical fallback   |
| `tasmania-health`                     | `https://www.health.tas.gov.au/`                                                    | Tasmania-labelled service/clinical fallback   |
| `nt-health`                           | `https://health.nt.gov.au/`                                                         | NT-labelled service/clinical fallback         |
| `act-health`                          | `https://www.health.act.gov.au/`                                                    | ACT-labelled service/clinical fallback        |

All active indexed-content publisher roots in this table default to `licencePolicy: "review_required"`; eTG/AMH are `metadata_link_only`, and historical NPS is `index_forbidden`. The seven non-WA state/territory definitions are lower-priority active fallbacks. They are eligible only after uploaded-local and Australian national/WA coverage is insufficient, and every answer keeps the jurisdiction label. Add no generic domain wildcard and no auto-trust based on `.gov.au`.

`data/australian-source-verification.v1.json` is the reviewed, content-free source-verification input for offline/local and ordinary internet-disabled Cloud work. Each row records catalogue key, canonical URL, publisher identity, licence/content mode, checked-at date, reviewer role, and evidence reference; it contains no fetched clinical content. A connected read-only reviewer must verify current official URLs and licence modes before the manifest is accepted or refreshed. Offline Cloud may implement and test only from the committed reviewed manifest and must report source-current acceptance as unrun when that connected checkpoint has not occurred.

Replace the unrelated valid-registry fixture `registry_record_id: "amh"` in `tests/check-indexing-contract.test.ts` with a neutral synthetic service identifier. Add a negative contract proving eTG/AMH cannot become a `RegistryCorpusEntry`: `src/lib/registry-corpus.ts` always creates content/chunks/embeddings and is therefore forbidden for link-only references.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts tests/check-indexing-contract.test.ts tests/registry-corpus.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Review and checkpoint**

Compare every entry to the committed reviewed verification manifest. A changed URL or licence is a policy review, not a silent edit. Official-page verification is a separately authorized connected read-only checkpoint; never make an ordinary internet-disabled Cloud implementer browse or claim it. Format and conditionally commit:

```bash
npm run format
git add src/lib/australian-source-catalogue.ts src/lib/types.ts data/australian-source-verification.v1.json tests/australian-source-catalogue.test.ts tests/check-indexing-contract.test.ts tests/registry-corpus.test.ts
git commit -m "feat(sources): define governed Australian catalogue"
```

---

