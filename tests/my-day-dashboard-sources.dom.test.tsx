/** @vitest-environment jsdom */

// The dashboard's extra reads never hand a signed-in reader invented data:
// Roster's example roster, a demo Teaching team and a demo CPD year all read
// as "unavailable" unless the page is a local demo build (allowSample).

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roster = vi.hoisted(() => ({
  current: {
    status: "ready",
    shifts: [] as unknown[],
    sample: false,
    demoMode: false,
    teamLoading: false,
    teamMessage: null as string | null,
  },
  reload: { calls: 0 },
}));
vi.mock("@/components/roster/use-roster-shifts", () => ({
  useRosterShifts: () => ({
    reload: async () => {
      roster.reload.calls += 1;
    },
    ...roster.current,
  }),
}));

const teaching = vi.hoisted(() => ({ current: { status: "ready", data: null as unknown }, retries: { calls: 0 } }));
vi.mock("@/components/teaching/use-teaching-resource", () => ({
  useTeachingResource: () => ({
    ...teaching.current,
    code: null,
    refreshing: false,
    retry: () => {
      teaching.retries.calls += 1;
    },
  }),
}));

// "Who's on now" reads the reader's team on its own; it has its own tests.
vi.mock("@/components/my-day/use-my-day-whos-on", () => ({
  useMyDayWhosOn: () => ({ status: "unavailable", teamName: null, colleagues: [] }),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: "authenticated", authEpoch: 1 }),
}));

import { useMyDayDashboardSources } from "@/components/my-day/use-my-day-dashboard-sources";

const TODAY = "2026-10-03";
const NOW = new Date("2026-10-03T04:40:00Z");
const SHIFT = {
  id: "s1",
  startsAt: "2026-10-03T09:00:00Z",
  endsAt: "2026-10-04T00:30:00Z",
  title: "On call",
  location: null,
  sourceUid: null,
  kind: "on_call",
  source: "manual",
  seriesId: null,
  workplace: null,
};
const session = (id: string, serviceId: string) => ({
  occurrenceId: id,
  serviceId,
  title: `Session ${id}`,
  startsAt: "2026-10-03T06:00:00Z",
  endsAt: "2026-10-03T07:00:00Z",
  venue: null,
  hasJoinLink: false,
  status: "scheduled",
  isPresenter: false,
  source: "teaching",
});

