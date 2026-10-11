// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Roster's Month tab (work-mode redesign, owner request 6 Oct 2026; mockup
 * `rost_month`, `rost_day`, `rost_empty`, `rost_error`, `rost_loading`).
 * Drives the behaviours, not just the look: tap a day, keyboard, month
 * arrows, the hand-offs, and the honest states. Every roster is invented.
 */

const ME = "5e000000-0000-4000-8000-000000000001";
const SAM = "5e000000-0000-4000-8000-000000000002";
const TEAM = "5e000000-0000-4000-8000-000000000003";

const state = vi.hoisted(() => ({
  shifts: {} as Record<string, unknown>,
  teams: {} as Record<string, unknown>,
  reads: {} as Record<string, unknown>,
  readCalls: [] as [string | null, string][],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/roster",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/roster/use-roster-shifts", () => ({ useRosterShifts: () => state.shifts }));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => state.teams,
  useRosterTeamRules: () => new Map(),
  useRosterRead: (serviceId: string | null, what: string) => {
    state.readCalls.push([serviceId, what]);
    return serviceId && state.reads[what]
      ? { status: "ready", data: state.reads[what], message: null, reload: vi.fn(), readAt: new Date() }
      : { status: serviceId ? "loading" : "idle", data: null, message: null, reload: vi.fn(), readAt: null };
  },
}));
vi.mock("@/components/roster/use-roster-links", () => ({ useRosterLinks: () => ({ links: [], add: vi.fn() }) }));
vi.mock("@/components/roster/use-roster-settings", () => ({ useRosterSettings: () => ({}) }));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => <div role="dialog" aria-label="Continue to your workspace" />,
}));

import { RosterMonthPage } from "@/components/roster/roster-month-page";

const NOW = new Date("2026-10-06T07:42:00+08:00");

function shift(id: string, date: string, kind: string, start = "08:00", end = "16:30", endDate = date, extra = {}) {
  return {
    id,
    startsAt: `${date}T${start}:00+08:00`,
    endsAt: `${endDate}T${end}:00+08:00`,
    title: kind === "leave" ? "Annual leave" : "Shift",
    location: null,
    sourceUid: null,
    kind,
    source: "import",
    seriesId: null,
    workplace: "Example Hospital",
    ...extra,
  };
}

const teamDay = shift("t8", "2026-10-08", "day", "08:00", "16:30", "2026-10-08", {
  source: "team",
  assignmentId: "5e000000-0000-4000-8000-000000000010",
  serviceId: TEAM,
});

function ready(shifts: unknown[], extra: Record<string, unknown> = {}) {
  state.shifts = {
    status: "ready",
    shifts,
    demoMode: false,
    sample: false,
    teamMessage: null,
    teamLoading: false,
    reload: vi.fn(),
    addManual: vi.fn(),
    ...extra,
  };
}

beforeEach(() => {
  state.readCalls = [];
  state.reads = {};
  state.teams = {
    status: "ready",
    data: {
      actorId: ME,
      teams: [{ serviceId: TEAM, name: "Example team", enabled: true, role: "member", grade: "registrar" }],
    },
  };
  ready([
    shift("oc6", "2026-10-06", "on_call", "21:00", "08:00", "2026-10-07"),
    teamDay,
    shift("n16", "2026-10-16", "night", "21:00", "08:30", "2026-10-17"),
    shift("n17", "2026-10-17", "night", "21:00", "08:30", "2026-10-18"),
    shift("al", "2026-10-21", "leave", "00:00", "00:00", "2026-10-23"),
    shift("ph", "2026-12-25", "day"),
  ]);
});
afterEach(cleanup);

