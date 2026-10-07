/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import { monthGridRange } from "@/lib/calendar/month-grid";
import type { OnCallShift } from "@/lib/roster/shifts/model";
import { addDaysToDate, perthWallToIso } from "@/lib/roster/shifts/perth-time";

/*
 * Roster Shifts: the week, Hours & rest (`?view=hours`), the month
 * (`?view=month`), the roster tools and the "Add" sheet. Every roster here is
 * invented ("Example Hospital", "Dr Alex Example").
 */

const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/shifts",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => navigation.search,
}));

import { RosterShiftsPage } from "@/components/roster/roster-shifts-page";

type Handler = (init?: RequestInit) => Response | Promise<Response>;
const routes = new Map<string, Handler>();
let fetchMock: ReturnType<typeof vi.fn>;

function shift(
  date: string,
  start: string,
  end: string,
  kind: ShiftKind,
  extra: Partial<OnCallShift> = {},
): OnCallShift {
  return {
    id: `${kind}-${date}`,
    startsAt: perthWallToIso(date, start)!,
    endsAt: perthWallToIso(end > start ? date : addDaysToDate(date, 1), end)!,
    title: SHIFT_KIND_LABEL[kind],
    location: null,
    sourceUid: null,
    kind,
    source: "import",
    seriesId: null,
    workplace: "Example Hospital",
    ...extra,
  };
}
const night = (date: string) => shift(date, "21:30", "08:00", "night");
const day = (date: string) => shift(date, "08:00", "16:30", "day");

function mockShifts(shifts: OnCallShift[]) {
  routes.set("GET /api/roster/shifts", () => Response.json({ shifts, latestImport: null }));
}
function mockSettings(settings: Record<string, unknown>) {
  routes.set("GET /api/roster/settings", () => Response.json({ settings }));
}
function mockTeamWindow(from: string, to: string, dates: string[], sample = false) {
  const teamId = "22222222-2222-4222-8222-222222222222";
  const actorId = "11111111-1111-4111-8111-111111111111";
  routes.set("GET /api/roster/team", () =>
    Response.json({
      actorId,
      teams: [{ serviceId: teamId, name: "General Medicine", enabled: true, role: "member", grade: "registrar" }],
      ...(sample ? { sample: true } : {}),
    }),
  );
  const url = `/api/roster/team/${teamId}?what=assignments&from=${from}&to=${to}`;
  routes.set(`GET ${url}`, () =>
    Response.json({
      assignments: dates.map((date, index) => ({
        id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
        userId: actorId,
        name: "Dr Alex Example",
        grade: "registrar",
        siteId: null,
        siteName: "Example Hospital",
        startsAt: `${date}T08:00:00+08:00`,
        endsAt: `${date}T16:30:00+08:00`,
        shiftCode: "D",
        kind: "day",
      })),
    }),
  );
  return url;
}
function fetchCalls(url: string, method: string) {
  return fetchMock.mock.calls.filter(([input, init]) => String(input) === url && (init?.method ?? "GET") === method);
}

