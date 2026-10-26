// Design audit D-03: typed search text is checked for patient details before navigation writes it
// into a page address (`?q=`). The full check loads lazily (bundle budget). Until it has loaded the
// guard fails closed (privacy audit CA-04, 2026-10-26): identifier shapes get their own sentence and
// anything else is held back as still being checked, so a name never slips through in that window.

import { describe, expect, it, vi } from "vitest";

describe("searchTextPatientDetailRefusal", () => {
  it("fails closed before the full check has loaded", async () => {
    vi.resetModules();
    const guard = await import("@/components/clinical-dashboard/search-patient-detail-guard");

    expect(guard.searchTextPatientDetailRefusal("schizophrenia criteria MRN: 1234567")).toBe(
      guard.SEARCH_IDENTIFIER_HELD_BACK,
    );
    expect(guard.searchTextPatientDetailRefusal("   ")).toBeNull();
    // A name needs the full check; until it loads, nothing typed is let through.
    expect(guard.searchTextPatientDetailRefusal("Mrs Jane Brown schizophrenia criteria")).toBe(
      guard.SEARCH_CHECK_LOADING,
    );
    expect(guard.searchTextPatientDetailRefusal("schizophrenia criteria")).toBe(guard.SEARCH_CHECK_LOADING);
  });

  it("uses the full patient-detail check once it has loaded", async () => {
    vi.resetModules();
    const guard = await import("@/components/clinical-dashboard/search-patient-detail-guard");
    await guard.preloadSearchPatientCheck();

    expect(guard.searchTextPatientDetailRefusal("Mrs Jane Brown schizophrenia criteria")).toMatch(
      /^This search looks like it holds a patient detail/,
    );
    expect(guard.searchTextPatientDetailRefusal("Minh Pham lithium level")).toMatch(
      /^This search looks like it holds a patient detail/,
    );
    expect(guard.searchTextPatientDetailRefusal("lithium dose for a 70 year old")).toBeNull();
    expect(guard.searchTextPatientDetailRefusal("schizophrenia criteria")).toBeNull();
  });
});

describe("checkSearchTextPatientDetail", () => {
  it("waits for the full check, then reads the text with it", async () => {
    vi.resetModules();
    const guard = await import("@/components/clinical-dashboard/search-patient-detail-guard");

    await expect(guard.checkSearchTextPatientDetail("Mr John Testpatient lithium")).resolves.toMatch(
      /^This search looks like it holds a patient detail/,
    );
    await expect(guard.checkSearchTextPatientDetail("clozapine titration")).resolves.toBeNull();
    await expect(guard.checkSearchTextPatientDetail("")).resolves.toBeNull();
  });

  it("holds the search back when the full check cannot load", async () => {
    vi.resetModules();
    vi.doMock("@/lib/clinical-question-patient-check", () => {
      throw new Error("chunk failed to load");
    });
    try {
      const guard = await import("@/components/clinical-dashboard/search-patient-detail-guard");
      await expect(guard.checkSearchTextPatientDetail("clozapine titration")).resolves.toBe(
        guard.SEARCH_CHECK_UNAVAILABLE,
      );
      await expect(guard.checkSearchTextPatientDetail("lithium DOB: 01/02/1990")).resolves.toBe(
        guard.SEARCH_IDENTIFIER_HELD_BACK,
      );
    } finally {
      vi.doUnmock("@/lib/clinical-question-patient-check");
    }
  });
});

describe("writeCheckedSearchText", () => {
  it("writes text that passes and clears the address copy with a warning for text that does not", async () => {
    vi.resetModules();
    const guard = await import("@/components/clinical-dashboard/search-patient-detail-guard");
    const writes: string[] = [];
    const warnings: string[] = [];

    guard.writeCheckedSearchText(
      "lithium",
      (value) => writes.push(value),
      (message) => warnings.push(message),
    );
    await vi.waitFor(() => expect(writes).toEqual(["lithium"]));
    expect(warnings).toEqual([]);

    guard.writeCheckedSearchText(
      "Sarah Jones lithium",
      (value) => writes.push(value),
      (message) => warnings.push(message),
    );
    await vi.waitFor(() => expect(writes).toEqual(["lithium", ""]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("Jones");
  });
});
