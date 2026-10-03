/** @vitest-environment jsdom */

// My Day Week: seven Perth days from today, grouped by the day each thing starts
// or falls due, with honest signed-out, loading, failed and empty states.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CmeRoutine } from "@/lib/cme/routines";
import type { MyDayItem, MyDaySourceResult } from "@/lib/my-day/model";
import { DEFAULT_REMINDER_SETTINGS } from "@/lib/reminders/settings";
import { groupByPerthDay, myDayItemWeekDate, myDayWeekDayLabel, myDayWeekDates } from "@/lib/my-day/week";

type ItemsRead = {
  status: "loading" | "ready" | "signed-out";
  items: MyDayItem[];
  sources: MyDaySourceResult[];
  demoMode: boolean;
  retry: () => void;
  cmeRoutines: CmeRoutine[];
};
const itemsState = vi.hoisted(() => ({ current: undefined as unknown as ItemsRead }));
vi.mock("@/components/my-day/use-my-day-items", () => ({ useMyDayItems: () => itemsState.current }));

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

type Teaching = { status: string; week: unknown; demo: "off"; retry: () => void };
const teachingState = vi.hoisted(() => ({ current: undefined as unknown as Teaching }));
vi.mock("@/components/teaching/use-teaching-week", () => ({ useTeachingWeek: () => teachingState.current }));

vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({ preferences: { reminders: DEFAULT_REMINDER_SETTINGS } }),
}));

const auth = vi.hoisted(() => ({ status: "authenticated", authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="account-dialog" /> : null),
}));

import { MyDayWeekPage } from "@/components/my-day/my-day-week-page";

// 09:00 on Sat 3 Oct 2026 in Perth.
const NOW = new Date("2026-10-03T01:00:00Z");

const retryItems = vi.fn();
const retryTeaching = vi.fn();
const reload = vi.fn(async () => undefined);
const readySources: MyDaySourceResult[] = (["on-call", "roster", "cme", "teaching", "my-work"] as const).map(
  (mode) => ({
    mode,
    status: "ready",
    items: [],
  }),
);

function item(id: string, due: string | null, overrides: Partial<MyDayItem> = {}): MyDayItem {
  return {
    id,
    mode: "my-work",
    title: `Item ${id}`,
    due,
    severity: "info",
    href: `/admin/${id}`,
    ...overrides,
  };
}

function shift(id: string, startsAt: string, endsAt: string, kind: string, extra: Record<string, unknown> = {}) {
  return { id, startsAt, endsAt, kind, title: kind, source: "import", workplace: null, location: null, ...extra };
}

function session(occurrenceId: string, startsAt: string, endsAt: string, extra: Record<string, unknown> = {}) {
  return {
    occurrenceId,
    serviceId: "svc",
    title: `Session ${occurrenceId}`,
    startsAt,
    endsAt,
    venue: null,
    hasJoinLink: false,
    status: "scheduled",
    isPresenter: false,
    source: "teaching",
    ...extra,
  };
}

