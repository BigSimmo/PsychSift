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
};
const shiftsState = vi.hoisted(() => ({ current: undefined as unknown as Shifts }));
vi.mock("@/components/roster/use-roster-shifts", () => ({ useRosterShifts: () => shiftsState.current }));

const overview = vi.hoisted(() => ({ anchor: null as string | null }));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => ({ status: "ready", data: { teams: [{ serviceId: "svc", enabled: true }] } }),
  useRosterRead: () => ({
    status: "ready",
    data: { settings: { payFortnightAnchor: overview.anchor } },
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
  reload.mockClear();
  setShifts();
});
afterEach(cleanup);

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
    expect(screen.getByTestId("my-day-hours-week").textContent).toContain("5–11 Oct");
    expect(screen.getByTestId("my-day-hours-week").textContent).toContain("26");
    expect(screen.getByTestId("my-day-hours-fortnight").textContent).toContain("28 Sep – 11 Oct");
    expect(screen.getByTestId("my-day-hours-fortnight").textContent).toContain("34");
    expect(screen.getByTestId("my-day-hours-leave").textContent).toContain("12–13 Oct");
    expect(screen.getByTestId("my-day-hours-footer").textContent).toContain("not pay");
  });

  it("lines the fortnight up with the pay-fortnight start when the team sets one", () => {
    overview.anchor = "2026-10-01";
    setShifts({ shifts: [day("2026-10-05")] });
    render(<MyDayHoursPage now={NOW} />);
    // 1 Oct start: fortnights run 1-14 Oct.
    expect(screen.getByTestId("my-day-hours-fortnight").textContent).toContain("1–14 Oct");
  });

  it("says None booked when no leave is rostered", () => {
    setShifts({ shifts: [day("2026-10-05")] });
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-leave").textContent).toContain("None booked");
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

  it("asks a signed-out reader to sign in and shows no figures", () => {
    auth.status = "signed_out";
    render(<MyDayHoursPage now={NOW} />);
    expect(screen.getByTestId("my-day-hours-signed-out")).toBeTruthy();
    expect(screen.queryByTestId("my-day-hours-ready")).toBeNull();
  });
});