beforeEach(() => {
  navigation.search = new URLSearchParams();
  routes.clear();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // Saved extra time is read for whichever fortnight is shown; one route answers every range.
    const url = String(input).startsWith("/api/roster/extra-time?") ? "/api/roster/extra-time" : String(input);
    const handler = routes.get(`${init?.method ?? "GET"} ${url}`);
    return handler ? handler(init) : Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Roster Shifts", () => {
  it("loads both teams' rules and applies them to the matching shifts using the full personal history", async () => {
    mockShifts([]);
    const first = "22222222-2222-4222-8222-222222222222";
    const second = "55555555-5555-4555-8555-555555555555";
    const actorId = "11111111-1111-4111-8111-111111111111";
    routes.set("GET /api/roster/team", () =>
      Response.json({
        actorId,
        teams: [first, second].map((serviceId) => ({
          serviceId,
          name: "Example team",
          enabled: true,
          role: "member",
          grade: "registrar",
        })),
      }),
    );
    const row = (id: string, startsAt: string, endsAt: string) => ({
      id,
      userId: actorId,
      name: "Dr Alex Example",
      grade: "registrar",
      siteId: null,
      siteName: null,
      startsAt,
      endsAt,
      shiftCode: "D",
      kind: "day",
    });
    const from = "2026-09-21",
      to = "2026-10-27";
    routes.set(`GET /api/roster/team/${first}?what=assignments&from=${from}&to=${to}`, () =>
      Response.json({
        assignments: [
          row("33333333-3333-4333-8333-000000000001", "2026-10-12T08:00:00+08:00", "2026-10-12T16:00:00+08:00"),
          row("33333333-3333-4333-8333-000000000003", "2026-10-13T16:00:00+08:00", "2026-10-13T23:00:00+08:00"),
        ],
      }),
    );
    routes.set(`GET /api/roster/team/${second}?what=assignments&from=${from}&to=${to}`, () =>
      Response.json({
        assignments: [
          row("33333333-3333-4333-8333-000000000002", "2026-10-13T00:00:00+08:00", "2026-10-13T08:00:00+08:00"),
        ],
      }),
    );
    for (const [id, minBreakHours] of [
      [first, 6],
      [second, 10],
    ] as const)
      routes.set(`GET /api/roster/team/${id}?what=overview`, () =>
        Response.json({ settings: { rules: { minBreakHours } } }),
      );
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    expect(await screen.findByText("Less than 10 hours' rest before this shift")).toBeInTheDocument();
    expect(screen.queryByText("Less than 6 hours' rest before this shift")).toBeNull();
    for (const id of [first, second]) expect(fetchCalls(`/api/roster/team/${id}?what=overview`, "GET")).toHaveLength(1);
  });
  it("offers Who can cover? on a team shift, beside the existing request rows", async () => {
    mockShifts([]);
    mockTeamWindow("2026-09-21", "2026-10-27", ["2026-10-15"]);
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    const row = await screen.findByRole("button", { name: /Thu 15 Oct: Day/ });
    fireEvent.click(row);
    const sheet = await screen.findByTestId("roster-team-shift-actions");
    expect(within(sheet).getByRole("link", { name: "Swap" })).toBeInTheDocument();
    expect(within(sheet).getAllByTestId("roster-who-can-cover").at(-1)).toHaveTextContent("Who can cover?");
  });

  it("offers Sick for tomorrow from the roster home to a doctor on a team", async () => {
    mockShifts([]);
    mockTeamWindow("2026-09-21", "2026-10-27", ["2026-10-15"]);
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    const entry = await screen.findByTestId("roster-sick-entry");
    expect(entry).toHaveAttribute("href", "/roster/sick");
    expect(entry).toHaveTextContent("Sick for tomorrow?");
  });

  it("does not offer Sick for tomorrow without a team, since nobody could be told", async () => {
    mockShifts([]);
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    await screen.findByTestId("roster-shifts-empty");
    expect(screen.queryByTestId("roster-sick-entry")).toBeNull();
  });

  it("loads the newly selected week before saying it has no team shifts", async () => {
    mockShifts([]);
    // Each week is read 21 days back (team rule lookback) and through the
    // 14-day share window from today (13 Oct), not just its own seven days.
    mockTeamWindow("2026-09-21", "2026-10-27", []);
    const nextUrl = mockTeamWindow("2026-09-22", "2026-10-27", ["2026-10-20"]);
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    await screen.findByText(/12 to 18 Oct · No shifts/);
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.queryByText(/19 to 25 Oct · No shifts/)).toBeNull();
    await waitFor(() => expect(fetchCalls(nextUrl, "GET")).toHaveLength(1));
    expect(await screen.findByRole("button", { name: /Tue 20 Oct: Day/ })).toBeInTheDocument();
  });

  it("never puts a sample team's invented shifts into the doctor's own roster", async () => {
    mockShifts([]);
    const url = mockTeamWindow("2026-09-21", "2026-10-27", ["2026-10-13"], true);
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    await screen.findByText(/12 to 18 Oct · No shifts/);
    expect(fetchCalls(url, "GET")).toHaveLength(0);
    expect(screen.queryByTestId("roster-shifts-row")).toBeNull();
  });

  it("stops going back once the previous week is outside the loaded history", async () => {
    mockShifts([]);
    for (const [from, to] of [
      ["2026-09-21", "2026-10-27"],
      ["2026-09-14", "2026-10-27"],
      ["2026-09-07", "2026-10-27"],
      ["2026-08-31", "2026-10-27"],
    ])
      mockTeamWindow(from, to, []);
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    await screen.findByText(/12 to 18 Oct · No shifts/);
    const previous = () => screen.findByRole("button", { name: "Previous week" });
    // Shifts load from 22 Sep: the weeks of 5 Oct and 28 Sep are whole; the week of 21 Sep is not.
    for (let step = 0; step < 2; step += 1) {
      const button = await previous();
      expect(button).not.toHaveAttribute("aria-disabled", "true");
      fireEvent.click(button);
    }
    const last = await previous();
    expect(last).toHaveAttribute("aria-disabled", "true");
    // It stays focusable, and a press does nothing.
    fireEvent.click(last);
    expect(await screen.findByText(/28 Sep to 4 Oct/)).toBeInTheDocument();
  });

  it("loads the newly selected month before displaying its team shifts", async () => {
    mockShifts([]);
    navigation.search = new URLSearchParams("view=month");
    const october = monthGridRange("2026-10");
    const octoberUrl = mockTeamWindow(addDaysToDate(october.start, -21), october.end, []);
    const november = monthGridRange("2026-11");
    // November's grid starts after today, so its read starts 21 days before today.
    const nextUrl = mockTeamWindow("2026-09-22", november.end, ["2026-11-10"]);
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    await waitFor(() => expect(fetchCalls(octoberUrl, "GET")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId("roster-team-shifts-loading")).toBeNull());
    expect(screen.getByRole("link", { name: "Shifts" })).toHaveAttribute("href", "/roster/shifts");
    // The month calendar loads in its own chunk, so wait for it to arrive.
    fireEvent.click(await screen.findByRole("button", { name: "Next month" }));
    await waitFor(() => expect(fetchCalls(nextUrl, "GET")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId("roster-team-shifts-loading")).toBeNull());
    expect(screen.getByTestId("roster-shifts-month")).toHaveTextContent("D · Day");
  });

  it("names the day a night ends on, and counts the week's shifts", async () => {
    mockShifts([night("2026-10-15")]);
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    const row = await screen.findByTestId("roster-shifts-row");
    expect(row).toHaveTextContent("21:30 to Fri 08:00");
    expect(row).toHaveTextContent("Example Hospital");
    expect(row).toHaveTextContent("Night");
    expect(screen.getByRole("heading", { name: /This week\s*12 to 18 Oct · 1 shift/ })).toBeInTheDocument();
    // The morning the night ends is a day off that says so.
    expect(screen.getAllByTestId("roster-shifts-off").map((item) => item.textContent)).toContain(
      "Fri16Fri 16, OffNight shift ends 08:00",
    );
  });

  it("leads with the next shift, and on a night shift with when it ends and the rest after it", async () => {
    mockShifts([night("2026-10-15"), shift("2026-10-17", "09:00", "17:00", "on_call", { workplace: null })]);
    const { unmount } = render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    const card = await screen.findByTestId("roster-next-shift");
    expect(card).toHaveTextContent("Next shift · Thu 15");
    expect(card).toHaveTextContent("Thu 15 Oct · 21:30 to Fri 08:00");
    expect(card).toHaveTextContent("Night · Example Hospital · starts in 59 h 30 min");
    unmount();
    // 23:40 Perth on the night itself.
    render(<RosterShiftsPage now={new Date("2026-10-15T15:40:00Z")} />);
    const now = await screen.findByTestId("roster-next-shift");
    expect(now).toHaveTextContent("On shift now · Thu 15 Oct night");
    expect(now).toHaveTextContent("8 h 20 min left · ends Fri 08:00");
    expect(within(now).getByRole("link", { name: /Phone numbers/ })).toHaveAttribute("href", "/on-call/contacts");
    expect(await screen.findByTestId("roster-after-night-note")).toHaveTextContent(
      "Your on call starts 25 h after this shift ends.",
    );
    expect(screen.getByTestId("roster-after-night-note")).toHaveTextContent("Clause 15(6)(g)");
  });

  it("says when rest after the nights is under the clause's band, in its own words", async () => {
    // One night, then a day shift 8 hours after it ends: under the 24 hours for a single night.
    mockShifts([night("2026-10-15"), shift("2026-10-16", "16:00", "22:00", "evening")]);
    render(<RosterShiftsPage now={new Date("2026-10-15T15:40:00Z")} />);
    const note = await screen.findByTestId("roster-after-night-note");
    expect(note).toHaveTextContent(
      "Your next evening shift starts 8 h after this shift ends, under the 24 hours free in clause 15(6)(g).",
    );
  });

  it("does not report a long run of nights that just ended as checked", async () => {
    // Six nights from Wed 7 Oct ended at 08:00 on Tue 13 Oct; it is now 10:00 that day.
    mockShifts(
      ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"].map((date) => night(date)),
    );
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    const row = await screen.findByTestId("roster-hours-row");
    expect(row).toHaveTextContent("Hours and rest: part checked");
    expect(row).toHaveTextContent("Rest after more than 5 nights in a row isn't checked");
    expect(row).not.toHaveTextContent("No warnings");
  });

  it("leads with on call running now and names it as on call", async () => {
    mockShifts([shift("2026-10-12", "17:00", "08:00", "on_call", { workplace: null }), day("2026-10-13")]);
    // 02:00 Perth on Tue 13 Oct, inside the on call.
    render(<RosterShiftsPage now={new Date("2026-10-12T18:00:00Z")} />);
    const card = await screen.findByTestId("roster-next-shift");
    expect(card).toHaveAccessibleName("On call now");
    expect(card).toHaveTextContent("On call now · Mon 12 Oct");
    expect(card).toHaveTextContent("ends Tue 08:00");
  });

  it("stores nothing about the doctor's roster on the device", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mockShifts([night("2026-10-15")]);
    mockSettings({
      rowName: "Dr Alex Example",
      codes: { "Example Hospital": { ADO: { kind: "off" } } },
      calendarShifts: true,
    });
    const views = ["", "view=month", "view=hours"];
    for (const view of views) {
      navigation.search = new URLSearchParams(view);
      const { unmount } = render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
      await waitFor(() => expect(screen.queryByTestId("roster-shifts-loading")).toBeNull());
      unmount();
    }
    const written = setItem.mock.calls.map(([key, value]) => `${key}=${value}`).join("\n");
    expect(written).not.toMatch(/Alex Example|Example Hospital|ADO|21:30|2026-10/);
  });

  it("shows the fortnight's rostered hours and logs a late finish with one tap", async () => {
    // Monday 12 Oct day shift finished at 16:30; it is now 17:45 Perth.
    mockShifts([day("2026-10-12"), night("2026-10-15")]);
    routes.set("GET /api/roster/extra-time", () => Response.json({ records: [] }));
    routes.set("POST /api/roster/extra-time", () => Response.json({ saved: true }));
    render(<RosterShiftsPage now={new Date("2026-10-12T09:45:00Z")} />);
    const fortnight = await screen.findByTestId("roster-fortnight");
    expect(fortnight).toHaveTextContent(/19\sh\s*rostered/);
    expect(screen.getByText("Rostered hours, not pay.")).toBeInTheDocument();
    expect(screen.getByText("16:30 to now, 1 h 15 min")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add the time since your last shift ended" }));
    await screen.findByText("Saved");
    const [call] = fetchCalls("/api/roster/extra-time", "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      kind: "stayed_late",
      startedAt: "2026-10-12T08:30:00.000Z",
      endedAt: "2026-10-12T09:45:00.000Z",
    });
    // Recorded once: the offer goes, and the fortnight counts it.
    expect(screen.queryByRole("button", { name: "Add the time since your last shift ended" })).toBeNull();
    expect(fortnight).toHaveTextContent(/plus 1\.25\sh extra/);
  });

  it("says on call is not counted when the fortnight's only shifts are on call", async () => {
    // Work-mode redesign, owner request 6 Oct 2026 (phone check): 0 h beside a week of on
    // call read as a fault, so the fortnight says why, and invents no hours.
    mockShifts([shift("2026-10-13", "17:00", "08:00", "on_call", { workplace: null })]);
    routes.set("GET /api/roster/extra-time", () => Response.json({ records: [] }));
    render(<RosterShiftsPage now={new Date("2026-10-12T09:45:00Z")} />);
    const fortnight = await screen.findByTestId("roster-fortnight");
    expect(fortnight).toHaveTextContent(/0\sh/);
    expect(within(fortnight).getByTestId("roster-fortnight-on-call-note")).toHaveTextContent(
      "On call isn't counted here.",
    );
  });

  it("adds no on-call note when the fortnight has no on-call shifts", async () => {
    mockShifts([day("2026-10-12")]);
    routes.set("GET /api/roster/extra-time", () => Response.json({ records: [] }));
    render(<RosterShiftsPage now={new Date("2026-10-12T09:45:00Z")} />);
    const fortnight = await screen.findByTestId("roster-fortnight");
    expect(within(fortnight).queryByTestId("roster-fortnight-on-call-note")).toBeNull();
  });

  it("never offers a late finish against sample shifts, or while the next shift is already running", async () => {
    routes.set("GET /api/roster/extra-time", () => Response.json({ records: [] }));
    routes.set("GET /api/roster/shifts", () =>
      Response.json({ shifts: [day("2026-10-12")], latestImport: null, sample: true }),
    );
    const { unmount } = render(<RosterShiftsPage now={new Date("2026-10-12T09:45:00Z")} />);
    await screen.findByTestId("roster-fortnight");
    expect(screen.queryByTestId("roster-stayed-late")).toBeNull();
    unmount();

    // Day shift ended 16:30 and an evening shift started at 16:30: the time since is that shift, not a late finish.
    mockShifts([day("2026-10-12"), shift("2026-10-12", "16:30", "23:00", "evening")]);
    render(<RosterShiftsPage now={new Date("2026-10-12T09:45:00Z")} />);
    await screen.findByTestId("roster-fortnight");
    expect(screen.queryByTestId("roster-stayed-late")).toBeNull();
  });

  it("counts saved extra time after a reload, and will not log the same late finish twice", async () => {
    mockShifts([day("2026-10-12"), night("2026-10-15")]);
    routes.set("GET /api/roster/extra-time", () =>
      Response.json({
        records: [{ kind: "stayed_late", startedAt: "2026-10-12T08:30:00.000Z", endedAt: "2026-10-12T09:30:00.000Z" }],
      }),
    );
    navigation.search = new URLSearchParams("view=hours");
    render(<RosterShiftsPage now={new Date("2026-10-12T09:45:00Z")} />);
    const extra = await screen.findByTestId("roster-hours-extra");
    expect(await within(extra).findByText(/Extra time · 1 h this fortnight/)).toBeInTheDocument();
    expect(within(extra).getByTestId("roster-hours-extra-row")).toHaveTextContent("16:30 to 17:30");
    expect(screen.queryByRole("button", { name: "Add the time since your last shift ended" })).toBeNull();
    const [read] = fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/roster/extra-time?"));
    expect(String(read?.[0])).toMatch(/^\/api\/roster\/extra-time\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
  });

  it("treats one instant as one record whatever its spelling, and a call-in as a different record", async () => {
    mockShifts([day("2026-10-12"), night("2026-10-15")]);
    routes.set("GET /api/roster/extra-time", () =>
      Response.json({
        records: [
          // Monday's shift ended 08:30Z; the database spells it with +00:00. A call-in shares the start.
          { kind: "called_in", startedAt: "2026-10-12T08:30:00+00:00", endedAt: "2026-10-12T09:00:00+00:00" },
        ],
      }),
    );
    routes.set("POST /api/roster/extra-time", () => Response.json({ saved: true }));
    navigation.search = new URLSearchParams("view=hours");
    render(<RosterShiftsPage now={new Date("2026-10-12T09:45:00Z")} />);
    const extra = await screen.findByTestId("roster-hours-extra");
    expect(await within(extra).findByText(/Extra time · 0.5 h this fortnight/)).toBeInTheDocument();
    // The call-in is not a late finish, so a late finish is still offered.
    fireEvent.click(screen.getByRole("button", { name: "Add the time since your last shift ended" }));
    await screen.findByText("Saved");
    expect(within(extra).getByText(/Extra time · 1.75 h this fortnight/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add the time since your last shift ended" })).toBeNull();
  });

  it("says so when saved extra time cannot be loaded, and retries", async () => {
    mockShifts([day("2026-10-12")]);
    let reads = 0;
    routes.set("GET /api/roster/extra-time", () => {
      reads += 1;
      return reads === 1 ? Response.json({ error: "down" }, { status: 503 }) : Response.json({ records: [] });
    });
    navigation.search = new URLSearchParams("view=hours");
    render(<RosterShiftsPage now={new Date("2026-10-12T09:45:00Z")} />);
    const error = await screen.findByTestId("roster-hours-extras-error");
    expect(error).toHaveTextContent("Saved extra time could not be loaded");
    expect(screen.getByTestId("roster-hours-extra")).toHaveTextContent("this fortnight so far");
    fireEvent.click(within(error).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByTestId("roster-hours-extras-error")).toBeNull());
  });

  it("sends a late finish once however fast it is tapped, and never before saved extra time loads", async () => {
    mockShifts([day("2026-10-12")]);
    let release: () => void = () => {};
    routes.set("GET /api/roster/extra-time", () => Response.json({ records: [] }));
    routes.set(
      "POST /api/roster/extra-time",
      () => new Promise<Response>((resolve) => (release = () => resolve(Response.json({ saved: true })))),
    );
    render(<RosterShiftsPage now={new Date("2026-10-12T09:45:00Z")} />);
    const add = await screen.findByRole("button", { name: "Add the time since your last shift ended" });
    fireEvent.click(add);
    fireEvent.click(add);
    release();
    await screen.findByText("Saved");
    expect(fetchCalls("/api/roster/extra-time", "POST")).toHaveLength(1);
  });

  it("hides Add while saved extra time could not be loaded, so a logged late finish is never sent again", async () => {
    mockShifts([day("2026-10-12")]);
    routes.set("GET /api/roster/extra-time", () => Response.json({ error: "down" }, { status: 503 }));
    navigation.search = new URLSearchParams("view=hours");
    render(<RosterShiftsPage now={new Date("2026-10-12T09:45:00Z")} />);
    await screen.findByTestId("roster-hours-extras-error");
    expect(screen.queryByRole("button", { name: "Add the time since your last shift ended" })).toBeNull();
  });

  it("gives the rest after nights only under the last night of a run", async () => {
    // Thursday's night is followed by another night, so the rest is not measured from it.
    mockShifts([
      night("2026-10-15"),
      night("2026-10-16"),
      shift("2026-10-18", "09:00", "17:00", "on_call", { workplace: null }),
    ]);
    render(<RosterShiftsPage now={new Date("2026-10-15T15:40:00Z")} />);
    await screen.findByTestId("roster-next-shift");
    await screen.findByTestId("roster-hours-row");
    expect(screen.queryByTestId("roster-after-night-note")).toBeNull();
  });

  it("says plainly that nothing was checked when the roster cannot load", async () => {
    routes.set("GET /api/roster/shifts", () => Response.json({ error: "down" }, { status: 503 }));
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    const failed = await screen.findByTestId("roster-shifts-error");
    expect(failed).toHaveTextContent("Couldn't load your roster.");
    expect(failed).toHaveTextContent("Hours and rest: not checked");
    expect(screen.queryByTestId("roster-hours-row")).toBeNull();
  });

  it("offers an import first to a doctor with no shifts and no team", async () => {
    mockShifts([]);
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    const empty = await screen.findByTestId("roster-shifts-empty");
    expect(empty).toHaveTextContent("No shifts yet");
    expect(within(empty).getByRole("button", { name: "Import a roster file" })).toBeInTheDocument();
    expect(within(empty).getByRole("link", { name: /Join a team/ })).toHaveAttribute("href", "/roster/join");
  });

  it("marks every hours-and-rest figure as a minimum when a team roster did not load", async () => {
    mockShifts([day("2026-10-14"), night("2026-10-15")]);
    routes.set("GET /api/roster/team", () => Response.json({ error: "down" }, { status: 503 }));
    navigation.search = new URLSearchParams("view=hours");
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    expect(await screen.findByTestId("roster-hours-rest-partial")).toHaveTextContent(
      "Only part of your roster loaded. These figures are minimums.",
    );
    expect(screen.getByTestId("roster-hours-rest-maxHours7d")).toHaveTextContent(/at least/);
    expect(screen.queryAllByTestId("roster-hours-rest-break")).toHaveLength(0);
    expect(screen.getByText("Breaks are shown once your whole roster loads.")).toBeInTheDocument();
  });

  it("says no warning does not mean within the limits while the rules are off", async () => {
    // After the signed rules' review date the check switches itself off.
    mockShifts([]);
    navigation.search = new URLSearchParams("view=hours");
    render(<RosterShiftsPage now={new Date("2027-09-10T02:00:00Z")} />);
    expect(await screen.findByTestId("roster-hours-rest-off")).toHaveTextContent(
      "No warnings are shown, and that does not mean your roster is within the limits.",
    );
  });

  it("reads a new calendar link straight away, and shows the new shifts", async () => {
    mockShifts([]);
    routes.set("POST /api/roster/links", () =>
      Response.json({
        link: {
          id: "new-link",
          workplace: "Example Hospital",
          hostPreview: "calendar.example.org/…",
          lastFetchedAt: null,
          lastError: null,
          createdAt: "2026-10-13T02:00:00Z",
        },
      }),
    );
    routes.set("POST /api/roster/links/refresh", () => {
      mockShifts([night("2026-10-15")]);
      return Response.json({ results: [{ id: "new-link", ok: true }] });
    });
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add a shift/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Add a calendar link/ }));
    fireEvent.change(screen.getByLabelText("Calendar link"), {
      target: { value: "https://calendar.example.org/feed.ics" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(await screen.findByText("21:30 to Fri 08:00")).toBeInTheDocument();
    const refreshes = fetchCalls("/api/roster/links/refresh", "POST");
    expect(refreshes).toHaveLength(1);
    expect(JSON.parse(String(refreshes[0]?.[1]?.body))).toEqual({ id: "new-link" });
  });

  it("says plainly when a workplace already has a calendar link", async () => {
    mockShifts([]);
    routes.set("POST /api/roster/links", () =>
      Response.json({ error: "Duplicate", code: "duplicate_workplace" }, { status: 409 }),
    );
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add a shift/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Add a calendar link/ }));
    fireEvent.change(screen.getByLabelText("Calendar link"), {
      target: { value: "https://calendar.example.org/feed.ics" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(await screen.findByText("You already have a calendar link for that workplace.")).toBeInTheDocument();
    expect(fetchCalls("/api/roster/links/refresh", "POST")).toHaveLength(0);
  });

  it("adds a shift by hand that repeats weekly", async () => {
    mockShifts([]);
    routes.set("POST /api/roster/shifts/manual", () => Response.json({ shifts: [] }));
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add a shift/ }));
    fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: /Add a shift/ }));
    fireEvent.change(screen.getByLabelText("Shift"), { target: { value: "evening" } });
    fireEvent.change(screen.getByLabelText("Repeat weekly"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save shift" }));
    await waitFor(() => expect(fetchCalls("/api/roster/shifts/manual", "POST")).toHaveLength(1));
    const body = JSON.parse(String(fetchCalls("/api/roster/shifts/manual", "POST")[0]?.[1]?.body));
    expect(body).toEqual({
      shift: {
        startsAt: "2026-10-13T06:00:00.000Z",
        endsAt: "2026-10-13T14:30:00.000Z",
        title: "Evening",
        location: null,
        sourceUid: null,
        kind: "evening",
      },
      repeatWeeks: 3,
    });
  });

  it("removes a hand-added shift with its weekly repeats", async () => {
    const series = "44444444-4444-4444-8444-444444444444";
    mockShifts([
      shift("2026-10-14", "09:00", "17:00", "other", { source: "manual", seriesId: series, workplace: null }),
    ]);
    routes.set(`DELETE /api/roster/shifts/manual/${series}`, () => Response.json({ deleted: true }));
    render(<RosterShiftsPage now={new Date("2026-10-13T02:00:00Z")} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Wed 14 Oct: Other work, 09:00 to 17:00. Remove it and its repeats" }),
    );
    // It asks first, naming what goes, and removes nothing until confirmed.
    expect(fetchCalls(`/api/roster/shifts/manual/${series}`, "DELETE")).toHaveLength(0);
    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent("every weekly repeat of it");
    fireEvent.click(screen.getByRole("button", { name: "Remove shift and repeats" }));
    await screen.findByText("Removed");
    expect(screen.queryByTestId("roster-shifts-row")).toBeNull();
  });
});
