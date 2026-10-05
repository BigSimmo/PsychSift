/** @vitest-environment jsdom */

// My Day dashboard cards (design review v13, concept D: Today, Work and Me
// pages): each card hides when its source has nothing or does not exist,
// Edit hides and restores cards (kept on this device, cleared at an account
// transition), "Needs you" is capped at three with "All N", and "Later"
// moves a row to tomorrow on this device with an undo.
//
// Rebuilt with the dashboard (2026-10-03): the cards and their test ids
// changed, so each test below was carried over to the new card that does the
// same job. Nothing was dropped; the old "next renewal" figure became the
// renewals runway, and the hero's class is now the dashboard hero.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The On Call call log is a patient-label store; the dashboard reads only its counts.
const callLog = vi.hoisted(() => ({
  current: null as null | { entries: { done: boolean }[]; expiresAt: number | null },
}));
vi.mock("@/components/on-call/handover/call-log", () => ({ useOnCallCallLog: () => callLog.current }));

import { MyDayDashboard, type MyDayDashboardProps } from "@/components/my-day/my-day-dashboard";
import { resetMyDayDeviceStateForTesting } from "@/components/my-day/my-day-device-state";
import type { MyDayDashboardSources } from "@/components/my-day/use-my-day-dashboard-sources";
import type { AdminHelpItem } from "@/lib/admin/help-items";
import {
  clearAccountScopedBrowserStorage,
  MY_DAY_HIDDEN_CARDS_STORAGE_KEY,
  MY_DAY_QUICK_NOTE_STORAGE_KEY,
  MY_DAY_SNOOZED_ITEMS_STORAGE_KEY,
} from "@/lib/account-scoped-browser-state";
import type { MyDayItem } from "@/lib/my-day/model";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import type { RosterDisplayShift } from "@/lib/roster/team/team-view";
import type { SessionSummary } from "@/lib/teaching/model";

// 12:40 on Sat 3 Oct 2026 in Perth (UTC+8).
const NOW = new Date("2026-10-03T04:40:00Z");
const TODAY = "2026-10-03";

const EMPTY_SOURCES: MyDayDashboardSources = {
  roster: { status: "unavailable", shifts: [], sample: false },
  teaching: { status: "unavailable", sessions: [], sample: false },
  cpd: {
    status: "unavailable",
    year: null,
    loggedHours: 0,
    targetHours: 0,
    byCategory: { educational: 0, reviewing: 0, measuring: 0 },
    categoryTargets: { educational: null, reviewing: null, measuring: null },
    byMonth: [],
    sample: false,
  },
};

const READY_CPD: MyDayDashboardSources["cpd"] = {
  status: "ready",
  year: 2026,
  loggedHours: 32,
  targetHours: 50,
  byCategory: { educational: 14, reviewing: 9, measuring: 9 },
  categoryTargets: { educational: null, reviewing: null, measuring: null },
  byMonth: [2, 4, 1, 5, 3, 2, 6, 4, 3, 2, 0, 0],
  sample: false,
};

function item(id: string, severity: MyDayItem["severity"], overrides: Partial<MyDayItem> = {}): MyDayItem {
  return {
    id,
    mode: "my-work",
    title: `Title ${id}`,
    due: severity === "overdue" ? "2026-09-20" : severity === "soon" ? "2026-10-05" : null,
    severity,
    href: `/admin/${id}`,
    ...overrides,
  };
}

function shift(overrides: Partial<RosterDisplayShift> & { id: string }): RosterDisplayShift {
  return {
    startsAt: "2026-10-03T09:00:00Z", // 17:00 Perth
    endsAt: "2026-10-04T00:30:00Z", // 08:30 Sun
    title: "On call",
    location: "Demo hospital",
    sourceUid: null,
    kind: "on_call",
    source: "manual",
    seriesId: null,
    workplace: null,
    ...overrides,
  };
}

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    occurrenceId: "occ-1",
    serviceId: "svc-1",
    title: "Registrar teaching: agitation",
    startsAt: "2026-10-03T06:00:00Z", // 14:00 Perth
    endsAt: "2026-10-03T07:00:00Z",
    venue: "Seminar room 3",
    hasJoinLink: false,
    status: "scheduled",
    isPresenter: true,
    source: "teaching",
    ...overrides,
  };
}

