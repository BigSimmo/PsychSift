/** @vitest-environment jsdom */

// Work profile's reads: invented sample data (a sample team, the signed-out
// sample of compliance dates) is never shown as the doctor's own, and team
// shifts that are still loading or failed never read as "Start".

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  shifts: {} as Record<string, unknown>,
  teams: {} as Record<string, unknown>,
  entries: {} as Record<string, unknown>,
  overviewFor: [] as Array<string | null>,
}));

vi.mock("@/components/roster/use-roster-settings", () => ({ useRosterSettings: () => reads.settings }));
vi.mock("@/components/roster/use-roster-shifts", () => ({ useRosterShifts: () => reads.shifts }));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => reads.teams,
  useRosterRead: (id: string | null) => {
    reads.overviewFor.push(id);
    return id
      ? { status: "ready", data: { settings: { payFortnightAnchor: "2026-10-01" } } }
      : { status: "idle", data: null };
  },
}));
vi.mock("@/lib/on-call/entry-store", () => ({ useOnCallEntries: () => reads.entries }));
vi.mock("@/components/on-call/call/call-device-stores", () => ({ useOnCallHospitalPhone: () => false }));
vi.mock("@/components/teaching/use-teaching-week", () => ({
  useTeachingWeek: () => ({ status: "ready", week: { teams: [] } }),
}));

import { useWorkProfileData } from "@/components/work-profile/use-work-profile-data";

const team = { serviceId: "00000000-0000-4000-9000-000000000001", name: "Sample team", enabled: true, grade: null };

beforeEach(() => {
  reads.settings = { status: "ready", settings: { codes: {}, rowName: null } };
  reads.shifts = { status: "ready", shifts: [], sample: false, teamLoading: false, teamMessage: null };
  reads.teams = { status: "ready", data: { teams: [team], sample: false } };
  reads.entries = { loading: false, signedOut: false, sample: false, isOffline: false, entries: [] };
  reads.overviewFor = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ requirementSet: null, routines: [] }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const now = new Date("2026-10-05T02:00:00Z");

describe("useWorkProfileData", () => {
  it("a sample team is not the doctor's: no teams, no pay fortnight read", async () => {
    reads.teams = { status: "ready", data: { teams: [team], sample: true } };
    const { result } = renderHook(() => useWorkProfileData(now));
    await waitFor(() => expect(result.current.cpd.status).toBe("ready"));
    expect(result.current.teams).toEqual({ status: "ready", value: [] });
    expect(result.current.payFortnightAnchor).toEqual({ status: "ready", value: null });
    expect(reads.overviewFor.every((id) => id === null)).toBe(true);
  });

  it("the doctor's one real team gives its pay-fortnight anchor", async () => {
    const { result } = renderHook(() => useWorkProfileData(now));
    await waitFor(() => expect(result.current.cpd.status).toBe("ready"));
    expect(result.current.payFortnightAnchor).toEqual({ status: "ready", value: "2026-10-01" });
  });

  it("the signed-out sample of compliance dates never counts as recorded", async () => {
    reads.entries = {
      loading: false,
      signedOut: false,
      sample: true,
      isOffline: false,
      entries: [{ details: { kind: "compliance" } }],
    };
    const { result } = renderHook(() => useWorkProfileData(now));
    await waitFor(() => expect(result.current.cpd.status).toBe("ready"));
    expect(result.current.admin).toEqual({ status: "signed-out" });
  });

  it("team shifts still loading read as loading, not Start", async () => {
    reads.shifts = { ...reads.shifts, teamLoading: true };
    const { result } = renderHook(() => useWorkProfileData(now));
    await waitFor(() => expect(result.current.cpd.status).toBe("ready"));
    expect(result.current.roster).toEqual({ status: "loading" });
    expect(result.current.workplaces).toEqual({ status: "loading" });
  });

  it("team shifts that failed, with nothing of the doctor's own, are not checked", async () => {
    reads.shifts = { ...reads.shifts, teamMessage: "Team shifts could not be loaded. Your own shifts are shown." };
    const { result } = renderHook(() => useWorkProfileData(now));
    await waitFor(() => expect(result.current.cpd.status).toBe("ready"));
    expect(result.current.roster).toEqual({ status: "failed" });
  });

  it("team shifts that failed still show the doctor's own workplaces", async () => {
    reads.shifts = {
      ...reads.shifts,
      shifts: [{ workplace: "Fiona Stanley" }],
      teamMessage: "Team shifts could not be loaded. Your own shifts are shown.",
    };
    const { result } = renderHook(() => useWorkProfileData(now));
    await waitFor(() => expect(result.current.cpd.status).toBe("ready"));
    expect(result.current.workplaces).toEqual({ status: "ready", value: ["Fiona Stanley"] });
  });
});
