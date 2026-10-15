import { describe, expect, it } from "vitest";

import { appModeIds, appModeSearchConfig } from "@/lib/app-modes";
import { legacyHomeRedirectUrl } from "@/lib/legacy-home-redirect";
import { ownPageModeHomeHref } from "@/lib/search-route-ownership";

/*
 * Owner report, 15 Oct 2026: a bare "CPD" search page showed "sometimes". A
 * mode with nothing to search (CPD, On Call, Roster…) has no shared home, so
 * every way onto `/?mode=<id>` must land on the mode's own page instead.
 */
describe("modes with nothing to search open their own page", () => {
  it("names an own page for every mode without a results surface, and only those", () => {
    for (const mode of appModeIds) {
      const href = ownPageModeHomeHref(mode);
      if (appModeSearchConfig(mode).resultsSurface === "none") {
        expect(href, mode).toMatch(/^\/[a-z-]+$/);
      } else {
        expect(href, mode).toBeNull();
      }
    }
    expect(ownPageModeHomeHref("cme")).toBe("/cme");
    expect(ownPageModeHomeHref("my-work")).toBe("/admin");
  });

  it("redirects a bare or submitted /?mode=cme to /cme, dropping only the search-home query", () => {
    expect(legacyHomeRedirectUrl(new URL("https://clinical-kb.test/?mode=cme"), "GET")?.toString()).toBe(
      "https://clinical-kb.test/cme",
    );
    expect(
      legacyHomeRedirectUrl(new URL("https://clinical-kb.test/?mode=on-call&q=ward&run=1&focus=1"), "GET")?.toString(),
    ).toBe("https://clinical-kb.test/on-call");
    expect(legacyHomeRedirectUrl(new URL("https://clinical-kb.test/?mode=cme"), "POST")).toBeNull();
  });

  it("keeps the destination page's own state on the redirect", () => {
    const cases = [
      ["/?mode=cme&year=2025", "/cme?year=2025"],
      ["/?mode=psychiatry&page=saved", "/psychiatry?page=saved"],
      ["/?mode=roster&view=hours&q=ward", "/roster?view=hours"],
      ["/?mode=my-day&view=all#top", "/my-day?view=all"],
    ] as const;
    for (const [from, to] of cases) {
      expect(legacyHomeRedirectUrl(new URL(`https://clinical-kb.test${from}`), "GET")?.toString(), from).toBe(
        `https://clinical-kb.test${to}`,
      );
    }
  });

  it("leaves searchable modes on the shared home", () => {
    expect(legacyHomeRedirectUrl(new URL("https://clinical-kb.test/?mode=answer"), "GET")).toBeNull();
    expect(legacyHomeRedirectUrl(new URL("https://clinical-kb.test/?mode=documents"), "GET")).toBeNull();
  });
});