function props(overrides: Partial<MyDayDashboardProps> = {}): MyDayDashboardProps {
  return {
    now: NOW,
    today: TODAY,
    items: [],
    sources: EMPTY_SOURCES,
    checked: ["On Call", "Admin"],
    editing: false,
    onShowAll: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
}

function shownCards(): string[] {
  return [...document.querySelectorAll('[data-testid^="my-day-card-"]')]
    .map((card) => card.getAttribute("data-testid")!.replace("my-day-card-", ""))
    .filter((id) => !["failed", "retry", "partial"].includes(id));
}

beforeEach(() => {
  window.localStorage.clear();
  resetMyDayDeviceStateForTesting();
  callLog.current = null;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetMyDayDeviceStateForTesting();
});

describe("MyDayDashboard cards", () => {
  it("hides every card whose source is empty or unavailable", () => {
    render(<MyDayDashboard {...props()} />);
    expect(shownCards()).toEqual(["quick-actions", "needs-you"]);
    expect(screen.getByTestId("my-day-empty").textContent).toContain("Nothing needs you right now");
  });

  // Design review 2026-10-03: no "Handover" tile (item 3), and every link out
  // carries the "from My Day" marker (item 2). v13 widened the row to five
  // swipeable tiles, each a label over a short hint, all existing routes.
  it("links the quick actions to existing routes only, with the way back to My Day", () => {
    render(<MyDayDashboard {...props()} />);
    const card = screen.getByTestId("my-day-card-quick-actions");
    const links = within(card)
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);
    // Mock-up v2: four icon tiles, Teaching dropped (it is one tap away in the week).
    expect(links).toEqual([
      ["Log a call", "/on-call/call?from=my-day#on-call-call-log-heading"],
      ["Log CPD", "/cme/new?from=my-day"],
      ["Who's on", "/on-call/whos-on?from=my-day"],
      ["Roster", "/roster?from=my-day"],
    ]);
    expect(card.getAttribute("aria-label")).toBe("Quick actions");
    expect(card.textContent).not.toContain("Handover");
  });

  it("shows Up next from today's teaching with a countdown, place, role and one action", () => {
    render(
      <MyDayDashboard
        {...props({
          sources: { ...EMPTY_SOURCES, teaching: { status: "ready", sessions: [session()], sample: false } },
        })}
      />,
    );
    const card = screen.getByTestId("my-day-card-up-next");
    expect(card.textContent).toContain("Next up · 14:00 to 15:00 · in 1 h 20 min");
    expect(card.textContent).toContain("Registrar teaching: agitation");
    expect(card.textContent).toContain("You're presenting · Seminar room 3");
    expect(screen.getByTestId("my-day-up-next-open").getAttribute("href")).toBe("/teaching/session/occ-1?from=my-day");
    // No shift ahead: the hero shows only Up next, with no time line.
    expect(screen.queryByTestId("my-day-shift")).toBeNull();
    expect(screen.queryByTestId("my-day-ribbon")).toBeNull();
    // Teaching alone gives the week a row, so This week shows even without a roster, with no shift codes.
    expect(screen.getByTestId("my-day-agenda").textContent).toContain("Registrar teaching: agitation");
    expect(screen.getByTestId("my-day-week").querySelector('[data-kind="on_call"]')).toBeNull();
  });

  it("shows the next teaching session as a panel inside the hero, with no separate card", () => {
    render(
      <MyDayDashboard
        {...props({
          sources: {
            ...EMPTY_SOURCES,
            teaching: {
              status: "ready",
              sessions: [],
              ahead: [
                session({
                  occurrenceId: "occ-2",
                  title: "Case presentation",
                  startsAt: "2026-10-06T04:30:00Z", // 12:30 Perth
                  endsAt: "2026-10-06T05:30:00Z",
                }),
              ],
              sample: false,
            },
          },
        })}
      />,
    );
    const hero = screen.getByTestId("my-day-card-up-next");
    const panel = within(hero).getByTestId("my-day-next-up");
    expect(panel.textContent).toContain("Next up · Tue 6 Oct, 12:30 to 13:30");
    expect(panel.textContent).toContain("Case presentation");
    expect(within(panel).getByTestId("my-day-next-up-open").getAttribute("href")).toBe(
      "/teaching/session/occ-2?from=my-day",
    );
    // Only the hero draws it: the old standalone card is gone.
    expect(screen.getAllByTestId("my-day-next-up")).toHaveLength(1);
  });

  // Design review 2026-10-03, items 6, 7, 9 and 11: the Shift ring lives in the
  // Up next hero (so the same shift is never shown twice), and the week reads
  // as filled day tiles with "OC" for on call and a faded "off" for rest days.
  it("builds the hero's shift line and This week from the roster, showing the shift once", () => {
    render(
      <MyDayDashboard
        {...props({
          sources: { ...EMPTY_SOURCES, roster: { status: "ready", shifts: [shift({ id: "s1" })], sample: false } },
        })}
      />,
    );
    expect(screen.queryByTestId("my-day-card-shift")).toBeNull();
    const hero = screen.getByTestId("my-day-card-up-next");
    expect(hero.className).toContain("dash-hero");
    expect(within(hero).getByTestId("my-day-ribbon")).toBeTruthy();
    expect(within(hero).getByTestId("my-day-ribbon-now")).toBeTruthy();
    expect(within(hero).getByTestId("my-day-shift-countdown").textContent).toBe("Starts in 4 h 20 min");
    expect(hero.textContent).toContain("On call tonight");
    expect(hero.textContent).toContain("Sat 17:00 to Sun 08:30 · Demo hospital");
    expect(hero.textContent).toContain("On call tonight, starts in 4 hours 20 minutes");
    expect(within(hero).getByTestId("my-day-shift").getAttribute("href")).toBe("/roster?from=my-day");
    // The only thing today is that shift, so there is no separate Up next panel repeating it.
    expect(screen.queryByTestId("my-day-up-next")).toBeNull();
    // Seven days from today, the same days as the Week page (it used to be Monday to Sunday).
    const week = screen.getByTestId("my-day-week");
    const days = [...week.querySelectorAll("li")].map((day) => day.getAttribute("data-testid"));
    expect(days[0]).toBe("dash-week-tile-2026-10-03");
    expect(days[6]).toBe("dash-week-tile-2026-10-09");
    const today = week.querySelector('[aria-current="date"]')!;
    expect(today.textContent).toContain("Sat 3 Oct: On call");
    expect(today.getAttribute("data-kind")).toBe("on_call");
    expect(today.textContent).toContain("OC");
    expect(week.querySelectorAll('[data-kind="off"]')).toHaveLength(6);
    expect(screen.getByTestId("my-day-card-this-week").textContent).toContain("OC on call");
  });

  it("puts what is up next under the shift ring in the one hero", () => {
    render(
      <MyDayDashboard
        {...props({
          sources: {
            ...EMPTY_SOURCES,
            roster: { status: "ready", shifts: [shift({ id: "s1" })], sample: false },
            teaching: { status: "ready", sessions: [session()], sample: false },
          },
        })}
      />,
    );
    const hero = screen.getByTestId("my-day-card-up-next");
    expect(within(hero).getByTestId("my-day-shift")).toBeTruthy();
    expect(within(hero).getByTestId("my-day-up-next").textContent).toContain("Registrar teaching: agitation");
    expect(hero.textContent).toContain("in 1 h 20 min");
    expect(shownCards().filter((id) => id === "up-next")).toHaveLength(1);
  });

  it("counts a running shift down to its end", () => {
    const running = shift({ id: "s2", kind: "day", startsAt: "2026-10-03T00:30:00Z", endsAt: "2026-10-03T09:00:00Z" });
    render(
      <MyDayDashboard
        {...props({ sources: { ...EMPTY_SOURCES, roster: { status: "ready", shifts: [running], sample: false } } })}
      />,
    );
    const card = screen.getByTestId("my-day-card-up-next");
    expect(card.textContent).toContain("Day shift now");
    expect(screen.getByTestId("my-day-shift-countdown").textContent).toBe("4 h 20 min left");
    expect(card.textContent).toContain("Day shift now, 4 hours 20 minutes left, until 17:00.");
    // Only on call gets Log a call in the blue card.
    expect(screen.queryByTestId("my-day-hero-log-call")).toBeNull();
    // A shift already running is the card's own, not an Up next panel's.
    expect(screen.queryByTestId("my-day-up-next")).toBeNull();
  });

  it("gives a running on call its one filled Log a call button", () => {
    const onCall = shift({ id: "oc", startsAt: "2026-10-02T21:00:00Z", endsAt: "2026-10-03T08:00:00Z" });
    render(
      <MyDayDashboard
        {...props({ sources: { ...EMPTY_SOURCES, roster: { status: "ready", shifts: [onCall], sample: false } } })}
      />,
    );
    expect(screen.getByTestId("my-day-hero-log-call").getAttribute("href")).toBe(
      "/on-call/call?from=my-day#on-call-call-log-heading",
    );
    expect(screen.getByTestId("my-day-card-up-next").textContent).toContain("Until 16:00 handover");
  });

  it("says plainly when the day's shift is over, with the next one", () => {
    const ended = shift({ id: "d", kind: "day", startsAt: "2026-10-02T23:00:00Z", endsAt: "2026-10-03T03:00:00Z" });
    const next = shift({ id: "n", kind: "day", startsAt: "2026-10-05T00:00:00Z", endsAt: "2026-10-05T09:00:00Z" });
    render(
      <MyDayDashboard
        {...props({ sources: { ...EMPTY_SOURCES, roster: { status: "ready", shifts: [ended, next], sample: false } } })}
      />,
    );
    const card = screen.getByTestId("my-day-card-up-next");
    expect(card.textContent).toContain("Off for the rest of today");
    expect(card.textContent).toContain("Day shift ended 11:00");
    expect(card.textContent).toContain("next: day shift Mon 5 Oct, 08:00");
  });

  it("still says the day's shift is over when the roster has nothing later", () => {
    const ended = shift({ id: "d", kind: "day", startsAt: "2026-10-02T23:00:00Z", endsAt: "2026-10-03T03:00:00Z" });
    render(
      <MyDayDashboard
        {...props({ sources: { ...EMPTY_SOURCES, roster: { status: "ready", shifts: [ended], sample: false } } })}
      />,
    );
    const card = screen.getByTestId("my-day-card-up-next");
    expect(card.textContent).toContain("Off for the rest of today");
    expect(card.textContent).toContain("Day shift ended 11:00");
  });

  it("hides the hero when the roster has nothing ahead and nothing else is up next", () => {
    const past = shift({ id: "s3", startsAt: "2026-10-01T09:00:00Z", endsAt: "2026-10-02T00:30:00Z" });
    render(
      <MyDayDashboard
        {...props({ sources: { ...EMPTY_SOURCES, roster: { status: "ready", shifts: [past], sample: false } } })}
      />,
    );
    expect(screen.queryByTestId("my-day-card-up-next")).toBeNull();
    // A known roster still shows the week.
    expect(screen.getByTestId("my-day-card-this-week")).toBeTruthy();
  });

  it("shows CPD hours by type against target, and recorded dates on the renewals list", () => {
    render(
      <MyDayDashboard
        {...props({
          sources: { ...EMPTY_SOURCES, cpd: READY_CPD },
          renewals: [
            { entryId: "e0", title: "Life support course", date: "2026-09-21", href: "/admin/renewals?item=e0" },
            { entryId: "e1", title: "Medical registration", date: "2026-11-24", href: "/admin/renewals?item=e1" },
            // Past the six-month runway: on the wallet, not the runway.
            { entryId: "e2", title: "Indemnity", date: "2027-08-01", href: "/admin/renewals?item=e2" },
          ],
        })}
      />,
    );
    const cpd = screen.getByTestId("my-day-card-cpd");
    expect(cpd.textContent).toContain(
      "32 of 50 CPD hours logged this year: Educational 14, Reviewing performance 9, Measuring outcomes 9. 18 hours to go by 31 December.",
    );
    expect(cpd.textContent).toContain("Educational14 h");
    expect(cpd.textContent).toContain("Reviewing performance9 h");
    expect(cpd.textContent).toContain("Measuring outcomes9 h");
    expect(cpd.textContent).toContain("To go by 31 Dec18 h");
    expect(cpd.textContent).toContain("Your 50 h target is the one you confirmed in CPD.");
    expect(screen.getByTestId("my-day-cpd").getAttribute("href")).toBe("/cme?from=my-day");
    expect(screen.getByTestId("my-day-cpd-ring")).toBeTruthy();
    const runway = screen.getByTestId("my-day-runway");
    expect(runway.querySelectorAll("li")).toHaveLength(2);
    expect(runway.textContent).not.toContain("Indemnity");
    // The nearest renewal leads, with Renew to the same place.
    const lead = screen.getByTestId("my-day-runway-lead");
    expect(lead.textContent).toContain("Life support course");
    expect(lead.textContent).toContain("Date passed · Mon 21 Sep 2026");
    expect(screen.getByTestId("my-day-runway-lead-action").getAttribute("href")).toBe(
      "/admin/renewals?item=e0&from=my-day",
    );
    expect(screen.getByTestId("my-day-runway-e1").textContent).toContain("In 52 days · Tue 24 Nov 2026");
  });

  it("says which card reads failed instead of silently showing nothing", () => {
    render(
      <MyDayDashboard
        {...props({
          items: [item("a", "soon")],
          sources: {
            ...EMPTY_SOURCES,
            roster: { status: "failed", shifts: [], sample: false },
            cpd: { ...EMPTY_SOURCES.cpd, status: "failed" },
          },
        })}
      />,
    );
    // The roster has its own amber note, read out at once, with Try again.
    const roster = screen.getByTestId("my-day-roster-failed");
    expect(roster.textContent).toContain("Your roster did not load");
    expect(roster.textContent).toContain("Check Roster before you rely on this page.");
    expect(roster.getAttribute("role")).toBe("alert");
    expect(within(roster).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByTestId("my-day-card-failed").textContent).toBe(
      "Couldn't load CPD hours, so that card is not shown.",
    );
    // With a source missing, the count is a floor, never a full count.
    expect(screen.getByTestId("my-day-card-needs-you").textContent).toContain("at least 1");
  });

  it("never says nothing needs you while a source failed", () => {
    render(
      <MyDayDashboard
        {...props({ sources: { ...EMPTY_SOURCES, roster: { status: "failed", shifts: [], sample: false } } })}
      />,
    );
    const empty = screen.getByTestId("my-day-empty");
    expect(empty.textContent).not.toContain("Nothing needs you right now");
    expect(empty.textContent).toContain("Nothing found in the sources that loaded");
  });

  it("says when the phone is offline, and the time the page loaded", () => {
    const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    render(<MyDayDashboard {...props({ checkedAt: "14:05" })} />);
    expect(screen.getByTestId("my-day-offline").textContent).toBe(
      "You are offlineThis is My Day as it loaded at 14:05. Reload when you are back online to see changes.",
    );
    online.mockRestore();
  });

  it("opens the show-and-hide mode from the Customise row at the bottom", () => {
    const onToggleEditing = vi.fn();
    render(<MyDayDashboard {...props({ onToggleEditing })} />);
    const row = screen.getByTestId("my-day-customise");
    expect(row.textContent).toContain("Show or hide these cards");
    fireEvent.click(row);
    expect(onToggleEditing).toHaveBeenCalledTimes(1);
  });
});

