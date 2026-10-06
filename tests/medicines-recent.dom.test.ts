/** @vitest-environment jsdom */

// The Medicines hub's "Recent" list (mock-up v6, screen 12): names only, on
// this device, newest first, one row per medicine, cleared at account
// transition and by Clear, and never trusting what else may sit in the key.

import { afterEach, describe, expect, it } from "vitest";

import { clearAccountScopedBrowserStorage, MEDICINES_RECENT_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import {
  clearMedicineVisits,
  countMedicineVisits,
  MEDICINES_RECENT_LIMIT,
  MEDICINES_RECENT_TTL_MS,
  medicineVisitHref,
  normaliseMedicineVisits,
  readMedicineVisits,
  recordMedicineVisit,
} from "@/lib/medicines-recent";

afterEach(() => {
  clearMedicineVisits();
  window.localStorage.clear();
});

describe("medicines recent list", () => {
  it("keeps one entry per medicine, newest first, capped", () => {
    const now = Date.now();
    recordMedicineVisit({ slug: "lithium", name: "Lithium", at: now - 3000 });
    recordMedicineVisit({ slug: "clozapine", name: "Clozapine", at: now - 2000 });
    recordMedicineVisit({ slug: "lithium", name: "Lithium", at: now - 1000 });
    expect(readMedicineVisits(now).map((visit) => visit.slug)).toEqual(["lithium", "clozapine"]);

    for (let index = 0; index < MEDICINES_RECENT_LIMIT + 3; index += 1) {
      recordMedicineVisit({ slug: `med-${index}`, name: `Med ${index}`, at: now + index });
    }
    expect(countMedicineVisits()).toBe(MEDICINES_RECENT_LIMIT);
  });

  it("stores only slug, name and time, and drops malformed or expired entries", () => {
    const now = Date.now();
    const kept = normaliseMedicineVisits(
      [
        { slug: "lithium", name: "Lithium", at: now },
        { slug: "../admin", name: "Bad", at: now },
        { slug: "old", name: "Old", at: now - MEDICINES_RECENT_TTL_MS - 1 },
        { slug: "blank", name: "  ", at: now },
        "nonsense",
      ],
      now,
    );
    expect(kept).toEqual([{ slug: "lithium", name: "Lithium", at: now }]);

    recordMedicineVisit({ slug: "lithium", name: "Lithium", at: now });
    const stored = JSON.parse(window.localStorage.getItem(MEDICINES_RECENT_STORAGE_KEY) ?? "[]");
    expect(Object.keys(stored[0]).sort()).toEqual(["at", "name", "slug"]);
  });

  it("reads unparseable storage as no history", () => {
    window.localStorage.setItem(MEDICINES_RECENT_STORAGE_KEY, "{not json");
    expect(readMedicineVisits()).toEqual([]);
  });

  it("is cleared at sign-out or account switch", () => {
    recordMedicineVisit({ slug: "lithium", name: "Lithium", at: Date.now() });
    clearAccountScopedBrowserStorage();
    expect(window.localStorage.getItem(MEDICINES_RECENT_STORAGE_KEY)).toBeNull();
    expect(readMedicineVisits()).toEqual([]);
  });

  it("links each entry to its medicine page", () => {
    expect(medicineVisitHref({ slug: "lithium-carbonate" })).toBe("/medications/lithium-carbonate");
  });
});
