/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="sign-in-dialog" /> : null),
}));
vi.mock("@/components/calendar/calendar-subscribe", () => ({
  CalendarSubscribe: () => <div data-testid="calendar-link" />,
}));
vi.mock("@/components/on-call/on-call-entry-editor", () => ({
  OnCallEntryEditor: () => null,
}));

import { LogToCpdSheet, stepCpdHours } from "@/components/teaching/log-to-cpd-sheet";
import { clashSummary, rosterClashes } from "@/components/teaching/roster-clash";
import { TeachingThisWeek } from "@/components/teaching/teaching-this-week";
import { TeachingToday } from "@/components/teaching/teaching-today";
import { countdown, heroSession, progress, todayPhase } from "@/components/teaching/today-model";

import {
  DURING,
  NB,
  NOW,
  OCC,
  TEAM_A,
  TODAY,
  json,
  serveFetch,
  session,
  useTeachingTestClock,
  week,
} from "./helpers/teaching-fixtures";

/*
 * Work-mode redesign, owner request 6 Oct 2026: Today's hero by phase, the check-in-with-code
 * sheet behind the header button, Log to CPD after a session, attendance, and Week's roster
 * clashes (ideas 12) and remembered filter.
 */

// A shared fixture, not a component hook: it only registers Vitest's `beforeEach`/`afterEach`.
// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock();

/** 13:40 in Perth: the 12:30 to 13:30 session ended ten minutes ago, so its code is still open. */
const JUST_AFTER = new Date("2026-09-30T05:40:00Z");
const SELF = { occurrenceId: OCC, method: "self" as const, recordedAt: DURING.toISOString() };

function shift(overrides: Record<string, unknown>) {
  return {
    id: "s1",
    title: "Shift",
    location: null,
    sourceUid: null,
    source: "manual",
    seriesId: null,
    workplace: null,
    kind: null,
    ...overrides,
  };
}

describe("Today's model", () => {
  it("names the phase from the server's windows", () => {
    const s = session();
    expect(todayPhase(s, NOW, TODAY)).toBe("before");
    expect(todayPhase(s, new Date("2026-09-30T04:20:00Z"), TODAY)).toBe("code");
    expect(todayPhase(s, DURING, TODAY)).toBe("on");
    expect(todayPhase(s, JUST_AFTER, TODAY)).toBe("after");
    expect(todayPhase(session({ startsAt: "2026-10-02T04:30:00Z", endsAt: "2026-10-02T05:30:00Z" }), NOW, TODAY)).toBe(
      "later",
    );
  });

  it("keeps a just-finished session in the hero for 15 minutes, but prefers one on now", () => {
    const next = session({ occurrenceId: "n", startsAt: "2026-09-30T08:00:00Z", endsAt: "2026-09-30T09:00:00Z" });
    expect(heroSession([session(), next], JUST_AFTER)?.occurrenceId).toBe(OCC);
    expect(heroSession([session(), next], new Date("2026-09-30T05:50:00Z"))?.occurrenceId).toBe("n");
    const back = session({ occurrenceId: "b", startsAt: "2026-09-30T05:30:00Z", endsAt: "2026-09-30T06:30:00Z" });
    expect(heroSession([session(), back], JUST_AFTER)?.occurrenceId).toBe("b");
  });

  it("counts down and measures progress with units joined by a non-breaking space", () => {
    expect(countdown(session(), NOW)).toMatchObject({
      figure: "40",
      label: "min",
      spoken: `Starts in 40${NB}min`,
    });
    expect(countdown(session(), new Date("2026-09-30T00:00:00Z"))).toMatchObject({ figure: "4:30", label: "to start" });
    expect(progress(session(), DURING)).toEqual({ percent: 17, left: `50${NB}min left` });
  });
});

