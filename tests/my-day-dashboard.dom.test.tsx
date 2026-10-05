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
    expect(links).toEqual([
      ["Log a callnote it for handover", "/on-call/call?from=my-day#on-call-call-log-heading"],
      ["Log CPDadd hours", "/cme/new?from=my-day"],
      ["Who's onteam now", "/on-call/whos-on?from=my-day"],
      ["Rosteryour shifts", "/roster?from=my-day"],
      ["Teachingthis week", "/teaching/week?from=my-day"],
    ]);
    expect(within(card).getByRole("list", { name: "Quick actions" })).toBeTruthy();
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
    expect(card.textContent).toContain("in 1 h 20 min");
    expect(card.textContent).toContain("Up next, in 1 hour 20 minutes: Registrar teaching: agitation at 14:00.");
    expect(card.textContent).toContain("Registrar teaching: agitation");
    expect(card.textContent).toContain("You're presenting · Seminar room 3");
    // The day ribbon marks now and the session.
    expect(within(card).getByTestId("my-day-ribbon-now")).toBeTruthy();
    expect(screen.getByTestId("my-day-up-next-open").getAttribute("href")).toBe("/teaching/session/occ-1?from=my-day");
    // No shift ahead: the hero shows only Up next, with no ring.
    expect(screen.queryByTestId("my-day-shift")).toBeNull();
    // Teaching alone gives today's agenda, so This week shows even without a roster.
    expect(screen.getByTestId("my-day-agenda").textContent).toContain("14:00");
    expect(screen.getByTestId("my-day-week").querySelector("[data-kind]")).toBeNull();
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
  it("builds the hero's shift ring and This week from the roster, showing the shift once", () => {
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
    expect(within(hero).getByTestId("my-day-shift-ring")).toBeTruthy();
    expect(hero.textContent).toContain("4:20");
    expect(hero.textContent).toContain("4 hours 20 minutes until your on call starts");
    expect(hero.textContent).toContain("Tonight");
    expect(hero.textContent).toContain("On call 17:00 to 08:30");
    expect(hero.textContent).toContain("Demo hospital");
    expect(within(hero).getByTestId("my-day-shift").getAttribute("href")).toBe("/roster?from=my-day");
    // The only thing today is that shift, so there is no separate Up next line repeating it.
    expect(screen.queryByTestId("my-day-up-next")).toBeNull();
    const week = screen.getByTestId("my-day-week");
    const today = week.querySelector('[aria-current="date"]')!;
    expect(today.getAttribute("aria-label")).toBe("Sat 3 Oct: On call");
    expect(today.querySelector('[data-kind="on-call"]')?.textContent).toBe("OC");
    expect(week.querySelectorAll('[data-kind="off"]')).toHaveLength(6);
    expect(week.textContent).not.toContain("–");
    expect(week.querySelector('[aria-label="Mon 28 Sep: Off"]')).toBeTruthy();
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
    expect(card.textContent).toContain("On now");
    expect(card.textContent).toContain("Day shift on now, 4 hours 20 minutes left, until 17:00.");
    // A shift already running is the ring's, not an Up next line's.
    expect(screen.queryByTestId("my-day-up-next")).toBeNull();
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

  it("shows CPD hours by type against target, and recorded dates on the renewals runway", () => {
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
    expect(cpd.textContent).toContain("32 / 50 h");
    expect(cpd.textContent).toContain("Educational14 h");
    expect(cpd.textContent).toContain("Performance9 h");
    expect(cpd.textContent).toContain("Outcomes9 h");
    expect(cpd.textContent).toContain("To go by 31 Dec18 h");
    expect(screen.getByTestId("my-day-cpd").getAttribute("href")).toBe("/cme?from=my-day");
    expect(screen.getByTestId("my-day-cpd-rings").querySelectorAll("circle").length).toBeGreaterThanOrEqual(3);
    const runway = screen.getByTestId("my-day-runway");
    const dots = within(runway).getAllByRole("link");
    expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual([
      "Life support course: date has passed, Mon 21 Sep",
      "Medical registration: recorded date, Tue 24 Nov",
    ]);
    expect(dots[1]!.getAttribute("href")).toBe("/admin/renewals?item=e1&from=my-day");
    // The nearest renewal leads, with its own action to the same place.
    const lead = screen.getByTestId("my-day-runway-lead");
    expect(lead.textContent).toContain("Life support course");
    expect(lead.textContent).toContain("Date passed · 21 Sep");
    expect(screen.getByTestId("my-day-runway-lead-action").getAttribute("href")).toBe(
      "/admin/renewals?item=e0&from=my-day",
    );
    // Amber marks only a date that has passed.
    expect(runway.querySelectorAll("[data-passed]")).toHaveLength(1);
  });

  it("says which card reads failed instead of silently showing nothing", () => {
    render(
      <MyDayDashboard
        {...props({
          sources: {
            ...EMPTY_SOURCES,
            roster: { status: "failed", shifts: [], sample: false },
            cpd: { ...EMPTY_SOURCES.cpd, status: "failed" },
          },
        })}
      />,
    );
    expect(screen.getByTestId("my-day-card-failed").textContent).toBe(
      "Couldn't load Shifts and CPD hours, so those cards are not shown.",
    );
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
    fireEvent.click(within(card).getByRole("button", { name: "All 5" }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it("moves a row to tomorrow on this device with Later, and Undo brings it back", () => {
    render(<MyDayDashboard {...props({ items: five })} />);
    fireEvent.click(screen.getByRole("button", { name: "Later: Title a" }));
    expect(screen.queryByTestId("my-day-item-a")).toBeNull();
    // The next row moves up so the card still shows three.
    expect(screen.getByTestId("my-day-item-d")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Moved to tomorrow: Title a");
    expect(JSON.parse(window.localStorage.getItem(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY)!)).toEqual({ a: "2026-10-04" });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();
    expect(window.localStorage.getItem(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY)).toBeNull();
  });

  it("shows a moved row again from the day it comes back", () => {
    window.localStorage.setItem(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY, JSON.stringify({ a: "2026-10-04" }));
    render(<MyDayDashboard {...props({ items: [item("a", "overdue")] })} />);
    expect(screen.queryByTestId("my-day-item-a")).toBeNull();
    expect(screen.getByTestId("my-day-needs-you-snoozed").textContent).toContain("1 moved to tomorrow");
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
describe("Today's agenda", () => {
  it("keeps upcoming lines when the morning's finished lines would fill the cap", () => {
    const morning = Array.from({ length: 6 }, (_, index) =>
      item(`m${index}`, "soon", { due: `2026-10-03T0${index}:00:00Z`, title: `Morning ${index}` }),
    );
    const afternoon = item("pm", "soon", { due: "2026-10-03T07:00:00Z", title: "Afternoon task" });
    render(<MyDayDashboard {...props({ items: [...morning, afternoon] })} />);
    const agenda = screen.getByTestId("my-day-agenda");
    expect(agenda.textContent).toContain("Afternoon task");
    expect(within(agenda).getAllByRole("listitem")).toHaveLength(6);
  });
});

// Design review v13, owner-approved concept D: the flag is the one most
// important real item, overdue first, with its one action.
describe("The flag", () => {
  it("leads with the overdue item, gives its one action with the way back, and steps with the dots", () => {
    const items = [
      item("soon", "soon", { title: "Soon thing" }),
      item("cpd", "overdue", { mode: "cme", title: "Demo journal club", href: "/cme/entry/1" }),
      item("adm", "overdue", { title: "Medical registration" }),
    ];
    render(<MyDayDashboard {...props({ items })} />);
    const flag = screen.getByTestId("my-day-card-flag");
    expect(within(flag).getByTestId("my-day-flag").textContent).toContain("Demo journal club");
    const action = within(flag).getByTestId("my-day-flag-action");
    expect(action.textContent).toBe("Log");
    expect(action.getAttribute("href")).toBe("/cme/entry/1?from=my-day");
    const dots = within(flag).getAllByRole("button", { name: /^Show flag / });
    expect(dots).toHaveLength(3);
    expect(dots[0]!.getAttribute("aria-current")).toBe("true");
    fireEvent.click(dots[1]!);
    expect(within(flag).getByTestId("my-day-flag").textContent).toContain("Medical registration");
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
    expect(card.textContent).toContain("2calls");
    expect(card.textContent).toContain("1open");
    expect(card.textContent).toContain("On this device");
    // Tonight's on call ends 08:30 Sunday: that is the handover.
    expect(card.textContent).toMatch(/08:30.*handover/);
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
    expect(team.textContent).toContain("till 21:00");
    const talk = screen.getByTestId("my-day-card-next-talk");
    expect(talk.textContent).toContain("Lithium toxicity");
    expect(within(talk).getByRole("link").getAttribute("href")).toBe("/teaching/session/talk?from=my-day");
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
    fireEvent.click(within(hours).getByRole("button", { name: "Fortnight" }));
    expect(hours.textContent).toContain("this fortnight");
    expect(screen.getByTestId("my-day-card-month-glance")).toBeTruthy();
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
    expect(wallet.textContent).toContain("to 24 Nov 2026");
  });

  it("keeps the quick note on this device only, and forgets it at an account transition", () => {
    render(<MyDayDashboard {...props({ page: "me" })} />);
    const card = screen.getByTestId("my-day-card-quick-note");
    expect(card.textContent).toContain("On this device only");
    expect(card.textContent).toContain("No patient names or details here.");
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
