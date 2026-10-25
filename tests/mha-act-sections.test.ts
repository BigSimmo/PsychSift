import { beforeEach, describe, expect, it, vi } from "vitest";

import formsActSectionCues from "../data/forms-act-section-cues.json";
import formsCatalog from "../data/forms-catalog.json";
import curatedSections from "../data/mha-2014-sections.json";
import sourceSections from "../data/mha-2014-sections.source.json";
import {
  checkProblems,
  citedSections,
  parseSectionCue as scriptParseSectionCue,
} from "../scripts/build-mha-act-sections.mjs";
import {
  actSectionsForCue,
  mhaActMetadata,
  mhaActSection,
  parseSectionCue,
  sectionCueForForm,
} from "@/lib/mha-act-sections";

describe("parseSectionCue", () => {
  it("reads every cue shape present in the forms catalogue", () => {
    expect(parseSectionCue("sections 66, 91")).toEqual(["66", "91"]);
    expect(parseSectionCue("sections 28")).toEqual(["28"]);
    // Form 4A's cue is ragged: no spaces after most commas, one space before the last.
    expect(parseSectionCue("sections 29,63,67,92,112,129,133,148, 154")).toEqual([
      "29",
      "63",
      "67",
      "92",
      "112",
      "129",
      "133",
      "148",
      "154",
    ]);
  });

  it("de-duplicates while preserving first-appearance order", () => {
    // Never sorted: cue order mirrors the approved form, and Form 1A's reviewed order
    // is pinned by tests/forms.test.ts.
    expect(parseSectionCue("sections 91, 66, 91")).toEqual(["91", "66"]);
  });

  it("treats an absent or non-numeric cue as no citation", () => {
    expect(parseSectionCue(undefined)).toEqual([]);
    expect(parseSectionCue(null)).toEqual([]);
    expect(parseSectionCue("sections")).toEqual([]);
  });

  it("matches the build script's parser, so the gate and runtime agree", () => {
    for (const form of formsCatalog.forms) {
      const cue = (form as { sourceFacts?: { sectionCue?: string } }).sourceFacts?.sectionCue;
      expect(parseSectionCue(cue)).toEqual(scriptParseSectionCue(cue));
    }
  });
});

describe("Act section coverage", () => {
  it("resolves every section cited by every archived form", () => {
    const cited = citedSections(formsCatalog);
    expect(cited.length).toBe(75);
    for (const section of cited) {
      const entry = mhaActSection(section);
      expect(entry, `section ${section} has no curated entry`).toBeTruthy();
      expect(entry?.title.trim()).not.toBe("");
    }
  });

  it("pins the Act version the summaries were written against", () => {
    expect(mhaActMetadata.actVersion).toBe(sourceSections.exportMetadata.actVersion);
    expect(mhaActMetadata.actAsAt).toBe(sourceSections.exportMetadata.actAsAt);
    expect(mhaActMetadata.sourceUrl).toContain("legislation.wa.gov.au");
  });

  it("keeps the curated and extracted files consistent", () => {
    // The same validation `npm run check:mha-act-sections` runs, so sign-off drift fails
    // the unit suite too rather than waiting for verify:cheap.
    expect(
      checkProblems({
        source: sourceSections,
        curated: curatedSections,
        catalog: formsCatalog,
        supplemental: formsActSectionCues,
      }),
    ).toEqual([]);
  });

  it("fails a hand edit to the verbatim Act text that keeps its stored hash", () => {
    const edited = structuredClone(sourceSections);
    const [first] = edited.sections;
    first.text = `${first.text} (edited)`;
    const problems = checkProblems({
      source: edited,
      curated: curatedSections,
      catalog: formsCatalog,
      supplemental: formsActSectionCues,
    });
    expect(problems.join("\n")).toContain(`Act extraction for section ${first.section} does not match its textSha256`);
  });

  it("does not call a catalogue row without its own cue a duplicate of the supplemental map", () => {
    // The seven forms the archive never indexed now have catalogue rows, for their
    // operational guidance. Their section mapping still comes from the supplemental map,
    // which is where the checkable basis for it lives. A catalogue row is a conflict only
    // when it carries a sourceFacts.sectionCue of its own.
    const problems = checkProblems({
      source: sourceSections,
      curated: curatedSections,
      catalog: { forms: [{ form: "7C" }] },
      supplemental: { forms: [{ code: "7C", sections: ["110"], status: "drafted", basis: "s 110 cancels leave." }] },
    });
    expect(problems.filter((problem: string) => problem.includes("supplemental"))).toEqual([]);
  });

  it("still catches a catalogue row and a supplemental entry both claiming the mapping", () => {
    const problems = checkProblems({
      source: sourceSections,
      curated: curatedSections,
      catalog: { forms: [{ form: "7C", sourceFacts: { sectionCue: "sections 110" } }] },
      supplemental: { forms: [{ code: "7C", sections: ["110"], status: "drafted", basis: "s 110 cancels leave." }] },
    });
    expect(problems).toContain(
      "Form 7C has both a catalogue section cue and a supplemental one \u2014 remove the supplemental entry.",
    );
  });
});

