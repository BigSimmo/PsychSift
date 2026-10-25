// Design audit D-03: typed search text is checked for patient details before navigation writes it
// into a page address (`?q=`). The full check loads lazily (bundle budget); until it has loaded,
// the identifier-shape check still holds back record numbers, dates of birth, phones and emails.

import { describe, expect, it, vi } from "vitest";

describe("searchTextPatientDetailRefusal", () => {
  it("holds back identifier shapes before the full check has loaded, and passes ordinary searches", async () => {
    vi.resetModules();
    const guard = await import("@/components/clinical-dashboard/search-patient-detail-guard");

    expect(guard.searchTextPatientDetailRefusal("schizophrenia criteria MRN: 1234567")).toBe(
      guard.SEARCH_IDENTIFIER_HELD_BACK,
    );
    expect(guard.searchTextPatientDetailRefusal("schizophrenia criteria")).toBeNull();
    expect(guard.searchTextPatientDetailRefusal("   ")).toBeNull();
    // A name alone needs the full check, which has not loaded yet.
    expect(guard.searchTextPatientDetailRefusal("Mrs Jane Brown schizophrenia criteria")).toBeNull();
  });

  it("uses the full patient-detail check once it has loaded", async () => {
    vi.resetModules();
    const guard = await import("@/components/clinical-dashboard/search-patient-detail-guard");
    await guard.preloadSearchPatientCheck();

    expect(guard.searchTextPatientDetailRefusal("Mrs Jane Brown schizophrenia criteria")).toMatch(
      /^This search looks like it holds a patient detail/,
    );
    expect(guard.searchTextPatientDetailRefusal("lithium dose for a 70 year old")).toBeNull();
    expect(guard.searchTextPatientDetailRefusal("schizophrenia criteria")).toBeNull();
  });
});
