/** @vitest-environment jsdom */

// My Day's small modules: each shows its content, and draws nothing (no box) when
// signed out, loading, failed or empty.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roster = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/components/roster/use-roster-shifts", () => ({ useRosterShifts: () => roster.current }));

const entries = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/on-call/entry-store", () => ({ useOnCallEntries: () => entries.current }));

vi.mock("@/components/admin/admin-pinned-numbers", () => ({
  AdminPinnedNumbers: ({ items, testId }: { items: unknown[]; testId: string }) => (
    <div data-testid={testId}>{items.length}</div>
  ),
}));

const teaching = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/components/teaching/use-teaching-resource", () => ({ useTeachingResource: () => teaching.current }));

const auth = vi.hoisted(() => ({ status: "authenticated", authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

import { MyDayCpdPace } from "@/components/my-day/modules/cpd-pace";
import { MyDayNextShift } from "@/components/my-day/modules/next-shift";
import { MyDayNextTeaching, useMyDayNextTeachingSession } from "@/components/my-day/modules/next-teaching";
import { MyDayPriorityFlag } from "@/components/my-day/modules/priority-flag";
import { MyDayQuickActions } from "@/components/my-day/modules/quick-actions";
import { MyDayRestOfToday, restOfTodayChips } from "@/components/my-day/modules/rest-of-today";
import { MyDayPinnedNumbers } from "@/components/my-day/modules/pinned-numbers";

function TeachingHarness() {
  return <MyDayNextTeaching session={useMyDayNextTeachingSession()} />;
}

// 09:00 on Sat 26 Sep 2026 in Perth.
const NOW = new Date("2026-09-26T01:00:00Z");

function shift(startsAt: string, endsAt: string, extra: Record<string, unknown> = {}) {
  return { id: "s1", title: "Night shift", startsAt, endsAt, location: null, workplace: "Example Hospital", ...extra };
}

beforeEach(() => {
  auth.authEpoch = 1;
  roster.current = { status: "ready", shifts: [], sample: false, demoMode: false };
  entries.current = {
    loading: false,
    isOffline: false,
    loadError: null,
    signedOut: false,
    entries: [],
    demoMode: false,
  };
  teaching.current = { status: "idle", data: null };
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MyDayNextShift", () => {
  it("shows the next shift with its start and workplace, linking to Roster", () => {
    // Starts 15:20 Perth: 6 h 20 min after 09:00.
    roster.current = { ...roster.current, shifts: [shift("2026-09-26T07:20:00Z", "2026-09-26T23:00:00Z")] };
    render(<MyDayNextShift state={roster.current as never} now={NOW} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/roster");
    expect(link.textContent).toContain("Night shift · starts in 6 h 20 min");
    expect(link.textContent).toContain("Example Hospital");
  });

  it("shows when the shift on now ends", () => {
    roster.current = { ...roster.current, shifts: [shift("2026-09-25T23:00:00Z", "2026-09-26T08:00:00Z")] };
    render(<MyDayNextShift state={roster.current as never} now={NOW} />);
    expect(screen.getByTestId("my-day-module-next-shift").textContent).toContain("On now · ends 16:00");
  });

  it.each([
    ["loading", { status: "loading" }],
    ["signed out", { status: "signed-out" }],
    ["failed", { status: "error" }],
    ["empty", { status: "ready", shifts: [] }],
    [
      "sample data",
      {
        status: "ready",
        sample: true,
        demoMode: false,
        shifts: [shift("2026-09-26T07:20:00Z", "2026-09-26T23:00:00Z")],
      },
    ],
  ])("renders nothing when %s", (_name, state) => {
    roster.current = { shifts: [], sample: false, demoMode: false, ...state };
    const { container } = render(<MyDayNextShift state={roster.current as never} now={NOW} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows sample shifts in demo mode", () => {
    roster.current = {
      status: "ready",
      sample: true,
      demoMode: true,
      shifts: [shift("2026-09-26T07:20:00Z", "2026-09-26T23:00:00Z")],
    };
    render(<MyDayNextShift state={roster.current as never} now={NOW} />);
    expect(screen.getByTestId("my-day-module-next-shift")).toBeTruthy();
  });
});

describe("MyDayPinnedNumbers", () => {
  it("renders the shared pinned list once entries loaded", () => {
    render(<MyDayPinnedNumbers />);
    expect(screen.getByTestId("my-day-module-pinned")).toBeTruthy();
  });

  it.each([
    ["loading", { loading: true }],
    ["failed", { loadError: "failed" }],
    ["offline", { isOffline: true }],
    ["signed out", { signedOut: true }],
  ])("renders nothing when %s", (_name, patch) => {
    entries.current = { ...entries.current, ...patch };
    const { container } = render(<MyDayPinnedNumbers />);
    expect(container.innerHTML).toBe("");
  });
});

describe("MyDayNextTeaching", () => {
  const session = {
    occurrenceId: "occ-1",
    serviceId: "svc",
    title: "Grand rounds",
    startsAt: "2026-09-29T01:00:00Z",
    endsAt: "2026-09-29T02:00:00Z",
    venue: "Room 4",
    hasJoinLink: false,
    status: "scheduled",
    isPresenter: false,
    source: "teaching",
  };

  it("shows title, Perth day and time, venue and the session link", () => {
    teaching.current = { status: "ready", data: { session } };
    render(<TeachingHarness />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/teaching/session/occ-1");
    expect(link.textContent).toContain("Grand rounds");
    expect(link.textContent).toContain("Tue 29 Sep · 09:00");
    expect(link.textContent).toContain("Room 4");
  });

  it.each([
    ["loading", { status: "loading", data: null }],
    ["failed", { status: "error", data: null }],
    ["signed out", { status: "signed-out", data: null }],
    ["empty", { status: "ready", data: { session: null } }],
    ["cancelled", { status: "ready", data: { session: { ...session, status: "cancelled" } } }],
  ])("renders nothing when %s", (_name, state) => {
    teaching.current = state;
    const { container } = render(<TeachingHarness />);
    expect(container.innerHTML).toBe("");
  });
});

describe("MyDayCpdPace", () => {
  const set = { year: 2026, totalHours: 50, requirements: [] };

  function respond(map: Record<string, { ok: boolean; body?: unknown }>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const hit = Object.entries(map).find(([prefix]) => url.startsWith(prefix))?.[1] ?? { ok: false };
        return { ok: hit.ok, status: hit.ok ? 200 : 500, json: async () => hit.body };
      }),
    );
  }

  it("shows hours logged of the target and links to CPD", async () => {
    respond({
      "/api/cme/entries": {
        ok: true,
        body: {
          entries: [{ id: "e1", archivedAt: null, allocations: [{ category: "educational-activities", hours: 12.5 }] }],
        },
      },
      "/api/cme/year": { ok: true, body: { requirementSet: set } },
    });
    render(<MyDayCpdPace now={NOW} />);
    await waitFor(() => expect(screen.getByTestId("my-day-module-cpd")).toBeTruthy());
    expect(screen.getByRole("link").getAttribute("href")).toBe("/cme");
    expect(screen.getByTestId("my-day-module-cpd").textContent).toContain("CPD: 12.5 of 50 h this year");
    expect(screen.getByTestId("my-day-module-cpd").textContent).not.toMatch(/behind/i);
  });

  it("reads the current CPD year once and not again on a re-render", async () => {
    respond({
      "/api/cme/entries": { ok: true, body: { entries: [] } },
      "/api/cme/year": { ok: true, body: { requirementSet: set } },
    });
    const { rerender } = render(<MyDayCpdPace now={NOW} />);
    await waitFor(() => expect(screen.getByTestId("my-day-module-cpd")).toBeTruthy());
    rerender(<MyDayCpdPace now={new Date(NOW.getTime() + 60_000)} />);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.map((call) => call[0])).toEqual([
      "/api/cme/entries?year=2026",
      "/api/cme/year?year=2026",
    ]);
  });

  it.each([
    [
      "the entries read failed",
      { "/api/cme/entries": { ok: false }, "/api/cme/year": { ok: true, body: { requirementSet: set } } },
    ],
    [
      "the year read failed",
      { "/api/cme/entries": { ok: true, body: { entries: [] } }, "/api/cme/year": { ok: false } },
    ],
    [
      "the year is not confirmed",
      {
        "/api/cme/entries": { ok: true, body: { entries: [] } },
        "/api/cme/year": { ok: true, body: { requirementSet: null } },
      },
    ],
  ])("renders nothing when %s", async (_name, map) => {
    respond(map);
    const { container } = render(<MyDayCpdPace now={NOW} />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(container.innerHTML).toBe("");
  });
});

describe("MyDayNextShift ring", () => {
  it("counts down to the start in words, filling over the 12 h before it", () => {
    // Starts 09:50 Perth, 50 minutes after NOW.
    roster.current = { ...roster.current, shifts: [shift("2026-09-26T01:50:00Z", "2026-09-26T10:00:00Z")] };
    render(<MyDayNextShift state={roster.current as never} now={NOW} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("0:50 to on call");
    const arc = screen.getByTestId("my-day-next-shift-ring").querySelectorAll("circle")[1];
    const offset = Number(arc.getAttribute("stroke-dashoffset"));
    const full = Number(arc.getAttribute("stroke-dasharray"));
    expect(1 - offset / full).toBeCloseTo((12 * 60 - 50) / (12 * 60), 3);
  });

  it("shows time left once the shift is on", () => {
    roster.current = { ...roster.current, shifts: [shift("2026-09-25T23:00:00Z", "2026-09-26T08:00:00Z")] };
    render(<MyDayNextShift state={roster.current as never} now={NOW} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("7:00 left on shift");
  });
});

describe("MyDayQuickActions", () => {
  it("links the five quick actions", () => {
    render(<MyDayQuickActions />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/on-call/call#on-call-call-log-heading",
      "/on-call/call#on-call-handover-heading",
      "/on-call/whos-on",
      "/cme/new",
      "/admin/help",
    ]);
    expect(links.map((link) => link.textContent)).toEqual([
      "Log a callCall log",
      "HandoverISBAR builder",
      "Who’s onTonight’s team",
      "Log CPDNew entry",
      "NumbersPinned",
    ]);
  });
});

describe("MyDayRestOfToday", () => {
  const baseItem = { mode: "cme", severity: "soon", href: "/cme/x" } as const;
  const readyRoster = { status: "ready", sample: false, demoMode: false, shifts: [] } as never;

  it("lists today's remaining timed things in Perth order and highlights the next", () => {
    const chips = restOfTodayChips({
      items: [
        { ...baseItem, id: "late", title: "Evening task", due: "2026-09-26T10:00:00Z" },
        { ...baseItem, id: "dateonly", title: "No time", due: "2026-09-26" },
        { ...baseItem, id: "past", title: "Earlier", due: "2026-09-26T00:00:00Z" },
        { ...baseItem, id: "tomorrow", title: "Tomorrow", due: "2026-09-27T01:00:00Z" },
      ],
      roster: {
        status: "ready",
        sample: false,
        demoMode: false,
        shifts: [shift("2026-09-26T07:20:00Z", "2026-09-26T23:00:00Z")],
      } as never,
      session: null,
      now: NOW,
    });
    expect(chips.map((chip) => chip.id)).toEqual(["shift", "item:late"]);
    render(<MyDayRestOfToday chips={chips} />);
    expect(screen.getByTestId("my-day-rest-chip-0").getAttribute("data-next")).toBe("true");
    expect(screen.getByTestId("my-day-rest-chip-0").textContent).toContain("15:20");
    expect(screen.getByTestId("my-day-rest-chip-1").textContent).toContain("18:00");
    expect(screen.getByTestId("my-day-rest-chip-1").getAttribute("data-next")).toBeNull();
  });

  it("includes a teaching session today", () => {
    const chips = restOfTodayChips({
      items: [],
      roster: readyRoster,
      session: {
        occurrenceId: "occ-1",
        title: "Grand rounds",
        startsAt: "2026-09-26T05:00:00Z",
        source: "teaching",
        serviceId: "svc",
      } as never,
      now: NOW,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].href).toBe("/teaching/session/occ-1");
  });

  it("renders nothing when there are none", () => {
    expect(restOfTodayChips({ items: [], roster: readyRoster, session: null, now: NOW })).toEqual([]);
    const { container } = render(<MyDayRestOfToday chips={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("MyDayPriorityFlag", () => {
  const base = { mode: "my-work", href: "/admin/renewals", due: "2026-09-25" } as const;

  it("shows the top overdue item as one link, Date passed for Admin", () => {
    render(
      <MyDayPriorityFlag
        items={[
          { ...base, id: "a", title: "Registration date", severity: "overdue" },
          { ...base, id: "b", title: "Other", severity: "soon" },
        ]}
        now={NOW}
      />,
    );
    const link = screen.getByRole("link", { name: "Most important now: Registration date" });
    expect(link.getAttribute("href")).toBe("/admin/renewals");
    expect(link.textContent).toContain("ADM");
    expect(link.textContent).toContain("Admin · Date passed · Yesterday");
    expect(link.textContent).not.toMatch(/Expired/);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows a soon item when nothing is overdue", () => {
    render(
      <MyDayPriorityFlag
        items={[{ ...base, id: "s", mode: "cme", title: "Log routine", severity: "soon", due: "2026-09-28" }]}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("my-day-module-priority").textContent).toContain("CPD · Due soon");
  });

  it("renders nothing for only info items, or none", () => {
    const { container } = render(
      <MyDayPriorityFlag items={[{ ...base, id: "i", title: "Later", severity: "info" }]} now={NOW} />,
    );
    expect(container.innerHTML).toBe("");
    const empty = render(<MyDayPriorityFlag items={[]} now={NOW} />);
    expect(empty.container.innerHTML).toBe("");
  });
});
