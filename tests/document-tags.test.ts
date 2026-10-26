import { describe, expect, it } from "vitest";
import {
  buildSmartDocumentTagFacetIndex,
  projectSmartTagFacetGroups,
  buildSmartDocumentTagFacets,
  buildSmartDocumentTags,
  documentLabelReviewStatus,
  documentLabelTier,
  filterDocumentsBySmartTagFacetIndex,
  filterDocumentsBySmartTagFacets,
  formatDocumentLabelDisplay,
  normalizeDocumentLabelForStorage,
  reviewDocumentTagQuality,
  tagSearchText,
} from "@/lib/document-tags";
import type { DocumentLabel } from "@/lib/types";

function label(overrides: Partial<DocumentLabel>): DocumentLabel {
  return {
    id: overrides.id ?? `${overrides.label ?? "label"}-id`,
    document_id: overrides.document_id ?? "doc-1",
    label: overrides.label ?? "monitoring",
    label_type: overrides.label_type ?? "topic",
    source: overrides.source ?? "generated",
    confidence: overrides.confidence ?? 0.8,
    ...overrides,
  };
}

describe("smart document tags", () => {
  it("cleans generated labels before storage", () => {
    expect(
      normalizeDocumentLabelForStorage({
        label: "Clozapine Monitoring!!",
        label_type: "topic",
        confidence: 0.91,
        source: "generated",
      }),
    ).toMatchObject({ label: "clozapine monitoring", label_type: "topic", confidence: 0.91 });

    expect(
      normalizeDocumentLabelForStorage({
        label: "Document control",
        label_type: "topic",
        confidence: 0.95,
        source: "generated",
      }),
    ).toBeNull();

    expect(
      normalizeDocumentLabelForStorage({
        label: "Policy",
        label_type: "document_type",
        confidence: 0.91,
        source: "generated",
      }),
    ).toMatchObject({ label: "policy", label_type: "document_type" });
  });

  it("normalises each site's short label back to that same site", () => {
    // "FH" is the short label shown for Fremantle Hospital; it used to be stored
    // as Fiona Stanley, filing a Fremantle document under the wrong hospital.
    const sites = [
      "armadale kalamunda group",
      "east metropolitan health service",
      "fiona stanley hospital",
      "fremantle hospital",
      "king edward memorial hospital",
      "north metropolitan health service",
      "peel health campus",
      "rockingham peel group",
      "royal perth bentley group",
      "south metropolitan health service",
    ];
    for (const site of sites) {
      const short = formatDocumentLabelDisplay(site, "site");
      const stored = normalizeDocumentLabelForStorage({
        label: short,
        label_type: "site",
        confidence: 0.9,
        source: "manual",
      });
      // A short label with no alias is stored as itself; one with an alias must
      // resolve to the site it is displayed for, never a different one.
      if (stored && stored.label !== short.toLowerCase()) expect(stored.label, short).toBe(site);
    }
    expect(
      normalizeDocumentLabelForStorage({ label: "FH", label_type: "site", confidence: 0.9, source: "manual" }),
    ).toMatchObject({ label: "fremantle hospital" });
  });

  it("deduplicates near-equivalent tags and preserves useful manual tags", () => {
    const tags = buildSmartDocumentTags(
      [
        label({ label: "risk and safety", label_type: "risk", confidence: 0.72 }),
        label({ label: "Risk & Safety", label_type: "risk", confidence: 0.7 }),
        label({ label: "Document", label_type: "document_type", confidence: 0.9 }),
        label({ label: "local service term", label_type: "custom", source: "manual", confidence: 0.2 }),
      ],
      { includeManualGroup: true },
    );

    expect(tags.map((tag) => tag.label)).toEqual(["Risk Escalation", "Local Service Term"]);
    expect(tags.at(-1)).toMatchObject({ group: "Manual", source: "manual" });
  });

  it("prioritizes tags that match the query", () => {
    const tags = buildSmartDocumentTags(
      [
        label({ label: "metabolic monitoring", label_type: "topic", confidence: 0.8 }),
        label({ label: "clozapine", label_type: "medication", confidence: 0.86 }),
      ],
      { query: "monitoring requirements" },
    );

    expect(tags[0]).toMatchObject({ label: "Metabolic Monitoring", queryMatched: true });
  });

  it("produces searchable text for dashboard document filtering", () => {
    expect(
      tagSearchText({
        labels: [label({ label: "long-acting injectables", label_type: "medication", confidence: 0.88 })],
      }).toLowerCase(),
    ).toContain("long acting injectable medication");
  });

  it("canonicalizes local clinical aliases and common misspellings", () => {
    expect(
      normalizeDocumentLabelForStorage({
        label: "FSH",
        label_type: "site",
        confidence: 0.9,
        source: "generated",
      }),
    ).toMatchObject({ label: "fiona stanley hospital", label_type: "site" });
    expect(
      normalizeDocumentLabelForStorage({
        label: "LAI",
        label_type: "medication",
        confidence: 0.9,
        source: "generated",
      }),
    ).toMatchObject({ label: "long acting injectable medication" });
    expect(
      normalizeDocumentLabelForStorage({
        label: "clozapine monitering",
        label_type: "workflow",
        confidence: 0.9,
        source: "generated",
      }),
    ).toMatchObject({ label: "clozapine monitoring" });
    expect(buildSmartDocumentTags([label({ label: "HoNOS", label_type: "topic" })])[0].label).toBe(
      "HoNOS Rating Scale",
    );
    expect(
      buildSmartDocumentTags([label({ label: "electroconvulsive therapy", label_type: "topic" })])[0],
    ).toMatchObject({
      searchText: "electroconvulsive-therapy",
      label: "Electroconvulsive therapy",
    });
    expect(
      buildSmartDocumentTags([label({ label: "substance-use-alcohol-and-drugs", label_type: "topic" })])[0].label,
    ).toBe("Substance use, alcohol and drugs");
    expect(formatDocumentLabelDisplay("fiona stanley hospital", "site")).toBe("FSH");
    expect(formatDocumentLabelDisplay("contains_quick-reference", "content_feature")).toBe("Contains quick reference");
    expect(formatDocumentLabelDisplay("post-discharge-follow-up", "care_phase")).toBe("Post-discharge follow-up");
  });

  it("keeps ranking labels searchable without making them prominent chips", () => {
    expect(documentLabelTier("clinical-risk", "risk")).toBe("ranking");
    expect(documentLabelTier("lithium", "medication")).toBe("primary");
    expect(documentLabelReviewStatus({ metadata: { review_status: "hidden" } })).toBe("hidden");

    expect(buildSmartDocumentTags([label({ label: "clinical-risk", label_type: "risk" })])).toEqual([]);
    expect(
      buildSmartDocumentTags([label({ label: "clinical-risk", label_type: "risk" })], { includeRanking: true })[0],
    ).toMatchObject({ searchText: "clinical risk", tier: "ranking" });
    expect(
      buildSmartDocumentTags([
        label({ label: "lithium", label_type: "medication", metadata: { review_status: "hidden" } }),
      ]),
    ).toEqual([]);
  });

  it("builds grouped tag facets with document counts", () => {
    const facets = buildSmartDocumentTagFacets([
      {
        labels: [
          label({ label: "clozapine", label_type: "medication", confidence: 0.9 }),
          label({ label: "metabolic monitoring", label_type: "workflow", confidence: 0.8 }),
        ],
      },
      {
        labels: [
          label({ document_id: "doc-2", label: "Fiona Stanley Hospital", label_type: "site", confidence: 0.9 }),
          label({ document_id: "doc-2", label: "clozapine", label_type: "medication", confidence: 0.85 }),
          label({ document_id: "doc-2", label: "inpatient", label_type: "setting", confidence: 0.75 }),
        ],
      },
    ]);

    expect(facets.find((group) => group.group === "Medication")?.facets[0]).toMatchObject({
      label: "Clozapine",
      count: 2,
    });
    expect(facets.map((group) => group.group)).toContain("Workflow");
    expect(facets.map((group) => group.group)).toContain("Site");
    expect(facets.map((group) => group.group)).not.toContain("Topic");
  });

  it("filters documents by selected smart tag facet keys", () => {
    const clozapine = label({ label: "clozapine", label_type: "medication", confidence: 0.9 });
    const risk = label({ label: "risk escalation", label_type: "risk", confidence: 0.9 });
    const documents = [
      { id: "doc-1", labels: [clozapine, risk] },
      { id: "doc-2", labels: [label({ document_id: "doc-2", label: "lithium", label_type: "medication" })] },
    ];
    const selectedKey = buildSmartDocumentTags([clozapine], { includeManualGroup: false })[0].key;

    expect(filterDocumentsBySmartTagFacets(documents, [selectedKey]).map((document) => document.id)).toEqual(["doc-1"]);
  });

  it("reuses one smart tag facet index for large result filtering", () => {
    const documents = Array.from({ length: 120 }, (_, index) => {
      const documentId = `doc-${index}`;
      const medication = index % 3 === 0 ? "clozapine" : "lithium";

      return {
        id: documentId,
        labels: [
          label({ document_id: documentId, label: medication, label_type: "medication", confidence: 0.9 }),
          label({
            document_id: documentId,
            label: index % 5 === 0 ? "metabolic monitoring" : "medication review",
            label_type: "workflow",
            confidence: 0.8,
          }),
          label({ document_id: documentId, label: "clinical-risk", label_type: "risk", confidence: 0.8 }),
        ],
      };
    });

    const index = buildSmartDocumentTagFacetIndex(documents);
    const clozapineKey = buildSmartDocumentTags([label({ label: "clozapine", label_type: "medication" })])[0].key;
    const clozapineFacet = index.groups
      .find((group) => group.group === "Medication")
      ?.facets.find((facet) => facet.key === clozapineKey);

    expect(index.entries).toHaveLength(documents.length);
    expect(clozapineFacet).toMatchObject({ label: "Clozapine", count: 40 });
    expect(filterDocumentsBySmartTagFacetIndex(index, [clozapineKey]).map((document) => document.id)).toEqual(
      documents.filter((document) => Number(document.id.replace("doc-", "")) % 3 === 0).map((document) => document.id),
    );
    expect(filterDocumentsBySmartTagFacetIndex(index, [])).toEqual(documents);
  });

  it("reviews noisy, duplicate, low-confidence, and overused tag quality issues", () => {
    const documents = [
      {
        id: "doc-1",
        title: "Clozapine guideline",
        labels: [
          label({ id: "a", label: "clinical guideline", label_type: "document_type", confidence: 0.9 }),
          label({ id: "b", label: "LAI", label_type: "medication", confidence: 0.9 }),
          label({ id: "c", label: "long acting injectables", label_type: "medication", confidence: 0.8 }),
          label({ id: "d", label: "lithium", label_type: "medication", confidence: 0.3 }),
        ],
      },
      {
        id: "doc-2",
        title: "Depot procedure",
        labels: [label({ document_id: "doc-2", label: "LAI", label_type: "medication", confidence: 0.9 })],
      },
    ];

    const issues = reviewDocumentTagQuality(documents, { overusedThreshold: 2 });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "noisy", label: "clinical guideline" }),
        expect.objectContaining({ kind: "duplicate", canonicalLabel: "long acting injectable medication" }),
        expect.objectContaining({ kind: "low_confidence", canonicalLabel: "lithium" }),
        expect.objectContaining({ kind: "overused", canonicalLabel: "long acting injectable medication" }),
      ]),
    );
  });
});

