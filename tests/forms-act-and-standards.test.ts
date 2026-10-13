import { describe, expect, it } from "vitest";

import chiefPsychiatristStandards from "../data/chief-psychiatrist-standards.json";
import formsActSectionCues from "../data/forms-act-section-cues.json";
import curatedSections from "../data/mha-2014-sections.json";
import {
  actReferenceGroups,
  loadChiefPsychiatristStandards,
  parseChiefPsychiatristStandards,
} from "@/components/forms/act-and-standards-content";

describe("actReferenceGroups", () => {
  const groups = actReferenceGroups(curatedSections, formsActSectionCues);

  it("lists the reference topics first, in their stated order, then every other section", () => {
    expect(groups.map((group) => group.id)).toEqual([
      ...formsActSectionCues.referenceTopics.map((topic) => topic.id),
      "other-form-sections",
    ]);
    expect(groups[0].sections.map((entry) => entry.section)).toEqual(["25"]);
  });

  it("shows every curated section exactly once", () => {
    const shown = groups.flatMap((group) => group.sections.map((entry) => entry.section));
    expect(new Set(shown).size).toBe(shown.length);
    expect([...shown].sort()).toEqual(curatedSections.sections.map((entry) => entry.section).sort());
  });

  it("orders the remaining sections numerically", () => {
    const other = groups.at(-1)!.sections.map((entry) => entry.section);
    expect(other.slice(0, 3)).toEqual(["14", "26", "28"]);
    expect(other).toContain("555");
    expect(other.indexOf("110")).toBeGreaterThan(other.indexOf("98"));
  });

  it("refuses a topic naming a section with no curated entry, rather than rendering a dead row", () => {
    expect(() =>
      actReferenceGroups(curatedSections, {
        referenceTopics: [{ id: "x", title: "X", sections: ["9999"], basis: "Invented." }],
      }),
    ).toThrow(/9999/);
  });
});

describe("Chief Psychiatrist's Standards", () => {
  const valid = {
    exportMetadata: { sourceIds: ["s1"] },
    standards: [
      {
        id: "cp-standard-a",
        title: "Standard A",
        summary: "Summary A.",
        sourceId: "s1",
        sourceUrl: "https://www.chiefpsychiatrist.wa.gov.au/example/",
        status: "drafted",
        reviewedBy: null,
        reviewedAt: null,
      },
    ],
  };

  it("returns null for the wrong shape, so the page renders without the section", () => {
    expect(parseChiefPsychiatristStandards({ standards: "nope" })).toBeNull();
    expect(parseChiefPsychiatristStandards({})).toBeNull();
    expect(parseChiefPsychiatristStandards(null)).toBeNull();
  });

  it("reads a well-formed payload", () => {
    expect(parseChiefPsychiatristStandards(valid)).toEqual([
      {
        id: "cp-standard-a",
        title: "Standard A",
        summary: "Summary A.",
        sourceUrl: "https://www.chiefpsychiatrist.wa.gov.au/example/",
        reviewed: false,
        reviewedBy: null,
        reviewedAt: null,
      },
    ]);
  });

  it("loads every committed standard from the bundled JSON; an unsigned one stays unreviewed", () => {
    // A JSON import, not a disk read: the runtime image does not ship data/.
    const loaded = loadChiefPsychiatristStandards();
    const rawById = new Map(chiefPsychiatristStandards.standards.map((entry) => [entry.id, entry]));
    expect(loaded?.map((entry) => entry.id)).toEqual(chiefPsychiatristStandards.standards.map((entry) => entry.id));
    for (const entry of loaded ?? []) {
      expect(entry.sourceUrl, entry.id).toMatch(/^https:\/\/www\.chiefpsychiatrist\.wa\.gov\.au\//);
      const raw = rawById.get(entry.id);
      if (raw?.status !== "reviewed") expect([entry.reviewed, entry.reviewedBy], entry.id).toEqual([false, null]);
      else if (entry.reviewed) expect(entry.reviewedBy, entry.id).toBe((raw.reviewedBy as string | null)?.trim());
    }
  });

  it("drops entries missing a title or summary and never links an ungoverned URL", () => {
    const parsed = parseChiefPsychiatristStandards({
      standards: [
        { ...valid.standards[0], id: "no-title", title: " " },
        { ...valid.standards[0], id: "no-summary", summary: "" },
        { ...valid.standards[0], id: "bad-url", sourceUrl: "https://example.com/standard" },
      ],
    });
    expect(parsed?.map((entry) => entry.id)).toEqual(["bad-url"]);
    expect(parsed?.[0].sourceUrl).toBeNull();
  });

  it("treats an entry as reviewed only with a complete, well-formed sign-off, and never Indigenous content", () => {
    const signed = {
      ...valid.standards[0],
      status: "reviewed",
      reviewedBy: " Dr Clinical Owner ",
      reviewedAt: "2026-09-01T00:00:00.000Z",
      reviewedContentSha256: "a".repeat(64),
    };
    const parsed = parseChiefPsychiatristStandards({
      standards: [
        { ...valid.standards[0], id: "claimed", status: "reviewed" },
        { ...signed, id: "date-only", reviewedAt: "2026-09-01" },
        { ...signed, id: "impossible-date", reviewedAt: "2026-02-31T00:00:00Z" },
        { ...signed, id: "future", reviewedAt: "2999-01-01T00:00:00Z" },
        { ...signed, id: "no-pin", reviewedContentSha256: null },
        { ...signed, id: "blank-reviewer", reviewedBy: "  " },
        { ...signed, id: "indigenous", summary: "Care for Aboriginal people and communities." },
        { ...signed, id: "signed" },
      ],
    });
    expect(parsed?.map((entry) => [entry.id, entry.reviewed, entry.reviewedBy])).toEqual([
      ["claimed", false, null],
      ["date-only", false, null],
      ["impossible-date", false, null],
      ["future", false, null],
      ["no-pin", false, null],
      ["blank-reviewer", false, null],
      ["indigenous", false, null],
      ["signed", true, "Dr Clinical Owner"],
    ]);
  });
});
