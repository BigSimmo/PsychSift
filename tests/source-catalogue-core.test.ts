import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalizeSourceReferences, compareClinicalSources, rateClinicalSource } from "@/lib/sources/catalogue-core";
import type {
  ClinicalSourceCatalogueEntry,
  ClinicalSourceReferenceInput,
  SourceCatalogueFilters,
} from "@/lib/sources/catalogue-types";
import {
  deriveSourceCatalogueFacets,
  filterAndSortSourceCatalogue,
  parseSourceCatalogueFilters,
} from "@/lib/sources/catalogue-view";

function reference(overrides: Partial<ClinicalSourceReferenceInput> = {}): ClinicalSourceReferenceInput {
  return {
    sourceId: "akg-guideline",
    documentId: null,
    title: "Example clinical guideline",
    aliases: [],
    publisher: "Armadale Kalamunda Group",
    publisherCode: "AKG",
    canonicalUrl: "https://www.ranzcp.org/example",
    datasetLocation: null,
    version: "1",
    publicationDate: "2025-01-01",
    reviewDate: "2026-01-01",
    expiryDate: null,
    jurisdiction: "Australia/WA",
    evidenceType: "guideline",
    documentStatus: "current",
    validationStatus: "approved",
    contentMode: "link_only",
    lifecycleStatus: "active",
    supersedes: [],
    supersededBy: [],
    topics: ["governance"],
    usage: {
      modeId: "dictionary",
      recordId: "mse",
      recordLabel: "Mental state examination",
      field: "definition",
    },
    referenceText: null,
    ...overrides,
  };
}

function catalogueEntry(
  sourceId: string,
  title: string,
  overrides: Partial<ClinicalSourceCatalogueEntry> = {},
): ClinicalSourceCatalogueEntry {
  const [entry] = canonicalizeSourceReferences([reference({ sourceId, title })]);
  return { ...entry, ...overrides };
}

function noFilters(overrides: Partial<SourceCatalogueFilters> = {}): SourceCatalogueFilters {
  return {
    q: "",
    bands: [],
    jurisdictions: [],
    sourceTypes: [],
    publishers: [],
    topics: [],
    lifecycleStatuses: [],
    documentStatuses: [],
    validationStatuses: [],
    usedBy: [],
    sort: "quality",
    ...overrides,
  };
}

