import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildDiscriminators,
  cleanDifferentialItem,
  curatedContentNote,
  generatedBodyWithheld,
  withholdGeneratedBody,
  detailTabCounts,
  doNowStepsAreCurated,
  formatDifferentialCopyText,
  groupCurrentPresentation,
  isDetailTabId,
  isRedundantSafetySummary,
  resolveDoNowSteps,
  resolveSafetyFacts,
  sectionBadgeLabel,
  visibleSectionItems,
} from "@/lib/differential-detail";
import { curatedDifferentials, curatedEntryFor } from "@/lib/differential-curated";
import type { DifferentialSnapshot } from "@/lib/differential-snapshot";
import {
  differentialRecords,
  getDifferentialDetailContext,
  getDifferentialRecord,
  type DifferentialRecord,
  type DifferentialSection,
} from "@/lib/differentials";

/** The generated export as it sits on disk, read straight from the file rather
 *  than through the catalogue loader, which now withholds a contaminated body
 *  before anything can see it. */
const rawSnapshot = JSON.parse(readFileSync("data/differentials-snapshot.json", "utf8")) as DifferentialSnapshot;

function buildSection(overrides: Partial<DifferentialSection> = {}): DifferentialSection {
  return {
    id: "why-it-fits",
    title: "Why it fits",
    summary: "Summary line",
    items: [],
    tone: "fit",
    ...overrides,
  };
}

function buildRecord(overrides: Partial<DifferentialRecord> = {}): DifferentialRecord {
  return {
    slug: "test-diagnosis",
    title: "Test diagnosis",
    status: "urgent",
    subtitle: "Subtitle line",
    clinicalHinge: "The clinical hinge.",
    safetySnapshot: { summary: "Safety summary.", tags: ["Sepsis"] },
    sections: [],
    related: [],
    currentPresentation: [],
    investigations: [],
    immediateActions: [],
    ...overrides,
  };
}

describe("cleanDifferentialItem", () => {
  it("strips the lone trailing full stop from short fragments", () => {
    expect(cleanDifferentialItem("medication toxicity.")).toBe("medication toxicity");
  });

  it("keeps sentence punctuation and internal periods", () => {
    const sentence = "Do vitals, BGL, sats. Then attention testing follows in every unwell patient today.";
    expect(cleanDifferentialItem(sentence)).toBe(sentence);
    expect(cleanDifferentialItem("e.g.")).toBe("e.g.");
  });

  it("collapses whitespace", () => {
    expect(cleanDifferentialItem("  spaced \n out   text ")).toBe("spaced out text");
  });
});

describe("visibleSectionItems", () => {
  it("drops duplicates of the summary and clinical hinge case-insensitively", () => {
    const section = buildSection({
      summary: "Fluctuating attention.",
      items: ["Fluctuating attention.", "FLUCTUATING ATTENTION", "The clinical hinge.", "Unique item", "unique item"],
    });
    const record = buildRecord({ sections: [section] });
    expect(visibleSectionItems(section, record)).toEqual(["Unique item"]);
  });

  it("keeps action sections diagnosis-scoped", () => {
    const section = buildSection({ id: "immediate-action", tone: "action", items: ["Diagnosis-specific step"] });
    const record = buildRecord({ sections: [section], immediateActions: ["Step one", "Step two", "Step one"] });
    expect(visibleSectionItems(section, record)).toEqual(["Diagnosis-specific step"]);
  });

  it("sources test sections from record.investigations with fallback to section items", () => {
    const section = buildSection({ id: "investigations", tone: "test", items: ["ECG"] });
    expect(visibleSectionItems(section, buildRecord({ investigations: ["Blood glucose"] }))).toEqual(["Blood glucose"]);
    expect(visibleSectionItems(section, buildRecord({ investigations: [] }))).toEqual(["ECG"]);
  });
});

