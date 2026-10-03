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
  it("records records and tools, never homes, searches or catalogue lists", () => {
    expect(psychiatryVisitKindForPath("/dsm/diagnoses/major-depressive-disorder")).toBe("dsm");
    expect(psychiatryVisitKindForPath("/dsm/compare")).toBe("dsm");
    expect(psychiatryVisitKindForPath("/differentials/presentations/agitation")).toBe("differentials");
    expect(psychiatryVisitKindForPath("/specifiers/builder")).toBe("specifiers");
    expect(psychiatryVisitKindForPath("/therapy-compass/cbt/brief")).toBe("therapy");
    expect(psychiatryVisitKindForPath("/forms/form-1a")).toBe("forms");

    expect(psychiatryVisitKindForPath("/dsm")).toBeNull();
    expect(psychiatryVisitKindForPath("/dsm/search")).toBeNull();
    expect(psychiatryVisitKindForPath("/differentials/presentations")).toBeNull();
    expect(psychiatryVisitKindForPath("/differentials/diagnoses")).toBeNull();
    expect(psychiatryVisitKindForPath("/forms/search")).toBeNull();
    expect(psychiatryVisitKindForPath("/documents/abc")).toBeNull();
    expect(psychiatryVisitKindForPath("/psychiatry")).toBeNull();
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
  it("counts opens by Perth calendar month", () => {
    const opens = [
      { at: Date.parse("2026-10-01T00:00:00Z"), kind: "dsm" as const }, // 1 Oct 08:00 Perth
      { at: Date.parse("2026-09-30T17:00:00Z"), kind: "dsm" as const }, // 1 Oct 01:00 Perth
      { at: Date.parse("2026-09-30T15:00:00Z"), kind: "forms" as const }, // 30 Sep 23:00 Perth
      { at: Date.parse("2026-08-15T00:00:00Z"), kind: "forms" as const },
    ];
    expect(psychiatryMonthFigures(opens, now)).toEqual({ thisMonth: 2, lastMonth: 1 });
  });

  it("ranks forms by opens, then by recency", () => {
    const visits: PsychiatryVisit[] = [
      { href: "/forms/c", title: "C", kind: "forms", at: now - 1 },
      { href: "/dsm/diagnoses/x", title: "X", kind: "dsm", at: now - 2 },
      { href: "/forms/a", title: "A", kind: "forms", at: now - 3 },
      { href: "/forms/b", title: "B", kind: "forms", at: now - 4 },
    ];
    expect(mostOpenedForms(visits, { "/forms/a": 3, "/forms/b": 1, "/forms/c": 1 }).map((v) => v.title)).toEqual([
      "A",
      "C",
      "B",
    ]);
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
