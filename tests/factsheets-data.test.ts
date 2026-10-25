import { describe, expect, it } from "vitest";

import {
  FACTSHEET_DEMO_NOTICE,
  FACTSHEET_EMERGENCY_NUMBER,
  TOPIC_SECTION_PREVIEW_LIMIT,
  factsheetCategories,
  factsheetDetailHref,
  factsheetTopicQueryValue,
  factsheets,
  factsheetSlugs,
  featuredFactsheetSlugs,
  factsheetsGroupedByCategory,
  filterFactsheets,
  findFactsheet,
  printBlocks,
  relatedFactsheets,
  resolveFactsheetTopicParam,
  topicSectionId,
  visibleTopicSheets,
} from "@/components/factsheets/factsheets-data";
import { smartSearchExpansions } from "@/lib/smart-search-intent";
import { GOVERNED_SOURCE_HOSTS } from "@/lib/sources/source-url-policy";

const kinds = new Set(["medRich", "medLite", "condition", "therapy", "procedure"]);

describe("factsheet library", () => {
  it("only resolves the explicitly supplied factsheet slugs", () => {
    expect(findFactsheet(factsheets[0]!.slug)).toEqual(factsheets[0]!);
    expect(findFactsheet("unknown-factsheet")).toBeUndefined();
  });

  it("exposes a demo/governance notice for on-screen and printed take-aways", () => {
    // The exported handout must never read as approved local patient information.
    expect(FACTSHEET_DEMO_NOTICE).toMatch(/demonstration/i);
    expect(FACTSHEET_DEMO_NOTICE).toMatch(/not clinician-approved/i);
    expect(FACTSHEET_DEMO_NOTICE).toMatch(/before any clinical use/i);
  });

  it("has unique slugs and complete governance metadata on every sheet", () => {
    const slugs = new Set<string>();
    for (const sheet of factsheets) {
      expect(slugs.has(sheet.slug)).toBe(false);
      slugs.add(sheet.slug);

      expect(sheet.title).toBeTruthy();
      expect(sheet.summary).toBeTruthy();
      expect(sheet.audience).toBeTruthy();
      expect(sheet.readTime).toBeTruthy();
      // Every sheet carries a content date month and at least one cited source.
      // `reviewedOn` is a demonstration currency stamp — not clinician approval.
      expect(sheet.reviewedOn).toBeTruthy();
      expect(sheet.sources.length).toBeGreaterThan(0);
      expect(factsheetCategories).toContain(sheet.category);
      expect(kinds.has(sheet.kind)).toBe(true);
    }
  });

  it("attaches verifiable, governed https URLs to cited sources that have one", () => {
    // Replaces an earlier blanket "every source has a URL" assertion. `url` is
    // optional by design: a source whose host is not in GOVERNED_SOURCE_HOSTS
    // renders as a plain citation rather than an outbound link, and the host
    // list is ranking-adjacent policy that content work does not widen. The
    // blanket rule left only worse options — fabricate a link, or drop the
    // citation. This is stronger: a URL that *is* present must be https and
    // governed, and a citation without one must still be fully identified.
    const governed = new Set<string>(GOVERNED_SOURCE_HOSTS);
    for (const sheet of factsheets) {
      for (const source of sheet.sources) {
        const where = `${sheet.slug} source ${source.n}`;
        expect(source.title, where).toBeTruthy();
        expect(source.org, where).toBeTruthy();
        expect(source.year, where).toBeTruthy();
        expect(source.tag, where).toBeTruthy();
        if (source.url === undefined) {
          // A plain citation must say what it is, since the reader cannot open it.
          expect(source.evidenceType, `${where} must declare its evidence type`).toBeTruthy();
          continue;
        }
        expect(source.url, where).toMatch(/^https:\/\//);
        expect(governed.has(new URL(source.url).hostname), `${where} cites an ungoverned host`).toBe(true);
      }
    }
  });

  it("exposes every slug through the static-params helper", () => {
    expect(factsheetSlugs().sort()).toEqual(factsheets.map((sheet) => sheet.slug).sort());
  });

  it("builds the canonical detail route for a factsheet slug", () => {
    expect(factsheetDetailHref("sertraline")).toBe("/factsheets/sertraline");
  });

  it("resolves every featured slug to a real sheet", () => {
    for (const slug of featuredFactsheetSlugs) {
      expect(findFactsheet(slug)).toBeDefined();
    }
  });

  it("resolves topic browse helpers for section ids, query params, and collapse", () => {
    expect(TOPIC_SECTION_PREVIEW_LIMIT).toBe(8);
    expect(topicSectionId("Tests & procedures")).toBe("factsheet-topic-tests-procedures");
    expect(factsheetTopicQueryValue("Tests & procedures")).toBe("tests-procedures");
    expect(resolveFactsheetTopicParam("Medications")).toBe("Medications");
    expect(resolveFactsheetTopicParam("tests-procedures")).toBe("Tests & procedures");
    expect(resolveFactsheetTopicParam("factsheet-topic-conditions")).toBe("Conditions");
    expect(resolveFactsheetTopicParam("unknown")).toBeUndefined();
    expect(resolveFactsheetTopicParam("")).toBeUndefined();
    expect(visibleTopicSheets([1, 2, 3, 4], false, 2)).toEqual([1, 2]);
    expect(visibleTopicSheets([1, 2, 3, 4], true, 2)).toEqual([1, 2, 3, 4]);
  });

  it("groups the library into the four topic categories without dropping sheets", () => {
    const groups = factsheetsGroupedByCategory();
    expect(groups.map((group) => group.category)).toEqual([...factsheetCategories]);
    expect(groups.reduce((count, group) => count + group.sheets.length, 0)).toBe(factsheets.length);
    for (const group of groups) {
      expect(group.sheets.every((sheet) => sheet.category === group.category)).toBe(true);
    }
  });

  it("filters by query and category", () => {
    expect(filterFactsheets("", undefined)).toHaveLength(factsheets.length);
    expect(filterFactsheets("sertraline").map((sheet) => sheet.slug)).toContain("sertraline");
    // Brand suffix ("(Zoloft)") is indexed even though it is stored separately from the title.
    expect(filterFactsheets("Zoloft").map((sheet) => sheet.slug)).toContain("sertraline");
    const conditions = filterFactsheets("", "Conditions");
    expect(conditions.length).toBeGreaterThan(0);
    expect(conditions.every((sheet) => sheet.category === "Conditions")).toBe(true);
    expect(filterFactsheets("this-matches-nothing-xyz")).toHaveLength(0);
  });

  it("uses natural-language expansion terms without changing the category predicate", () => {
    const expansions = ["generalised anxiety disorder", "worry", "anxiety"];
    expect(filterFactsheets("worries all the time", undefined, expansions).map((sheet) => sheet.slug)[0]).toBe("gad");
    expect(filterFactsheets("worries all the time", "Conditions", expansions).map((sheet) => sheet.slug)).toEqual([
      "gad",
    ]);
    expect(filterFactsheets("worries all the time", "Therapies", expansions)).toEqual([]);
  });

  it("finds the CBT factsheet from Factsheets-mode talking-therapy expansions", () => {
    const query = "plain information about talking therapy";
    const expansions = smartSearchExpansions("factsheets", query);
    expect(filterFactsheets(query, undefined, expansions).map((sheet) => sheet.slug)).toContain("cbt");
  });

  it("finds the subject of a natural factsheet question without a curated phrase rule", () => {
    const query = "What should I know about depression?";

    expect(smartSearchExpansions("factsheets", query)).toEqual([]);
    expect(filterFactsheets(query).map((sheet) => sheet.slug)[0]).toBe("depression");
  });

  it("does not invent factsheet matches from question boilerplate alone", () => {
    expect(filterFactsheets("Can you give me information?")).toEqual([]);
  });

  it("places direct factsheet matches ahead of expansion-only matches in catalogue order", () => {
    const matches = filterFactsheets("Zoloft", undefined, ["generalised anxiety disorder"]);
    expect(matches.map((sheet) => sheet.slug)).toEqual(["sertraline", "gad"]);
  });

  it("keeps a factsheet title mentioned inside a natural query ahead of Smart expansion matches", () => {
    const matches = filterFactsheets(
      "information about Generalised anxiety disorder for someone who worries all the time",
      undefined,
      ["anxiety", "worry"],
    );

    expect(matches[0]?.slug).toBe("gad");
    expect(matches.map((sheet) => sheet.slug)).toContain("sertraline");
  });

  it("does not turn an unknown query into an expansion match", () => {
    expect(filterFactsheets("this-matches-nothing-xyz", undefined, ["also-not-present"])).toEqual([]);
  });

  it("never lists a sheet as related to itself", () => {
    for (const sheet of factsheets) {
      expect(relatedFactsheets(sheet.slug).some((related) => related.slug === sheet.slug)).toBe(false);
    }
  });

  it("builds a print projection for every kind", () => {
    for (const sheet of factsheets) {
      const blocks = printBlocks(sheet);
      expect(blocks.length).toBeGreaterThan(0);
      // The sources block is always the final print block.
      expect(blocks.at(-1)?.kind).toBe("sources");
    }
  });

  it("gives every printed sheet, of every kind, the emergency number", () => {
    // A printed therapy handout once dropped the crisis contacts that its screen
    // version shows, so a CBT sheet left the reader with no number to call.
    const kinds = new Set<string>();
    for (const sheet of factsheets) {
      kinds.add(sheet.kind);
      const printed = JSON.stringify(printBlocks(sheet));
      expect(printed, `${sheet.slug} (${sheet.kind})`).toContain(FACTSHEET_EMERGENCY_NUMBER);
    }
    expect(kinds).toContain("therapy");
  });

  it("prints the selected reading level for medicine-rich factsheets", () => {
    const sheet = factsheets.find((candidate) => candidate.kind === "medRich");
    if (!sheet || sheet.kind !== "medRich") throw new Error("Expected a medicine-rich factsheet fixture");

    const easyBlock = printBlocks(sheet, "easy").find((block) => block.heading === "What is this medicine?");
    const standardBlock = printBlocks(sheet, "standard").find((block) => block.heading === "What is this medicine?");

    expect(easyBlock).toMatchObject({ kind: "prose", body: sheet.whatEasy });
    expect(standardBlock).toMatchObject({ kind: "prose", body: sheet.whatStandard });
  });
});