describe("Today's hero", () => {
  it("after a session you checked in to, logs it to CPD in quarter hours and then offers a reflection", async () => {
    vi.setSystemTime(JUST_AFTER);
    const posts: unknown[] = [];
    serveFetch((url, body) => {
      if (url.startsWith("/api/teaching?view=week")) return json(200, week({ attendance: [SELF] }));
      if (url === "/api/teaching/cpd") {
        posts.push(body);
        return json(200, { entryId: "e1", created: true });
      }
      return null;
    });
    render(<TeachingToday demoMode={false} />);
    const hero = await screen.findByTestId("teaching-hero");
    expect(hero).toHaveTextContent("Finished 13:30 · self-reported");
    expect(within(hero).getByRole("link", { name: "Feedback" })).toHaveAttribute("href", "/teaching/feedback");
    fireEvent.click(within(hero).getByRole("button", { name: "Log to CPD" }));
    const sheet = await screen.findByRole("dialog", { name: "Log to CPD" });
    expect(sheet).toHaveTextContent("Your check-in");
    expect(sheet).toHaveTextContent("Self-reported");
    fireEvent.click(within(sheet).getByRole("button", { name: "A quarter hour more" }));
    fireEvent.click(within(sheet).getByRole("button", { name: `Log 1.25${NB}h to CPD` }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ occurrenceId: OCC, hours: 1.25 });
    await waitFor(() => expect(hero).toHaveTextContent("logged to CPD"));
    expect(within(hero).getByRole("link", { name: "Add reflection" })).toHaveAttribute("href", "/cme/log/e1");
    expect(within(hero).queryByRole("button", { name: "Log to CPD" })).toBeNull();
  });

  it("after a session with no check-in, offers check in without code first", async () => {
    vi.setSystemTime(JUST_AFTER);
    serveFetch((url) => (url.startsWith("/api/teaching?view=week") ? json(200, week()) : null));
    render(<TeachingToday demoMode={false} />);
    const hero = await screen.findByTestId("teaching-hero");
    expect(hero).toHaveTextContent("Finished 13:30");
    expect(within(hero).getByRole("button", { name: "Check in without code" })).toBeInTheDocument();
    expect(within(hero).getByRole("link", { name: "Check in with code" })).toBeInTheDocument();
  });

  it("opens the code sheet from the header button, and says checked in only once the server agrees", async () => {
    vi.setSystemTime(DURING);
    let marked = false;
    serveFetch((url, body) => {
      if (url === `/api/teaching/services/${TEAM_A}` && body?.action === "checkin.typed") {
        expect(body).toEqual({ action: "checkin.typed", occurrenceId: OCC, stream: "room", code: "418273" });
        marked = true;
        return json(200, { method: "code_room", recordedAt: DURING.toISOString() });
      }
      if (url.startsWith("/api/teaching?view=week"))
        return json(200, week(marked ? { attendance: [{ ...SELF, method: "code_room" }] } : {}));
      return null;
    });
    render(<TeachingToday demoMode={false} />);
    const hero = await screen.findByTestId("teaching-hero");
    fireEvent.click(screen.getByRole("button", { name: "Type a check-in code" }));
    const sheet = await screen.findByRole("dialog", { name: "Check in with code" });
    fireEvent.change(within(sheet).getByLabelText("Or type the six digits"), { target: { value: "418 273" } });
    expect(hero).not.toHaveTextContent("Checked in by code");
    fireEvent.click(within(sheet).getByRole("button", { name: "Check in" }));
    await waitFor(() => expect(hero).toHaveTextContent("Checked in by code · shown in room"));
    expect(screen.getByTestId("teaching-today-checked-in")).toHaveTextContent("Checked in.");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Type a check-in code" })).toBeNull());
  });

  it("shows attendance from the logbook, and links to it", async () => {
    serveFetch((url) => {
      if (url.startsWith("/api/teaching?view=week")) return json(200, week());
      if (url === "/api/teaching?view=logbook")
        return json(200, {
          attendance: [
            {
              ...SELF,
              title: "A",
              startsAt: "2026-09-23T04:30:00Z",
              endsAt: "2026-09-23T05:30:00Z",
              serviceName: "A",
              cpdEntryId: null,
            },
            {
              ...SELF,
              title: "B",
              startsAt: "2026-09-16T04:30:00Z",
              endsAt: "2026-09-16T05:30:00Z",
              serviceName: "A",
              cpdEntryId: null,
            },
          ],
        });
      return null;
    });
    render(<TeachingToday demoMode={false} />);
    const card = await screen.findByTestId("teaching-today-attendance");
    const link = within(card).getByRole("link");
    expect(link).toHaveAttribute("href", "/teaching/logbook");
    expect(link.textContent).toContain(`2${NB}sessions in the last 12${NB}weeks`);
    expect(link.textContent).toContain(`Checked in 2${NB}of the last 12${NB}weeks`);
  });
});

