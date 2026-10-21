import { describe, expect, it } from "vitest";

import {
  addCalendarMonths,
  contentReviewSchedule,
  contentReviewNoticeCopy,
  isReviewDueNow,
  isoCalendarDate,
  REVIEW_INTERVAL_MONTHS,
} from "@/lib/content-review-schedule";
import type { SourceChangeEvent } from "@/lib/sources/source-change-events";

const at = (iso: string) => new Date(`${iso}T03:00:00.000Z`);

function change(overrides: Partial<SourceChangeEvent> = {}): SourceChangeEvent {
  return {
    sourceId: "wa-health-clozapine-guideline-2024",
    changedOn: "2026-11-14",
    summary: "Monitoring schedule revised.",
    detectedBy: "source-watch",
    confirmedBy: "Dr Alex Morgan",
    confirmedOn: "2026-11-16",
    ...overrides,
  };
}

describe("review intervals", () => {
  it("are the owner's 21 Oct 2026 intervals", () => {
    expect(REVIEW_INTERVAL_MONTHS).toEqual({ medication: 12, interaction: 12, therapy: 24, form: 24 });
  });
});

describe("calendar arithmetic", () => {
  it("adds months and clamps to the end of a shorter month", () => {
    expect(addCalendarMonths("2026-05-14", 12)).toBe("2027-05-14");
    expect(addCalendarMonths("2026-10-06", 24)).toBe("2028-10-06");
    expect(addCalendarMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addCalendarMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addCalendarMonths("2026-11-30", 2)).toBe("2027-01-30");
  });

  it("reads the date part of a date or an instant and rejects impossible dates", () => {
    expect(isoCalendarDate("2026-09-26T17:26:59.987Z")).toBe("2026-09-26");
    expect(isoCalendarDate("2026-05-01")).toBe("2026-05-01");
    expect(isoCalendarDate("2026-02-30")).toBeNull();
    expect(isoCalendarDate("May 2026")).toBeNull();
    expect(isoCalendarDate("")).toBeNull();
    expect(isoCalendarDate(null)).toBeNull();
  });
});

