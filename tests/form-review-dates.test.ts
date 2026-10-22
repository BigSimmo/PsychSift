import { describe, expect, it } from "vitest";

import { contentReviewSchedule, FORM_CITED_SOURCE_IDS } from "@/lib/content-review-schedule";
import { loadFormCatalogDetails } from "@/lib/form-catalog";
import { sourceAcquisitionRecords } from "@/lib/sources/acquisition-ledger";

describe("form review dates", () => {
  const details = loadFormCatalogDetails();

  it("carries the sign-off date for every reviewed form and none for a drafted one", () => {
    const reviewed = details.filter((entry) => entry.contentReviewStatus === "reviewed");
    expect(reviewed.length).toBeGreaterThan(0);
    for (const entry of reviewed) {
      expect(entry.contentReviewedAt, `Form ${entry.form}`).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    for (const entry of details.filter((item) => item.contentReviewStatus !== "reviewed")) {
      expect(entry.contentReviewedAt, `Form ${entry.form}`).toBeUndefined();
    }
  });

  it("puts a signed form due 24 months after sign-off", () => {
    const entry = details.find((item) => item.contentReviewedAt);
    const schedule = contentReviewSchedule({
      kind: "form",
      lastReviewedAt: entry?.contentReviewedAt,
      referenceDate: new Date("2026-10-21T00:00:00.000Z"),
      changeEvents: [],
    });
    expect(schedule.lastReviewedOn).toBe(entry?.contentReviewedAt?.slice(0, 10));
    expect(schedule.dueOn?.slice(0, 4)).toBe(String(Number(entry?.contentReviewedAt?.slice(0, 4)) + 2));
  });

  it("cites register sources that exist", () => {
    const ids = new Set(sourceAcquisitionRecords.map((record) => record.id));
    for (const id of FORM_CITED_SOURCE_IDS) expect(ids.has(id), id).toBe(true);
  });
});
