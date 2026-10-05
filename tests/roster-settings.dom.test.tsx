/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import type { OnCallShift } from "@/lib/roster/shifts/model";
import { addDaysToDate, perthWallToIso } from "@/lib/roster/shifts/perth-time";

/*
 * Roster Settings, and Delete my data with a 30-second Undo: nothing is
 * deleted until the 30 seconds end with the page still open; leaving the page
 * first cancels the delete. Every roster here is
 * invented ("Example Hospital").
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/settings",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { RosterSettingsPage } from "@/components/roster/roster-settings-page";

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
const day = (date: string) => shift(date, "08:00", "16:30", "day");
const manualWeekly = (date: string, seriesId: string) =>
  shift(date, "09:00", "17:00", "other", { source: "manual", seriesId, workplace: null });

function mockShifts(shifts: OnCallShift[]) {
  routes.set("GET /api/roster/shifts", () => Response.json({ shifts, latestImport: null }));
}
function mockSettings(settings: Record<string, unknown>) {
  routes.set("GET /api/roster/settings", () => Response.json({ settings }));
}
function fetchCalls(url: string, method: string) {
  return fetchMock.mock.calls.filter(([input, init]) => String(input) === url && (init?.method ?? "GET") === method);
}
async function deleteMyData() {
  fireEvent.click(screen.getByRole("button", { name: /Delete my roster data/ }));
  expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
}

beforeEach(() => {
  routes.clear();
  mockSettings({ calendarShifts: false, rowName: null, codes: {} });
  routes.set("DELETE /api/roster/shifts", () => Response.json({ shifts: [], latestImport: null }));
  routes.set("PUT /api/roster/settings", (init) => Response.json({ settings: JSON.parse(String(init?.body)) }));
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const handler = routes.get(`${init?.method ?? "GET"} ${String(input)}`);
    return handler ? handler(init) : Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Roster Settings", () => {
  it("deletes nothing if Undo is pressed within 30 seconds, and everything after", async () => {
    mockShifts([day("2026-10-12"), manualWeekly("2026-10-14", "series-1")]);
    render(<RosterSettingsPage />);
    await screen.findByText("Example Hospital");
    vi.useFakeTimers();

    await deleteMyData();
    expect(screen.queryByText("Example Hospital")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(fetchCalls("/api/roster/shifts", "DELETE")).toHaveLength(0);
    expect(screen.getByText("Example Hospital")).toBeInTheDocument();

    await deleteMyData();
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(fetchCalls("/api/roster/shifts", "DELETE")).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(fetchCalls("/api/roster/shifts", "DELETE")).toHaveLength(1);
    // Committed: the request must outlive the page if it is left now.
    expect(fetchCalls("/api/roster/shifts", "DELETE")[0]![1]).toEqual(expect.objectContaining({ keepalive: true }));
  });

  it("says what Delete removes and what it keeps, and who sees what", async () => {
    mockShifts([day("2026-10-12")]);
    render(<RosterSettingsPage />);
    await screen.findByText("Example Hospital");
    const note = screen.getByTestId("roster-settings-delete-note");
    expect(note).toHaveTextContent("You get 30 seconds to change your mind.");
    expect(note).toHaveTextContent("Extra time you logged is not removed here, and phone alerts stop on every device.");
    expect(screen.getByTestId("roster-settings-who-sees")).toHaveTextContent("Roster does not ask for patient details");
  });

  it("deletes nothing if the page closes during the 30 seconds", async () => {
    mockShifts([day("2026-10-12")]);
    render(<RosterSettingsPage />);
    await screen.findByText("Example Hospital");
    vi.useFakeTimers();
    await deleteMyData();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(fetchCalls("/api/roster/shifts", "DELETE")).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(fetchCalls("/api/roster/shifts", "DELETE")).toHaveLength(0);
    expect(screen.getByText("Example Hospital")).toBeInTheDocument();
  });

  it("deletes nothing if the page is left inside the app during the 30 seconds", async () => {
    mockShifts([day("2026-10-12")]);
    const { unmount } = render(<RosterSettingsPage />);
    await screen.findByText("Example Hospital");
    vi.useFakeTimers();
    await deleteMyData();
    expect(fetchCalls("/api/roster/shifts", "DELETE")).toHaveLength(0);
    unmount();
    expect(fetchCalls("/api/roster/shifts", "DELETE")).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(fetchCalls("/api/roster/shifts", "DELETE")).toHaveLength(0);
  });

  it("sends nothing on leaving the page when nothing is pending", async () => {
    mockShifts([day("2026-10-12")]);
    const { unmount } = render(<RosterSettingsPage />);
    await screen.findByText("Example Hospital");
    unmount();
    expect(fetchCalls("/api/roster/shifts", "DELETE")).toHaveLength(0);
  });

  it("says the shifts could not be loaded, rather than that there are no workplaces", async () => {
    routes.set("GET /api/roster/shifts", () => Response.json({ error: "Unavailable" }, { status: 503 }));
    render(<RosterSettingsPage />);
    expect(await screen.findByTestId("roster-settings-error")).toHaveTextContent("Your shifts could not be loaded.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByTestId("roster-settings-workplaces")).toBeNull();
  });

  it("says the calendar links could not be loaded, rather than that there are none", async () => {
    mockShifts([day("2026-10-12")]);
    routes.set("GET /api/roster/links", () => Response.json({ error: "Unavailable" }, { status: 503 }));
    render(<RosterSettingsPage />);
    expect(await screen.findByTestId("roster-settings-links-error")).toHaveTextContent(
      "Your calendar links could not be loaded.",
    );
    expect(screen.queryByTestId("roster-settings-links")).toBeNull();
  });

  it("removes a workplace with its calendar links and codes, without recording an import", async () => {
    mockShifts([day("2026-10-12")]);
    mockSettings({ calendarShifts: false, rowName: null, codes: { "Example Hospital": { ADO: { kind: "off" } } } });
    routes.set("DELETE /api/roster/workplaces", () => Response.json({ ok: true }));
    routes.set("PUT /api/roster/settings", () => Response.json({ calendarShifts: false, rowName: null, codes: {} }));
    render(<RosterSettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Example Hospital" }));
    // Nothing is removed until the confirmation, which says what goes with it.
    expect(fetchCalls("/api/roster/workplaces", "DELETE")).toHaveLength(0);
    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent(
      "its calendar links, the shifts imported for it, and its shift codes",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove workplace" }));
    await waitFor(() => expect(fetchCalls("/api/roster/settings", "PUT")).toHaveLength(1));
    expect(JSON.parse(String(fetchCalls("/api/roster/workplaces", "DELETE")[0]?.[1]?.body))).toEqual({
      workplace: "Example Hospital",
    });
    expect(JSON.parse(String(fetchCalls("/api/roster/settings", "PUT")[0]?.[1]?.body))).toEqual({
      codes: { "Example Hospital": null },
    });
    expect(fetchCalls("/api/roster/shifts", "POST")).toHaveLength(0);
    // The links list is read again, so the removed workplace's link is gone from it.
    await waitFor(() => expect(fetchCalls("/api/roster/links", "GET").length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText("Removed")).toBeInTheDocument();
    expect(screen.queryByText("Example Hospital")).toBeNull();
  });

  it("turns calendar shifts on through Roster settings and only then offers the evening reminder", async () => {
    mockShifts([]);
    render(<RosterSettingsPage />);
    const reminder = await screen.findByRole("switch", { name: "Remind me the evening before" });
    expect(reminder).toBeDisabled();
    expect(screen.getByText("Turn on Calendar link first")).toBeInTheDocument();

    const calendar = screen.getByRole("switch", { name: "Shifts on my calendar link" });
    await waitFor(() => expect(calendar).toBeEnabled());
    fireEvent.click(calendar);
    await waitFor(() => expect(fetchCalls("/api/roster/settings", "PUT")).toHaveLength(1));
    expect(JSON.parse(String(fetchCalls("/api/roster/settings", "PUT")[0]?.[1]?.body))).toEqual({
      calendarShifts: true,
    });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Remind me the evening before" })).toBeEnabled());
  });

  it("lists calendar links by host only, and refreshes or removes one", async () => {
    mockShifts([]);
    routes.set("GET /api/roster/links", () =>
      Response.json({
        links: [
          {
            id: "l1",
            workplace: "Example Hospital",
            hostPreview: "calendar.example.org/…",
            lastFetchedAt: "2026-10-12T22:00:00.000Z",
            lastError: "unreachable",
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      }),
    );
    routes.set("DELETE /api/roster/links", () => Response.json({ ok: true }));
    // The refresh route answers 200 either way; only `ok` says whether the link was read.
    let refreshOk = false;
    routes.set("POST /api/roster/links/refresh", () =>
      Response.json({
        results: [refreshOk ? { id: "l1", ok: true } : { id: "l1", ok: false, reason: "not_calendar" }],
      }),
    );
    render(<RosterSettingsPage />);
    expect(await screen.findByText("calendar.example.org/…")).toBeInTheDocument();
    // The failure leads the second line, before the workplace the link belongs to.
    expect(screen.getByText("That calendar could not be reached. · Example Hospital")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh calendar.example.org/…" }));
    await waitFor(() => expect(fetchCalls("/api/roster/links/refresh", "POST")).toHaveLength(1));
    expect(JSON.parse(String(fetchCalls("/api/roster/links/refresh", "POST")[0]?.[1]?.body))).toEqual({ id: "l1" });
    expect(await screen.findByText("That link is not a calendar.")).toBeInTheDocument();
    expect(screen.queryByText("Refreshed")).toBeNull();
    refreshOk = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh calendar.example.org/…" }));
    expect(await screen.findByText("Refreshed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove calendar.example.org/…" }));
    expect(fetchCalls("/api/roster/links", "DELETE")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove calendar link" }));
    await waitFor(() => expect(screen.queryByText("calendar.example.org/…")).toBeNull());
    expect(screen.getByText("Uploaded files are never kept.", { exact: false })).toBeInTheDocument();
  });
});
