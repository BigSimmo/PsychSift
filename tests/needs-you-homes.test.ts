import { describe, expect, it } from "vitest";

import { isStaffWorkHomePath, needsYouBellVisibleForAuth } from "@/lib/needs-you/homes";
import { groupNeedsYouItems, needsYouWaitingCopy } from "@/lib/needs-you/groups";
import type { MyDayItem } from "@/lib/my-day/model";

describe("staff work home paths for the Needs you bell", () => {
  it("shows on the six signed-in work homes, including On Call Who's on", () => {
    expect(isStaffWorkHomePath("my-day", "/my-day")).toBe(true);
    expect(isStaffWorkHomePath("roster", "/roster")).toBe(true);
    // work-mode redesign, owner request 6 Oct 2026: Admin's home is Today at /admin; Renewals keeps its bell.
    expect(isStaffWorkHomePath("my-work", "/admin")).toBe(true);
    expect(isStaffWorkHomePath("my-work", "/admin/renewals")).toBe(true);
    expect(isStaffWorkHomePath("teaching", "/teaching")).toBe(true);
    expect(isStaffWorkHomePath("cme", "/cme")).toBe(true);
    expect(isStaffWorkHomePath("on-call", "/on-call")).toBe(true);
    expect(isStaffWorkHomePath("on-call", "/on-call/whos-on")).toBe(true);
  });

  it("stays off inner pages, First Nations, clinical search, and psychiatry", () => {
    expect(isStaffWorkHomePath("on-call", "/on-call/contacts")).toBe(false);
    expect(isStaffWorkHomePath("roster", "/roster/team")).toBe(false);
    expect(isStaffWorkHomePath("cme", "/cme/log")).toBe(false);
    expect(isStaffWorkHomePath("my-work", "/admin/compliance")).toBe(false);
    expect(isStaffWorkHomePath("my-day", "/my-day/week")).toBe(false);
    expect(isStaffWorkHomePath("first-nations", "/first-nations")).toBe(false);
    expect(isStaffWorkHomePath("answer", "/")).toBe(false);
    expect(isStaffWorkHomePath("psychiatry", "/psychiatry")).toBe(false);
    expect(isStaffWorkHomePath("medicines", "/medicines")).toBe(false);
  });

  it("hides for signed-out sessions", () => {
    expect(needsYouBellVisibleForAuth("authenticated")).toBe(true);
    expect(needsYouBellVisibleForAuth("unconfigured")).toBe(true);
    expect(needsYouBellVisibleForAuth("signed_out")).toBe(false);
    expect(needsYouBellVisibleForAuth("expired")).toBe(false);
    expect(needsYouBellVisibleForAuth("loading")).toBe(false);
  });
});

describe("Needs you grouping and copy", () => {
  const item = (mode: MyDayItem["mode"], id: string): MyDayItem => ({
    id,
    mode,
    title: id,
    due: null,
    severity: "info",
    href: `/${mode}`,
  });

  it("groups by mode in My Day order and skips empty modes", () => {
    const groups = groupNeedsYouItems([item("teaching", "t"), item("on-call", "o"), item("cme", "c")]);
    expect(groups.map((group) => group.mode)).toEqual(["on-call", "cme", "teaching"]);
    expect(groups.map((group) => group.label)).toEqual(["On Call", "CPD", "Teaching"]);
  });

  it("says something needs attention, never a scare word", () => {
    expect(needsYouWaitingCopy(0)).toBe("Nothing needs you right now.");
    expect(needsYouWaitingCopy(1)).toBe("Something needs attention.");
    expect(needsYouWaitingCopy(4)).toBe("4 things need attention.");
    for (const copy of [needsYouWaitingCopy(0), needsYouWaitingCopy(1), needsYouWaitingCopy(4)]) {
      expect(copy.toLowerCase()).not.toMatch(/alert|compliant|you.?re behind/);
    }
  });
});
