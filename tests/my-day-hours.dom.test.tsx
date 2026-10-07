/** @vitest-environment jsdom */

// My Day Hours: this week's and this fortnight's rostered hours (Roster's own
// helpers), the next leave, and honest signed-out, loading, failed and empty states.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Shifts = {
  status: "loading" | "ready" | "signed-out" | "error";
  shifts: Record<string, unknown>[];
  teamLoading: boolean;
  demoMode: boolean;
  sample: boolean;
  reload: () => Promise<void>;
  teamMessage?: string | null;
};
const shiftsState = vi.hoisted(() => ({ current: undefined as unknown as Shifts }));
vi.mock("@/components/roster/use-roster-shifts", () => ({ useRosterShifts: () => shiftsState.current }));

const overview = vi.hoisted(() => ({ anchor: null as string | null, status: "ready" as string }));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => ({ status: "ready", data: { teams: [{ serviceId: "svc", enabled: true }] } }),
  useRosterRead: () => ({
    status: overview.status,
    data: overview.status === "ready" ? { settings: { payFortnightAnchor: overview.anchor } } : null,
  }),
}));

const auth = vi.hoisted(() => ({ status: "authenticated", authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="account-dialog" /> : null),
}));
vi.mock("@/components/my-day/use-my-day-items", () => ({ useMyDayItems: () => ({}) }));

import { MyDayHoursPage } from "@/components/my-day/my-day-hours-page";

// 09:00 on Wed 7 Oct 2026 in Perth: the week is Mon 5 to Sun 11 Oct.
const NOW = new Date("2026-10-07T01:00:00Z");
const reload = vi.fn(async () => undefined);

function shift(id: string, startsAt: string, endsAt: string, kind: string) {
  return { id, startsAt, endsAt, kind, title: kind, source: "import", workplace: null, location: null };
}

function setShifts(overrides: Partial<Shifts> = {}) {
  shiftsState.current = {
    status: "ready",
    shifts: [],
    teamLoading: false,
    demoMode: false,
    sample: false,
    reload,
    ...overrides,
  };
}

// Perth 08:00-16:00 is 00:00Z-08:00Z.
const day = (date: string, id = date) => shift(id, `${date}T00:00:00Z`, `${date}T08:00:00Z`, "day");

beforeEach(() => {
  auth.status = "authenticated";
  overview.anchor = null;
  overview.status = "ready";
  reload.mockClear();
  setShifts();
});
afterEach(cleanup);

// work-mode redesign, owner request 6 Oct 2026: date ranges read "5 to 11 Oct" (visible copy uses "to", not a dash).
describe("MyDayHoursPage", () => {
  it("shows this week's and this fortnight's rostered hours and the next leave", () => {
    setShifts({
      shifts: [
        day("2026-09-30"), // last week, inside the fortnight (Mon 28 Sep to Sun 11 Oct)
        day("2026-10-05"),
        day("2026-10-06"),
        // A night from 22:00 Tue 6 Oct to 08:00 Wed 7 Oct counts on Tue, the day it starts: 10 h.
        shift("night", "2026-10-06T14:00:00Z", "2026-10-07T00:00:00Z", "night"),
        // On call from home is not worked hours.
        shift("oc", "2026-10-08T00:00:00Z", "2026-10-08T08:00:00Z", "on_call"),
        shift("leave", "2026-10-12T00:00:00Z", "2026-10-13T08:00:00Z", "leave"),
      ],
    });
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByRole("heading", { level: 1, name: "Hours" })).toBeTruthy();
    expect(screen.getByTestId("my-day-hours-week").textContent).toContain("5 to 11 Oct");
    expect(screen.getByTestId("my-day-hours-week").textContent).toContain("26");
    expect(screen.getByTestId("my-day-hours-fortnight").textContent).toContain("28 Sep to 11 Oct");
    expect(screen.getByTestId("my-day-hours-fortnight").textContent).toContain("34");
    expect(screen.getByTestId("my-day-hours-leave").textContent).toContain("12 to 13 Oct");
    expect(screen.getByTestId("my-day-hours-footer").textContent).toContain("not pay");
  });

  it("lines the fortnight up with the pay-fortnight start when the team sets one", () => {
    overview.anchor = "2026-10-01";
    setShifts({ shifts: [day("2026-10-05")] });
    render(<MyDayHoursPage now={NOW} />);
    // 1 Oct start: fortnights run 1-14 Oct.
    expect(screen.getByTestId("my-day-hours-fortnight").textContent).toContain("1 to 14 Oct");
  });

  it("bounds the leave claim to the 40 days fetched when none is rostered", () => {
    setShifts({ shifts: [day("2026-10-05")] });
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-leave").textContent).toContain("None in the next 40 days");
  });

  it("shows no totals and a warning when team shifts failed to load", () => {
    setShifts({
      shifts: [day("2026-10-05")],
      teamMessage: "Team shifts could not be loaded. Your own shifts are shown.",
    });
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-partial").textContent).toContain("Team shifts could not be loaded");
    expect(screen.queryByTestId("my-day-hours-facts")).toBeNull();
    expect(screen.queryByTestId("my-day-hours-empty")).toBeNull();
  });

  it("does not present a fallback fortnight when the pay-fortnight settings failed", () => {
    overview.status = "error";
    setShifts({ shifts: [day("2026-10-05")] });
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-settings-failed")).toBeTruthy();
    expect(screen.getByTestId("my-day-hours-fortnight").textContent).toContain("Unavailable");
    expect(screen.getByTestId("my-day-hours-week").textContent).toContain("5 to 11 Oct");
  });

  it("keeps the page loading while the pay-fortnight settings load", () => {
    overview.status = "loading";
    setShifts({ shifts: [day("2026-10-05")] });
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-loading")).toBeTruthy();
  });

  it("links to Roster Shifts", () => {
    setShifts({ shifts: [day("2026-10-05")] });
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-shifts-link").getAttribute("href")).toBe("/roster/shifts");
  });

  it("says so, rather than showing 0 h, when there are no shifts", () => {
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-empty").textContent).toContain("No shifts in your roster yet");
    expect(screen.queryByTestId("my-day-hours-facts")).toBeNull();
    expect(screen.getByTestId("my-day-hours-shifts-link")).toBeTruthy();
  });

  it("shows no hours for example shifts outside demo mode", () => {
    setShifts({ sample: true, shifts: [day("2026-10-05")] });
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-sample")).toBeTruthy();
    expect(screen.queryByTestId("my-day-hours-facts")).toBeNull();
  });

  it("shows example hours with a demo notice in demo mode", () => {
    setShifts({ sample: true, demoMode: true, shifts: [day("2026-10-05")] });
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-demo-notice")).toBeTruthy();
    expect(screen.getByTestId("my-day-hours-facts")).toBeTruthy();
  });

  it("shows a skeleton while the roster is loading", () => {
    setShifts({ status: "loading" });
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-loading")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading your hours");
  });

  it("reports a failed read with a retry and still links to Shifts", () => {
    setShifts({ status: "error" });
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-failed").textContent).toContain("Couldn't load your roster");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("my-day-hours-shifts-link")).toBeTruthy();
  });

  it("shows a signed-out reader sample hours, reads nothing and keeps nothing", async () => {
    auth.status = "signed_out";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-signed-out")).toBeTruthy();
    // The sample is a lazily loaded module; a cold first import can take over the default one second here.
    expect(await screen.findByTestId("my-day-hours-ready", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByTestId("my-day-hours-week")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    setItem.mockRestore();
  });
});