function setItems(overrides: Partial<ItemsRead> = {}) {
  itemsState.current = {
    status: "ready",
    items: [],
    sources: readySources,
    demoMode: false,
    retry: retryItems,
    cmeRoutines: [],
    ...overrides,
  };
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
function setTeaching(sessions: unknown[] = [], overrides: Partial<Teaching> = {}) {
  teachingState.current = {
    status: "ready",
    week: { sessions, relocated: [], teams: [] },
    demo: "off",
    retry: retryTeaching,
    ...overrides,
  };
}

beforeEach(() => {
  auth.status = "authenticated";
  retryItems.mockClear();
  retryTeaching.mockClear();
  reload.mockClear();
  setItems();
  setShifts();
  setTeaching();
});
afterEach(cleanup);

describe("My Day week rules", () => {
  it("runs seven Perth days from today and labels them", () => {
    const dates = myDayWeekDates("2026-10-03");
    expect(dates).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
    expect(myDayWeekDayLabel("2026-10-03", "2026-10-03")).toBe("Today · Sat 3 Oct");
    expect(myDayWeekDayLabel("2026-10-04", "2026-10-03")).toBe("Tomorrow · Sun 4 Oct");
    expect(myDayWeekDayLabel("2026-10-05", "2026-10-03")).toBe("Mon 5 Oct");
  });

  it("puts a past-due item under Today and drops undated and later items", () => {
    const last = "2026-10-09";
    expect(myDayItemWeekDate(item("a", "2026-10-01"), "2026-10-03", last)).toBe("2026-10-03");
    expect(myDayItemWeekDate(item("b", "2026-10-06T02:00:00Z"), "2026-10-03", last)).toBe("2026-10-06");
    // 17:00Z is 01:00 the next Perth day.
    expect(myDayItemWeekDate(item("c", "2026-10-05T17:00:00Z"), "2026-10-03", last)).toBe("2026-10-06");
    expect(myDayItemWeekDate(item("d", null), "2026-10-03", last)).toBeNull();
    expect(myDayItemWeekDate(item("e", "2026-10-10"), "2026-10-03", last)).toBeNull();
  });

  it("groups only the days given, in input order", () => {
    const grouped = groupByPerthDay(["x1", "y", "x2"], ["a", "b"], (row) => (row.startsWith("x") ? "a" : "zzz"));
    expect(grouped.get("a")).toEqual(["x1", "x2"]);
    expect(grouped.get("b")).toEqual([]);
    expect(grouped.has("zzz")).toBe(false);
  });
});

describe("MyDayWeekPage", () => {
  it("shows seven day lists headed by the Perth date range", () => {
    render(<MyDayWeekPage now={NOW} />);
    expect(screen.getByRole("heading", { level: 1, name: "Week" })).toBeTruthy();
    expect(screen.getByTestId("my-day-week-header").textContent).toContain("Sat 3 Oct to Fri 9 Oct");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Today · Sat 3 Oct",
      "Tomorrow · Sun 4 Oct",
      "Mon 5 Oct",
      "Tue 6 Oct",
      "Wed 7 Oct",
      "Thu 8 Oct",
      "Fri 9 Oct",
    ]);
  });

  it("says Nothing on for an empty day", () => {
    render(<MyDayWeekPage now={NOW} />);
    for (const date of ["2026-10-03", "2026-10-09"]) {
      expect(within(screen.getByTestId(`my-day-week-day-${date}`)).getByText("Nothing on")).toBeTruthy();
    }
  });

  it("attributes a shift that crosses midnight to the day it starts", () => {
    // 21:00 Sat 3 Oct to 07:30 Sun 4 Oct in Perth.
    setShifts({ shifts: [shift("night-1", "2026-10-03T13:00:00Z", "2026-10-03T23:30:00Z", "night")] });
    render(<MyDayWeekPage now={NOW} />);
    const saturday = screen.getByTestId("my-day-week-day-2026-10-03");
    const row = within(saturday).getByTestId("my-day-week-shift-night-1");
    expect(row.textContent).toContain("Night");
    expect(row.textContent).toContain("21:00–07:30 +1");
    expect(row.getAttribute("href")).toBe("/roster/shifts");
    expect(
      within(screen.getByTestId("my-day-week-day-2026-10-04")).queryByTestId("my-day-week-shift-night-1"),
    ).toBeNull();
    expect(within(screen.getByTestId("my-day-week-day-2026-10-04")).getByText("Nothing on")).toBeTruthy();
  });

  it("leaves out shifts that start outside the seven days", () => {
    setShifts({
      shifts: [
        shift("before", "2026-10-02T15:00:00Z", "2026-10-02T23:00:00Z", "day"),
        shift("after", "2026-10-10T00:00:00Z", "2026-10-10T08:00:00Z", "day"),
      ],
    });
    render(<MyDayWeekPage now={NOW} />);
    expect(screen.queryByTestId("my-day-week-shift-before")).toBeNull();
    expect(screen.queryByTestId("my-day-week-shift-after")).toBeNull();
  });

  it("lists teaching sessions on their Perth day and links to the session", () => {
    setTeaching([session("s1", "2026-10-05T03:00:00Z", "2026-10-05T04:00:00Z", { venue: "Room 2" })]);
    render(<MyDayWeekPage now={NOW} />);
    const monday = screen.getByTestId("my-day-week-day-2026-10-05");
    const row = within(monday).getByTestId("my-day-week-session-s1");
    expect(row.textContent).toContain("Session s1");
    expect(row.textContent).toContain("Teaching · 11:00–12:00 · Room 2");
    expect(row.getAttribute("href")).toBe("/teaching/session/s1");
  });

  it("lists CPD routines due in the week and dated My Day items, once each", () => {
    const routine = {
      id: "r1",
      title: "Peer review group",
      cadence: "monthly",
      usualHours: 1,
      usualAllocations: [],
      nextDue: "2026-10-06",
      archivedAt: null,
    } as unknown as CmeRoutine;
    setItems({
      cmeRoutines: [routine],
      items: [item("late", "2026-10-01"), item("wed", "2026-10-07"), item("undated", null), item("far", "2026-10-30")],
    });
    render(<MyDayWeekPage now={NOW} />);
    expect(within(screen.getByTestId("my-day-week-day-2026-10-06")).getByText("Peer review group")).toBeTruthy();
    expect(within(screen.getByTestId("my-day-week-day-2026-10-07")).getByTestId("my-day-item-wed")).toBeTruthy();
    expect(within(screen.getByTestId("my-day-week-day-2026-10-03")).getByTestId("my-day-item-late")).toBeTruthy();
    expect(screen.queryByTestId("my-day-item-undated")).toBeNull();
    expect(screen.queryByTestId("my-day-item-far")).toBeNull();
    expect(screen.getAllByText("Peer review group")).toHaveLength(1);
  });

  it("omits example shifts unless this is a demo, and says so", () => {
    setShifts({ sample: true, shifts: [shift("ex", "2026-10-03T01:00:00Z", "2026-10-03T09:00:00Z", "day")] });
    render(<MyDayWeekPage now={NOW} />);
    expect(screen.queryByTestId("my-day-week-shift-ex")).toBeNull();
    expect(screen.getByTestId("my-day-week-sample-notice")).toBeTruthy();
  });

  it("shows example shifts with a demo notice in demo mode", () => {
    setShifts({
      sample: true,
      demoMode: true,
      shifts: [shift("ex", "2026-10-03T01:00:00Z", "2026-10-03T09:00:00Z", "day")],
    });
    render(<MyDayWeekPage now={NOW} />);
    expect(screen.getByTestId("my-day-week-shift-ex")).toBeTruthy();
    expect(screen.getByTestId("my-day-week-demo-notice")).toBeTruthy();
  });

  it("shows a skeleton while any source is loading, not empty days", () => {
    setShifts({ status: "loading" });
    render(<MyDayWeekPage now={NOW} />);
    expect(screen.getByTestId("my-day-week-loading")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading your week");
    expect(screen.queryByText("Nothing on")).toBeNull();
  });

  it("names what failed, keeps the rest, and retries every read", () => {
    setShifts({ status: "error" });
    setTeaching([], { status: "offline", week: null });
    setItems({
      sources: readySources.map((source) =>
        source.mode === "cme" ? { ...source, status: "failed" as const } : source,
      ),
    });
    render(<MyDayWeekPage now={NOW} />);
    expect(screen.getByTestId("my-day-week-failed-notice").textContent).toContain(
      "Couldn't load: CPD, Roster shifts and Teaching sessions. Showing the rest.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryItems).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(retryTeaching).toHaveBeenCalledTimes(1);
  });

  it("asks a signed-out reader to sign in and reads nothing", () => {
    auth.status = "signed_out";
    render(<MyDayWeekPage now={NOW} />);
    const panel = screen.getByTestId("my-day-week-signed-out");
    expect(within(panel).getByText("Sign in to see your day")).toBeTruthy();
    expect(screen.queryByTestId("my-day-week-ready")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Sign in" }));
    expect(screen.getByTestId("account-dialog")).toBeTruthy();
  });

  it("shows the skeleton while the sign-in is being checked", () => {
    auth.status = "loading";
    render(<MyDayWeekPage now={NOW} />);
    expect(screen.getByTestId("my-day-week-loading")).toBeTruthy();
    expect(screen.queryByTestId("my-day-week-signed-out")).toBeNull();
  });
});
