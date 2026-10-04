/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installRosterSampleFetch, ROSTER_SAMPLE_REFUSAL } from "@/components/roster/roster-sample-fetch";

let realFetch: ReturnType<typeof vi.fn>;
let original: typeof window.fetch;
let uninstall: () => void;

beforeEach(() => {
  original = window.fetch;
  realFetch = vi.fn(async () => Response.json({ real: true }));
  window.fetch = realFetch as unknown as typeof window.fetch;
  uninstall = installRosterSampleFetch();
});
afterEach(() => {
  uninstall();
  window.fetch = original;
});

// A loose read of the sample JSON, which these tests poke at by name.
type Sample = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const get = async (path: string) => {
  const response = await fetch(path);
  return { status: response.status, body: (await response.json()) as Sample };
};

describe("Roster signed-out sample transport", () => {
  it("answers reads from the invented sample and never reaches the server", async () => {
    const shifts = await get("/api/roster/shifts");
    expect(shifts.status).toBe(200);
    expect(shifts.body.shifts.length).toBeGreaterThan(5);
    expect(shifts.body.demoMode).toBe(true);
    const teams = await get("/api/roster/team");
    expect(teams.body.sample).toBe(true);
    expect(teams.body.teams[0].name).toContain("Example");
    const people = await get(`/api/roster/team/${teams.body.teams[0].serviceId}?what=people`);
    for (const person of people.body.people) expect(person.displayName).toMatch(/^Dr \w+ Example$/);
    expect((await get("/api/roster/leave")).body.leave).toHaveLength(1);
    expect((await get("/api/roster/links")).body.links).toEqual([]);
    expect((await get("/api/roster/alerts")).body.configured).toBe(false);
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("builds the shifts around today's date", async () => {
    const { body } = await get("/api/roster/shifts");
    const now = Date.now();
    const starts = body.shifts.map((shift: { startsAt: string }) => Date.parse(shift.startsAt));
    expect(starts.some((start: number) => start < now)).toBe(true);
    expect(starts.some((start: number) => start > now)).toBe(true);
  });

  it("leaves out rest and fatigue rules", async () => {
    const teams = await get("/api/roster/team");
    const overview = await get(`/api/roster/team/${teams.body.teams[0].serviceId}?what=overview`);
    expect(overview.body.settings.rules).toEqual({});
    expect(overview.body.settings.rulesSource).toBeNull();
  });

  it("refuses every write with 'The sample doesn't save' and sends nothing", async () => {
    const targets: [string, string][] = [
      ["POST", "/api/roster/shifts"],
      ["POST", "/api/roster/shifts/manual"],
      ["DELETE", "/api/roster/shifts"],
      ["PUT", "/api/roster/settings"],
      ["POST", "/api/roster/leave"],
      ["POST", "/api/roster/extra-time"],
      ["POST", "/api/roster/read-file"],
      ["POST", "/api/roster/team/d0000000-0000-4000-8000-000000000001"],
      ["POST", "/api/roster/team/d0000000-0000-4000-8000-000000000001/publish"],
    ];
    for (const [method, path] of targets) {
      const response = await fetch(path, { method, body: "{}" });
      expect(response.status, `${method} ${path}`).toBe(400);
      const body = await response.json();
      expect(body.message).toBe(ROSTER_SAMPLE_REFUSAL);
      expect(body.message).toContain("The sample doesn't save");
    }
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("passes other addresses through and restores the real fetch", async () => {
    await fetch("/api/other");
    await fetch("https://example.org/api/roster/shifts");
    expect(realFetch).toHaveBeenCalledTimes(2);
    uninstall();
    expect(window.fetch).toBe(realFetch);
  });
});