function stubCpd({ demoMode }: { demoMode: boolean }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.startsWith("/api/cme/year")
        ? { year: 2026, requirementSet: { year: 2026, totalHours: 50, requirements: [] }, demoMode }
        : {
            year: 2026,
            demoMode,
            entries: [
              {
                id: "e1",
                date: "2026-03-10",
                archivedAt: null,
                allocations: [
                  { category: "educational", hours: 20 },
                  { category: "reviewing", hours: 12 },
                ],
              },
              {
                id: "e2",
                date: "2026-04-02",
                archivedAt: "2026-05-01",
                allocations: [{ category: "measuring", hours: 99 }],
              },
            ],
          };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

beforeEach(() => {
  roster.current = {
    status: "ready",
    shifts: [SHIFT],
    sample: false,
    demoMode: false,
    teamLoading: false,
    teamMessage: null,
  };
  roster.reload.calls = 0;
  teaching.retries.calls = 0;
  teaching.current = {
    status: "ready",
    data: {
      teams: [
        { id: "real", isDemo: false },
        { id: "demo", isDemo: true },
      ],
      sessions: [session("r", "real"), session("d", "demo"), { ...session("x", "real"), status: "cancelled" }],
      relocated: [],
    },
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("useMyDayDashboardSources", () => {
  it("reads the reader's own roster, today's real sessions and CPD hours", async () => {
    stubCpd({ demoMode: false });
    const { result } = renderHook(() => useMyDayDashboardSources({ today: TODAY, now: NOW, allowSample: false }));
    expect(result.current.roster).toMatchObject({ status: "ready", sample: false });
    expect(result.current.roster.shifts).toHaveLength(1);
    expect(result.current.teaching.sessions.map((s) => s.occurrenceId)).toEqual(["r"]);
    await waitFor(() => expect(result.current.cpd.status).toBe("ready"));
    // Archived activities never count, as on the CPD page.
    expect(result.current.cpd).toMatchObject({ loggedHours: 32, targetHours: 50, year: 2026 });
    // The rings and the month bars read the same unarchived activities.
    expect(result.current.cpd.byCategory).toEqual({ educational: 20, reviewing: 12, measuring: 0 });
    expect(result.current.cpd.byMonth[2]).toBe(32);
    expect(result.current.cpd.byMonth.reduce((sum, hours) => sum + hours, 0)).toBe(32);
  });

  it("finds the next talk the reader is presenting, never a demo team's", () => {
    stubCpd({ demoMode: false });
    teaching.current = {
      status: "ready",
      data: {
        teams: [
          { id: "real", isDemo: false },
          { id: "demo", isDemo: true },
        ],
        sessions: [
          session("listening", "real"),
          { ...session("demo-talk", "demo"), isPresenter: true },
          { ...session("mine", "real"), isPresenter: true, startsAt: "2026-10-15T06:00:00Z" },
        ],
        relocated: [],
      },
    };
    const { result } = renderHook(() => useMyDayDashboardSources({ today: TODAY, now: NOW, allowSample: false }));
    expect(result.current.teaching.nextTalk?.occurrenceId).toBe("mine");
  });

  it("drops every kind of invented data for a signed-in reader", async () => {
    stubCpd({ demoMode: true });
    roster.current = { ...roster.current, sample: true };
    const { result } = renderHook(() => useMyDayDashboardSources({ today: TODAY, now: NOW, allowSample: false }));
    expect(result.current.roster).toMatchObject({ status: "unavailable", shifts: [] });
    expect(result.current.teaching.sessions.some((s) => s.serviceId === "demo")).toBe(false);
    await waitFor(() => expect(result.current.cpd.status).toBe("unavailable"));
    expect(result.current.cpd.loggedHours).toBe(0);
  });

  it("keeps demo data, flagged as sample, in a local demo build", async () => {
    stubCpd({ demoMode: true });
    roster.current = { ...roster.current, demoMode: true };
    const { result } = renderHook(() => useMyDayDashboardSources({ today: TODAY, now: NOW, allowSample: true }));
    expect(result.current.roster).toMatchObject({ status: "ready", sample: true });
    // Sessions are now listed earliest first (ties by title), so the order is "d" then "r".
    expect(result.current.teaching.sessions.map((s) => s.occurrenceId)).toEqual(["d", "r"]);
    await waitFor(() => expect(result.current.cpd).toMatchObject({ status: "ready", sample: true }));
  });

  it("hides CPD when no target is confirmed, and reports a failed read as failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("/api/cme/year")
          ? new Response(JSON.stringify({ year: 2026, requirementSet: null }), { status: 200 })
          : new Response(JSON.stringify({ year: 2026, entries: [] }), { status: 200 }),
      ),
    );
    const first = renderHook(() => useMyDayDashboardSources({ today: TODAY, now: NOW, allowSample: false }));
    await waitFor(() => expect(first.result.current.cpd.status).toBe("unavailable"));
    first.unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    roster.current = { ...roster.current, status: "error", shifts: [] };
    const second = renderHook(() => useMyDayDashboardSources({ today: TODAY, now: NOW, allowSample: false }));
    expect(second.result.current.roster.status).toBe("failed");
    await waitFor(() => expect(second.result.current.cpd.status).toBe("failed"));
  });

  // Codex review on #3234 (items 1, 3, 5 and 6).
  it("does not present the roster as final while a team's shifts are still loading, and flags a missing team", () => {
    stubCpd({ demoMode: false });
    roster.current = { ...roster.current, teamLoading: true };
    const loading = renderHook(() => useMyDayDashboardSources({ today: TODAY, now: NOW, allowSample: false }));
    expect(loading.result.current.roster.status).toBe("loading");
    loading.unmount();
    roster.current = { ...roster.current, teamLoading: false, teamMessage: "Couldn't load your team." };
    const partial = renderHook(() => useMyDayDashboardSources({ today: TODAY, now: NOW, allowSample: false }));
    expect(partial.result.current.roster).toMatchObject({ status: "ready", partial: true });
  });

  it("keeps Teaching's partial-load flag when the On Call teaching list could not be read", () => {
    stubCpd({ demoMode: false });
    teaching.current = {
      status: "ready",
      data: { teams: [], sessions: [], relocated: [], relocatedUnavailable: true },
    };
    const { result } = renderHook(() => useMyDayDashboardSources({ today: TODAY, now: NOW, allowSample: false }));
    expect(result.current.teaching).toMatchObject({ status: "ready", partial: true });
  });

  it("retries every dashboard read, and reads CPD again when the year turns", async () => {
    stubCpd({ demoMode: false });
    const fetchMock = vi.mocked(fetch);
    const { result, rerender } = renderHook(
      ({ today }) => useMyDayDashboardSources({ today, now: NOW, allowSample: false }),
      {
        initialProps: { today: TODAY },
      },
    );
    await waitFor(() => expect(result.current.cpd.status).toBe("ready"));
    const before = fetchMock.mock.calls.length;
    act(() => result.current.retry?.());
    expect(roster.reload.calls).toBe(1);
    expect(teaching.retries.calls).toBe(1);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 2));
    rerender({ today: "2027-01-01" });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 4));
  });
});
