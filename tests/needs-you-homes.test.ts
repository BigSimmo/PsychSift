import { describe, expect, it } from "vitest";

import {
  isNotificationsPath,
  isStaffWorkHomePath,
  needsYouBellVisibleForAuth,
  staffWorkBellVisible,
} from "@/lib/needs-you/homes";
import { groupNeedsYouItems, needsYouWaitingCopy } from "@/lib/needs-you/groups";
import type { MyDayItem } from "@/lib/my-day/model";

describe("staff work home paths", () => {
  it("names the six work homes, including On Call Who's on", () => {
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

  it("does not count inner pages, First Nations, clinical search, or psychiatry as homes", () => {
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
});

describe("where the header bell shows", () => {
  // Josh, 7 Oct 2026: every staff work page, just left of AI Search.
  it("shows on every page of the seven staff work modes, homes and inner pages alike", () => {
    expect(staffWorkBellVisible("my-day", "/my-day")).toBe(true);
    expect(staffWorkBellVisible("my-day", "/my-day/week")).toBe(true);
    expect(staffWorkBellVisible("my-day", "/my-day/notifications")).toBe(true);
    expect(staffWorkBellVisible("roster", "/roster")).toBe(true);
    expect(staffWorkBellVisible("roster", "/roster/team")).toBe(true);
    expect(staffWorkBellVisible("open-shifts", "/open-shifts")).toBe(true);
    expect(staffWorkBellVisible("my-work", "/admin")).toBe(true);
    expect(staffWorkBellVisible("my-work", "/admin/compliance")).toBe(true);
    expect(staffWorkBellVisible("teaching", "/teaching/week")).toBe(true);
    expect(staffWorkBellVisible("cme", "/cme/log")).toBe(true);
    expect(staffWorkBellVisible("on-call", "/on-call/contacts")).toBe(true);
    expect(staffWorkBellVisible("roster", "/roster/team/?tab=leave")).toBe(true);
  });

  it("stays off the setup walkthrough and the help centre, which draw their own top bar", () => {
    expect(staffWorkBellVisible("my-day", "/my-day/setup")).toBe(false);
    expect(staffWorkBellVisible("my-day", "/my-day/setup/roster")).toBe(false);
    expect(staffWorkBellVisible("my-day", "/my-day/help")).toBe(false);
    expect(staffWorkBellVisible("my-day", "/my-day/help/search")).toBe(false);
    // Whole segments only: a page whose name merely starts the same way keeps the bell.
    expect(staffWorkBellVisible("my-day", "/my-day/helpful")).toBe(true);
  });

  it("never shows on clinical modes, First Nations, Psychiatry, Medicines, or clinical search", () => {
    expect(staffWorkBellVisible("first-nations", "/first-nations")).toBe(false);
    expect(staffWorkBellVisible("answer", "/")).toBe(false);
    expect(staffWorkBellVisible("psychiatry", "/psychiatry")).toBe(false);
    expect(staffWorkBellVisible("medicines", "/medicines")).toBe(false);
    expect(staffWorkBellVisible("my-day", null)).toBe(false);
    expect(staffWorkBellVisible("my-day", undefined)).toBe(false);
  });

  it("knows the Notifications page and the pages below it", () => {
    expect(isNotificationsPath("/my-day/notifications")).toBe(true);
    expect(isNotificationsPath("/my-day/notifications/")).toBe(true);
    expect(isNotificationsPath("/my-day/notifications/earlier")).toBe(true);
    expect(isNotificationsPath("/my-day/notifications?tab=settings")).toBe(true);
    expect(isNotificationsPath("/my-day")).toBe(false);
    expect(isNotificationsPath("/my-day/notificationsx")).toBe(false);
    expect(isNotificationsPath("/my-day/alerts")).toBe(false);
    expect(isNotificationsPath(null)).toBe(false);
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