describe("clinical source catalogue", () => {
  it("uses the published six weights and band thresholds", () => {
    const rating = rateClinicalSource(reference());
    expect(rating.weights).toEqual({
      accuracyAssurance: 25,
      reliability: 20,
      evidenceQuality: 20,
      currency: 15,
      australianApplicability: 15,
      traceability: 5,
    });
    expect(rating.score).toBe(100);
    expect(rating.band).toBe("A");
  });

  it("applies the exact 85, 70, 50 and below-50 band boundaries", () => {
    const exact85 = rateClinicalSource(
      reference({
        sourceId: "exact-85",
        publisher: "World Health Organization",
        publisherCode: "WHO",
        jurisdiction: "International",
        evidenceType: "systematic_review",
      }),
    );
    const exact70 = rateClinicalSource(
      reference({
        sourceId: "exact-70",
        publisher: "NSW Health",
        publisherCode: "NSWHEALTH",
        jurisdiction: "Australia/NSW",
        evidenceType: "primary_study",
        documentStatus: "unknown",
        validationStatus: "locally_reviewed",
      }),
    );
    const exact50 = rateClinicalSource(
      reference({
        sourceId: "exact-50",
        publisher: "BMJ Best Practice",
        publisherCode: "BMJ",
        canonicalUrl: null,
        jurisdiction: "International",
        evidenceType: "other",
        documentStatus: "outdated",
        validationStatus: "locally_reviewed",
      }),
    );
    const below50 = rateClinicalSource(
      reference({
        sourceId: "below-50",
        publisher: "Unclassified publisher",
        publisherCode: null,
        canonicalUrl: null,
        jurisdiction: null,
        evidenceType: "professional_reference",
        documentStatus: "unknown",
        validationStatus: "locally_reviewed",
      }),
    );

    expect([exact85.score, exact85.band]).toEqual([85, "A"]);
    expect([exact70.score, exact70.band]).toEqual([70, "B"]);
    expect([exact50.score, exact50.band]).toEqual([50, "C"]);
    expect([below50.score, below50.band]).toEqual([48, "D"]);
  });

  it("forces incomplete future references into D without discarding them", () => {
    const [entry] = canonicalizeSourceReferences([
      reference({
        sourceId: null,
        title: null,
        publisher: null,
        publisherCode: null,
        canonicalUrl: null,
        version: null,
        publicationDate: null,
        reviewDate: null,
        jurisdiction: null,
        evidenceType: "unknown",
        validationStatus: "unknown",
        referenceText: "Legacy prose citation",
      }),
    ]);
    expect(entry.title).toBe("Legacy prose citation");
    expect(entry.id).toMatch(/^src_[a-f0-9]{20}$/);
    expect(entry.rating.band).toBe("D");
    expect(entry.warnings).toEqual(expect.arrayContaining(["ambiguous_identity", "verification_unknown"]));
    expect(entry).not.toHaveProperty("referenceText");
  });

  it("forces an otherwise preferred official WA guideline with missing version and dates into D", () => {
    const [entry] = canonicalizeSourceReferences([
      reference({
        version: null,
        publicationDate: null,
        reviewDate: null,
        expiryDate: null,
      }),
    ]);

    expect(entry.rating.score).toBeGreaterThanOrEqual(85);
    expect(entry.rating.band).toBe("D");
    expect(entry.warnings).toEqual(["missing_dates", "missing_version"]);
    expect(entry.rating.reasons).toContain("Incomplete source metadata requires review");
  });

  it("keeps registry geography while forcing a recognized authority with missing jurisdiction into D", () => {
    const [entry] = canonicalizeSourceReferences([
      reference({
        publisher: "World Health Organization",
        publisherCode: "WHO",
        jurisdiction: null,
      }),
    ]);

    expect(entry.geography).toEqual({ scope: "international", label: "International" });
    expect(entry.rating.score).toBe(87);
    expect(entry.rating.band).toBe("D");
    expect(entry.warnings).toContain("unknown_jurisdiction");
    expect(entry.rating.reasons).toContain("Incomplete source metadata requires review");
  });

  it("does not award current currency credit after a source expiry date", () => {
    const [expired, future] = canonicalizeSourceReferences([
      reference({ sourceId: "expired", expiryDate: "2000-01-01" }),
      reference({ sourceId: "future", expiryDate: "2999-01-01" }),
    ]).sort((left, right) => left.sourceId!.localeCompare(right.sourceId!));

    expect(expired.sourceId).toBe("expired");
    expect(expired.documentStatus).toBe("outdated");
    expect(expired.rating.dimensions.currency).toBe(0);
    expect(expired.warnings).toContain("outdated");
    expect(expired.rating.reasons).toContain("Currency: 0/15");
    expect(future.sourceId).toBe("future");
    expect(future.documentStatus).toBe("current");
    expect(future.rating.dimensions.currency).toBe(15);
  });

  describe("expiry against the Perth calendar date", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("treats a source as expired once its expiry date has passed in Perth, while UTC is still on that date", () => {
      // 03:00 on 25 Oct 2026 in Perth is still 24 Oct in UTC.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T19:00:00.000Z"));
      const [entry] = canonicalizeSourceReferences([reference({ sourceId: "lapsed", expiryDate: "2026-10-24" })]);

      expect(entry.documentStatus).toBe("outdated");
      expect(entry.rating.dimensions.currency).toBe(0);
    });

    it("keeps a source current on its own expiry day in Perth", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T15:00:00.000Z"));
      const [entry] = canonicalizeSourceReferences([reference({ sourceId: "today", expiryDate: "2026-10-24" })]);

      expect(entry.documentStatus).toBe("current");
    });
  });

  it("does not read a future expiry date as recency in the currency sort", () => {
    const entries = canonicalizeSourceReferences([
      reference({
        sourceId: "old-long-expiry",
        publicationDate: "2015-01-01",
        reviewDate: null,
        expiryDate: "2999-01-01",
      }),
      reference({ sourceId: "recently-reviewed", publicationDate: null, reviewDate: "2026-09-01", expiryDate: null }),
    ]);

    expect(
      filterAndSortSourceCatalogue(entries, noFilters({ sort: "currency" })).map((entry) => entry.sourceId),
    ).toEqual(["recently-reviewed", "old-long-expiry"]);
  });

  it("hard-excludes a source with an identified replacement even when marked active", () => {
    const [entry] = canonicalizeSourceReferences([
      reference({ lifecycleStatus: "active", supersededBy: ["akg-guideline-v2"] }),
    ]);

    expect(entry.lifecycleStatus).toBe("excluded");
    expect(entry.rating.band).toBe("excluded");
    expect(entry.warnings).toContain("superseded");
    expect(entry.rating.reasons).toContain("Excluded because a current replacement is identified");
  });

  it("runs lifecycle exclusion before the numeric score", () => {
    expect(rateClinicalSource(reference({ lifecycleStatus: "excluded" })).band).toBe("excluded");
  });

  it("keeps a substantially stronger international source above a weak Australian source", () => {
    const entries = canonicalizeSourceReferences([
      reference({
        sourceId: "strong-int",
        publisher: "World Health Organization",
        publisherCode: "WHO",
        jurisdiction: "International",
      }),
      reference({
        sourceId: "weak-au",
        publisher: null,
        publisherCode: null,
        validationStatus: "unverified",
        evidenceType: "other",
      }),
    ]);
    expect(entries.map((entry) => entry.sourceId)).toEqual(["strong-int", "weak-au"]);
  });

  it("never infers authority or geography from source prose", () => {
    const rating = rateClinicalSource(
      reference({
        publisher: null,
        publisherCode: null,
        jurisdiction: null,
        title: "World Health Organization Australian guideline",
        referenceText: "Official WA guidance",
      }),
    );
    expect(rating.dimensions.reliability).toBe(0);
    expect(rating.dimensions.australianApplicability).toBe(0);
  });

  it("merges compatible aliases while retaining every usage", () => {
    const entries = canonicalizeSourceReferences([
      reference({ aliases: ["AKG guidance"], topics: ["governance", "assessment"] }),
      reference({
        aliases: ["AKG guidance", "Local guidance"],
        topics: ["assessment"],
        usage: {
          modeId: "factsheets",
          recordId: "depression",
          recordLabel: "Depression",
          field: "sources",
        },
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].aliases).toEqual(["AKG guidance", "Local guidance"]);
    expect(entries[0].topics).toEqual(["assessment", "governance"]);
    expect(entries[0].usedBy).toHaveLength(2);
  });

  it("enriches incomplete metadata for the same canonical source without splitting its usages", () => {
    const entries = canonicalizeSourceReferences([
      reference({
        sourceId: null,
        canonicalUrl: "https://www.ranzcp.org/metadata-completion",
        publisher: null,
        publisherCode: null,
        jurisdiction: null,
        usage: {
          modeId: "factsheets",
          recordId: "depression",
          recordLabel: "Depression",
          field: "sources",
        },
      }),
      reference({
        sourceId: null,
        canonicalUrl: "https://www.ranzcp.org/metadata-completion",
        publisher: "Royal Australian and New Zealand College of Psychiatrists",
        publisherCode: "RANZCP",
        jurisdiction: "Australia",
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      publisher: "Royal Australian and New Zealand College of Psychiatrists",
      publisherCode: "RANZCP",
    });
    for (const warning of ["metadata_conflict", "missing_publisher", "unknown_jurisdiction"]) {
      expect(entries[0].warnings).not.toContain(warning);
    }
    expect(entries[0].usedBy).toHaveLength(2);
  });

  it("keeps a canonical source detail ID stable when metadata is completed", () => {
    const incomplete = reference({
      sourceId: null,
      canonicalUrl: "https://www.ranzcp.org/stable-detail-source",
      publisher: null,
      publisherCode: null,
      jurisdiction: null,
      version: null,
    });
    const completed = {
      ...incomplete,
      publisher: "Royal Australian and New Zealand College of Psychiatrists",
      publisherCode: "RANZCP",
      jurisdiction: "Australia",
      version: "2025",
    };

    expect(canonicalizeSourceReferences([completed])[0].id).toBe(canonicalizeSourceReferences([incomplete])[0].id);
  });

  it("does not merge conflicting versions or publishers", () => {
    const entries = canonicalizeSourceReferences([
      reference(),
      reference({ version: "2", publisher: "Different publisher", publisherCode: null }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.warnings.includes("metadata_conflict"))).toBe(true);
    expect(entries.every((entry) => entry.rating.band === "D")).toBe(true);
  });

  it("keeps registry and supplied jurisdiction conflicts internally consistent", () => {
    const [entry] = canonicalizeSourceReferences([
      reference({
        sourceId: "conflicting-who",
        publisher: "World Health Organization",
        publisherCode: "WHO",
        jurisdiction: "Australia/WA",
      }),
    ]);
    expect(entry.geography).toEqual({ scope: "unknown", label: "Unknown" });
    expect(entry.warnings).toEqual(expect.arrayContaining(["metadata_conflict", "unknown_jurisdiction"]));
    expect(entry.rating.band).toBe("D");
  });

  it("removes unsafe outbound locations", () => {
    const [entry] = canonicalizeSourceReferences([reference({ canonicalUrl: "javascript:alert(1)" })]);
    expect(entry.canonicalLocation).toEqual({ kind: "none" });
    expect(entry.warnings).toContain("unsafe_location");
    expect(entry.rating.band).toBe("D");
  });

  it("removes HTTPS outbound locations on hosts outside the governed allowlist", () => {
    const [entry] = canonicalizeSourceReferences([
      reference({ canonicalUrl: "https://unreviewed-source.example/clinical-guidance" }),
    ]);

    expect(entry.canonicalLocation).toEqual({ kind: "none" });
    expect(entry.warnings).toContain("unsafe_location");
    expect(entry.rating.band).toBe("D");
  });

  it.each([
    "token",
    "API_KEY",
    "api-key",
    "access_token",
    "secret",
    "password",
    "signature",
    "sig",
    "credential",
    "authorization",
    "auth",
    "X-Amz-Signature",
    "client_secret",
    "refresh_token",
    "session_token",
    "jwt",
    "access_key",
    "auth_token",
    "X-Amz-Credential",
    "X-Amz-Security-Token",
  ])("redacts canonical locations carrying the %s query credential", (parameter) => {
    const secret = "catalogue-query-secret";
    const [entry] = canonicalizeSourceReferences([
      reference({ canonicalUrl: `https://www.ranzcp.org/guidance?${parameter}=${secret}` }),
    ]);

    expect(entry.canonicalLocation).toEqual({ kind: "none" });
    expect(entry.warnings).toContain("unsafe_location");
    expect(entry.rating.band).toBe("D");
    expect(JSON.stringify(entry)).not.toContain(secret);
  });

  it("rejects credential-bearing HTTPS locations without exposing credentials", () => {
    const [entry] = canonicalizeSourceReferences([
      reference({ canonicalUrl: "https://catalogue-user:catalogue-secret@example.org/private" }),
    ]);
    expect(entry.canonicalLocation).toEqual({ kind: "none" });
    expect(entry.warnings).toContain("unsafe_location");
    expect(entry.rating.band).toBe("D");
    expect(JSON.stringify(entry)).not.toContain("catalogue-user");
    expect(JSON.stringify(entry)).not.toContain("catalogue-secret");
  });

  it.each(["2025-02-29", "2025-13-01", "01-02-2025", "2025-2-01"])(
    "treats malformed structured date %s as review debt without projecting it",
    (malformedDate) => {
      const [entry] = canonicalizeSourceReferences([
        reference({ publicationDate: malformedDate, reviewDate: null, expiryDate: malformedDate }),
      ]);

      expect(entry.publicationDate).toBeNull();
      expect(entry.expiryDate).toBeNull();
      expect(entry.documentStatus).toBe("unknown");
      expect(entry.rating.dimensions.currency).toBe(4);
      expect(entry.warnings).toContain("invalid_date");
      expect(entry.rating.band).toBe("D");
    },
  );

  it("ignores blank-only replacement identifiers for lifecycle exclusion", () => {
    const [entry] = canonicalizeSourceReferences([reference({ supersededBy: ["", "   "] })]);

    expect(entry.lifecycleStatus).toBe("active");
    expect(entry.rating.band).toBe("A");
    expect(entry.warnings).not.toContain("superseded");
  });

  it("keeps fully unresolved references separate with deterministic opaque IDs", () => {
    const unresolved = (modeId: "dictionary" | "factsheets", recordId: string): ClinicalSourceReferenceInput =>
      reference({
        sourceId: null,
        documentId: null,
        title: null,
        publisher: null,
        publisherCode: null,
        canonicalUrl: null,
        datasetLocation: null,
        version: null,
        publicationDate: null,
        reviewDate: null,
        expiryDate: null,
        jurisdiction: null,
        evidenceType: "unknown",
        documentStatus: "unknown",
        validationStatus: "unknown",
        contentMode: "metadata_only",
        referenceText: null,
        usage: { modeId, recordId, recordLabel: `Unresolved ${recordId}`, field: "sources" },
      });
    const inputs = [unresolved("dictionary", "first"), unresolved("factsheets", "second")];
    const entries = canonicalizeSourceReferences(inputs);
    const reversed = canonicalizeSourceReferences([...inputs].reverse());

    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.id))).toHaveLength(2);
    expect(entries.map((entry) => entry.id)).toEqual(reversed.map((entry) => entry.id));
    expect(entries.every((entry) => entry.warnings.includes("ambiguous_identity"))).toBe(true);
  });

  it("keeps an unresolved bookmark stable when an unrelated unresolved reference is inserted or removed", () => {
    const unresolved = (modeId: "dictionary" | "factsheets", recordId: string): ClinicalSourceReferenceInput =>
      reference({
        sourceId: null,
        documentId: null,
        title: null,
        publisher: null,
        publisherCode: null,
        canonicalUrl: null,
        datasetLocation: null,
        version: null,
        publicationDate: null,
        reviewDate: null,
        expiryDate: null,
        jurisdiction: null,
        evidenceType: "unknown",
        documentStatus: "unknown",
        validationStatus: "unknown",
        contentMode: "metadata_only",
        referenceText: null,
        usage: { modeId, recordId, recordLabel: `Unresolved ${recordId}`, field: "sources" },
      });
    const target = unresolved("factsheets", "stable-bookmark");
    const earlier = unresolved("dictionary", "earlier-unrelated");
    const targetId = (inputs: ClinicalSourceReferenceInput[]) =>
      canonicalizeSourceReferences(inputs).find((entry) =>
        entry.usedBy.some((usage) => usage.recordId === "stable-bookmark"),
      )?.id;

    const id = targetId([target]);
    expect(targetId([earlier, target])).toBe(id);
    expect(targetId([target])).toBe(id);
    expect(id).toMatch(/^src_[a-f0-9]{20}$/);
    expect(id).not.toContain("stable-bookmark");
  });

  it("normalizes safe HTTPS locations without retaining fragments", () => {
    const [entry] = canonicalizeSourceReferences([
      reference({ canonicalUrl: "https://www.health.gov.au/path?language=en#private-fragment" }),
    ]);
    expect(entry.canonicalLocation).toEqual({
      kind: "url",
      href: "https://www.health.gov.au/path?language=en",
    });
  });

  it("orders by band, score, Australian applicability, currency, then title", () => {
    const base = catalogueEntry("base", "Base");
    const entry = (
      sourceId: string,
      title: string,
      band: ClinicalSourceCatalogueEntry["rating"]["band"],
      score: number,
      australianApplicability: number,
      currency: number,
    ): ClinicalSourceCatalogueEntry => ({
      ...base,
      id: sourceId,
      sourceId,
      title,
      rating: {
        ...base.rating,
        band,
        score,
        dimensions: { ...base.rating.dimensions, australianApplicability, currency },
      },
    });
    const entries = [
      entry("excluded", "Excluded", "excluded", 100, 15, 15),
      entry("d", "D", "D", 99, 15, 15),
      entry("c", "C", "C", 60, 15, 15),
      entry("b-title-z", "Zulu", "B", 80, 13, 8),
      entry("b-title-a", "Alpha", "B", 80, 13, 8),
      entry("b-currency", "Currency", "B", 80, 13, 15),
      entry("b-australian", "Australian", "B", 80, 15, 0),
      entry("b-score", "Score", "B", 81, 0, 0),
      entry("a", "A", "A", 85, 0, 0),
    ];
    expect(entries.sort(compareClinicalSources).map((item) => item.sourceId)).toEqual([
      "a",
      "b-score",
      "b-australian",
      "b-currency",
      "b-title-a",
      "b-title-z",
      "c",
      "d",
      "excluded",
    ]);
  });

  it("parses repeated filters only when their values exist in the catalogue", () => {
    const entries = [
      catalogueEntry("one", "One", { topics: ["governance"], publisher: "Publisher One" }),
      catalogueEntry("two", "Two", { topics: ["assessment"], publisher: "Publisher Two" }),
    ];
    const params = new URLSearchParams([
      ["q", "  guide  "],
      ["band", "A"],
      ["band", "invalid"],
      ["publisher", "Publisher One"],
      ["publisher", "Missing"],
      ["topic", "governance"],
      ["usedBy", "dictionary"],
      ["usedBy", "missing"],
      ["sort", "title"],
    ]);
    expect(parseSourceCatalogueFilters(params, entries)).toEqual({
      q: "guide",
      bands: ["A"],
      jurisdictions: [],
      sourceTypes: [],
      publishers: ["Publisher One"],
      topics: ["governance"],
      lifecycleStatuses: [],
      documentStatuses: [],
      validationStatuses: [],
      usedBy: ["dictionary"],
      sort: "title",
    });
  });

  it("filters search to public catalogue fields and derives stable facets", () => {
    const entries = [
      catalogueEntry("governance", "Governance guide", {
        aliases: ["Local policy"],
        publisher: "Publisher One",
        topics: ["governance"],
      }),
      catalogueEntry("assessment", "Assessment guide", {
        lifecycleStatus: "inactive",
        publisher: "Publisher Two",
        topics: ["assessment"],
      }),
    ];
    expect(
      filterAndSortSourceCatalogue(entries, noFilters({ q: "Local policy" })).map((entry) => entry.sourceId),
    ).toEqual(["governance"]);
    expect(filterAndSortSourceCatalogue(entries, noFilters({ q: "Mental state examination" }))).toEqual([]);
    // Punctuation is ignored, and a query matches from the start of a word only.
    expect(
      filterAndSortSourceCatalogue(entries, noFilters({ q: "Local policy?" })).map((entry) => entry.sourceId),
    ).toEqual(["governance"]);
    expect(filterAndSortSourceCatalogue(entries, noFilters({ q: "ance" }))).toEqual([]);
    expect(deriveSourceCatalogueFacets(entries)).toEqual({
      total: 2,
      australian: 2,
      reviewRequired: 0,
      inactiveOrExcluded: 1,
      topics: [
        { value: "assessment", count: 1 },
        { value: "governance", count: 1 },
      ],
      publishers: [
        { value: "Publisher One", count: 1 },
        { value: "Publisher Two", count: 1 },
      ],
    });
  });
});