describe("actSectionsForCue", () => {
  it("renders drafted summaries, marked as drafted", () => {
    // Drafted summaries are written from the statutory text and hash-pinned to it. They
    // render so the forms carry authority content, and `reviewStatus` drives the
    // "awaiting clinical review" labelling on both the card face and the sheet.
    const sections = actSectionsForCue("sections 66, 91");
    expect(sections?.map((entry) => entry.section)).toEqual(["66", "91"]);
    for (const entry of sections ?? []) {
      const source = mhaActSection(entry.section);
      expect(entry.reviewStatus).toBe(source?.status === "reviewed" ? "reviewed" : "drafted");
      expect(entry.summary?.trim()).toBeTruthy();
    }
  });

  it("returns no sections for a form with no cue", () => {
    expect(actSectionsForCue(undefined)).toBeUndefined();
    expect(actSectionsForCue("")).toBeUndefined();
  });

  it("resolves a supplemental mapping for every unindexed form", () => {
    // A cue is a citation, not a clinical claim, so its own `status` is provenance only
    // and never a render gate. Gating it would leave these seven forms dark twice over.
    for (const entry of formsActSectionCues.forms) {
      expect(sectionCueForForm(entry.code, undefined), entry.code).toBe(entry.sections.join(", "));
    }
  });

  it("prefers a form's own catalogue cue over the supplemental map", () => {
    expect(sectionCueForForm("13", "sections 66, 91")).toBe("sections 66, 91");
  });
});

describe("actSectionsForCue against reviewed data", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const reviewedFixture = {
    exportMetadata: {
      actVersion: "02-b0-01",
      actAsAt: "2025-09-25",
      sourceUrl: "https://www.legislation.wa.gov.au/example",
    },
    sections: [
      { section: "66", title: "Transfer from general hospital", summary: "Summary of 66.", status: "reviewed" },
      { section: "91", title: "Transfer between authorised hospitals", summary: "Summary of 91.", status: "drafted" },
      { section: "45", title: "Still being written", status: "pending" },
      { section: "46", title: "Awaiting review", summary: "Summary of 46.", status: "drafted" },
    ],
  };

  it("yields sections in cue order once every cited section has a summary", async () => {
    vi.doMock("../data/mha-2014-sections.json", () => ({ default: reviewedFixture }));
    const { actSectionsForCue: withFixture } = await import("@/lib/mha-act-sections");
    // A mixed list renders, and each entry keeps its own review status.
    expect(withFixture("sections 91, 66")).toEqual([
      {
        section: "91",
        title: "Transfer between authorised hospitals",
        summary: "Summary of 91.",
        reviewStatus: "drafted",
      },
      { section: "66", title: "Transfer from general hospital", summary: "Summary of 66.", reviewStatus: "reviewed" },
    ]);
  });

  it("withholds the whole list when one cited section has no summary yet", async () => {
    vi.doMock("../data/mha-2014-sections.json", () => ({ default: reviewedFixture }));
    const { actSectionsForCue: withFixture } = await import("@/lib/mha-act-sections");
    expect(withFixture("sections 66, 45")).toBeUndefined();
  });

  it("renders a drafted section alongside a reviewed one", async () => {
    vi.doMock("../data/mha-2014-sections.json", () => ({ default: reviewedFixture }));
    const { actSectionsForCue: withFixture } = await import("@/lib/mha-act-sections");
    // Only `pending` (no summary written) withholds the card; drafted renders labelled.
    expect(withFixture("sections 66, 46")?.map((entry) => [entry.section, entry.reviewStatus])).toEqual([
      ["66", "reviewed"],
      ["46", "drafted"],
    ]);
  });

  it("throws for a cue naming a section with no curated entry", async () => {
    vi.doMock("../data/mha-2014-sections.json", () => ({ default: reviewedFixture }));
    const { actSectionsForCue: withFixture } = await import("@/lib/mha-act-sections");
    // A mis-cue is a data defect; it must never render as a chip with no title.
    expect(() => withFixture("sections 999")).toThrow(/999/);
  });
});