describe("Roster Month tab", () => {
  it("draws the month with a spoken shift code on every day and marks today", () => {
    render(<RosterMonthPage now={NOW} />);
    const grid = screen.getByRole("grid", { name: "Your shifts, October 2026" });
    expect(within(grid).getByRole("button", { name: "Thu 8 Oct: Day" })).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: "Sun 11 Oct: Off" })).toBeInTheDocument();
    const today = within(grid).getByRole("button", { name: /Tue 6 Oct: On call, today/ });
    expect(today).toHaveAttribute("aria-current", "date");
    // One Tab stop for the month: today.
    expect(today).toHaveAttribute("tabindex", "0");
    expect(within(grid).getByRole("button", { name: "Thu 8 Oct: Day" })).toHaveAttribute("tabindex", "-1");
  });

  it("leads with the next shift and lists the next nights and leave", () => {
    render(<RosterMonthPage now={NOW} />);
    expect(screen.getByTestId("roster-month-lead")).toHaveTextContent("On call tonight");
    const coming = screen.getByTestId("roster-month-coming");
    expect(coming).toHaveTextContent("Nights · 2 in a row");
    expect(coming).toHaveTextContent("Fri 16 and Sat 17 · 21:00 to 08:30");
    expect(coming).toHaveTextContent("Annual leave");
    expect(coming).toHaveTextContent("2 days");
  });

  it("counts the month, with days off and public holidays worked", () => {
    render(<RosterMonthPage now={NOW} />);
    const totals = screen.getByTestId("roster-month-totals");
    expect(within(totals).getByText("Night").nextSibling).toHaveTextContent("2");
    // 31 days, 4 working, 2 on leave.
    expect(screen.getByTestId("roster-month-off")).toHaveTextContent("25");
    expect(screen.getByTestId("roster-month-holidays")).toHaveTextContent("0");
  });

  it("opens a team shift's day sheet with the swap, give-away and can't-make hand-offs", async () => {
    const user = userEvent.setup();
    render(<RosterMonthPage now={NOW} />);
    const day = screen.getByRole("button", { name: "Thu 8 Oct: Day" });
    await user.click(day);
    expect(day).toHaveAttribute("aria-pressed", "true");
    const sheet = await screen.findByTestId("roster-day-sheet");
    expect(within(sheet).getByText("Thursday 8 October")).toBeInTheDocument();
    const actions = within(sheet).getByTestId("roster-day-sheet-actions");
    expect(within(actions).getByRole("link", { name: /Swap/ })).toHaveAttribute(
      "href",
      `/roster/requests?start=swap&assignment=5e000000-0000-4000-8000-000000000010&team=${TEAM}`,
    );
    expect(
      within(actions)
        .getByRole("link", { name: /Can't make/ })
        .getAttribute("href"),
    ).toContain("start=cant_make");
    // Who is on with you is read only now the sheet is open.
    expect(state.readCalls.some(([id, what]) => id === TEAM && what === "assignments")).toBe(true);
  });

  it("offers a day off the dates and leave hand-offs for that date", async () => {
    const user = userEvent.setup();
    render(<RosterMonthPage now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Sun 11 Oct: Off" }));
    const sheet = await screen.findByTestId("roster-day-sheet");
    expect(within(sheet).getByText("Nothing rostered")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Can't work" })).toHaveAttribute(
      "href",
      `/roster/requests?start=dates&date=2026-10-11&team=${TEAM}&kind=cant`,
    );
    expect(within(sheet).getByRole("link", { name: /Plan leave from this day/ })).toHaveAttribute(
      "href",
      "/roster/requests?start=leave&date=2026-10-11",
    );
  });

  it("names who is on with you once the team roster is read", async () => {
    state.reads.assignments = {
      assignments: [
        {
          id: "a1",
          userId: SAM,
          name: "Dr Sam Example",
          grade: "registrar",
          siteId: null,
          siteName: null,
          startsAt: "2026-10-08T08:00:00+08:00",
          endsAt: "2026-10-08T17:00:00+08:00",
          shiftCode: "D",
          kind: "day",
        },
        {
          id: "a2",
          userId: SAM,
          name: "Dr Late Example",
          grade: "registrar",
          siteId: null,
          siteName: null,
          startsAt: "2026-10-08T18:00:00+08:00",
          endsAt: "2026-10-08T22:00:00+08:00",
          shiftCode: "L",
          kind: "evening",
        },
      ],
    };
    render(<RosterMonthPage now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Thu 8 Oct: Day" }));
    const sheet = await screen.findByTestId("roster-day-sheet");
    expect(within(sheet).getByText("Dr Sam Example")).toBeInTheDocument();
    expect(within(sheet).getByText("Day · until 17:00")).toBeInTheDocument();
    // Not overlapping your shift, so not "on with you".
    expect(within(sheet).queryByText("Dr Late Example")).toBeNull();
  });

  it("moves between days with the arrow keys and between months with the arrows", async () => {
    const user = userEvent.setup();
    render(<RosterMonthPage now={NOW} />);
    const today = screen.getByRole("button", { name: /Tue 6 Oct/ });
    today.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Wed 7 Oct: Off" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Wed 14 Oct: Off" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("grid", { name: "Your shifts, November 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to this month" }));
    expect(screen.getByRole("grid", { name: "Your shifts, October 2026" })).toBeInTheDocument();
  });

  it("marks a WA public holiday and counts it as worked", async () => {
    const user = userEvent.setup();
    render(<RosterMonthPage now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("button", { name: "Fri 25 Dec: Day, WA public holiday" })).toBeInTheDocument();
    expect(screen.getByTestId("roster-month-holidays")).toHaveTextContent("1");
  });

  it("stops going back before what the roster loads, and says which days did not load", async () => {
    const user = userEvent.setup();
    render(<RosterMonthPage now={NOW} />);
    const back = screen.getByRole("button", { name: "Previous month" });
    await user.click(back);
    expect(screen.getByRole("button", { name: "Mon 14 Sep: not loaded" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tue 15 Sep: Off" })).toBeInTheDocument();
    expect(screen.getByTestId("roster-month-totals")).toHaveTextContent("Counted from Tue 15 Sep");
    expect(back).toHaveAttribute("aria-disabled", "true");
    await user.click(back);
    expect(screen.getByRole("grid", { name: "Your shifts, September 2026" })).toBeInTheDocument();
  });

  it("shows a swap waiting on you, with its answer-by time and the dashed chip", () => {
    const assignment = (id: string, userId: string, date: string, kind: string) => ({
      id,
      userId,
      name: null,
      grade: "registrar",
      siteId: null,
      siteName: null,
      startsAt: `${date}T08:00:00+08:00`,
      endsAt: `${date}T16:30:00+08:00`,
      shiftCode: "D",
      kind,
    });
    state.reads.requests = {
      swaps: [
        {
          id: "5e000000-0000-4000-8000-000000000020",
          status: "requested",
          autoApproved: false,
          needsManagerBecause: null,
          cancelReason: null,
          requesterId: SAM,
          counterpartyId: ME,
          requesterName: "Dr Sam Example",
          counterpartyName: null,
          give: assignment("5e000000-0000-4000-8000-000000000021", SAM, "2026-10-11", "evening"),
          take: assignment("5e000000-0000-4000-8000-000000000010", ME, "2026-10-08", "day"),
          expiresAt: "2026-10-06T17:00:00+08:00",
          createdAt: "2026-10-05T19:20:00+08:00",
          decidedAt: null,
        },
      ],
      openShifts: [],
    };
    render(<RosterMonthPage now={NOW} />);
    const card = screen.getByTestId("roster-month-swap");
    expect(card).toHaveTextContent("Swap from Dr Sam Example");
    expect(card).toHaveTextContent("Your Thu 8 day for their Sun 11");
    expect(card).toHaveTextContent("Answer by 17:00 today");
    expect(within(card).getByRole("link", { name: "Answer" })).toHaveAttribute("href", "/roster/swaps");
    expect(screen.getByRole("button", { name: "Thu 8 Oct: Day, swap asked" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sun 11 Oct: Off, a swap would give you/ })).toBeInTheDocument();
  });

  it("says a failed load changed nothing and checked nothing, and retries", () => {
    const reload = vi.fn();
    state.shifts = { status: "error", shifts: [], reload };
    render(<RosterMonthPage now={NOW} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your roster");
    expect(screen.getByTestId("roster-hours-not-checked")).toHaveTextContent("No warning here does not mean none");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalled();
  });

  it("shows the page's shape while loading", () => {
    state.shifts = { status: "loading", shifts: [] };
    render(<RosterMonthPage now={NOW} />);
    expect(screen.getByTestId("roster-month-loading")).toHaveTextContent("Loading your roster…");
    // The words are for screen readers; the grey shape is what shows.
    expect(screen.getByRole("status")).toHaveClass("sr-only");
  });

  it("signed out, Sign in opens the sign-in dialog in place rather than leaving the page", () => {
    state.shifts = { status: "signed-out", shifts: [] };
    render(<RosterMonthPage now={NOW} />);
    const notice = screen.getByTestId("roster-month-signed-out");
    expect(notice).toHaveAttribute("data-work-state", "signed-out");
    expect(within(notice).queryByRole("link")).toBeNull();
    fireEvent.click(within(notice).getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("dialog", { name: "Continue to your workspace" })).toBeInTheDocument();
  });

  it("offers an import, Add a shift and Join a team to a doctor with no roster yet", () => {
    ready([]);
    state.teams = { status: "ready", data: { actorId: ME, teams: [] } };
    render(<RosterMonthPage now={NOW} />);
    const empty = screen.getByTestId("roster-month-empty");
    expect(within(empty).getByText("No shifts yet")).toBeInTheDocument();
    expect(within(empty).getByRole("button", { name: "Import a roster file" })).toBeInTheDocument();
    expect(within(empty).getByRole("link", { name: /Join a team/ })).toHaveAttribute("href", "/roster/join");
  });

  it("keeps the part-loaded warning and makes the totals minimums", () => {
    ready([teamDay], { teamMessage: "Part of your team roster didn't load." });
    render(<RosterMonthPage now={NOW} />);
    expect(screen.getByText("Part of your team roster didn't load.")).toBeInTheDocument();
    expect(screen.getByTestId("roster-month-totals")).toHaveTextContent("these are minimums");
  });

  it("opens the account dialog to sign in, not the /sign-in address that forwards to Favourites", () => {
    state.shifts = { status: "signed-out", shifts: [], reload: vi.fn(), addManual: vi.fn() };
    render(<RosterMonthPage now={NOW} />);
    const empty = screen.getByTestId("roster-month-signed-out");
    expect(within(empty).queryByRole("link")).toBeNull();
    fireEvent.click(within(empty).getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("dialog", { name: "Continue to your workspace" })).toBeInTheDocument();
  });

  it("never calls the sample made up, and offers no add button", () => {
    ready([teamDay], { sample: true });
    render(<RosterMonthPage now={NOW} />);
    expect(screen.queryByText(/made up/)).toBeNull();
    expect(screen.queryByTestId("roster-month-add")).toBeNull();
  });

  it("draws no example note over a demo build's roster", () => {
    ready([teamDay], { demoMode: true });
    render(<RosterMonthPage now={NOW} />);
    expect(screen.queryByText("Example only. Sign in to add your own shifts.")).toBeNull();
  });
});