describe("projectSmartTagFacetGroups", () => {
  // Three documents whose label sets deliberately do not all overlap, so an
  // AND-combination that returns nothing is reachable.
  const docs = [
    {
      id: "a",
      labels: [label({ label: "lithium", label_type: "medication" }), label({ label: "renal", label_type: "risk" })],
    },
    {
      id: "b",
      labels: [label({ label: "lithium", label_type: "medication" }), label({ label: "thyroid", label_type: "risk" })],
    },
    {
      id: "c",
      labels: [label({ label: "clozapine", label_type: "medication" }), label({ label: "renal", label_type: "risk" })],
    },
  ];
  const index = buildSmartDocumentTagFacetIndex(docs);
  // Resolve by key, not by label: the tag builder canonicalises and capitalises.
  const keyFor = (value: string, type: DocumentLabel["label_type"]) =>
    buildSmartDocumentTags([label({ label: value, label_type: type })])[0].key;
  const countOf = (groups: ReturnType<typeof projectSmartTagFacetGroups>, key: string) =>
    groups.flatMap((group) => group.facets).find((facet) => facet.key === key)?.count;

  const lithium = keyFor("lithium", "medication");
  const clozapine = keyFor("clozapine", "medication");
  const renal = keyFor("renal", "risk");
  const thyroid = keyFor("thyroid", "risk");

  it("returns the built groups untouched when nothing is selected", () => {
    expect(projectSmartTagFacetGroups(index, [])).toBe(index.groups);
  });

  it("recounts every facet against the current selection", () => {
    // Lithium is on 2 of 3 documents overall, but only 1 of the 2 renal ones.
    // The built index keeps saying 2 — that is the stale number this fixes.
    expect(countOf(index.groups, lithium)).toBe(2);
    const projected = projectSmartTagFacetGroups(index, [renal]);
    expect(countOf(projected, lithium)).toBe(1);
    expect(countOf(projected, clozapine)).toBe(1);
  });

  it("reports the current result count for a facet that is already selected", () => {
    expect(countOf(projectSmartTagFacetGroups(index, [renal]), renal)).toBe(2);
  });

  it("drives a dead-end combination to zero rather than leaving it live", () => {
    // Lithium AND thyroid exists; clozapine AND thyroid does not. Before this
    // projection clozapine advertised 1 and led to an empty result.
    const projected = projectSmartTagFacetGroups(index, [thyroid]);
    expect(countOf(projected, clozapine)).toBe(0);
    expect(countOf(projected, lithium)).toBe(1);
  });

  it("agrees with the filter it describes", () => {
    const selection = [renal];
    for (const facet of projectSmartTagFacetGroups(index, selection).flatMap((group) => group.facets)) {
      const combined = [...new Set([...selection, facet.key])];
      expect(filterDocumentsBySmartTagFacetIndex(index, combined)).toHaveLength(facet.count ?? -1);
    }
  });

  it("keeps facet membership and order stable so rows cannot jump while selecting", () => {
    expect(projectSmartTagFacetGroups(index, [renal]).map((group) => group.facets.map((facet) => facet.key))).toEqual(
      index.groups.map((group) => group.facets.map((facet) => facet.key)),
    );
  });
});

