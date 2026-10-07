import { describe, expect, it } from "vitest";

import { WORK_AREAS, workFrameCurrentItem, workFrameForRoute } from "@/lib/work-frame/areas";

// work-mode redesign, owner request 6 Oct 2026: the top bar names the page and
// tints itself from the address before the band mounts, so it must agree with
// what the band's own first render draws, and stay off where no band is drawn.
describe("workFrameForRoute", () => {
  const named = (modeId: Parameters<typeof workFrameForRoute>[0], pathname: string) => {
    const frame = workFrameForRoute(modeId, pathname);
    return frame ? [frame.area.name, frame.page.label, frame.area.identity] : null;
  };

  it("names the frame's page and area for a framed work page", () => {
    expect(named("roster", "/roster/swaps")).toEqual(["Roster", "Swaps", "roster"]);
    expect(named("open-shifts", "/open-shifts")).toEqual(["Open shifts", "Browse", "roster"]);
    expect(named("roster", "/roster/manage")).toEqual(["Manage team", "Inbox", "roster"]);
    expect(named("my-day", "/my-day")).toEqual(["My Day", "Today", "my-day"]);
    expect(named("teaching", "/teaching/assessments")).toEqual(["Assessments", "To do", "teaching"]);
    expect(named("my-work", "/admin")).toEqual(["Admin", "Today", "my-work"]);
  });

  it("titles Roster's requests page as the page it is, from the first paint", () => {
    // work-mode redesign, owner request 6 Oct 2026: the More row stays "Leave", the band says the page.
    const frame = workFrameForRoute("roster", "/roster/requests");
    expect(frame?.page.label).toBe("Leave");
    expect(frame?.page.title).toBe("Leave and requests");
  });

  it("is null where no framed band is drawn", () => {
    expect(named("roster", "/roster/join")).toBeNull();
    expect(named("teaching", "/teaching/session/0d7c2e1a-6f43-4f6b-9a5e-0c1d2e3f4a5b")).toBeNull();
    expect(named("dsm", "/dsm")).toBeNull();
    expect(named("answer", "/")).toBeNull();
  });
});

describe("workFrameCurrentItem", () => {
  const assess = WORK_AREAS.assess;
  const current = (search: string) => workFrameCurrentItem(assess, "/teaching/assessments", search)?.id ?? null;

  it("keeps the supervisor's Inbox and Term overview off the To do tab", () => {
    expect(current("?view=inbox&as=supervisor")).toBe("assess-inbox");
    expect(current("?view=overview&as=supervisor")).toBe("assess-overview");
    expect(current("")).toBe("assess-todo");
    expect(current("?view=home")).toBe("assess-todo");
  });

  it("ticks Privacy on the profile's privacy tab and Work profile elsewhere", () => {
    const day = WORK_AREAS.day;
    expect(workFrameCurrentItem(day, "/my-day/profile", "?tab=privacy")?.id).toBe("my-day-privacy");
    expect(workFrameCurrentItem(day, "/my-day/profile", "")?.id).toBe("my-day-profile");
  });

  it("ticks each Notifications tab on its own page", () => {
    const notify = WORK_AREAS.notify;
    expect(workFrameCurrentItem(notify, "/my-day/notifications", "")?.id).toBe("notify-todo");
    expect(workFrameCurrentItem(notify, "/my-day/notifications/earlier", "?area=roster")?.id).toBe("notify-earlier");
    expect(workFrameCurrentItem(notify, "/my-day/notifications/settings", "")?.id).toBe("notify-settings");
    expect(workFrameForRoute("my-day", "/my-day/notifications")?.page.title).toBe("Notifications");
  });

  it("names the features' pages as their own items, not a tab", () => {
    expect(workFrameCurrentItem(WORK_AREAS.cpd, "/cme/applications/cv", "")?.id).toBe("applications");
    expect(workFrameCurrentItem(WORK_AREAS.admin, "/admin/new-job/ready", "")?.id).toBe("admin-ready");
    expect(workFrameCurrentItem(WORK_AREAS.call, "/on-call/whos-on/roster", "")?.id).toBe("whoson-roster");
    expect(workFrameCurrentItem(WORK_AREAS.teach, "/teaching/term/folder", "")?.id).toBe("term-folder");
  });

  it("keeps pages that draw their own header off the band", () => {
    expect(workFrameForRoute("my-day", "/my-day/setup")).toBeNull();
    expect(workFrameForRoute("my-day", "/my-day/help")).toBeNull();
    expect(workFrameForRoute("my-day", "/my-day/alerts/earlier")).toBeNull();
    expect(workFrameForRoute("cme", "/cme/export")).toBeNull();
    expect(workFrameForRoute("my-work", "/admin/workforce")).toBeNull();
    expect(workFrameForRoute("my-day", "/my-day/favourites")?.page.label).toBe("Favourites");
  });
});