describe("Log to CPD sheet", () => {
  it("steps in quarter hours inside 0.25 to 8, and the demo saves nothing", async () => {
    expect(stepCpdHours("1", 1)).toBe("1.25");
    expect(stepCpdHours("0.25", -1)).toBe("0.25");
    expect(stepCpdHours("8", 1)).toBe("8");
    expect(stepCpdHours("", 1)).toBe("1.25");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(
      <LogToCpdSheet
        open
        onClose={vi.fn()}
        occurrenceId={OCC}
        startsAt="2026-09-30T04:30:00.000Z"
        endsAt="2026-09-30T05:30:00.000Z"
        demo
      />,
    );
    const sheet = screen.getByRole("dialog", { name: "Log to CPD" });
    fireEvent.click(within(sheet).getByRole("button", { name: `Log 1${NB}h to CPD` }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("The demo doesn't save to CPD.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Week's roster clashes", () => {
  it("tags a session in an evening, night or on-call shift, or within 10 hours after a night, but not a day shift", () => {
    const sessions = [
      session({ occurrenceId: "day" }),
      session({ occurrenceId: "night", startsAt: "2026-10-01T04:30:00Z", endsAt: "2026-10-01T05:30:00Z" }),
      session({ occurrenceId: "call", startsAt: "2026-10-02T10:30:00Z", endsAt: "2026-10-02T11:30:00Z" }),
    ];
    const shifts = [
      { title: "Day", startsAt: "2026-09-30T00:30:00Z", endsAt: "2026-09-30T09:00:00Z", kind: "day" as const },
      { title: "Night", startsAt: "2026-09-30T13:00:00Z", endsAt: "2026-09-30T23:30:00Z", kind: "night" as const },
      { title: "On call", startsAt: "2026-10-02T10:00:00Z", endsAt: "2026-10-02T23:00:00Z", kind: "on_call" as const },
    ];
    const clashes = rosterClashes(sessions, shifts);
    expect(clashes.get("day")).toBeUndefined();
    expect(clashes.get("night")).toBe("After a night");
    expect(clashes.get("call")).toBe("Rostered");
    expect(clashSummary(1)).toBe(`1${NB}session clashes with your roster`);
    expect(clashSummary(2)).toBe(`2${NB}sessions clash with your roster`);
  });

  it("tags the row and links the summary to Roster, reading the reader's own shifts", async () => {
    window.localStorage.clear();
    serveFetch((url) => {
      if (url.startsWith("/api/teaching?view=week")) return json(200, week());
      if (url === "/api/roster/shifts")
        return json(200, {
          shifts: [
            shift({ title: "Night", startsAt: "2026-09-29T13:00:00Z", endsAt: "2026-09-30T00:00:00Z", kind: "night" }),
          ],
          demoMode: false,
          sample: false,
        });
      if (url.startsWith("/api/teaching/whats-on")) return json(200, { healthServices: [], sessions: [] });
      if (url.startsWith("/api/on-call/")) return json(403, {});
      return null;
    });
    render(<TeachingThisWeek demoMode={false} />);
    const summary = await screen.findByTestId("teaching-week-clashes");
    expect(within(summary).getByRole("link")).toHaveAttribute("href", "/roster");
    expect(summary.textContent).toContain(`1${NB}session clashes with your roster`);
    expect(screen.getByTestId(`teaching-week-row-${OCC}`)).toHaveTextContent("After a night");
  });

  it("remembers Whole service while you move between pages, without writing to the device", async () => {
    window.localStorage.clear();
    const mine = session({ isPresenter: true });
    const other = session({ occurrenceId: "99999999-9999-4999-8999-999999999999", title: "Grand rounds" });
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week")
        ? json(200, week({ sessions: [mine, other] }))
        : url.startsWith("/api/teaching/whats-on")
          ? json(200, { healthServices: [], sessions: [] })
          : url.startsWith("/api/on-call/")
            ? json(403, {})
            : null,
    );
    const first = render(<TeachingThisWeek demoMode={false} />);
    await screen.findByTestId("teaching-week-list");
    expect(screen.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Whole service" }));
    first.unmount();
    render(<TeachingThisWeek demoMode={false} />);
    await screen.findByTestId("teaching-week-list");
    expect(screen.getByRole("button", { name: "Whole service" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByTestId("teaching-week-list")).getByText("Grand rounds")).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    // Put the choice back so no later test starts on Whole service.
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
  });
});