describe("facet selections combine OR within a group and AND across groups", () => {
  const docs = [
    {
      id: "a",
      labels: [label({ label: "lithium", label_type: "medication" }), label({ label: "renal", label_type: "risk" })],
    },
    {
      id: "b",
      labels: [label({ label: "lithium", label_type: "medication" }), label({ label: "thyroid", label_type: "risk" })],
    },
    {
      id: "c",
      labels: [label({ label: "clozapine", label_type: "medication" }), label({ label: "renal", label_type: "risk" })],
    },
    {
      id: "d",
      labels: [
        label({ label: "quetiapine", label_type: "medication" }),
        label({ label: "thyroid", label_type: "risk" }),
      ],
    },
  ];
  const index = buildSmartDocumentTagFacetIndex(docs);
  const keyFor = (value: string, type: DocumentLabel["label_type"]) =>
    buildSmartDocumentTags([label({ label: value, label_type: type })])[0].key;
  const ids = (keys: string[]) =>
    filterDocumentsBySmartTagFacetIndex(index, keys)
      .map((document) => document.id)
      .sort();

  const lithium = keyFor("lithium", "medication");
  const clozapine = keyFor("clozapine", "medication");
  const renal = keyFor("renal", "risk");
  const thyroid = keyFor("thyroid", "risk");

  it("treats two values from one group as alternatives", () => {
    // Previously this ANDed and returned nothing, which made multi-select within
    // a group a dead affordance.
    expect(ids([lithium, clozapine])).toEqual(["a", "b", "c"]);
  });

  it("still narrows across groups", () => {
    expect(ids([lithium, renal])).toEqual(["a"]);
  });

  it("combines both rules at once", () => {
    // (lithium OR clozapine) AND (renal) -> a, c
    expect(ids([lithium, clozapine, renal])).toEqual(["a", "c"]);
  });

  it("widens within each group independently", () => {
    // (lithium OR clozapine) AND (renal OR thyroid) -> a, b, c
    expect(ids([lithium, clozapine, renal, thyroid])).toEqual(["a", "b", "c"]);
  });

  it("keeps a single selection unchanged", () => {
    expect(ids([renal])).toEqual(["a", "c"]);
  });

  it("keeps counts and filter in agreement under the grouped rules", () => {
    const selection = [lithium, renal];
    for (const facet of projectSmartTagFacetGroups(index, selection).flatMap((group) => group.facets)) {
      const combined = [...new Set([...selection, facet.key])];
      expect(filterDocumentsBySmartTagFacetIndex(index, combined)).toHaveLength(facet.count);
    }
  });

  it("reports a same-group sibling as widening rather than as a dead end", () => {
    // Under the old all-AND rules clozapine would have counted 0 beside lithium.
    const projected = projectSmartTagFacetGroups(index, [lithium]);
    const clozapineFacet = projected.flatMap((group) => group.facets).find((facet) => facet.key === clozapine);
    expect(clozapineFacet?.count).toBe(3);
  });
});
