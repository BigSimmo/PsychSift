import { describe, expect, it } from "vitest";

import sourceVerificationManifest from "../data/australian-source-verification.v1.json";
import {
  assertAustralianSourceVerificationManifest,
  assertIndexableCatalogueEntry,
  australianSourceByKey,
  australianSourceCatalogue,
  australianSourcePolicyVersion,
  isIndexableAustralianSource,
} from "@/lib/australian-source-catalogue";
import {
  authorityIdentityForCatalogueEntry,
  catalogueDocumentIdentityCompatible,
  sourceAuthorityForPublisherCode,
} from "@/lib/source-authority-registry";

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
    expect(new Set(australianSourceCatalogue.map((source) => source.publisherCode)).size).toBe(
      australianSourceCatalogue.length,
    );
    expect(new Set(australianSourceCatalogue.map((source) => source.canonicalUrl)).size).toBe(
      australianSourceCatalogue.length,
    );
    expect(australianSourceCatalogue.every((source) => new URL(source.canonicalUrl).protocol === "https:")).toBe(true);
  });

  it("rejects duplicate publisher codes at the verification-manifest boundary", () => {
    const firstPublisherCode = sourceVerificationManifest.sources[0]?.publisherCode;
    const duplicatePublisherCodeManifest = {
      ...sourceVerificationManifest,
      sources: sourceVerificationManifest.sources.map((source, index) =>
        index === 1 ? { ...source, publisherCode: firstPublisherCode } : source,
      ),
    };

    expect(() => assertAustralianSourceVerificationManifest(duplicatePublisherCodeManifest)).toThrow(
      /duplicate Australian source publisher code/i,
    );
  });

  it("resolves every indexed catalogue entry through exactly one compatible authority identity", () => {
    for (const source of australianSourceCatalogue.filter((entry) => entry.contentMode === "indexed_content")) {
      const identity = authorityIdentityForCatalogueEntry(source);
      expect(identity).not.toBeNull();
      expect(sourceAuthorityForPublisherCode(source.publisherCode)).toBe(identity);
      expect(
        catalogueDocumentIdentityCompatible(source, {
          publisherCode: source.publisherCode,
          publisher: source.publisher,
          jurisdiction: source.jurisdiction,
        }),
      ).toBe(true);
    }
  });

  it("keeps catalogue policy keys separate from authority identity keys", () => {
    const source = australianSourceByKey("australian-health-disability-ageing")!;
    expect(source.key).not.toBe("australian-department-of-health");
    expect(authorityIdentityForCatalogueEntry(source)).toMatchObject({
      key: "australian-department-of-health",
      codes: expect.arrayContaining(["AUSDOH"]),
    });
  });

  it("accepts registered WA publisher, code, and jurisdiction aliases but rejects hostile mismatches", () => {
    const source = australianSourceByKey("wa-health")!;
    expect(
      catalogueDocumentIdentityCompatible(source, {
        publisherCode: "DOHWA",
        publisher: "WA Department of Health",
        jurisdiction: "WA",
      }),
    ).toBe(true);

    for (const documentIdentity of [
      { publisherCode: "TGA", publisher: "WA Department of Health", jurisdiction: "WA" },
      { publisherCode: "WAHEALTH", publisher: "NPS MedicineWise", jurisdiction: "WA" },
      { publisherCode: "WAHEALTH", publisher: "WA Department of Health", jurisdiction: "Australia/National" },
      { publisherCode: "UNKNOWN", publisher: "Unknown publisher", jurisdiction: "Unknown jurisdiction" },
    ]) {
      expect(catalogueDocumentIdentityCompatible(source, documentIdentity)).toBe(false);
    }
    expect(
      catalogueDocumentIdentityCompatible(
        { ...source, lifecycle: "historical" },
        { publisherCode: "WAHEALTH", publisher: "WA Health", jurisdiction: "Australia/WA" },
      ),
    ).toBe(false);
  });

  it("uses precise authority identities for independently governed publishers", () => {
    for (const key of ["wa-chief-psychiatrist", "wa-legislation", "australian-prescriber"]) {
      const source = australianSourceByKey(key);
      expect(source).not.toBeNull();
      expect(sourceAuthorityForPublisherCode(source?.publisherCode)?.key).toBe(key);
    }
  });

  it("does not treat an official publisher root as document-level indexing permission", () => {
    expect(australianSourceByKey("wa-health")?.licencePolicy).toBe("review_required");
    expect(isIndexableAustralianSource("wa-health", "review_required")).toBe(false);
    expect(isIndexableAustralianSource("wa-health", "public_index_permitted")).toBe(true);
  });
});