describe("Needs you", () => {
  const five = [
    item("a", "overdue", { detail: "Routine due" }),
    item("b", "overdue"),
    item("c", "soon"),
    item("d", "soon"),
    item("e", "info"),
  ];

  it("shows at most three rows, overdue first, with All N opening the full list", () => {
    const onShowAll = vi.fn();
    render(<MyDayDashboard {...props({ items: five, onShowAll })} />);
    const card = screen.getByTestId("my-day-card-needs-you");
    const rows = [...card.querySelectorAll('[data-testid^="my-day-item-"]')].map((row) =>
      row.getAttribute("data-testid"),
    );
    expect(rows).toEqual(["my-day-item-a", "my-day-item-b", "my-day-item-c"]);
    // Two lines a row (design review item 8): the detail line only repeated the state.
    expect(within(card).queryByText("Routine due")).toBeNull();
    // The row's one action opens the item, carrying the way back to My Day.
    expect(screen.getByTestId("my-day-open-a").getAttribute("href")).toBe("/admin/a?from=my-day");
    expect(screen.getByTestId("my-day-open-a").textContent).toBe("Open");
    expect(card.textContent).toContain("Needs you3 of 5");
    fireEvent.click(within(card).getByRole("button", { name: "See all 5" }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it("moves a row to tomorrow on this device with Later, and Undo brings it back", () => {
    render(<MyDayDashboard {...props({ items: five })} />);
    fireEvent.click(screen.getByRole("button", { name: "Later: Title a" }));
    expect(screen.queryByTestId("my-day-item-a")).toBeNull();
    // The next row moves up so the card still shows three.
    expect(screen.getByTestId("my-day-item-d")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Hidden until tomorrow: Title a");
    expect(JSON.parse(window.localStorage.getItem(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY)!)).toEqual({ a: "2026-10-04" });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();
    expect(window.localStorage.getItem(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY)).toBeNull();
  });

  it("never says nothing else needs you when every row is hidden but a source failed", () => {
    render(<MyDayDashboard {...props({ items: [item("a", "soon")], incomplete: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Later: Title a" }));
    expect(screen.getByTestId("my-day-needs-you-snoozed").textContent).toBe(
      "Nothing else found in the sources that loaded. 1 hidden until tomorrow.",
    );
  });

  it("shows a moved row again from the day it comes back", () => {
    window.localStorage.setItem(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY, JSON.stringify({ a: "2026-10-04" }));
    render(<MyDayDashboard {...props({ items: [item("a", "overdue")] })} />);
    expect(screen.queryByTestId("my-day-item-a")).toBeNull();
    expect(screen.getByTestId("my-day-needs-you-snoozed").textContent).toContain("1 hidden until tomorrow");
    cleanup();
    render(<MyDayDashboard {...props({ items: [item("a", "overdue")], today: "2026-10-04" })} />);
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();
  });

  it("changes nothing on the server: Later and Undo make no request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<MyDayDashboard {...props({ items: five })} />);
    fireEvent.click(screen.getByRole("button", { name: "Later: Title b" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("Edit mode", () => {
  it("hides a card, lists it as a chip while editing, and restores it", () => {
    const { rerender } = render(<MyDayDashboard {...props({ editing: true })} />);
    expect(screen.getByTestId("my-day-hidden-cards").textContent).toContain("Hidden cards wait here.");
    fireEvent.click(screen.getByRole("button", { name: "Hide Quick actions" }));
    expect(screen.queryByTestId("my-day-card-quick-actions")).toBeNull();
    expect(screen.getByRole("button", { name: "Show Quick actions" }).textContent).toContain("Quick actions");
    expect(JSON.parse(window.localStorage.getItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY)!)).toEqual(["quick-actions"]);

    // Outside edit mode the card stays hidden and no chip or Hide button shows.
    rerender(<MyDayDashboard {...props({ editing: false })} />);
    expect(screen.queryByTestId("my-day-card-quick-actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show Quick actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Hide / })).toBeNull();

    rerender(<MyDayDashboard {...props({ editing: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Show Quick actions" }));
    expect(screen.getByTestId("my-day-card-quick-actions")).toBeTruthy();
    expect(window.localStorage.getItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY)).toBeNull();
  });

  it("says how to bring cards back when every shown card is hidden", () => {
    window.localStorage.setItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY, JSON.stringify(["quick-actions", "needs-you"]));
    render(<MyDayDashboard {...props()} />);
    expect(shownCards()).toEqual([]);
    expect(screen.getByTestId("my-day-all-hidden").textContent).toContain("Choose Edit to bring them back.");
  });

  it("forgets hidden cards and moved rows at an account transition", () => {
    window.localStorage.setItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY, JSON.stringify(["quick-actions"]));
    window.localStorage.setItem(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY, JSON.stringify({ a: "2026-10-04" }));
    render(<MyDayDashboard {...props({ items: [item("a", "overdue")] })} />);
    expect(screen.queryByTestId("my-day-card-quick-actions")).toBeNull();
    expect(screen.queryByTestId("my-day-item-a")).toBeNull();

    act(() => clearAccountScopedBrowserStorage());
    expect(window.localStorage.getItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId("my-day-card-quick-actions")).toBeTruthy();
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();
  });

  // Codex review on #3234 (item 2): when storage works, a missing key is the truth.
  it("brings a card back when another tab restores it", () => {
    render(<MyDayDashboard {...props({ editing: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide Quick actions" }));
    expect(screen.queryByTestId("my-day-card-quick-actions")).toBeNull();
    act(() => {
      window.localStorage.removeItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: MY_DAY_HIDDEN_CARDS_STORAGE_KEY }));
    });
    expect(screen.getByTestId("my-day-card-quick-actions")).toBeTruthy();
  });
});

// Codex review on #3234 (item 7): finished morning lines must not push the rest of the day off.
describe("This week's rows", () => {
  it("folds repeated day shifts into one row and keeps a running shift on its own", () => {
    const day = (id: string, date: string) =>
      shift({ id, kind: "day", startsAt: `${date}T00:00:00Z`, endsAt: `${date}T09:00:00Z` });
    render(
      <MyDayDashboard
        {...props({
          sources: {
            ...EMPTY_SOURCES,
            roster: {
              status: "ready",
              shifts: [day("a", "2026-10-05"), day("b", "2026-10-06"), day("c", "2026-10-07")],
              sample: false,
            },
          },
        })}
      />,
    );
    const rows = screen.getByTestId("my-day-agenda");
    expect(rows.textContent).toContain("Day shifts");
    expect(rows.textContent).toContain("Mon, Tue and Wed · 08:00 to 17:00 · Roster");
    expect(within(rows).getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("This week's teaching rows", () => {
  it("lists a session from today once, though it is in both today's list and the weeks ahead", () => {
    render(
      <MyDayDashboard
        {...props({
          sources: {
            ...EMPTY_SOURCES,
            teaching: { status: "ready", sessions: [session()], ahead: [session()], sample: false },
          },
        })}
      />,
    );
    const rows = screen.getByTestId("my-day-agenda");
    expect(rows.textContent!.split("Registrar teaching: agitation")).toHaveLength(2);
  });
});

// Design review v13, owner-approved concept D: the flag is the one most
// important real item, overdue first, with its one action.
describe("The flag", () => {
  it("leads with the overdue item, gives its one action with the way back, and counts the others", () => {
    const items = [
      item("soon", "soon", { title: "Soon thing" }),
      item("cpd", "overdue", { mode: "cme", title: "Demo journal club", href: "/cme/entry/1" }),
      item("adm", "overdue", { title: "Medical registration" }),
    ];
    render(<MyDayDashboard {...props({ items })} />);
    const flag = screen.getByTestId("my-day-card-flag");
    expect(within(flag).getByTestId("my-day-flag").textContent).toContain("Demo journal club");
    expect(flag.textContent).toMatch(/1 of \d+ reminders/);
    const action = within(flag).getByTestId("my-day-flag-action");
    expect(action.textContent).toBe("Log");
    expect(action.getAttribute("href")).toBe("/cme/entry/1?from=my-day");
  });

  it("hides when nothing real needs the reader", () => {
    render(<MyDayDashboard {...props()} />);
    expect(screen.queryByTestId("my-day-card-flag")).toBeNull();
  });
});

describe("Pages", () => {
  it("keeps each card on its own page", () => {
    render(<MyDayDashboard {...props({ sources: { ...EMPTY_SOURCES, cpd: READY_CPD }, page: "me" })} />);
    expect(screen.getByTestId("my-day-dashboard").getAttribute("data-page")).toBe("me");
    // Me has CPD by month and the quick note; Today's CPD rings are not drawn here.
    expect(shownCards()).toEqual(["cpd-month", "quick-note"]);
  });

  it("says what Work will hold when none of its sources has anything yet", () => {
    render(<MyDayDashboard {...props({ page: "work" })} />);
    expect(shownCards()).toEqual([]);
    expect(screen.getByTestId("my-day-all-hidden").textContent).toContain("Nothing for Work yet.");
  });

  // Sources that do not exist in this build (a sign-off queue, recent or
  // pinned documents) have no card at all rather than an invented one.
  it("never draws a card for a source this build does not have", () => {
    for (const page of ["today", "work", "me"] as const) {
      render(<MyDayDashboard {...props({ page })} />);
      expect(shownCards().some((id) => /sign-off|sources|leave/.test(id))).toBe(false);
      cleanup();
    }
  });
});

describe("Work cards", () => {
  it("shows tonight's calls as counts only, with the handover time, and hides with no call log", () => {
    const { rerender } = render(<MyDayDashboard {...props({ page: "work" })} />);
    expect(screen.queryByTestId("my-day-card-calls")).toBeNull();

    callLog.current = { entries: [{ done: true }, { done: false }], expiresAt: null };
    rerender(
      <MyDayDashboard
        {...props({
          page: "work",
          sources: { ...EMPTY_SOURCES, roster: { status: "ready", shifts: [shift({ id: "s1" })], sample: false } },
        })}
      />,
    );
    const card = screen.getByTestId("my-day-card-calls");
    expect(card.textContent).toContain("On call tonight");
    expect(card.textContent).toContain("Calls logged2");
    expect(card.textContent).toContain("Still open1");
    expect(card.textContent).toContain("Counts only · this device");
    // Tonight's on call ends 08:30 Sunday: that is the handover.
    expect(card.textContent).toContain("HandoverSun 08:30");
    // The notes themselves stay on the Call page, and the page says so.
    expect(screen.getByText(/Call notes stay on the Call page/)).toBeTruthy();
    expect(screen.getByTestId("my-day-calls-log").getAttribute("href")).toBe(
      "/on-call/call?from=my-day#on-call-call-log-heading",
    );
    expect(screen.getByTestId("my-day-calls-handover").getAttribute("href")).toBe(
      "/on-call/call?from=my-day#on-call-handover-heading",
    );
  });

  it("shows pinned Help numbers, numbers first, four at most", () => {
    const ids = Array.from({ length: 5 }, (_, index) => `00000000-0000-4000-8000-00000000000${index + 1}`);
    const help = (id: string, title: string, phone: string | null): AdminHelpItem => ({
      key: `entry-${id}`,
      tab: "contacts",
      title,
      detail: phone ? null : "Ask at the desk",
      phone,
      url: null,
      updatedOn: null,
      source: "you",
      entry: { id } as OnCallEntry,
      searchText: title,
    });
    window.localStorage.setItem("clinical-kb-admin-pins", JSON.stringify(ids));
    render(
      <MyDayDashboard
        {...props({
          page: "work",
          helpItems: [
            help(ids[0]!, "Front desk", null),
            help(ids[1]!, "Switch", "0890009000"),
            help(ids[2]!, "ED", "0890009123"),
            help(ids[3]!, "Pharmacy", "0890009456"),
            help(ids[4]!, "Security", "0890009777"),
          ],
        })}
      />,
    );
    const card = screen.getByTestId("my-day-card-pinned-numbers");
    const links = within(card).getAllByRole("link", { name: /^Call / });
    expect(links).toHaveLength(4);
    expect(links[0]!.getAttribute("href")).toMatch(/^tel:/);
    expect(card.textContent).not.toContain("Front desk");
  });

  it("shows who is on now only from a confirmed team, and the next talk", () => {
    render(
      <MyDayDashboard
        {...props({
          page: "work",
          sources: {
            ...EMPTY_SOURCES,
            whosOn: {
              status: "ready",
              teamName: "Example service",
              colleagues: [{ id: "c1", name: "Dr Demo B", grade: "Registrar", endsAt: "2026-10-03T13:00:00Z" }],
            },
            teaching: {
              status: "ready",
              sessions: [],
              sample: false,
              nextTalk: session({ occurrenceId: "talk", title: "Lithium toxicity", startsAt: "2026-10-15T06:00:00Z" }),
            },
          },
        })}
      />,
    );
    const team = screen.getByTestId("my-day-card-whos-on");
    expect(team.textContent).toContain("Dr Demo B");
    // Role first, then the name.
    expect(team.textContent).toContain("RegistrarDr Demo B · until 21:00");
    // No on call tonight: the next talk leads "Coming up" rather than having its own section.
    expect(screen.queryByTestId("my-day-card-next-talk")).toBeNull();
    const talk = screen.getByTestId("my-day-card-coming-up");
    expect(talk.textContent).toContain("Lithium toxicity");
    expect(talk.textContent).toContain("Thu 15 Oct · 14:00");
    expect(within(talk).getByRole("link").getAttribute("href")).toBe("/teaching/session/talk?from=my-day");
  });

  it("lists the next talk and the next on call under Coming up, soonest first", () => {
    render(
      <MyDayDashboard
        {...props({
          page: "work",
          sources: {
            ...EMPTY_SOURCES,
            roster: {
              status: "ready",
              shifts: [shift({ id: "oc", startsAt: "2026-10-09T13:00:00Z", endsAt: "2026-10-10T00:00:00Z" })],
              sample: false,
            },
            teaching: {
              status: "ready",
              sessions: [],
              sample: false,
              nextTalk: session({ occurrenceId: "talk", title: "Journal club", startsAt: "2026-10-05T04:30:00Z" }),
            },
          },
        })}
      />,
    );
    const rows = within(screen.getByTestId("my-day-card-coming-up")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Journal club"),
      expect.stringContaining("Your next on callFri 21:00 to Sat 08:00 · in 6 days · Roster"),
    ]);
  });

  it("hides who's on while the team is unavailable", () => {
    render(
      <MyDayDashboard
        {...props({
          page: "work",
          sources: { ...EMPTY_SOURCES, whosOn: { status: "unavailable", teamName: null, colleagues: [] } },
        })}
      />,
    );
    expect(screen.queryByTestId("my-day-card-whos-on")).toBeNull();
  });
});

describe("Me cards", () => {
  const worked = [
    shift({ id: "d1", kind: "day", startsAt: "2026-09-28T00:00:00Z", endsAt: "2026-09-28T09:00:00Z" }),
    shift({ id: "d2", kind: "day", startsAt: "2026-09-29T00:00:00Z", endsAt: "2026-09-29T09:00:00Z" }),
    shift({ id: "oc", kind: "on_call" }),
  ];

  it("counts hours worked from the roster, on call excluded, and keeps fatigue warnings off", () => {
    render(
      <MyDayDashboard
        {...props({
          page: "me",
          sources: { ...EMPTY_SOURCES, roster: { status: "ready", shifts: worked, sample: false } },
        })}
      />,
    );
    const hours = screen.getByTestId("my-day-card-hours");
    expect(hours.textContent).toContain("18 h");
    expect(hours.textContent).toContain("Rest and fatigue warnings stay off until the rules are signed off.");
    expect(hours.textContent).toContain("rostered · 2 shifts");
    expect(hours.textContent).toContain("On call and leave are not counted.");
    fireEvent.click(within(hours).getByRole("button", { name: "Fortnight" }));
    expect(hours.textContent).toContain("rostered · 2 shifts");
  });

  it("shows the next leave from the roster and the next renewal from Admin at a glance", () => {
    render(
      <MyDayDashboard
        {...props({
          page: "me",
          sources: {
            ...EMPTY_SOURCES,
            roster: {
              status: "ready",
              shifts: [
                shift({ id: "lv", kind: "leave", startsAt: "2026-10-19T00:00:00Z", endsAt: "2026-10-19T09:00:00Z" }),
              ],
              sample: false,
            },
          },
          renewals: [
            { entryId: "e0", title: "Past course", date: "2026-09-21", href: "/admin/renewals?item=e0" },
            { entryId: "e1", title: "Medical registration", date: "2026-11-24", href: "/admin/renewals?item=e1" },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("my-day-glance-leave").textContent).toContain(
      "Next leaveMon 19 Oct · in 16 days · Roster",
    );
    // A passed date is not the next renewal.
    expect(screen.getByTestId("my-day-glance-renewal").textContent).toContain(
      "Medical registration · 24 Nov · in 52 days",
    );
  });

  it("draws no estimate for a CPD year that is closed", () => {
    render(
      <MyDayDashboard {...props({ page: "me", sources: { ...EMPTY_SOURCES, cpd: { ...READY_CPD, closed: true } } })} />,
    );
    const card = screen.getByTestId("my-day-card-cpd-month");
    expect(card.textContent).toContain("This CPD year is closed. The hours above are final.");
    expect(card.textContent).not.toContain("At this rate");
  });

  it("hides hours when the roster holds only on call", () => {
    render(
      <MyDayDashboard
        {...props({
          page: "me",
          sources: { ...EMPTY_SOURCES, roster: { status: "ready", shifts: [shift({ id: "oc" })], sample: false } },
        })}
      />,
    );
    expect(screen.queryByTestId("my-day-card-hours")).toBeNull();
    expect(screen.queryByTestId("my-day-card-month-glance")).toBeNull();
  });

  it("shows recorded Admin dates in the wallet, saying plainly when one has passed", () => {
    render(
      <MyDayDashboard
        {...props({
          page: "me",
          renewals: [
            { entryId: "e0", title: "Life support course", date: "2026-09-21", href: "/admin/renewals?item=e0" },
            { entryId: "e1", title: "Medical registration", date: "2026-11-24", href: "/admin/renewals?item=e1" },
          ],
        })}
      />,
    );
    const wallet = screen.getByTestId("my-day-card-credentials");
    expect(wallet.textContent).toContain("Date passed");
    expect(wallet.textContent).toContain("Recorded date");
    expect(wallet.textContent).toContain("Recorded date 24 Nov 2026");
    expect(wallet.textContent).toContain("Date passed 21 Sep 2026");
    // Dates only: no registration numbers.
    expect(wallet.textContent).toContain("No registration numbers are kept on My Day.");
  });

  it("keeps the quick note on this device only, and forgets it at an account transition", () => {
    render(<MyDayDashboard {...props({ page: "me" })} />);
    const card = screen.getByTestId("my-day-card-quick-note");
    expect(card.textContent).toContain("This device only");
    expect(card.textContent).toContain("Never write patient names or details here. Deleted when you sign out.");
    const field = screen.getByTestId("my-day-quick-note") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Ring pharmacy on Monday" } });
    expect(window.localStorage.getItem(MY_DAY_QUICK_NOTE_STORAGE_KEY)).toBe("Ring pharmacy on Monday");
    expect(field.value).toBe("Ring pharmacy on Monday");

    act(() => clearAccountScopedBrowserStorage());
    expect(window.localStorage.getItem(MY_DAY_QUICK_NOTE_STORAGE_KEY)).toBeNull();
    expect(field.value).toBe("");
  });

  it("never sends the quick note anywhere", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<MyDayDashboard {...props({ page: "me" })} />);
    fireEvent.change(screen.getByTestId("my-day-quick-note"), { target: { value: "Reminder" } });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
