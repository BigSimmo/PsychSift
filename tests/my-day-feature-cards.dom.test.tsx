/** @vitest-environment jsdom */

// My Day Today's junior feature cards: drawn only with something to say, and never for a screen the
// launch switch holds back.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: "authenticated", authEpoch: 0 }),
}));
// These two read the network (handbook, logbook); their own tests cover them.
vi.mock("@/components/on-call/first-week/first-week-today-card", () => ({
  FirstWeekTodayCardLive: () => <p data-testid="first-week-card">first week</p>,
}));
vi.mock("@/components/teaching/term-folder/term-folder-today-card", () => ({
  TermFolderTodayCard: () => <p data-testid="term-folder-card">term folder</p>,
}));

import { MyDayFeatureCards } from "@/components/my-day/my-day-feature-cards";
import { WorkModeLaunchProvider } from "@/components/work-mode-launch/work-mode-launch-provider";

// Tue 6 Oct 2026, 19:30 in Perth.
const NOW = new Date("2026-10-06T11:30:00Z");
const TOMORROW_DAY = { startsAt: "2026-10-07T00:00:00Z", kind: "day" as const };

function draw(newWorkMode: boolean, tomorrowShift: typeof TOMORROW_DAY | null) {
  return render(
    <WorkModeLaunchProvider
      launch={{ newWorkMode, previewAudience: newWorkMode, classicPreferred: false, choiceAvailable: true }}
    >
      <MyDayFeatureCards now={NOW} today="2026-10-06" tomorrowShift={tomorrowShift} />
    </WorkModeLaunchProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("MyDayFeatureCards", () => {
  it("offers Sick for tomorrow with tomorrow's shift, and the first week pack", () => {
    draw(true, TOMORROW_DAY);
    const sick = screen.getByTestId("roster-sick-entry");
    expect(sick.getAttribute("href")).toBe("/roster/sick");
    expect(sick.textContent).toContain("Wed 7");
    expect(screen.getByTestId("first-week-card")).toBeTruthy();
    // No term on this device, and no application dates: nothing to show for either.
    expect(screen.queryByTestId("term-folder-card")).toBeNull();
    expect(screen.queryByTestId("applications-today-card")).toBeNull();
  });

  it("leaves out Sick for tomorrow when there is no shift tomorrow", () => {
    draw(true, null);
    expect(screen.queryByTestId("roster-sick-entry")).toBeNull();
  });

  it("draws nothing that opens a new-only screen on the classic work mode", () => {
    const { container } = draw(false, TOMORROW_DAY);
    expect(container.textContent).toBe("");
  });
});
