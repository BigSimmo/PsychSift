import { describe, expect, it } from "vitest";

import { isInformationPage } from "@/lib/information-pages";

/**
 * Information pages carry no search composer, in every mode and at every
 * breakpoint. `GlobalSearchShell` derives that from `isInformationPage` alone —
 * there is no per-mode opt-back-in. Services, Forms and Medication record pages
 * used to have one (`isToolDetailWithFooterSearch`), which is why they are named
 * explicitly here: they are the routes whose chrome this contract changed.
 */
describe("information pages and the search composer", () => {
  it("claims the record pages that used to opt back into a footer composer", () => {
    expect(isInformationPage("/services/13yarn")).toBe(true);
    expect(isInformationPage("/forms/transport-crisis-form")).toBe(true);
    expect(isInformationPage("/medications/lithium")).toBe(true);
  });

  it("treats the whole My Day namespace as information pages, with no composer", () => {
    for (const path of ["/my-day", "/my-day/week", "/my-day/hours"]) {
      expect(isInformationPage(path)).toBe(true);
    }
  });

  it("treats the Psychiatry dashboard and its own pages as information pages, with no composer", () => {
    for (const path of ["/psychiatry", "/psychiatry/mha-clock"]) {
      expect(isInformationPage(path)).toBe(true);
    }
  });

  it("treats every CPD route as an information page, the CV under Job applications included", () => {
    for (const path of [
      "/cme",
      "/cme/log",
      "/cme/log/abc",
      "/cme/cpd-home",
      "/cme/applications",
      "/cme/applications/cv",
    ]) {
      expect(isInformationPage(path)).toBe(true);
    }
    expect(isInformationPage("/cme/applications/cv/extra")).toBe(false);
  });

  it("leaves catalogue result docks out, so a submitted search keeps its composer", () => {
    expect(isInformationPage("/services/search")).toBe(false);
    expect(isInformationPage("/forms/search")).toBe(false);
  });

  it("leaves the mode homes out, so the hero composer survives", () => {
    expect(isInformationPage("/services")).toBe(false);
    expect(isInformationPage("/forms")).toBe(false);
    expect(isInformationPage("/medications")).toBe(false);
  });
});
