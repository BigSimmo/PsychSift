/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny reactive stand-in for the URL, as in the staff calendar test.
const url = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { params: new URLSearchParams() };
  return {
    state,
    set(search: string) {
      state.params = new URLSearchParams(search);
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/team",
  useRouter: () => ({ push: vi.fn(), replace: url.replace, back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () =>
    useSyncExternalStore(
      url.subscribe,
      () => url.state.params,
      () => url.state.params,
    ),
}));
vi.mock("@/components/roster/ask/roster-ask-box", () => ({ RosterAskButton: () => null }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "authenticated", authEpoch: 1 }) }));

import { UNDO_MS } from "@/components/roster/swaps/use-delayed-roster-action";
import { approveAllWithoutWarnings, SwapDecisionRow } from "@/components/roster/team/calendar/needs-you-strip";
import { recheckDecision } from "@/components/roster/manage/roster-decision-sheet";
import { RosterTeamPage } from "@/components/roster/team/roster-team-page";
import type { RosterAction, RosterManageSwap } from "@/lib/roster/team/model";
import type { RuleFlag } from "@/lib/roster/team/rule-flags";

const ME = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";
const TEAM = "33333333-3333-4333-8333-333333333333";
const PAT = "88888888-8888-4888-8888-888888888888";
const NOW = new Date("2026-10-15T00:00:00Z"); // 08:00 Thursday 15 October, Perth

const shift = (id: string, userId: string, name: string, kind: string, code: string, start: string, end: string) => ({
  id,
  userId,
  name,
  grade: "registrar",
  siteId: null,
  siteName: "Example Hospital",
  startsAt: start,
  endsAt: end,
  shiftCode: code,
  kind,
});
const ID = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const mine = shift(ID(1), ME, "Alex Example", "day", "D", "2026-10-15T09:00:00+08:00", "2026-10-15T17:00:00+08:00");
const samThursdayNight = shift(
  ID(2),
  SAM,
  "Dr Sam Example",
  "night",
  "N",
  "2026-10-15T21:30:00+08:00",
  "2026-10-16T08:00:00+08:00",
);
const samFridayNight = shift(
  ID(3),
  SAM,
  "Dr Sam Example",
  "night",
  "N",
  "2026-10-16T21:30:00+08:00",
  "2026-10-17T08:00:00+08:00",
);
const meFriday = shift(ID(4), ME, "Alex Example", "day", "D", "2026-10-16T09:00:00+08:00", "2026-10-16T17:00:00+08:00");

const need = (n: number, weekday: number, kind: string, needed: number) => ({
  id: ID(100 + n),
  weekday,
  date: null,
  kind,
  grade: null,
  siteId: null,
  needed,
});

const swap = (id: string, give: unknown, take: unknown, over: Record<string, unknown> = {}) => ({
  id,
  status: "accepted",
  autoApproved: false,
  needsManagerBecause: "within_7_days",
  requesterId: SAM,
  counterpartyId: PAT,
  give,
  take,
  decidedAt: null,
  requesterName: "Dr Sam Example",
  counterpartyName: "Dr Pat Example",
  ...over,
});

type Options = {
  onPost?: () => void;
  role?: "manager" | "member";
  rules?: Record<string, unknown>;
  assignments?: unknown[];
  needs?: unknown[];
  swaps?: unknown[];
  openShifts?: unknown[];
  makerFails?: boolean;
  overviewFails?: boolean;
  refuse?: Set<string>;
  /** The server's answer to swap.approve for a swap id, when it is not "approved". */
  answers?: Record<string, Record<string, unknown>>;
};

function mockFetch(options: Options = {}) {
  const role = options.role ?? "manager";
  const posts: unknown[] = [];
  const reads: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const address = String(input);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { swapId?: string };
      posts.push(body);
      options.onPost?.();
      if (body.swapId && options.refuse?.has(body.swapId))
        return Response.json({ code: "roster_conflict", message: "That shift has already changed." }, { status: 409 });
      if (body.swapId && options.answers?.[body.swapId]) return Response.json({ result: options.answers[body.swapId] });
      return Response.json({ result: { ok: true, status: "approved" } });
    }
    if (address === "/api/roster/team")
      return Response.json({
        actorId: ME,
        teams: [{ serviceId: TEAM, name: "Example team", enabled: true, role, grade: "registrar" }],
      });
    reads.push(address);
    if (address.includes("what=overview")) {
      if (options.overviewFails) return Response.json({ message: "Roster couldn't be reached." }, { status: 500 });
      return Response.json({
        service: { id: TEAM, name: "Example team" },
        me: { role, grade: "registrar", rotationEndsOn: null },
        latestPublication: null,
        seenLatest: true,
        settings: { swapApproval: "manager", rules: options.rules ?? {}, rulesSource: null, payFortnightAnchor: null },
        sites: [],
      });
    }
    if (address.includes("what=assignments")) {
      // Only the shifts that start inside the asked-for dates, as the server answers.
      const query = new URL(address, "http://localhost").searchParams;
      const [from, to] = [query.get("from"), query.get("to")];
      const perthDate = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);
      const rows = (options.assignments ?? [mine, samThursdayNight]) as { startsAt: string }[];
      return Response.json({
        assignments: rows.filter(
          (row) => (!from || perthDate(row.startsAt) >= from) && (!to || perthDate(row.startsAt) <= to),
        ),
      });
    }
    if (address.includes("what=maker")) {
      if (options.makerFails) return Response.json({ message: "Roster couldn't be reached." }, { status: 500 });
      return Response.json({ codes: [], needs: options.needs ?? [], drafts: [] });
    }
    if (address.includes("what=manage"))
      return Response.json({ swaps: options.swaps ?? [], openShifts: options.openShifts ?? [], seen: null });
    return Response.json({ swaps: [], openShifts: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, posts, reads };
}