describe("contentReviewSchedule", () => {
  it("is current inside the interval and gives the due date", () => {
    const schedule = contentReviewSchedule({
      kind: "medication",
      lastReviewedAt: "2026-05-14",
      referenceDate: at("2026-10-21"),
      changeEvents: [],
    });
    expect(schedule).toMatchObject({ state: "current", lastReviewedOn: "2026-05-14", dueOn: "2027-05-14" });
    expect(contentReviewNoticeCopy(schedule)).toBeNull();
  });

  it("uses 24 months for therapy and forms", () => {
    for (const kind of ["therapy", "form"] as const) {
      const schedule = contentReviewSchedule({
        kind,
        lastReviewedAt: "2026-09-26T17:26:59.987Z",
        referenceDate: at("2027-10-01"),
        changeEvents: [],
      });
      expect(schedule).toMatchObject({ state: "current", dueOn: "2028-09-26" });
    }
  });

  it("flags due soon within 30 days, and due on and after the due date", () => {
    const base = { kind: "interaction" as const, lastReviewedAt: "2026-05-14", changeEvents: [] };
    expect(contentReviewSchedule({ ...base, referenceDate: at("2027-04-13") }).state).toBe("current");
    expect(contentReviewSchedule({ ...base, referenceDate: at("2027-04-14") }).state).toBe("due_soon");
    expect(contentReviewSchedule({ ...base, referenceDate: at("2027-05-14") }).state).toBe("due");
    expect(contentReviewSchedule({ ...base, referenceDate: at("2028-01-01") }).state).toBe("due");
    expect(contentReviewNoticeCopy(contentReviewSchedule({ ...base, referenceDate: at("2027-05-20") }))).toEqual({
      lead: "Next review overdue",
      detail: "It was due on",
      dateIso: "2027-05-14",
    });
    expect(contentReviewNoticeCopy(contentReviewSchedule({ ...base, referenceDate: at("2027-04-20") }))).toEqual({
      lead: "Next review due soon",
      detail: "Due by",
      dateIso: "2027-05-14",
    });
  });

  it("is unknown without a usable review date, including one in the future", () => {
    for (const lastReviewedAt of [null, undefined, "", "not a date", "2126-01-01"]) {
      const schedule = contentReviewSchedule({
        kind: "therapy",
        lastReviewedAt,
        referenceDate: at("2026-10-21"),
        changeEvents: [],
      });
      expect(schedule).toMatchObject({ state: "unknown", lastReviewedOn: null, dueOn: null });
      expect(isReviewDueNow(schedule)).toBe(false);
    }
  });

  it("is due now when a cited guideline changed after the last review, whatever the interval says", () => {
    const schedule = contentReviewSchedule({
      kind: "medication",
      lastReviewedAt: "2026-05-14",
      citedSourceIds: ["wa-health-clozapine-guideline-2024", "tga-product-information-clozapine"],
      referenceDate: at("2026-11-20"),
      changeEvents: [change()],
    });
    expect(schedule.state).toBe("guideline_changed");
    expect(schedule.dueOn).toBe("2027-05-14");
    expect(isReviewDueNow(schedule)).toBe(true);
    expect(contentReviewNoticeCopy(schedule)).toEqual({
      lead: "Re-review needed",
      detail: "A guideline this record cites changed on",
      dateIso: "2026-11-14",
    });
  });

  it("ignores a change made before the last review, and a change to a source the record does not cite", () => {
    const before = contentReviewSchedule({
      kind: "medication",
      lastReviewedAt: "2026-12-01",
      citedSourceIds: ["wa-health-clozapine-guideline-2024"],
      referenceDate: at("2026-12-02"),
      changeEvents: [change()],
    });
    expect(before.state).toBe("current");
    const uncited = contentReviewSchedule({
      kind: "medication",
      lastReviewedAt: "2026-05-14",
      citedSourceIds: ["tga-product-information-lithium-carbonate"],
      referenceDate: at("2026-11-20"),
      changeEvents: [change()],
    });
    expect(uncited.state).toBe("current");
  });

  it("flags a confirmed change even when the record has no review date", () => {
    const schedule = contentReviewSchedule({
      kind: "form",
      lastReviewedAt: null,
      citedSourceIds: ["wa-health-clozapine-guideline-2024"],
      referenceDate: at("2026-11-20"),
      changeEvents: [change()],
    });
    expect(schedule.state).toBe("guideline_changed");
  });

  it("lists changed sources newest first", () => {
    const schedule = contentReviewSchedule({
      kind: "medication",
      lastReviewedAt: "2026-05-14",
      citedSourceIds: ["a", "b"],
      referenceDate: at("2027-01-20"),
      changeEvents: [
        change({ sourceId: "a", changedOn: "2026-08-01" }),
        change({ sourceId: "b", changedOn: "2027-01-02" }),
      ],
    });
    expect(schedule.changedSources.map((event) => event.sourceId)).toEqual(["b", "a"]);
  });
});

describe("interaction review dates", () => {
  it("share the carrying medication record's source-check date and 12-month interval", async () => {
    const { interactionReviewSchedule } = await import("@/lib/medication-interactions");
    const index = (await import("../data/medication-interaction-index.json")).default as {
      reviewedOn: Record<string, string | null>;
    };
    const [slug, reviewedOn] = Object.entries(index.reviewedOn).find(([, date]) => date !== null) ?? [];
    expect(slug).toBeDefined();
    const schedule = interactionReviewSchedule({ id: `${slug}:0:other` }, at("2026-10-21"));
    expect(schedule.kind).toBe("interaction");
    expect(schedule.lastReviewedOn).toBe(reviewedOn);
    expect(schedule.dueOn).toBe(addCalendarMonths(reviewedOn as string, 12));
    // A reverse match is carried by the patient's drug, named first in its id.
    expect(interactionReviewSchedule({ id: `${slug}:reverse:3:viewed` }, at("2026-10-21")).lastReviewedOn).toBe(
      reviewedOn,
    );
    expect(interactionReviewSchedule({ id: "not-in-catalogue:0:x" }, at("2026-10-21")).state).toBe("unknown");
  });
});
