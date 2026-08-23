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

  it("reuses exactly one existing authority identity per indexed catalogue entry", () => {
    for (const source of australianSourceCatalogue.filter((entry) => entry.contentMode === "indexed_content")) {
      expect(sourceAuthorityForPublisherCode(source.publisherCode)?.key).toBeTruthy();
    }
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
