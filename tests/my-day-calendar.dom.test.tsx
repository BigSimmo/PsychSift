/** @vitest-environment jsdom */

// My Day Calendar, signed out: the sample calendar drawn from My Day's invented day,
// as Week and Hours do, reading no server and keeping nothing.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";
import { DEFAULT_REMINDER_SETTINGS } from "@/lib/reminders/settings";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({ preferences: { reminders: DEFAULT_REMINDER_SETTINGS } }),
  readAppPreferences: () => ({ timeZone: "Australia/Perth" }),
  subscribeAppPreferences: () => () => undefined,
}));
const auth = vi.hoisted(() => ({ status: "signed_out", authEpoch: 1, session: null }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="account-dialog" /> : null),
}));

import { MyDayCalendarPage } from "@/components/my-day/my-day-calendar-page";

// 09:00 on Sat 3 Oct 2026 in Perth.
const NOW = new Date("2026-10-03T01:00:00Z");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("My Day Calendar signed out", () => {
  it("shows the sample calendar, reads nothing and keeps nothing", async () => {
    window.localStorage.clear();
    resetExampleDataForTests();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<MyDayCalendarPage now={NOW} />);
    expect(screen.queryByTestId("my-day-calendar-signed-out")).toBeNull();
    const calendar = await screen.findByTestId("my-day-calendar-ready");
    expect(within(calendar).getAllByText("Registrar teaching: agitation").length).toBeGreaterThan(0);
    // Nothing in the sample can be exported, so the export panel and private link are left out.
    expect(screen.queryByTestId("my-day-calendar-export")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("asks a signed-out reader who turned example data off to sign in", () => {
    window.localStorage.clear();
    resetExampleDataForTests();
    setExampleDataOn(false);
    render(<MyDayCalendarPage now={NOW} />);
    const panel = screen.getByTestId("my-day-calendar-signed-out");
    expect(within(panel).getByText("Sign in to see your calendar")).toBeTruthy();
    expect(screen.queryByTestId("my-day-calendar-signed-out-sample")).toBeNull();
  });
});
