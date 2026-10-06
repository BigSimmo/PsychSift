import { describe, expect, it } from "vitest";

import {
  formatPsychiatryVisitWhen,
  mostOpenedForms,
  normalisePsychiatryVisits,
  PSYCHIATRY_VISIT_TTL_MS,
  psychiatryMonthFigures,
  psychiatryVisitKindForPath,
  psychiatryVisitTitle,
  psychiatryWeekBySection,
  type PsychiatryVisit,
} from "@/lib/psychiatry-hub/visits";

const now = Date.parse("2026-10-03T04:00:00Z"); // 12:00 Perth

describe("psychiatryVisitKindForPath", () => {
  it("records records only, never homes, searches, catalogue lists or the interactive tools", () => {
    expect(psychiatryVisitKindForPath("/dsm/diagnoses/major-depressive-disorder")).toBe("dsm");
    expect(psychiatryVisitKindForPath("/differentials/presentations/agitation")).toBe("differentials");
    expect(psychiatryVisitKindForPath("/specifiers/melancholic-features")).toBe("specifiers");
    expect(psychiatryVisitKindForPath("/therapy-compass/cbt/brief")).toBe("therapy");
    expect(psychiatryVisitKindForPath("/forms/form-1a")).toBe("forms");

    expect(psychiatryVisitKindForPath("/dsm")).toBeNull();
    expect(psychiatryVisitKindForPath("/dsm/search")).toBeNull();
    expect(psychiatryVisitKindForPath("/differentials/presentations")).toBeNull();
    expect(psychiatryVisitKindForPath("/differentials/diagnoses")).toBeNull();
    expect(psychiatryVisitKindForPath("/forms/search")).toBeNull();
    expect(psychiatryVisitKindForPath("/documents/abc")).toBeNull();
    expect(psychiatryVisitKindForPath("/psychiatry")).toBeNull();
    // Tools keep their working state in the query, which a bare path cannot reopen.
    for (const tool of [
      "/dsm/compare",
      "/specifiers/builder",
      "/specifiers/map",
      "/formulation/builder",
      "/formulation/map",
      "/therapy-compass/recommend",
      "/therapy-compass/pathways",
    ]) {
      expect(psychiatryVisitKindForPath(tool)).toBeNull();
    }
  });
});

describe("psychiatryVisitTitle", () => {
  it("takes the record's name from each section's title style", () => {
    expect(psychiatryVisitTitle("Major depressive disorder | DSM-5 Diagnosis | PsychSift")).toBe(
      "Major depressive disorder",
    );
    expect(psychiatryVisitTitle("Cognitive behavioural therapy - Therapy")).toBe("Cognitive behavioural therapy");
    expect(psychiatryVisitTitle("Rumination — Formulation")).toBe("Rumination");
    expect(psychiatryVisitTitle("Obsessive-compulsive disorder | DSM-5 Diagnosis | PsychSift")).toBe(
      "Obsessive-compulsive disorder",
    );
  });

  it("refuses generic and not-found titles", () => {
    expect(psychiatryVisitTitle("PsychSift")).toBeNull();
    expect(psychiatryVisitTitle("DSM diagnosis not found | PsychSift")).toBeNull();
    expect(psychiatryVisitTitle("")).toBeNull();
  });
});

describe("normalisePsychiatryVisits", () => {
  it("keeps the newest entry per path, drops expired and malformed entries", () => {
    const visits = normalisePsychiatryVisits(
      [
        { href: "/forms/a", title: "A", kind: "forms", at: now - 10 },
        { href: "/forms/a", title: "A", kind: "forms", at: now - 5 },
        { href: "/forms/b", title: "B", kind: "forms", at: now - PSYCHIATRY_VISIT_TTL_MS - 1 },
        { href: "https://example.com", title: "X", kind: "forms", at: now },
        { href: "/forms/c", title: "C", kind: "patients", at: now },
        "nonsense",
      ],
      now,
    );
    expect(visits).toEqual([{ href: "/forms/a", title: "A", kind: "forms", at: now - 5 }]);
  });
});

describe("figures", () => {
  it("reads this Perth month and last month from the monthly totals", () => {
    expect(psychiatryMonthFigures({ "2026-10": 2, "2026-09": 1, "2026-08": 7 }, now)).toEqual({
      thisMonth: 2,
      lastMonth: 1,
    });
    expect(psychiatryMonthFigures({}, now)).toEqual({ thisMonth: 0, lastMonth: 0 });
  });

  it("ranks forms by opens, then by recency", () => {
    const visits: PsychiatryVisit[] = [
      { href: "/forms/c", title: "C", kind: "forms", at: now - 1 },
      { href: "/dsm/diagnoses/x", title: "X", kind: "dsm", at: now - 2 },
      { href: "/forms/a", title: "A", kind: "forms", at: now - 3 },
      { href: "/forms/b", title: "B", kind: "forms", at: now - 4 },
    ];
    const opens = [
      { at: now - 30, kind: "forms" as const, href: "/forms/a" },
      { at: now - 20, kind: "forms" as const, href: "/forms/a" },
      { at: now - 10, kind: "forms" as const, href: "/forms/a" },
      { at: now - 4, kind: "forms" as const, href: "/forms/b" },
      { at: now - 1, kind: "forms" as const, href: "/forms/c" },
    ];
    expect(mostOpenedForms(visits, opens).map((v) => v.title)).toEqual(["A", "C", "B"]);
  });

  it("leaves the Act and Standards page out of the most-opened forms", () => {
    const visits: PsychiatryVisit[] = [
      { href: "/forms/act", title: "Mental Health Act 2014", kind: "forms", at: now - 1 },
      { href: "/forms/a", title: "A", kind: "forms", at: now - 2 },
    ];
    expect(mostOpenedForms(visits, []).map((v) => v.href)).toEqual(["/forms/a"]);
  });

  it("sums the last seven days by section", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(
      psychiatryWeekBySection(
        [
          { at: now - day, kind: "forms" },
          { at: now - 2 * day, kind: "forms" },
          { at: now - 3 * day, kind: "dsm" },
          { at: now - 8 * day, kind: "dsm" },
        ],
        now,
      ),
    ).toEqual([
      { kind: "forms", count: 2 },
      { kind: "dsm", count: 1 },
    ]);
  });

  it("says when in Perth time", () => {
    expect(formatPsychiatryVisitWhen(Date.parse("2026-10-03T01:30:00Z"), now)).toBe("Today 09:30");
    expect(formatPsychiatryVisitWhen(Date.parse("2026-10-02T01:30:00Z"), now)).toBe("Yesterday");
    expect(formatPsychiatryVisitWhen(Date.parse("2026-09-20T01:30:00Z"), now)).toBe("20 Sept");
  });
});
