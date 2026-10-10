/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnCallShift } from "@/lib/roster/shifts/model";

/*
 * useRosterShifts with `ownHistory`: an older month reads your own shifts for
 * its dates, merged once with the main list. Every shift here is invented.
 */

vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => ({ status: "ready", data: null, reload: () => undefined }),
  rosterTeamUrl: (id: string) => `/api/roster/team/${id}`,
}));
vi.mock("@/components/work-time/use-work-time-zone", () => ({
  useWorkTimeZone: () => ({ zone: "Australia/Perth" }),
}));
vi.mock("@/lib/example-data/store", () => ({ reportAreaData: () => undefined }));

import { useRosterShifts } from "@/components/roster/use-roster-shifts";

function shift(id: string, startsAt: string, endsAt: string): OnCallShift {
  return {
    id,
    startsAt,
    endsAt,
    title: "Day shift",
    location: null,
    sourceUid: null,
    kind: "day",
    source: "import",
    seriesId: null,
    workplace: "Example Hospital",
  };
}

const listed = shift("recent", "2026-10-09T00:00:00Z", "2026-10-09T08:30:00Z");
const older = shift("older", "2026-08-12T00:00:00Z", "2026-08-12T08:30:00Z");
let requests: string[];
let olderStatus: number;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T02:00:00Z"));
  requests = [];
  olderStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://psychiatry.tools");
      requests.push(`${url.pathname}${url.search}`);
      if (url.searchParams.has("from")) {
        return olderStatus === 200
          ? Response.json({ shifts: [older, listed] })
          : Response.json({ error: "no" }, { status: olderStatus });
      }
      return Response.json({ shifts: [listed], latestImport: null });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("your own shifts in an older month", () => {
  it("reads the older dates and shows them once beside the main list, soonest first", async () => {
    const { result } = renderHook(() =>
      useRosterShifts({ from: "2026-07-31", to: "2026-09-01" }, { ownHistory: true }),
    );
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    expect(result.current.shifts.map((item) => item.id)).toEqual(["older", "recent"]);
    expect(result.current.historyFailed).toBe(false);
    expect(requests).toContain("/api/roster/shifts?from=2026-07-31&to=2026-09-01");
  });

  it("stops the dated read where the main list starts, for a month that straddles it", async () => {
    const { result } = renderHook(() =>
      useRosterShifts({ from: "2026-09-13", to: "2026-10-15" }, { ownHistory: true }),
    );
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    expect(requests).toContain("/api/roster/shifts?from=2026-09-13&to=2026-09-19");
  });

  it("makes no dated read for a recent month, or for a screen that did not ask", async () => {
    const recent = renderHook(() => useRosterShifts({ from: "2026-09-30", to: "2026-11-01" }, { ownHistory: true }));
    const plain = renderHook(() => useRosterShifts({ from: "2026-07-31", to: "2026-09-01" }));
    await waitFor(() => expect(recent.result.current.status).toBe("ready"));
    await waitFor(() => expect(plain.result.current.status).toBe("ready"));
    expect(requests.some((url) => url.includes("from="))).toBe(false);
    expect(recent.result.current.historyLoading).toBe(false);
    expect(plain.result.current.shifts.map((item) => item.id)).toEqual(["recent"]);
  });

  it("reads the older shifts again after you delete your roster, so deleted ones do not come back", async () => {
    const { result } = renderHook(() =>
      useRosterShifts({ from: "2026-07-31", to: "2026-09-01" }, { ownHistory: true }),
    );
    await waitFor(() => expect(result.current.shifts.map((item) => item.id)).toContain("older"));
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://psychiatry.tools");
      requests.push(`${url.pathname}${url.search}`);
      return Response.json({ shifts: [], latestImport: null });
    });
    await act(async () => {
      await result.current.deleteAll();
    });
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    expect(result.current.shifts).toEqual([]);
  });

  it("never lets a read that began before a delete bring the deleted shifts back", async () => {
    let releaseFirst: (response: Response) => void = () => undefined;
    let datedReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://psychiatry.tools");
      if (url.searchParams.has("from")) {
        datedReads += 1;
        if (datedReads === 1) return new Promise<Response>((resolve) => (releaseFirst = resolve));
        return Response.json({ shifts: [] });
      }
      return Response.json({ shifts: [], latestImport: null });
    });
    const { result } = renderHook(() =>
      useRosterShifts({ from: "2026-07-31", to: "2026-09-01" }, { ownHistory: true }),
    );
    await waitFor(() => expect(datedReads).toBe(1));
    await act(async () => {
      await result.current.deleteAll();
    });
    await waitFor(() => expect(datedReads).toBe(2));
    await act(async () => {
      releaseFirst(Response.json({ shifts: [older] }));
    });
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    expect(result.current.shifts).toEqual([]);
  });

  it("says when the older shifts could not be read, and keeps the main list", async () => {
    olderStatus = 500;
    const { result } = renderHook(() =>
      useRosterShifts({ from: "2026-07-31", to: "2026-09-01" }, { ownHistory: true }),
    );
    await waitFor(() => expect(result.current.historyFailed).toBe(true));
    expect(result.current.historyLoading).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.shifts.map((item) => item.id)).toEqual(["recent"]);
  });
});
