/** @vitest-environment jsdom */

// "Recent pages" (site recommendations 12 Oct 2026, item 4): one device-only
// list across Work and Clinical. Paths without queries and page titles only;
// record and work area pages only; never call notes, handover, the MHA clock,
// drafts, searches, mock-ups or developer pages.

import { afterEach, describe, expect, it } from "vitest";

import { clearAccountScopedBrowserStorage, RECENT_PAGES_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import {
  clearRecentPages,
  countRecentPages,
  forgetRecentPage,
  normaliseRecentPages,
  pickRecentPages,
  readRecentPages,
  recentPagesGeneration,
  RECENT_PAGES_LIMIT,
  RECENT_PAGES_TTL_MS,
  recentPageTarget,
  recentPageTitle,
  recordRecentPage,
  announceRecentPageTitle,
  announcedRecentPageTitle,
} from "@/lib/recent-pages";

afterEach(() => {
  clearRecentPages();
  window.localStorage.clear();
});

describe("which pages Recent pages may hold", () => {
  it("records Clinical record pages in their mode's section", () => {
    expect(recentPageTarget("/dsm/diagnoses/major-depressive-disorder")).toEqual({
      path: "/dsm/diagnoses/major-depressive-disorder",
      mode: "clinical",
      section: "dsm",
    });
    expect(recentPageTarget("/medications/lithium-carbonate-ir-sr")?.section).toBe("prescribing");
    expect(recentPageTarget("/therapy-compass/acceptance-and-commitment-therapy-act")?.section).toBe("therapy-compass");
    expect(recentPageTarget("/differentials/diagnoses/akathisia")?.section).toBe("differentials");
    expect(recentPageTarget("/documents/abc-123")?.section).toBe("documents");
    expect(recentPageTarget("/forms/form-1a")?.section).toBe("forms");
  });

  it("records work area pages and their tabs, but nothing deeper", () => {
    expect(recentPageTarget("/roster")).toEqual({ path: "/roster", mode: "work", section: "roster" });
    expect(recentPageTarget("/roster/swaps")?.mode).toBe("work");
    expect(recentPageTarget("/admin")?.section).toBe("my-work");
    expect(recentPageTarget("/roster/rotations/round-1")).toBeNull();
    expect(recentPageTarget("/teaching/session/abc")).toBeNull();
  });

  it("never records call notes, handover, the MHA clock, drafts, searches, mock-ups or developer pages", () => {
    for (const path of [
      "/on-call/call",
      "/on-call/handover",
      "/on-call/referrals",
      "/forms/clock",
      "/psychiatry/mha-clock",
      "/cme/new",
      "/teaching/feedback",
      "/teaching/c/secret-token",
      "/open-shifts/post",
      "/safety-plan",
      "/first-nations",
      "/first-nations/contacts",
      "/mockups/anything",
      "/developer",
      "/dsm/search",
      "/therapy-compass/search",
      "/differentials/presentations",
      "/specifiers/builder",
      "/",
      "/dsm",
    ]) {
      expect(recentPageTarget(path), path).toBeNull();
    }
  });

  it("drops a query or hash, and refuses a path segment that could carry typed words", () => {
    expect(recentPageTarget("/medications/sertraline?q=dose%20in%20pregnancy#top")?.path).toBe(
      "/medications/sertraline",
    );
    expect(recentPageTarget("/medications/John%20Smith")).toBeNull();
    expect(recentPageTarget("/medications/a b")).toBeNull();
  });

  it("reads the page's own name from its title and refuses generic ones", () => {
    expect(recentPageTitle("Major depressive disorder | DSM-5 Diagnosis | PsychSift")).toBe(
      "Major depressive disorder",
    );
    expect(recentPageTitle("Swaps | Roster | PsychSift")).toBe("Swaps");
    expect(recentPageTitle("Obsessive-compulsive disorder - Therapy")).toBe("Obsessive-compulsive disorder");
    expect(recentPageTitle("PsychSift")).toBeNull();
    expect(recentPageTitle("Medication | PsychSift")).toBeNull();
    expect(recentPageTitle("Therapy not found - Therapy")).toBeNull();
    expect(recentPageTitle("Search DSM diagnoses | PsychSift")).toBeNull();
  });
});

describe("the stored list", () => {
  it("keeps one entry per path, newest first, capped", () => {
    const now = Date.now();
    recordRecentPage("/roster", "Roster", now - 3000);
    recordRecentPage("/medications/lithium", "Lithium", now - 2000);
    recordRecentPage("/roster", "Roster", now - 1000);
    expect(readRecentPages(now).map((page) => page.path)).toEqual(["/roster", "/medications/lithium"]);

    for (let index = 0; index < RECENT_PAGES_LIMIT + 4; index += 1) {
      recordRecentPage(`/medications/med-${index}`, `Med ${index}`, now + index);
    }
    expect(countRecentPages()).toBe(RECENT_PAGES_LIMIT);
  });

  it("refuses anything recentPageTarget refuses, whatever the caller checked", () => {
    recordRecentPage("/on-call/handover", "Handover");
    recordRecentPage("/forms/clock", "MHA clock");
    expect(countRecentPages()).toBe(0);
  });

  it("stores only path, title, mode, section and time, and drops malformed, expired or rewritten entries", () => {
    const now = Date.now();
    const kept = normaliseRecentPages(
      [
        { path: "/roster", title: "Roster", mode: "work", section: "roster", at: now, note: "extra" },
        { path: "/on-call/call", title: "Call", mode: "work", section: "on-call", at: now },
        { path: "/roster/swaps", title: "Swaps", mode: "clinical", section: "roster", at: now },
        {
          path: "/medications/old",
          title: "Old",
          mode: "clinical",
          section: "prescribing",
          at: now - RECENT_PAGES_TTL_MS - 1,
        },
        { path: "/medications/blank", title: "  ", mode: "clinical", section: "prescribing", at: now },
        "nonsense",
      ],
      now,
    );
    expect(kept).toEqual([{ path: "/roster", title: "Roster", mode: "work", section: "roster", at: now }]);
  });

  it("forgets one page, clears all, and is cleared at an account transition", () => {
    recordRecentPage("/roster", "Roster");
    recordRecentPage("/medications/lithium", "Lithium");
    forgetRecentPage("/roster");
    expect(readRecentPages().map((page) => page.path)).toEqual(["/medications/lithium"]);

    clearAccountScopedBrowserStorage();
    expect(window.localStorage.getItem(RECENT_PAGES_STORAGE_KEY)).toBeNull();
    expect(countRecentPages()).toBe(0);
  });

  it("picks the newest of one section, leaving out the page on screen", () => {
    const now = Date.now();
    recordRecentPage("/dsm/diagnoses/a", "A", now - 4);
    recordRecentPage("/roster", "Roster", now - 3);
    recordRecentPage("/dsm/diagnoses/b", "B", now - 2);
    recordRecentPage("/dsm/diagnoses/c", "C", now - 1);
    const pages = readRecentPages(now);
    expect(pickRecentPages(pages, { limit: 3, section: "dsm" }).map((page) => page.title)).toEqual(["C", "B", "A"]);
    expect(pickRecentPages(pages, { limit: 2, exceptPath: "/dsm/diagnoses/c/" }).map((page) => page.title)).toEqual([
      "B",
      "Roster",
    ]);
  });
});

describe("privacy guards (review fixes)", () => {
  it("never keeps a title that could name a patient", () => {
    recordRecentPage("/documents/doc-1", "Discharge summary Mr Testpatient");
    expect(readRecentPages()).toEqual([]);
    announceRecentPageTitle("/documents/doc-2", "Jane Citizen MRN 1234567");
    expect(announcedRecentPageTitle("/documents/doc-2")).toBeNull();
    recordRecentPage("/documents/doc-3", "Lithium monitoring guideline");
    expect(readRecentPages().map((page) => page.title)).toEqual(["Lithium monitoring guideline"]);
  });

  it("never records roster requests or anything below a record", () => {
    expect(recentPageTarget("/roster/requests")).toBeNull();
    expect(recentPageTarget("/therapy-compass/cbt/brief")).toBeNull();
    expect(recentPageTarget("/therapy-compass/cbt/sheet")).toBeNull();
    expect(recentPageTarget("/dsm/diagnoses/major-depressive-disorder/extra")).toBeNull();
    expect(recentPageTarget("/therapy-compass/cbt")).not.toBeNull();
  });

  it("drops entries that expire while cached, and removes them from the device", () => {
    const at = Date.now();
    recordRecentPage("/medications/lithium", "Lithium", at);
    expect(readRecentPages(at)).toHaveLength(1);
    expect(readRecentPages(at + RECENT_PAGES_TTL_MS + 10)).toEqual([]);
    expect(window.localStorage.getItem(RECENT_PAGES_STORAGE_KEY)).toBeNull();
  });

  it("moves to a new generation on clear and at an account transition", () => {
    const before = recentPagesGeneration();
    clearRecentPages();
    expect(recentPagesGeneration()).toBe(before + 1);
    clearAccountScopedBrowserStorage();
    expect(recentPagesGeneration()).toBeGreaterThan(before + 1);
  });
});
