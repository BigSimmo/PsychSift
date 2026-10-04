/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import type { OnCallShift } from "@/lib/roster/shifts/model";
import { addDaysToDate, perthWallToIso } from "@/lib/roster/shifts/perth-time";

/*
 * Roster Today. Every roster here is invented ("Example Hospital").
 * `fetch` is mocked per route; the clock is pinned through the `now` prop.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/roster",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { RosterTodayPage } from "@/components/roster/roster-today-page";

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
function mockLinks(links: unknown[]) {
  routes.set("GET /api/roster/links", () => Response.json({ links }));
}

/** A calendar link in the server's own shape (`RosterCalendarLink`): a host preview, never the address. */
function link(lastFetchedAt: string | null, lastError: string | null = null) {
  return {
    id: "l1",
    workplace: "Example Hospital",
    hostPreview: "calendar.example.org/…",
    lastFetchedAt,
    lastError,
    createdAt: "2026-10-01T00:00:00Z",
  };
}

function renderToday(now = "2026-10-13T02:00:00Z") {
  return render(<RosterTodayPage now={new Date(now)} />);
}

beforeEach(() => {
  routes.clear();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // A team's assignments are read for a window this test does not pin; one route answers any window.
    const key = url.includes("?what=assignments&") ? url.slice(0, url.indexOf("&")) : url;
    const handler = routes.get(`${init?.method ?? "GET"} ${key}`);
    return handler ? handler(init) : Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Roster Today", () => {
  it("leads a day off with the next shift", async () => {
    mockShifts([night("2026-10-15")]);
    renderToday("2026-10-13T02:00:00Z");
    expect(await screen.findByText(/Thu 15 Oct/)).toBeInTheDocument();
    expect(screen.getByText("21:30")).toBeInTheDocument();
    expect(screen.getByTestId("roster-today-hero")).toHaveTextContent("Day off");
  });

  it("shows the empty state with both ways in", async () => {
    mockShifts([]);
    renderToday();
    expect(await screen.findByRole("button", { name: "Import a file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a shift" })).toBeInTheDocument();
    expect(screen.getByText("In a hospital team? Your roster manager will invite you.")).toBeInTheDocument();
  });

  it("opens the import flow and the add-a-shift sheet from the empty state", async () => {
    mockShifts([]);
    renderToday();
    fireEvent.click(await screen.findByRole("button", { name: "Import a file" }));
    expect(await screen.findByTestId("roster-import-flow")).toHaveTextContent("Step 1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add a shift" }));
    expect(await screen.findByTestId("roster-add-shift-form")).toBeInTheDocument();
  });

  it("counts down before a shift that starts today and draws the week as letters", async () => {
    mockShifts([day("2026-10-13"), night("2026-10-15")]);
    renderToday("2026-10-12T23:05:00Z"); // 07:05 Tuesday in Perth
    const hero = await screen.findByTestId("roster-today-hero");
    expect(hero).toHaveTextContent("Day · Example Hospital");
    expect(hero).toHaveTextContent("Starts in 55 min");
    const strip = screen.getByTestId("roster-today-week-strip");
    expect(strip.querySelectorAll("[data-kind]")).toHaveLength(2);
    expect(screen.getByLabelText("Thu 15 Oct: Night")).toBeInTheDocument();
    expect(screen.getByTestId("roster-today-next-night")).toHaveTextContent("Thu 15 Oct");
  });

  it("shows the rest before the next shift on the hero, the same cue as Shifts", async () => {
    mockShifts([day("2026-10-12"), day("2026-10-13")]);
    renderToday("2026-10-12T23:05:00Z"); // 07:05 Tuesday in Perth; Monday's shift ended 16:30
    const rest = await screen.findByTestId("roster-today-rest");
    expect(rest).toHaveTextContent("15 h 30 min rest");
    // A shift with no team carries no team rule, so the cue is never a warning.
    expect(rest).not.toHaveAttribute("data-warning");
  });

  it("offers Who can cover? for the next team shift even while another shift is on now", async () => {
    const teamId = "22222222-2222-4222-8222-222222222222";
    const actorId = "11111111-1111-4111-8111-111111111111";
    mockShifts([day("2026-10-13")]);
    routes.set("GET /api/roster/team", () =>
      Response.json({
        actorId,
        teams: [{ serviceId: teamId, name: "General Medicine", enabled: true, role: "member", grade: "registrar" }],
      }),
    );
    routes.set(`GET /api/roster/team/${teamId}?what=assignments`, () =>
      Response.json({
        assignments: [
          {
            id: "33333333-3333-4333-8333-000000000001",
            userId: actorId,
            name: "Dr Alex Example",
            grade: "registrar",
            siteId: null,
            siteName: "Example Hospital",
            startsAt: "2026-10-16T08:00:00+08:00",
            endsAt: "2026-10-16T16:30:00+08:00",
            shiftCode: "D",
            kind: "day",
          },
        ],
      }),
    );
    routes.set(`GET /api/roster/team/${teamId}?what=overview`, () =>
      Response.json({
        service: { id: teamId, name: "General Medicine" },
        me: { role: "member", grade: "registrar", rotationEndsOn: null },
        latestPublication: null,
        seenLatest: true,
        settings: { swapApproval: "auto_same_grade", rules: {}, rulesSource: null, payFortnightAnchor: null },
        sites: [],
      }),
    );
    renderToday("2026-10-13T02:00:00Z"); // 10:00 Tuesday in Perth: the imported day shift is on now
    const cover = await screen.findByTestId("roster-today-cover");
    expect(cover).toHaveTextContent("Who can cover?");
  });

  it("turns into the night dial between midnight and 06:00 on a night", async () => {
    mockShifts([night("2026-10-15")]);
    renderToday("2026-10-15T19:12:00Z"); // 03:12 Friday in Perth
    const dial = await screen.findByTestId("roster-night-dial");
    expect(screen.getByTestId("roster-night-dial-left")).toHaveTextContent("4 h 48 min");
    expect(dial).toHaveTextContent("left · ends 08:00");
    expect(screen.queryByTestId("roster-today-hero")).toBeNull();
  });

  it("shows the green Up to date only while a calendar link refreshed in the last six hours", async () => {
    mockShifts([night("2026-10-15")]);
    mockLinks([link("2026-10-12T22:00:00Z")]);
    const { unmount } = renderToday("2026-10-13T02:00:00Z");
    expect(await screen.findByTestId("roster-fresh")).toHaveTextContent("Up to date");
    expect(screen.queryByTestId("roster-stale")).toBeNull();
    unmount();
    mockLinks([link("2026-10-12T10:00:00Z")]);
    renderToday("2026-10-13T02:00:00Z");
    await screen.findByText(/Thu 15 Oct/);
    expect(screen.queryByTestId("roster-fresh")).toBeNull();
    const stale = await screen.findByTestId("roster-stale");
    expect(stale).toHaveTextContent("May be out of date");
    expect(screen.getByRole("button", { name: "Refresh calendar.example.org/…" })).toBeInTheDocument();
  });

  it("is not Up to date when the last refresh failed, and offers Refresh", async () => {
    mockShifts([night("2026-10-15")]);
    mockLinks([link("2026-10-12T22:00:00Z", "unreachable")]);
    renderToday("2026-10-13T02:00:00Z");
    await screen.findByText(/Thu 15 Oct/);
    expect(screen.queryByTestId("roster-fresh")).toBeNull();
    expect(await screen.findByTestId("roster-stale")).toHaveTextContent("May be out of date");
    expect(screen.getByRole("button", { name: "Refresh calendar.example.org/…" })).toBeInTheDocument();
  });

  it("refreshes a stale calendar link from Today with the same action Settings uses", async () => {
    mockShifts([night("2026-10-15")]);
    mockLinks([link("2026-10-12T10:00:00Z")]);
    routes.set("POST /api/roster/links/refresh", (init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { id?: string };
      if (body.id === "l1") {
        mockLinks([link("2026-10-13T01:59:00Z")]);
        return Response.json({ results: [{ id: "l1", ok: true }] });
      }
      return Response.json({ results: [] });
    });
    renderToday("2026-10-13T02:00:00Z");
    expect(await screen.findByTestId("roster-stale")).toHaveTextContent("May be out of date");
    fireEvent.click(screen.getByRole("button", { name: "Refresh calendar.example.org/…" }));
    expect(await screen.findByTestId("roster-fresh")).toHaveTextContent("Up to date");
    expect(screen.queryByTestId("roster-stale")).toBeNull();
    expect(screen.getByText("Refreshed")).toBeInTheDocument();
    const manual = fetchMock.mock.calls.filter(
      ([input, init]) => String(input) === "/api/roster/links/refresh" && init?.method === "POST",
    );
    expect(manual.some(([, init]) => JSON.parse(String(init?.body))?.id === "l1")).toBe(true);
  });

  it("asks the server once, on opening, to refresh whichever links are due, then reads the new shifts", async () => {
    mockShifts([]);
    routes.set("POST /api/roster/links/refresh", () => {
      mockShifts([night("2026-10-15")]);
      mockLinks([link("2026-10-13T01:59:00Z")]);
      return Response.json({ results: [{ id: "l1", ok: true }] });
    });
    renderToday("2026-10-13T02:00:00Z");
    expect(await screen.findByText(/Thu 15 Oct/)).toBeInTheDocument();
    expect(await screen.findByTestId("roster-fresh")).toHaveTextContent("Up to date");
    const refreshes = fetchMock.mock.calls.filter(
      ([input, init]) => String(input) === "/api/roster/links/refresh" && init?.method === "POST",
    );
    expect(refreshes).toHaveLength(1);
    expect(JSON.parse(String(refreshes[0]?.[1]?.body))).toEqual({});
  });

  it("asks a signed-out reader to sign in and offers no import", async () => {
    routes.set("GET /api/roster/shifts", () => Response.json({ error: "Sign in" }, { status: 401 }));
    renderToday();
    expect(await screen.findByTestId("roster-today-signed-out")).toHaveTextContent("Sign in to see your roster.");
    expect(screen.queryByRole("button", { name: "Import a file" })).toBeNull();
  });
});
