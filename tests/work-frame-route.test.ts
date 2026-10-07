import { describe, expect, it } from "vitest";

import { workFrameForRoute } from "@/lib/work-frame/areas";

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

  it("is null where no framed band is drawn", () => {
    expect(named("roster", "/roster/join")).toBeNull();
    expect(named("teaching", "/teaching/session/0d7c2e1a-6f43-4f6b-9a5e-0c1d2e3f4a5b")).toBeNull();
    expect(named("dsm", "/dsm")).toBeNull();
    expect(named("answer", "/")).toBeNull();
  });
});