beforeEach(() => {
  url.replace.mockReset();
  url.replace.mockImplementation((target: string) => act(() => url.set(target.split("?")[1] ?? "")));
  url.set("");
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Team calendar, manager layer", () => {
  it("shows a member no strip, no counts and makes no manager reads", async () => {
    const { reads } = mockFetch({ role: "member", needs: [need(1, 4, "night", 2)] });
    render(<RosterTeamPage now={NOW} />);
    await screen.findByRole("table", { name: "Week roster" });
    expect(screen.queryByRole("region", { name: "Needs you" })).toBeNull();
    expect(screen.queryByText(/Nights 1 of 2/)).toBeNull();
    expect(reads.some((address) => address.includes("what=manage") || address.includes("what=maker"))).toBe(false);
  });

  it("shows a manager 'Nights 1 of 2' in red on a short day", async () => {
    mockFetch({ needs: [need(1, 4, "night", 2)] });
    render(<RosterTeamPage now={NOW} />);
    const count = await screen.findByText("Nights 1 of 2");
    expect(count.getAttribute("data-cover")).toBe("short");
    expect(count.className).toContain("--danger");
    // The short day is also offered in the strip.
    const strip = await screen.findByRole("region", { name: "Needs you" });
    expect(within(strip).getByRole("button", { name: /Thu 15 Oct/ })).toBeTruthy();
  });

  it("shows counts in each Month cell for a manager", async () => {
    mockFetch({ needs: [need(1, 4, "night", 2)] });
    url.set("view=month&date=2026-10-15");
    const { container } = render(<RosterTeamPage now={NOW} />);
    await screen.findByRole("grid");
    const cell = container.querySelector<HTMLElement>('[data-date="2026-10-15"]')!;
    await waitFor(() => expect(within(cell).getByText("Nights 1 of 2")).toBeTruthy());
    expect(cell.querySelector("[data-cover]")?.getAttribute("data-cover")).toBe("short");
    // A past day shows no count, even one short of its target.
    const past = container.querySelector<HTMLElement>('[data-date="2026-10-08"]')!;
    expect(past.querySelector("[data-cover]")).toBeNull();
  });

  it("lists a pending swap in the strip with Approve and Decline, and sends the decision", async () => {
    const { posts } = mockFetch({ swaps: [swap(ID(50), samThursdayNight, null)] });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    expect(within(strip).getByText(/Swap · Dr Sam Example and Dr Pat Example/)).toBeTruthy();
    expect(within(strip).getByText("Needs you because it's within 7 days")).toBeTruthy();
    fireEvent.click(within(strip).getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(posts).toEqual([{ action: "swap.decline", swapId: ID(50) }]));
    expect(within(strip).getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("lists a taken open shift for approval", async () => {
    const { posts } = mockFetch({
      openShifts: [
        {
          id: ID(60),
          status: "claimed",
          urgent: false,
          startsAt: "2026-10-16T09:00:00+08:00",
          endsAt: "2026-10-16T17:00:00+08:00",
          shiftCode: "D",
          kind: "day",
          minGrade: null,
          siteId: null,
          postedBy: ME,
          claimedBy: SAM,
          claimedAt: "2026-10-14T00:00:00Z",
        },
      ],
    });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    expect(within(strip).getByText(/Day on Fri 16 Oct was taken/)).toBeTruthy();
    fireEvent.click(within(strip).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posts).toEqual([{ action: "open.approve", openShiftId: ID(60) }]));
  });

  it("marks a shift that breaks a team rule and explains it in the shift sheet", async () => {
    mockFetch({ rules: { maxNightsInRow: 1 }, assignments: [mine, samThursdayNight, samFridayNight] });
    render(<RosterTeamPage now={NOW} />);
    const flagged = await screen.findByRole("button", { name: /Dr Sam Example, Night.*2nd night in a row/ });
    expect(flagged.getAttribute("data-flagged")).toBe("true");
    fireEvent.click(flagged);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Rule warnings")).toBeTruthy();
    expect(within(sheet).getByText("2nd night in a row (team limit 1)")).toBeTruthy();
  });

  it("draws over-cover in the blue info tone, apart from met", async () => {
    const extraDay = shift(
      ID(6),
      "88888888-8888-4888-8888-888888888888",
      "Dr Pat Example",
      "day",
      "D",
      "2026-10-15T08:00:00+08:00",
      "2026-10-15T16:00:00+08:00",
    );
    mockFetch({
      assignments: [mine, extraDay, samThursdayNight, samFridayNight],
      needs: [need(1, 4, "day", 1), need(2, 4, "night", 1), need(3, 5, "night", 2)],
    });
    render(<RosterTeamPage now={NOW} />);
    const over = await screen.findByText("Days 2 of 1");
    expect(over.getAttribute("data-cover")).toBe("over");
    expect(over.className).toContain("--info");
    expect(over.className).not.toContain("--danger");
    const met = screen.getByText("Nights 1 of 1");
    expect(met.getAttribute("data-cover")).toBe("met");
    expect(met.className).not.toContain("--info");
    expect(screen.getByText("Nights 1 of 2").getAttribute("data-cover")).toBe("short");
  });

  it("reads requests, manage and the roster again after a give-away is sent from the calendar", async () => {
    // The give-away sheet reads the real clock (`useRosterNow()` is not handed the page's pinned
    // `now`), and the shift (Thu 15 Oct, 09:00 Perth) counts as urgent inside 24 hours, which swaps
    // "Offer to 1 person" for "I can't make it". This test only ever passed because the real date
    // was more than a day before the fixture shift; from 09:00 Perth on 14 Oct 2026 it failed on
    // every run. Pin Date to two days before the shift so the ordinary give-away path is the one tested.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-13T00:00:00Z") });
    const { posts, reads } = mockFetch();
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: /You, Day 09:00–17:00/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Give away" }));
    const offer = await screen.findByRole("button", { name: /^Offer to 1 person/ });
    const count = (what: string) => reads.filter((address) => address.includes(`what=${what}`)).length;
    const before = { requests: count("requests"), manage: count("manage"), assignments: count("assignments") };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(offer);
    await act(async () => vi.advanceTimersByTime(UNDO_MS + 1));
    vi.useRealTimers();
    await waitFor(() => expect(posts).toEqual([{ action: "open.post", assignmentId: mine.id }]));
    await waitFor(() => expect(count("requests")).toBeGreaterThan(before.requests));
    expect(count("manage")).toBeGreaterThan(before.manage);
    expect(count("assignments")).toBeGreaterThan(before.assignments);
  });

  it("offers a manager 'Post as open shift' on an upcoming shift", async () => {
    const { posts } = mockFetch();
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: /Dr Sam Example, Night/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: "Offer to the team" })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Post as open shift" }));
    await waitFor(() => expect(posts).toEqual([{ action: "open.post", assignmentId: samThursdayNight.id }]));
    expect(await within(sheet).findByText("Posted as an open shift.")).toBeTruthy();
  });

  it("shows a waiting swap in the shift sheet with Approve and Decline in place", async () => {
    const { posts } = mockFetch({ swaps: [swap(ID(50), samThursdayNight, null)] });
    render(<RosterTeamPage now={NOW} />);
    await screen.findByRole("region", { name: "Needs you" });
    fireEvent.click(screen.getByRole("button", { name: /Dr Sam Example, Night/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/Swap · Dr Sam Example and Dr Pat Example/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(posts).toEqual([{ action: "swap.decline", swapId: ID(50) }]));
    fireEvent.click(within(sheet).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual({ action: "swap.approve", swapId: ID(50) });
  });

  it("shows no swap in the sheet of a shift the waiting swap does not touch", async () => {
    const patNight = shift(
      ID(9),
      "88888888-8888-4888-8888-888888888888",
      "Dr Pat Example",
      "night",
      "N",
      "2026-10-16T21:30:00+08:00",
      "2026-10-17T08:00:00+08:00",
    );
    mockFetch({ assignments: [mine, samThursdayNight, patNight], swaps: [swap(ID(50), samThursdayNight, null)] });
    render(<RosterTeamPage now={NOW} />);
    await screen.findByRole("region", { name: "Needs you" });
    fireEvent.click(screen.getByRole("button", { name: /Dr Pat Example, Night/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).queryByText(/Swap ·/)).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Post as open shift" })).toBeTruthy();
  });

  it("'Approve all without warnings' skips a flagged swap and reports a server refusal", async () => {
    const flaggedSwap = swap(ID(51), samFridayNight, null);
    const patFriday = { ...meFriday, id: ID(10), userId: PAT, name: "Dr Pat Example" };
    const refusedSwap = swap(ID(52), patFriday, samThursdayNight, {
      requesterId: PAT,
      counterpartyId: SAM,
      requesterName: "Dr Pat Example",
      counterpartyName: "Dr Sam Example",
    });
    const saturday = shift(
      ID(5),
      SAM,
      "Dr Sam Example",
      "day",
      "D",
      "2026-10-17T09:00:00+08:00",
      "2026-10-17T17:00:00+08:00",
    );
    const cleanSwap = swap(ID(53), saturday, null);
    const { posts, reads } = mockFetch({
      rules: { maxNightsInRow: 1 },
      assignments: [mine, samThursdayNight, samFridayNight, patFriday, saturday],
      swaps: [flaggedSwap, refusedSwap, cleanSwap],
      refuse: new Set([ID(52)]),
    });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    // Wait for the rule flags, which come from a separate, wider read.
    await screen.findByRole("button", { name: /2nd night in a row/ });
    expect(reads.some((address) => address.includes("what=assignments") && address.includes("from=2026-10-10"))).toBe(
      true,
    );
    fireEvent.click(within(strip).getByRole("button", { name: "Approve all without warnings" }));
    expect(
      await within(strip).findByText("Approved 1. 1 left for you to read because a shift has a rule warning."),
    ).toBeTruthy();
    expect(within(strip).getByRole("alert").textContent).toContain("That shift has already changed.");
    // The flagged swap is never sent; the other two go one after the other.
    expect(posts).toEqual([
      { action: "swap.approve", swapId: ID(52) },
      { action: "swap.approve", swapId: ID(53) },
    ]);
  });

  it("'Approve all' leaves a swap the server marked as breaking a team rule, even with no flag on the calendar", async () => {
    const saturday = shift(
      ID(5),
      SAM,
      "Dr Sam Example",
      "day",
      "D",
      "2026-10-17T09:00:00+08:00",
      "2026-10-17T17:00:00+08:00",
    );
    const { posts } = mockFetch({
      rules: { maxNightsInRow: 1 },
      assignments: [mine, samThursdayNight, saturday],
      swaps: [swap(ID(80), saturday, null, { needsManagerBecause: "team_rule" })],
    });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    expect(within(strip).getByText("Needs you because it breaks a team rule")).toBeTruthy();
    const all = within(strip).getByRole("button", { name: "Approve all without warnings" }) as HTMLButtonElement;
    await waitFor(() => expect(within(strip).queryByText("Not checked, open it to review")).toBeNull());
    expect(all.disabled).toBe(true);
    expect(posts).toEqual([]);
  });

  it("'Approve all' leaves a swap whose result would break a team rule, and says what it would break", async () => {
    // Sam works Thursday night; taking Pat's Friday night would make two nights in a row.
    const patFridayNight = { ...samFridayNight, id: ID(12), userId: PAT, name: "Dr Pat Example" };
    const saturday = shift(
      ID(5),
      SAM,
      "Dr Sam Example",
      "day",
      "D",
      "2026-10-17T09:00:00+08:00",
      "2026-10-17T17:00:00+08:00",
    );
    const breaking = swap(ID(81), patFridayNight, null, {
      requesterId: PAT,
      counterpartyId: SAM,
      requesterName: "Dr Pat Example",
      counterpartyName: "Dr Sam Example",
    });
    const clean = swap(ID(82), saturday, null);
    const { posts } = mockFetch({
      rules: { maxNightsInRow: 1 },
      assignments: [mine, samThursdayNight, patFridayNight, saturday],
      swaps: [breaking, clean],
    });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    // Nothing on the calendar is flagged before the swap.
    expect(screen.queryByRole("button", { name: /night in a row/ })).toBeNull();
    expect(
      await within(strip).findByText("After this swap, Dr Sam Example: 2nd night in a row (team limit 1)"),
    ).toBeTruthy();
    fireEvent.click(within(strip).getByRole("button", { name: "Approve all without warnings" }));
    expect(
      await within(strip).findByText("Approved 1. 1 left for you to read because a shift has a rule warning."),
    ).toBeTruthy();
    expect(posts).toEqual([{ action: "swap.approve", swapId: ID(82) }]);
  });

  it("'Approve all' leaves a swap at the end of the week that breaks a rule on a shift just after it", async () => {
    // The week ends Sunday 18 Oct. Sam works Monday 19 Oct night; taking Pat's Sunday night makes two in a row.
    const patSundayNight = shift(
      ID(21),
      PAT,
      "Dr Pat Example",
      "night",
      "N",
      "2026-10-18T21:30:00+08:00",
      "2026-10-19T08:00:00+08:00",
    );
    const samMondayNight = shift(
      ID(22),
      SAM,
      "Dr Sam Example",
      "night",
      "N",
      "2026-10-19T21:30:00+08:00",
      "2026-10-20T08:00:00+08:00",
    );
    const saturday = shift(
      ID(5),
      SAM,
      "Dr Sam Example",
      "day",
      "D",
      "2026-10-17T09:00:00+08:00",
      "2026-10-17T17:00:00+08:00",
    );
    const breaking = swap(ID(89), patSundayNight, null, {
      requesterId: PAT,
      counterpartyId: SAM,
      requesterName: "Dr Pat Example",
      counterpartyName: "Dr Sam Example",
    });
    const { posts, reads } = mockFetch({
      rules: { maxNightsInRow: 1 },
      assignments: [mine, patSundayNight, samMondayNight, saturday],
      swaps: [breaking, swap(ID(90), saturday, null)],
    });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    expect(
      await within(strip).findByText("After this swap, Dr Sam Example: 2nd night in a row (team limit 1)"),
    ).toBeTruthy();
    // The rule flags read reaches past the week by the rules' look-back.
    expect(reads.some((address) => address.includes("what=assignments") && address.includes("to=2026-10-20"))).toBe(
      true,
    );
    fireEvent.click(within(strip).getByRole("button", { name: "Approve all without warnings" }));
    expect(
      await within(strip).findByText("Approved 1. 1 left for you to read because a shift has a rule warning."),
    ).toBeTruthy();
    expect(posts).toEqual([{ action: "swap.approve", swapId: ID(90) }]);
  });

  it("treats a swap as not checked where the look-back and look-ahead cannot both fit the read limit", async () => {
    // The November grid runs 26 Oct to 6 Dec. With a 14-day hours rule the read reaches 15 days
    // past it, so its start is trimmed to fit 60 days and early-grid swaps cannot be judged.
    const early = shift(
      ID(23),
      SAM,
      "Dr Sam Example",
      "day",
      "D",
      "2026-10-28T09:00:00+08:00",
      "2026-10-28T17:00:00+08:00",
    );
    const later = shift(
      ID(24),
      SAM,
      "Dr Sam Example",
      "day",
      "D",
      "2026-11-20T09:00:00+08:00",
      "2026-11-20T17:00:00+08:00",
    );
    const { posts, reads } = mockFetch({
      rules: { maxHours14d: 200 },
      assignments: [early, later],
      swaps: [swap(ID(91), early, null), swap(ID(92), later, null)],
    });
    url.set("view=month&date=2026-11-15");
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    await waitFor(() => expect(within(strip).getAllByText("Not checked, open it to review")).toHaveLength(1));
    expect(reads.some((address) => address.includes("from=2026-10-22") && address.includes("to=2026-12-21"))).toBe(
      true,
    );
    fireEvent.click(within(strip).getByRole("button", { name: "Approve all without warnings" }));
    expect(await within(strip).findByText("Approved 1. 1 not checked, open it to review.")).toBeTruthy();
    expect(posts).toEqual([{ action: "swap.approve", swapId: ID(92) }]);
  });

  it("'Approve all' counts only swaps the server really approved and says why the others were not", async () => {
    const saturday = shift(
      ID(5),
      SAM,
      "Dr Sam Example",
      "day",
      "D",
      "2026-10-17T09:00:00+08:00",
      "2026-10-17T17:00:00+08:00",
    );
    const patFriday = { ...meFriday, id: ID(10), userId: PAT, name: "Dr Pat Example" };
    const expired = swap(ID(83), saturday, null);
    const changed = swap(ID(84), patFriday, null, {
      requesterId: PAT,
      counterpartyId: SAM,
      requesterName: "Dr Pat Example",
      counterpartyName: "Dr Sam Example",
    });
    const { posts } = mockFetch({
      assignments: [mine, samThursdayNight, saturday, patFriday],
      swaps: [expired, changed],
      answers: {
        [ID(83)]: { swapId: ID(83), status: "expired" },
        [ID(84)]: { swapId: ID(84), status: "cancelled", cancelReason: "roster_changed" },
      },
    });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    await waitFor(() =>
      expect(
        (within(strip).getByRole("button", { name: "Approve all without warnings" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(within(strip).getByRole("button", { name: "Approve all without warnings" }));
    expect(await within(strip).findByText("Approved 0.")).toBeTruthy();
    const alert = within(strip).getByRole("alert");
    expect(alert.textContent).toContain(
      "The swap between Dr Sam Example and Dr Pat Example wasn't approved because it had expired.",
    );
    expect(alert.textContent).toContain(
      "The swap between Dr Pat Example and Dr Sam Example wasn't approved because the roster changed.",
    );
    expect(posts).toHaveLength(2);
  });

  it("says so when a single approval comes back expired instead of approved", async () => {
    mockFetch({
      swaps: [swap(ID(85), samThursdayNight, null)],
      answers: { [ID(85)]: { swapId: ID(85), status: "expired" } },
    });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    fireEvent.click(within(strip).getByRole("button", { name: "Approve" }));
    expect((await within(strip).findByRole("alert")).textContent).toBe(
      "This swap wasn't approved because it had expired.",
    );
  });

  it("does not list a swap the manager is part of, which the server would refuse", async () => {
    const saturday = shift(
      ID(5),
      SAM,
      "Dr Sam Example",
      "day",
      "D",
      "2026-10-17T09:00:00+08:00",
      "2026-10-17T17:00:00+08:00",
    );
    mockFetch({
      swaps: [
        swap(ID(86), samThursdayNight, mine, { counterpartyId: ME, counterpartyName: "Alex Example" }),
        swap(ID(87), mine, samThursdayNight, { requesterId: ME, counterpartyId: SAM, requesterName: "Alex Example" }),
        swap(ID(88), saturday, null),
      ],
    });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    expect(
      within(strip)
        .getAllByText(/^Swap ·/)
        .map((line) => line.textContent),
    ).toEqual(["Swap · Dr Sam Example and Dr Pat Example"]);
  });

  it("'Approve all' leaves a swap it could not check: a shift outside the loaded rows or before the look-back", async () => {
    const outside = shift(
      ID(7),
      SAM,
      "Dr Sam Example",
      "day",
      "D",
      "2026-11-20T09:00:00+08:00",
      "2026-11-20T17:00:00+08:00",
    );
    const before = shift(
      ID(8),
      SAM,
      "Dr Sam Example",
      "day",
      "D",
      "2026-10-11T09:00:00+08:00",
      "2026-10-11T17:00:00+08:00",
    );
    const checked = swap(ID(54), samThursdayNight, null);
    const { posts } = mockFetch({
      rules: { maxNightsInRow: 1 },
      // `before` is read but sits ahead of the rules' look-back; `outside` is not read at all.
      assignments: [mine, samThursdayNight, before],
      swaps: [checked, swap(ID(55), outside, null), swap(ID(56), before, null)],
    });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    await waitFor(() => expect(within(strip).getAllByText("Not checked, open it to review")).toHaveLength(2));
    fireEvent.click(within(strip).getByRole("button", { name: "Approve all without warnings" }));
    expect(await within(strip).findByText("Approved 1. 2 not checked, open them to review.")).toBeTruthy();
    expect(posts).toEqual([{ action: "swap.approve", swapId: ID(54) }]);
  });

  it("'Approve all' checks nothing when the team rules did not load", async () => {
    const { posts } = mockFetch({
      overviewFails: true,
      rules: { maxNightsInRow: 1 },
      assignments: [mine, samThursdayNight],
      swaps: [swap(ID(57), samThursdayNight, null)],
    });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    expect(within(strip).getByText("Not checked, open it to review")).toBeTruthy();
    const all = within(strip).getByRole("button", { name: "Approve all without warnings" }) as HTMLButtonElement;
    expect(all.disabled).toBe(true);
    // A single decision is still the manager's to make.
    fireEvent.click(within(strip).getByRole("button", { name: "Approve" }));
    const review = await screen.findByRole("dialog", { name: "Review fresh roster checks" });
    expect(posts).toEqual([]);
    expect(within(review).getByText(/Team rules could not be fully checked/)).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "Approve after review" }));
    await waitFor(() => expect(posts).toEqual([{ action: "swap.approve", swapId: ID(57) }]));
  });

  it("requires explicit review of a rest warning introduced after the calendar loaded", async () => {
    const waiting = swap(ID(50), samThursdayNight, null);
    const options: Options = { rules: { minBreakHours: 10 }, assignments: [mine, samThursdayNight], swaps: [waiting] };
    const { posts } = mockFetch(options);
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    await waitFor(() => expect(within(strip).queryByText("Not checked, open it to review")).toBeNull());
    options.assignments = [mine, samThursdayNight, { ...mine, id: ID(20), userId: PAT, name: "Dr Pat Example" }];
    fireEvent.click(within(strip).getByRole("button", { name: "Approve" }));
    const review = await screen.findByRole("dialog", { name: "Review fresh roster checks" });
    expect(within(review).getByText("After this swap: Less than 10 hours' rest before this shift")).toBeTruthy();
    expect(posts).toEqual([]);
    // A rule changed again while the manager was reading. The old review is not reusable.
    options.rules = { minBreakHours: 12 };
    fireEvent.click(within(review).getByRole("button", { name: "Approve after review" }));
    await within(review).findByText("After this swap: Less than 12 hours' rest before this shift");
    expect(posts).toEqual([]);
    fireEvent.click(within(review).getByRole("button", { name: "Approve after review" }));
    await waitFor(() => expect(posts).toEqual([{ action: "swap.approve", swapId: ID(50) }]));
  });

  it("bulk approval leaves a freshly unsafe swap unapproved", async () => {
    const options: Options = {
      rules: { minBreakHours: 10 },
      assignments: [mine, samThursdayNight],
      swaps: [swap(ID(50), samThursdayNight, null)],
    };
    const { posts } = mockFetch(options);
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    const all = within(strip).getByRole("button", { name: "Approve all without warnings" }) as HTMLButtonElement;
    await waitFor(() => expect(all.disabled).toBe(false));
    options.assignments = [mine, samThursdayNight, { ...mine, id: ID(20), userId: PAT, name: "Dr Pat Example" }];
    fireEvent.click(all);
    await within(strip).findByText("Approved 0. 1 left for you to read because a shift has a rule warning.");
    expect(posts).toEqual([]);
  });

  it("rechecks the full rule window around both fresh swap sides", async () => {
    const take = { ...samFridayNight, id: ID(21), userId: PAT };
    const waiting = swap(ID(50), samThursdayNight, take) as unknown as RosterManageSwap;
    const { reads } = mockFetch({
      rules: { maxHours14d: 24 },
      assignments: [samThursdayNight, take],
      swaps: [waiting],
    });
    const result = await recheckDecision(TEAM, { kind: "swap", item: waiting });
    expect(result.ok && result.rules?.checkable).toBe(true);
    const read = new URL(
      reads.find((address) => address.includes("what=assignments"))!,
      "http://localhost",
    );
    expect(read.searchParams.get("from")).toBe("2026-09-30");
    expect(read.searchParams.get("to")).toBe("2026-10-31");
  });

  it("bulk approval does not use old checkability when fresh rules fail", async () => {
    const options: Options = { assignments: [mine, samThursdayNight], swaps: [swap(ID(50), samThursdayNight, null)] };
    const { posts } = mockFetch(options);
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    const all = within(strip).getByRole("button", { name: "Approve all without warnings" }) as HTMLButtonElement;
    await waitFor(() => expect(all.disabled).toBe(false));
    options.overviewFails = true;
    fireEvent.click(all);
    await within(strip).findByText("Approved 0. 1 not checked, open it to review.");
    expect(posts).toEqual([]);
  });

  it("bulk approval rechecks the second swap after the first changes the roster", async () => {
    const noor = "99999999-9999-4999-8999-999999999999";
    const friday = { ...samFridayNight, id: ID(22), userId: noor, name: "Dr Noor Example" };
    const first = swap(ID(50), samThursdayNight, null);
    const second = swap(ID(51), friday, null, { requesterId: noor, requesterName: "Dr Noor Example" });
    const options: Options = {
      rules: { maxNightsInRow: 1 },
      assignments: [samThursdayNight, friday],
      swaps: [first, second],
    };
    options.onPost = () => {
      options.assignments = [{ ...samThursdayNight, userId: PAT }, friday];
      options.swaps = [second];
    };
    const { posts } = mockFetch(options);
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    const all = within(strip).getByRole("button", { name: "Approve all without warnings" }) as HTMLButtonElement;
    await waitFor(() => expect(all.disabled).toBe(false));
    fireEvent.click(all);
    await within(strip).findByText("Approved 1. 1 left for you to read because a shift has a rule warning.");
    expect(posts).toEqual([{ action: "swap.approve", swapId: ID(50) }]);
  });

  it("rechecks the live roster before an Approve in the strip, and sends nothing for a swap that has changed", async () => {
    const options: Options = { swaps: [swap(ID(50), samThursdayNight, null)] };
    const { posts, reads } = mockFetch(options);
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    const manageReads = () => reads.filter((address) => address.includes("what=manage")).length;
    const before = manageReads();
    // Someone else decided it after the list loaded.
    options.swaps = [];
    fireEvent.click(within(strip).getByRole("button", { name: "Approve" }));
    expect((await within(strip).findByRole("alert")).textContent).toBe(
      "This decision wasn't sent because it has changed. The list has been refreshed.",
    );
    expect(manageReads()).toBeGreaterThan(before);
    expect(posts).toEqual([]);
  });

  it("rechecks before an Approve in the shift sheet, and sends nothing for a swap that has changed", async () => {
    const options: Options = { swaps: [swap(ID(50), samThursdayNight, null)] };
    const { posts } = mockFetch(options);
    render(<RosterTeamPage now={NOW} />);
    await screen.findByRole("region", { name: "Needs you" });
    fireEvent.click(screen.getByRole("button", { name: /Dr Sam Example, Night/ }));
    const sheet = await screen.findByRole("dialog");
    options.swaps = [swap(ID(50), samThursdayNight, null, { status: "approved" })];
    fireEvent.click(within(sheet).getByRole("button", { name: "Approve" }));
    expect((await within(sheet).findByRole("alert")).textContent).toContain("it has changed");
    expect(posts).toEqual([]);
  });

  it("'Approve all' rechecks each swap, skipping and reporting one that has changed", async () => {
    const saturday = shift(
      ID(5),
      SAM,
      "Dr Sam Example",
      "day",
      "D",
      "2026-10-17T09:00:00+08:00",
      "2026-10-17T17:00:00+08:00",
    );
    const patFriday = { ...meFriday, id: ID(10), userId: PAT, name: "Dr Pat Example" };
    const stays = swap(ID(81), saturday, null);
    const goes = swap(ID(82), patFriday, null, {
      requesterId: PAT,
      counterpartyId: SAM,
      requesterName: "Dr Pat Example",
      counterpartyName: "Dr Sam Example",
    });
    const options: Options = { assignments: [mine, samThursdayNight, saturday, patFriday], swaps: [stays, goes] };
    const { posts } = mockFetch(options);
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    const all = within(strip).getByRole("button", { name: "Approve all without warnings" }) as HTMLButtonElement;
    await waitFor(() => expect(all.disabled).toBe(false));
    options.swaps = [stays];
    fireEvent.click(all);
    expect(await within(strip).findByText("Approved 1.")).toBeTruthy();
    expect(within(strip).getByRole("alert").textContent).toContain(
      "The swap between Dr Pat Example and Dr Sam Example wasn't sent because it has changed.",
    );
    expect(posts).toEqual([{ action: "swap.approve", swapId: ID(81) }]);
  });

  it("says an identical rule warning once for one swap", () => {
    const waiting = swap(ID(89), samThursdayNight, null) as unknown as RosterManageSwap;
    const words = "Less than 10 hours' rest before this shift";
    render(
      <SwapDecisionRow
        swap={waiting}
        checks={{
          flags: new Map(),
          afterSwap: new Map([
            [
              ID(89),
              [
                { assignmentId: ID(2), rule: "minBreakHours", words, userId: SAM },
                { assignmentId: ID(3), rule: "minBreakHours", words, userId: SAM },
              ],
            ],
          ]),
          checkable: new Set([ID(89)]),
        }}
        busy={false}
        onDecide={() => {}}
      />,
    );
    expect(screen.getAllByText(`After this swap, Dr Sam Example: ${words}`)).toHaveLength(1);
  });

  it("lists short days from today onward only", async () => {
    mockFetch({ needs: [need(1, 3, "night", 1), need(2, 4, "night", 2)] });
    render(<RosterTeamPage now={NOW} />);
    const strip = await screen.findByRole("region", { name: "Needs you" });
    expect(within(strip).getByRole("button", { name: /Thu 15 Oct/ })).toBeTruthy();
    // Wednesday 14 October is short too, but it has passed: no count and no strip entry.
    expect(screen.getByText("Nights 1 of 2").getAttribute("data-cover")).toBe("short");
    expect(screen.queryByText("Nights 0 of 1")).toBeNull();
    expect(within(strip).queryByRole("button", { name: /Wed 14 Oct/ })).toBeNull();
  });

  it("hides the manager layer with one quiet line when the maker read fails, and the staff calendar still works", async () => {
    mockFetch({ makerFails: true, needs: [need(1, 4, "night", 2)], swaps: [swap(ID(50), samThursdayNight, null)] });
    render(<RosterTeamPage now={NOW} />);
    const board = await screen.findByRole("table", { name: "Week roster" });
    expect(within(board).getByRole("button", { name: /Dr Sam Example, Night/ })).toBeTruthy();
    const line = await screen.findByText("Manager tools aren't available right now.");
    expect(line.getAttribute("role")).toBeNull();
    expect(screen.queryByRole("region", { name: "Needs you" })).toBeNull();
    expect(screen.queryByText(/Nights 1 of 2/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows no counts for a team with no targets", async () => {
    mockFetch({ needs: [], swaps: [swap(ID(50), samThursdayNight, null)] });
    render(<RosterTeamPage now={NOW} />);
    // The strip appearing shows the manager reads have answered.
    await screen.findByRole("region", { name: "Needs you" });
    expect(screen.queryByText(/ of \d/)).toBeNull();
    expect(screen.queryByText("Manager tools aren't available right now.")).toBeNull();
  });
});

describe("approveAllWithoutWarnings", () => {
  const item = (id: string, giveId: string, over: Record<string, unknown> = {}): RosterManageSwap =>
    swap(id, { ...mine, id: giveId }, null, over) as unknown as RosterManageSwap;
  const flag: RuleFlag = { assignmentId: ID(11), rule: "maxNightsInRow", words: "2nd night in a row" };
  const approved = { ok: true, result: { ok: true, status: "approved" } } as const;

  it("sends swap.approve one at a time, skipping flagged and unchecked swaps and collecting refusals", async () => {
    const order: string[] = [];
    let running = 0;
    const post = vi.fn(async (action: { action: string; swapId?: string }) => {
      running += 1;
      expect(running).toBe(1);
      order.push(action.swapId ?? "");
      await Promise.resolve();
      running -= 1;
      return action.swapId === ID(72)
        ? ({ ok: false, code: "roster_conflict", message: "Refused." } as const)
        : approved;
    });
    const outcome = await approveAllWithoutWarnings(
      [item(ID(70), ID(11)), item(ID(71), ID(12)), item(ID(72), ID(13)), item(ID(73), ID(14)), item(ID(74), ID(15))],
      {
        flags: new Map([[ID(11), [flag]]]),
        afterSwap: new Map(),
        checkable: new Set([ID(70), ID(71), ID(72), ID(73)]),
      },
      post,
    );
    expect(order).toEqual([ID(71), ID(72), ID(73)]);
    expect(outcome).toEqual({
      approved: 2,
      refused: [{ id: ID(72), message: "Refused." }],
      notApproved: [],
      warned: [ID(70)],
      notChecked: [ID(74)],
    });
  });

  it("never sends a swap the server said breaks a team rule, or one whose result would add a rule flag", async () => {
    const post = vi.fn(async () => approved);
    const outcome = await approveAllWithoutWarnings(
      [item(ID(75), ID(16), { needsManagerBecause: "team_rule" }), item(ID(76), ID(17)), item(ID(77), ID(18))],
      {
        flags: new Map(),
        afterSwap: new Map([[ID(76), [{ ...flag, assignmentId: ID(17), userId: PAT }]]]),
        checkable: new Set([ID(75), ID(76), ID(77)]),
      },
      post,
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ action: "swap.approve", swapId: ID(77) });
    expect(outcome.warned).toEqual([ID(75), ID(76)]);
    expect(outcome.approved).toBe(1);
  });

  it("counts only an answer of approved, and words the others", async () => {
    const answers: Record<string, Record<string, unknown>> = {
      [ID(78)]: { status: "cancelled", cancelReason: "no_longer_fits" },
      [ID(79)]: { status: "requested" },
    };
    const post = vi.fn(async (action: RosterAction) => ({
      ok: true as const,
      result: answers["swapId" in action ? action.swapId : ""],
    }));
    const outcome = await approveAllWithoutWarnings(
      [item(ID(78), ID(19)), item(ID(79), ID(20))],
      { flags: new Map(), afterSwap: new Map(), checkable: new Set([ID(78), ID(79)]) },
      post,
    );
    expect(outcome.approved).toBe(0);
    expect(outcome.notApproved).toEqual([
      {
        id: ID(78),
        words:
          "The swap between Dr Sam Example and Dr Pat Example wasn't approved because it no longer fits: a shift clash or a grade change.",
      },
      {
        id: ID(79),
        words: "The swap between Dr Sam Example and Dr Pat Example wasn't confirmed as approved. Check the list again.",
      },
    ]);
  });
});
