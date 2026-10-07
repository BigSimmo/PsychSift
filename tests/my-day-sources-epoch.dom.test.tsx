/** @vitest-environment jsdom */

// Roster and CPD sources: a previous account's data never renders after an account switch,
// and a held Roster release is "unavailable" with no sample flag.

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("@/components/clinical-dashboard/use-app-preferences", async () => {
  const { DEFAULT_REMINDER_SETTINGS } = await import("@/lib/reminders/settings");
  return {
    useAppPreferences: () => ({ preferences: { reminders: DEFAULT_REMINDER_SETTINGS } }),
    readAppPreferences: () => ({ timeZone: "Australia/Perth" }),
    subscribeAppPreferences: () => () => undefined,
  };
});

import { useCmeMyDaySource } from "@/components/my-day/sources/cme";
import { useRosterMyDaySource } from "@/components/my-day/sources/roster";

const NOW = new Date("2026-10-05T02:00:00Z");
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
/** The reader's own shifts, read for the signed fatigue warnings: none, so no warning. */
const rosterReads = (teams: unknown) => (url: string) =>
  json(url.includes("/api/roster/shifts") ? { shifts: [] } : teams);
/** The CPD reads, including the year and activities the signed CPD coaching reads. */
const cmeReads = (url: string) =>
  json(
    url.includes("routines")
      ? { routines: [] }
      : url.includes("drafts")
        ? { drafts: [] }
        : url.includes("/api/cme/year")
          ? { requirementSet: null }
          : { entries: [], year: 2026 },
  );

beforeEach(() => {
  auth.authEpoch = 1;
});
afterEach(() => vi.unstubAllGlobals());

describe("useRosterMyDaySource", () => {
  it("reports a held release as unavailable, with no sample flag and no items", async () => {
    vi.stubGlobal("fetch", () => json({ sample: true, teams: [] }));
    const { result } = renderHook(() => useRosterMyDaySource({ enabled: true, now: NOW }));
    await waitFor(() => expect(result.current.result.status).toBe("unavailable"));
    expect(result.current.result.items).toEqual([]);
    expect(result.current.result.sample).toBeUndefined();
  });

  it("goes back to loading when the account changes, until the new account's data arrives", async () => {
    vi.stubGlobal("fetch", rosterReads({ actorId: "a", teams: [] }));
    const { result, rerender } = renderHook(() => useRosterMyDaySource({ enabled: true, now: NOW }));
    await waitFor(() => expect(result.current.result.status).toBe("ready"));

    const held: { url: string; resolve: (response: Response) => void }[] = [];
    vi.stubGlobal("fetch", (url: string) => new Promise<Response>((resolve) => held.push({ url, resolve })));
    auth.authEpoch = 2;
    rerender();
    expect(result.current.result.status).toBe("loading");

    for (const { url, resolve } of held) {
      const body = url.includes("/api/roster/shifts") ? { shifts: [] } : { actorId: "b", teams: [] };
      resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    await waitFor(() => expect(result.current.result.status).toBe("ready"));
  });
});

describe("useCmeMyDaySource", () => {
  it("goes back to loading when the account changes", async () => {
    vi.stubGlobal("fetch", cmeReads);
    const { result, rerender } = renderHook(() => useCmeMyDaySource({ enabled: true, now: NOW }));
    await waitFor(() => expect(result.current.result.status).toBe("ready"));

    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    auth.authEpoch = 2;
    rerender();
    expect(result.current.result.status).toBe("loading");
  });
});