describe("sectionBadgeLabel", () => {
  it("uses cleaned counts with the section noun", () => {
    const section = buildSection({
      tone: "warning",
      summary: "Sepsis summary",
      items: ["Sepsis", "sepsis", "Hypoxia"],
    });
    expect(sectionBadgeLabel(section, buildRecord())).toBe("2 causes");
  });

  // #KZDNNX (owner decision, Josh, 2026-09-25): the badge counts reference
  // bullets, so it names what is counted. It must never read as a patient
  // assessment state ("2 present", "8 possible", "1 positive", "5 pending").
  it.each([
    ["fit", ["Alpha", "Beta"], "2 features"],
    ["fit", ["Alpha"], "1 feature"],
    ["warning", ["Alpha"], "1 cause"],
    ["question", ["Alpha"], "1 clue"],
    ["question", ["Alpha", "Beta", "Gamma"], "3 clues"],
    ["action", ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"], "5 steps"],
    ["action", ["Alpha"], "1 step"],
  ] as const)("labels a %s section with %j as %s", (tone, items, expected) => {
    const section = buildSection({ tone, summary: "Unrelated summary", items: [...items] });
    expect(sectionBadgeLabel(section, buildRecord())).toBe(expected);
  });

  it("never uses an assessment-state word", () => {
    for (const tone of ["fit", "warning", "question", "action", "test", "overlap"] as const) {
      const section = buildSection({ tone, summary: "Unrelated summary", items: ["Alpha", "Beta"] });
      const record = buildRecord({ investigations: [] });
      expect(sectionBadgeLabel(section, record) ?? "").not.toMatch(/present|possible|positive|pending/);
    }
  });

  it("returns null when nothing remains after cleaning", () => {
    const section = buildSection({ summary: "Only item", items: ["Only item."] });
    expect(sectionBadgeLabel(section, buildRecord())).toBeNull();
  });
});

describe("resolveSafetyFacts", () => {
  it("returns the curated quartet for delirium", () => {
    const delirium = getDifferentialRecord("delirium");
    expect(delirium).not.toBeNull();
    const labels = resolveSafetyFacts(delirium!, curatedEntryFor(delirium!.slug)).map((fact) => fact.label);
    expect(labels).toEqual(["High risk", "Onset", "Course", "Treatable"]);
  });

  it("derives only honest counts for non-curated records", () => {
    const record = buildRecord({
      sections: [buildSection({ id: "must-not-miss", tone: "warning", summary: "Risks", items: ["Sepsis", "Stroke"] })],
      investigations: ["Blood glucose"],
      immediateActions: ["Do vitals"],
      related: [{ id: "other", label: "Other", likelihood: "possible", note: "" }],
    });
    const facts = resolveSafetyFacts(record, null);
    expect(facts.map((fact) => fact.label)).toEqual([
      "High-risk causes",
      "Core tests",
      "Immediate actions",
      "Related differentials",
    ]);
    expect(facts.map((fact) => fact.value)).toEqual(["2", "1", "1", "1"]);
    expect(facts.some((fact) => ["Onset", "Course", "Treatable"].includes(fact.label))).toBe(false);
  });
});

describe("isRedundantSafetySummary", () => {
  it("treats an exact comma-joined tag list as redundant", () => {
    expect(
      isRedundantSafetySummary("Superimposed delirium, aspiration, falls, abuse/neglect", [
        "Superimposed delirium",
        "aspiration",
        "falls",
        "abuse/neglect",
      ]),
    ).toBe(true);
  });

  it("ignores case and trailing punctuation", () => {
    expect(
      isRedundantSafetySummary("Wandering, exploitation, medication mismanagement.", [
        "wandering",
        "Exploitation",
        "medication mismanagement",
      ]),
    ).toBe(true);
  });

  it("keeps summary tokens that tags do not cover, even at high overlap", () => {
    expect(
      isRedundantSafetySummary("Superimposed delirium, aspiration, falls, abuse/neglect, unsafe living.", [
        "Superimposed delirium",
        "aspiration",
        "falls",
        "abuse/neglect",
      ]),
    ).toBe(false);
  });

  it("does not hide a summary when tags are only a subset of its risks", () => {
    expect(
      isRedundantSafetySummary("Suicide risk, violence risk, unsafe living", ["Suicide risk", "violence risk"]),
    ).toBe(false);
  });

  it("keeps unique prose summaries that tags do not cover", () => {
    expect(
      isRedundantSafetySummary("Acute change needs a delirium workup before attributing decline to dementia alone.", [
        "Superimposed delirium",
        "aspiration",
      ]),
    ).toBe(false);
  });

  it("hides an empty summary and keeps a summary when there are no tags", () => {
    expect(isRedundantSafetySummary("", ["falls"])).toBe(true);
    expect(isRedundantSafetySummary("Falls and aspiration risk.", [])).toBe(false);
  });
});

describe("formatDifferentialCopyText", () => {
  it("produces a deterministic register ending with the disclaimer", () => {
    const record = buildRecord({
      immediateActions: ["One", "Two", "Three", "Four", "Five", "Six", "Seven"],
      investigations: ["Blood glucose"],
    });
    const text = formatDifferentialCopyText(record);
    expect(text.startsWith("Test diagnosis — Urgent differential")).toBe(true);
    expect(text).toContain("Clinical hinge: The clinical hinge.");
    expect(text).toContain("Must-not-miss: Safety summary.");
    expect(text).toContain("- Six");
    expect(text).not.toContain("- Seven");
    expect(text).toContain("- Blood glucose");
    expect(text.endsWith("Clinical reference — not validated decision support. Review before use.")).toBe(true);
    expect(text).not.toContain("undefined");
  });
});

describe("groupCurrentPresentation", () => {
  it("groups strict title/candidates/hinge triplets", () => {
    const view = groupCurrentPresentation([
      "Psychomotor Agitation",
      "Akathisia, Bipolar mania",
      "CLINICAL HINGE: Inattention separates delirium.",
      "Perinatal Acute Psychiatry",
      "Postpartum psychosis",
      "CLINICAL HINGE: Abrupt change from baseline.",
    ]);
    expect(view.kind).toBe("grouped");
    if (view.kind !== "grouped") return;
    expect(view.groups).toHaveLength(2);
    expect(view.groups[0]).toEqual({
      title: "Psychomotor Agitation",
      candidates: "Akathisia, Bipolar mania",
      hinge: "Inattention separates delirium.",
    });
  });

  it("falls back to a flat list with per-item hinge detection", () => {
    const view = groupCurrentPresentation(["Item one", "CLINICAL HINGE: Key separator", "Item two"]);
    expect(view.kind).toBe("flat");
    if (view.kind !== "flat") return;
    expect(view.items).toEqual([
      { text: "Item one", isHinge: false },
      { text: "Key separator", isHinge: true },
      { text: "Item two", isHinge: false },
    ]);
  });
});

describe("isDetailTabId", () => {
  it("accepts known tabs and rejects everything else", () => {
    expect(isDetailTabId("map")).toBe(true);
    expect(isDetailTabId("overview")).toBe(true);
    expect(isDetailTabId("bogus")).toBe(false);
    expect(isDetailTabId(null)).toBe(false);
  });
});

describe("getDifferentialDetailContext", () => {
  it("links delirium to the acute confusion comparison workspace", () => {
    const delirium = getDifferentialRecord("delirium");
    expect(delirium).not.toBeNull();
    const context = getDifferentialDetailContext(delirium!);
    expect(context.comparePresentation?.slug).toBe("acute-confusion-encephalopathy");
    expect(context.knownRelatedSlugs).toContain("akathisia");
    expect(context.relatedMapDetails.akathisia).toMatchObject({
      slug: "akathisia",
      title: "Akathisia",
    });
    expect(context.relatedMapDetails.akathisia?.clinicalHinge.length).toBeGreaterThan(0);
    expect(context.relatedMapDetails.akathisia?.safetySummary.length).toBeGreaterThan(0);
    expect(context.source.version.length).toBeGreaterThan(0);
    expect(context.source.sourceStatus).toBe("review_due");
  });

  it("omits incomplete owner-catalog clinical summaries instead of falling back across owner scope", () => {
    const delirium = getDifferentialRecord("delirium");
    const akathisia = getDifferentialRecord("akathisia");
    expect(delirium).not.toBeNull();
    expect(akathisia).not.toBeNull();

    const context = getDifferentialDetailContext(delirium!, {
      records: [
        {
          ...akathisia!,
          clinicalHinge: "",
          safetySnapshot: { ...akathisia!.safetySnapshot, summary: "" },
        },
      ],
      presentations: [],
    });

    expect(context.knownRelatedSlugs).toContain("akathisia");
    expect(context.relatedMapDetails.akathisia).toBeUndefined();
  });

  it("produces catalog-consistent context for every record", () => {
    const catalogSlugs = new Set(differentialRecords.map((record) => record.slug));
    for (const record of differentialRecords) {
      const context = getDifferentialDetailContext(record);
      expect(context.comparePresentation, `${record.slug} should belong to a presentation`).not.toBeNull();
      for (const slug of context.knownRelatedSlugs) {
        expect(catalogSlugs.has(slug), `related slug ${slug} on ${record.slug}`).toBe(true);
        expect(context.relatedMapDetails[slug]?.slug, `map detail ${slug} on ${record.slug}`).toBe(slug);
      }
      for (const slug of Object.values(context.termLinks)) {
        expect(getDifferentialRecord(slug), `term link ${slug} from ${record.slug}`).not.toBeNull();
        expect(slug, `term link must not self-link ${record.slug}`).not.toBe(record.slug);
      }
      for (const slug of Object.values(context.overlapLinks)) {
        expect(getDifferentialRecord(slug), `overlap link ${slug} from ${record.slug}`).not.toBeNull();
      }
    }
  });

  it("includes alias-backed termLinks for dementia watch-for tags", () => {
    const dementia = getDifferentialRecord("dementia-apathy-neurocognitive-disorder");
    expect(dementia).not.toBeNull();
    const context = getDifferentialDetailContext(dementia!);
    expect(context.termLinks["Superimposed delirium"]).toBe("delirium");
  });
});

describe("Safety facts in the shared record layout", () => {
  it("shows every fact under its full label in the At a glance card, never a compact label", () => {
    const source = readFileSync(
      new URL("../src/components/differentials/differential-detail-page.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("<RecordGlance");
    expect(source).toContain("label: fact.label, value: fact.value");
    expect(source).not.toContain("compactLabel");
  });

  it("keeps the safety snapshot as the full cautions block and omits the old review action", () => {
    const source = readFileSync(
      new URL("../src/components/differentials/differential-detail-page.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('<RecordCautions title="Safety snapshot" testId="differential-safety-snapshot">');
    // Watch-for items wrap, so none is cut off at the edge of a phone.
    expect(source).toMatch(/flex-wrap[^"]*"[^>]*\n?[^>]*data-testid="differential-safety-watchlist"/);
    expect(source).not.toContain("Review must-not-miss causes");
    expect(source).not.toContain('data-testid="differential-safety-cta"');
  });
});

describe("Authored content overlay", () => {
  it("never points a discriminator at a diagnosis the record does not list", () => {
    // The overlay is keyed by slug and edited by hand, so the one way it rots
    // is a related id changing in the export underneath it. A row that names a
    // diagnosis the map does not draw would render as an orphan.
    const offenders: string[] = [];
    for (const [slug, entry] of Object.entries(curatedDifferentials)) {
      const record = getDifferentialRecord(slug);
      if (!record) {
        offenders.push(`${slug}: no such record in the catalogue`);
        continue;
      }
      const related = new Set(record.related.map((node) => node.id));
      for (const discriminator of entry.discriminators ?? []) {
        if (!related.has(discriminator.relatedSlug)) {
          offenders.push(`${slug}: "${discriminator.relatedSlug}" is not one of its related diagnoses`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps authored first moves free of dosing, which governance reserves for validated tooling", () => {
    // docs/clinical-governance.md, "Clinical Use Rules": no dose calculators or
    // automated treatment recommendations without dedicated clinical
    // validation. Authored steps name the action and the escalation point.
    const dosePattern = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|microgram|g|mL|units?)\b/i;
    const offenders = Object.entries(curatedDifferentials).flatMap(([slug, entry]) =>
      (entry.doNow ?? []).filter((step) => dosePattern.test(step)).map((step) => `${slug}: ${step}`),
    );
    expect(offenders).toEqual([]);
  });

  it("replaces the lithium record's non-actionable steps and flags the record itself", () => {
    const record = getDifferentialRecord("lithium-physiological-withdrawal-tremor");
    expect(record).toBeTruthy();
    // The export gives this record four statements about akathisia and
    // parkinsonism in its "immediate action" section; none is an action. Since
    // the withhold, the catalogue no longer hands them out at all — the raw
    // snapshot below is the only place they survive.
    expect(record!.immediateActions).toEqual([]);
    const exported = rawSnapshot.diagnoses.find((entry) => entry.slug === record!.slug);
    expect(exported!.immediateActions[0]).toMatch(/most commonly missed/);
    const curated = curatedEntryFor(record!.slug);
    expect(doNowStepsAreCurated(curated)).toBe(true);
    expect(resolveDoNowSteps(record!, curated)[0]).toMatch(/Characterise the tremor/);
    expect(curatedContentNote(curated)).toMatch(/carried material from akathisia/);
    expect(generatedBodyWithheld(curated)).toBe(true);
  });

  it("leaves an uncurated record on its own content", () => {
    const record = differentialRecords.find((entry) => !(entry.slug in curatedDifferentials));
    expect(record).toBeTruthy();
    const curated = curatedEntryFor(record!.slug);
    expect(curated).toBeNull();
    expect(doNowStepsAreCurated(curated)).toBe(false);
    expect(curatedContentNote(curated)).toBeNull();
  });
});

describe("detailTabCounts", () => {
  it("counts the compare queue and the map as the record plus its related diagnoses", () => {
    const record = getDifferentialRecord("delirium")!;
    const counts = detailTabCounts(record);
    expect(counts.compare).toBe(record.related.length + 1);
    expect(counts.map).toBe(record.related.length + 1);
    expect(counts.related).toBe(record.related.length);
  });

  it("shows no number where a number would be about the layout rather than the patient", () => {
    const record = getDifferentialRecord("delirium")!;
    const counts = detailTabCounts(record);
    expect(counts.overview).toBeNull();
    expect(counts.source).toBeNull();
  });

  it("suppresses the related count rather than showing a zero", () => {
    const record: DifferentialRecord = { ...getDifferentialRecord("delirium")!, related: [] };
    expect(detailTabCounts(record).related).toBeNull();
  });
});

describe("buildDiscriminators", () => {
  it("prefers an authored pair and marks it as authored", () => {
    const record = getDifferentialRecord("lithium-physiological-withdrawal-tremor")!;
    const rows = buildDiscriminators(record, getDifferentialDetailContext(record));
    const akathisia = rows.find((row) => row.slug === "akathisia");
    expect(akathisia?.curated).toBe(true);
    expect(akathisia?.favoursRelated).toMatch(/inner restlessness/i);
    expect(akathisia?.favoursFocus).toMatch(/postural tremor/i);
  });

  it("derives a row from the catalogue when nothing is authored, and links only verified slugs", () => {
    const record = getDifferentialRecord("delirium")!;
    const context = getDifferentialDetailContext(record);
    const rows = buildDiscriminators(record, context);
    expect(rows).toHaveLength(record.related.length);
    for (const row of rows) {
      expect(row.href === null || row.href === `/differentials/diagnoses/${row.slug}`).toBe(true);
      if (row.href) expect(context.knownRelatedSlugs).toContain(row.slug);
    }
  });

  it("leaves the second column empty rather than echoing the first", () => {
    const record: DifferentialRecord = {
      ...getDifferentialRecord("delirium")!,
      slug: "uncurated-echo-record",
      clinicalHinge: "Identical hinge.",
      related: [{ id: "mystery", label: "Mystery", likelihood: "possible", note: "Identical hinge." }],
    };
    const [row] = buildDiscriminators(record, { knownRelatedSlugs: [], relatedMapDetails: {} });
    expect(row.favoursRelated).toBe("Identical hinge");
    expect(row.favoursFocus).toBeNull();
  });
});

/** The lithium tremor record as the generated export actually holds it: a
 *  clinical hinge, a bedside question and four immediate actions that all
 *  belong to akathisia and drug-induced parkinsonism. */
const contaminated: DifferentialRecord = {
  slug: "lithium-physiological-withdrawal-tremor",
  title: "Lithium",
  status: "urgent",
  subtitle: "Fine postural bilateral tremor (lithium), coarse withdrawal tremor (alcohol)",
  clinicalHinge: "Subjective inner restlessness is the key feature, often with observable motor restlessness.",
  safetySnapshot: {
    summary: "Lithium toxicity, withdrawal seizures, thyrotoxicosis.",
    tags: ["Lithium toxicity", "withdrawal seizures"],
  },
  sections: [
    {
      id: "immediate-action",
      title: "Immediate action",
      summary: "Bilateral onset after medication strongly suggests drug-induced parkinsonism",
      items: ["Bilateral onset after medication strongly suggests drug-induced parkinsonism"],
      tone: "action",
    },
  ],
  related: [{ id: "akathisia", label: "Akathisia", likelihood: "possible", note: "Inner restlessness." }],
  currentPresentation: ["Akathisia / EPSE / Tremor / Sedation"],
  investigations: ["Thyroid function tests"],
  immediateActions: ["Bilateral onset after medication strongly suggests drug-induced parkinsonism"],
};

describe("withholding a contaminated generated body", () => {
  // Owner ruling, 2026-09-16. The lithium tremor record carried a warning asking
  // the reader to distrust the generated sections below it, which were known to
  // hold text belonging to akathisia, drug-induced parkinsonism and tardive
  // syndromes. A warning that says "read the rest of this page with suspicion"
  // is weaker than not publishing the wrong text at all, and this record is
  // publicly readable. Showing nothing degrades conservatively; showing another
  // diagnosis's management does not.
  it("withholds the generated sections for a record flagged unreliable", () => {
    expect(generatedBodyWithheld(curatedEntryFor("lithium-physiological-withdrawal-tremor"))).toBe(true);
  });

  it("shows the generated sections for every other curated record", () => {
    for (const [slug, entry] of Object.entries(curatedDifferentials)) {
      if (slug === "lithium-physiological-withdrawal-tremor") continue;
      expect(generatedBodyWithheld(entry), `${slug} must not withhold its generated body`).toBe(false);
    }
  });

  it("treats a record with no curated entry as ordinary", () => {
    expect(generatedBodyWithheld(null)).toBe(false);
  });

  it("empties every generated field that asserts something about the diagnosis", () => {
    const record = withholdGeneratedBody(contaminated, curatedEntryFor("lithium-physiological-withdrawal-tremor"));

    expect(record.sections).toEqual([]);
    expect(record.clinicalHinge).toBe("");
    expect(record.immediateActions).toEqual([]);
    expect(record.currentPresentation).toEqual([]);
  });

  it("keeps the fields that are the record's own and were never contaminated", () => {
    const record = withholdGeneratedBody(contaminated, curatedEntryFor("lithium-physiological-withdrawal-tremor"));

    // The safety snapshot, the investigations and the related list survive: the
    // first two are correct for this diagnosis, and emptying `related` would
    // take the Compare, Map and Related tabs down with it. The content note
    // names the related list as drawn from the wrong family instead.
    expect(record.safetySnapshot.summary).toBe("Lithium toxicity, withdrawal seizures, thyrotoxicosis.");
    expect(record.investigations).toEqual(["Thyroid function tests"]);
    expect(record.related).toHaveLength(1);
    expect(record.title).toBe("Lithium");
  });

  it("is a no-op by identity for the 200 records that are not withheld", () => {
    // Returned unchanged rather than cloned, so wiring this into the page costs
    // nothing on every other record.
    const ordinary = { ...contaminated, slug: "ordinary" };
    expect(withholdGeneratedBody(ordinary, null)).toBe(ordinary);
  });

  it("copies nothing from the withheld body into the clipboard text", () => {
    // "Copy after review" puts this text into a medical record, so it is the one
    // surface where leaking the wrong diagnosis's actions does lasting harm.
    const curated = curatedEntryFor("lithium-physiological-withdrawal-tremor");
    const text = formatDifferentialCopyText(withholdGeneratedBody(contaminated, curated));

    expect(text).not.toContain("inner restlessness");
    expect(text).not.toContain("drug-induced parkinsonism");
    expect(text).not.toContain("Clinical hinge:");
    expect(text).not.toContain("Immediate actions:");
    expect(text).toContain("Lithium toxicity");
  });

  it("never withholds silently: a withheld body always carries a note saying why", () => {
    for (const [slug, entry] of Object.entries(curatedDifferentials)) {
      if (!generatedBodyWithheld(entry)) continue;
      expect(curatedContentNote(entry), `${slug} withholds its body and must say why`).toBeTruthy();
    }
  });
});

describe("named instruments stay named, never scored", () => {
  // Owner question, 2026-09-16: four records tell the reader to apply a named
  // instrument (4AT, Hunter criteria, Bush-Francis, structured withdrawal
  // scoring). Naming one is assessment guidance. Reproducing its items, its
  // cut-offs or its arithmetic would make this product a scoring tool, which
  // docs/clinical-governance.md reserves for validated tooling. This pins the
  // boundary that was previously only implicit.
  // Each pattern needs a NUMBER near the scoring word. Naming an instrument, or
  // pointing at where its cut-off is defined, is the behaviour we want; only
  // reproducing the value here turns this page into a scoring tool. An earlier
  // draft of this guard flagged "the exact cut-off sits in the local clozapine
  // protocol", which is the safe phrasing it exists to encourage.
  const SCORE_LIKE = [
    /\bscore(?:s|d)?\s+(?:of\s+)?\d/i,
    /\b\d+\s*(?:or\s+(?:more|above|greater)|\+)\s*(?:points?|on)\b/i,
    /\bcut[- ]?off\b[^.]{0,40}\d/i,
    /\d[^.]{0,40}\bcut[- ]?off\b/i,
    /\btotal\s+of\s+\d/i,
    /\b\d+\s*points?\b/i,
    // Operator and label forms: `score: 4`, `score >= 4`, `score ≥4`. A bare
    // number next to "score" was the only shape the original guard knew.
    /\bscores?\b\s*[:=]\s*\d/i,
    /\bscores?\b\s*(?:>=|<=|≥|≤|>|<)\s*\d/i,
    /\bscores?\s+(?:of\s+)?(?:at\s+least|or\s+(?:more|above))\s*\d/i,
  ];

  it("names an instrument without reproducing its scoring", () => {
    for (const [slug, entry] of Object.entries(curatedDifferentials)) {
      for (const step of entry.doNow ?? []) {
        for (const pattern of SCORE_LIKE) {
          expect(pattern.test(step), `${slug} reproduces scoring: ${step}`).toBe(false);
        }
      }
    }
  });

  it("allows a step to defer to where a cut-off is actually defined", () => {
    // The distinction the guard above turns on, pinned so a later tightening
    // cannot quietly forbid the safe phrasing.
    const deferring = "The exact cut-off sits in the local clozapine protocol";
    const reproducing = "Retitrate when the cut-off of 48 hours is exceeded";
    expect(SCORE_LIKE.some((pattern) => pattern.test(deferring))).toBe(false);
    expect(SCORE_LIKE.some((pattern) => pattern.test(reproducing))).toBe(true);
  });

  it("states no qualitative threshold either, which is the same rule in words", () => {
    // Copilot on PR #2838, and a fair hit on my own guard: "above the
    // therapeutic range" is a serum level used as a decision point, which
    // docs/clinical-governance.md defers to the local protocol. The numeric
    // patterns above cannot see it, so a worded threshold slipped through the
    // very check written to catch thresholds.
    const QUALITATIVE = [
      /\babove the (?:therapeutic|normal|reference) range\b/i,
      /\bbelow the (?:therapeutic|normal|reference) range\b/i,
      /\b(?:exceeds?|above|below|under|over)\s+the\s+(?:cut[- ]?off|threshold|limit)\b/i,
    ];
    for (const [slug, entry] of Object.entries(curatedDifferentials)) {
      for (const step of entry.doNow ?? []) {
        for (const pattern of QUALITATIVE) {
          expect(pattern.test(step), `${slug} states a qualitative threshold: ${step}`).toBe(false);
        }
      }
    }
  });

  it("catches scoring written with an operator or a label, not just a bare number", () => {
    // Also Copilot: `score: 4` and `score >= 4` are the forms a future authored
    // step is most likely to use, and neither matched.
    const forbidden = ["Record a score: 4 before escalating", "Escalate once the score >= 4", "Escalate at score ≥4"];
    for (const step of forbidden) {
      expect(
        SCORE_LIKE.some((pattern) => pattern.test(step)),
        `not caught: ${step}`,
      ).toBe(true);
    }
    // Still allowed: naming the instrument and deferring the number.
    expect(SCORE_LIKE.some((pattern) => pattern.test("Apply the Hunter criteria and record which limb is met"))).toBe(
      false,
    );
  });

  it("states no numeric clinical threshold in an authored step", () => {
    // A temperature, a level or a duration presented as a decision point is a
    // rule, not a prompt. The one that existed (escalate above 38.5 degrees) was
    // removed on the same ruling and deferred to the local protocol.
    const THRESHOLD = /\b\d+(?:\.\d+)?\s*(?:degrees?|°|mmol|mg\/L|hours?\s+or\s+more)\b/i;
    for (const [slug, entry] of Object.entries(curatedDifferentials)) {
      for (const step of entry.doNow ?? []) {
        expect(THRESHOLD.test(step), `${slug} states a numeric threshold: ${step}`).toBe(false);
      }
    }
  });
});
