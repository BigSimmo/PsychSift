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
  OnCallEntryEditor: ({ open, entry }: { open: boolean; entry?: { id: string } | null }) =>
    open ? <div data-testid="on-call-editor">{entry?.id ?? "new"}</div> : null,
}));

import { TeachingToday } from "@/components/teaching/teaching-today";
import { heroModel, restOfWeek, sessionRow } from "@/components/teaching/teaching-view-model";
import { TeachingWeekScreen } from "@/components/teaching/teaching-week";
import { useTeachingRoles } from "@/lib/teaching/page-visibility";

import { authState } from "./helpers/teaching-auth";
import {
  DURING,
  NB,
  NOW,
  OCC,
  TEAM_A,
  TEAM_B,
  TODAY,
  apiError,
  byId,
  fetchCalls,
  json,
  serveFetch,
  session,
  teamA,
  teamB,
  useTeachingTestClock,
  week,
} from "./helpers/teaching-fixtures";

// A shared fixture, not a component hook: it only registers Vitest's
// `beforeEach`/`afterEach` (see teaching-modules.dom.test.tsx).
// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock();

const JOURNAL = "22222222-2222-4222-8222-222222222222";
const PAST = "33333333-3333-4333-8333-333333333333";
const ENTRY = "44444444-4444-4444-8444-444444444444";
const JOIN = "https://teams.microsoft.com/l/meetup-join/1";
const journal = session({
  occurrenceId: JOURNAL,
  serviceId: TEAM_B,
  title: "Journal club",
  startsAt: "2026-10-01T09:00:00.000Z",
  endsAt: "2026-10-01T10:00:00.000Z",
  venue: "Library",
});
const context = { teams: [teamA, teamB], attendance: [], showTeam: true };
const heroInput = {
  now: NOW,
  today: TODAY,
  teams: [teamA],
  showTeam: false,
  attendance: [],
  joinUrl: JOIN,
  calendar: true,
  hadToday: true,
};

/*
 * jest-dom's `toHaveTextContent` folds every non-breaking space in the DOM to a
 * plain space before comparing, so an expected string carrying NB can never
 * match. This reads the raw text instead, which proves the NB is really there.
 */
function rawText(element: HTMLElement): string {
  return element.textContent ?? "";
}

function onCallRoutes(url: string) {
  if (url === "/api/on-call/entries?section=education") {
    return json(200, {
      signedOut: false,
      entries: [
        {
          id: ENTRY,
          section: "education",
          slug: "t",
          title: "Registrar tutorial",
          subtitle: null,
          body: null,
          details: {},
          linkedDocumentIds: [],
          tags: [],
          isPersonal: false,
          includeOnCard: false,
          sortOrder: 0,
          lastVerifiedAt: null,
          isOwn: true,
        },
      ],
    });
  }
  if (url === "/api/on-call/services") return json(200, { services: [{ id: "svc", name: "Ward 5" }] });
  if (url === "/api/on-call/services/svc") {
    const entry = (id: string, section: string, title: string) => ({
      id,
      revision: 1,
      publishedRevision: 1,
      status: "published",
      content: {},
      publishedContent: {
        siteId: null,
        section,
        kind: "operational",
        title,
        body: "",
        phone: "",
        sources: [{ label: "Timetable", url: "https://example.org/t" }],
        orientationPhase: "first_shift",
      },
      authorId: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewComment: "",
      updatedAt: "2026-09-01T00:00:00Z",
    });
    return json(200, {
      service: { id: "svc", name: "Ward 5" },
      membership: { role: "member", clinicalReviewer: false },
      sites: [],
      members: [],
      invitations: [],
      reports: [],
      orientation: [],
      entries: [entry("h1", "teaching", "Friday registrar teaching"), entry("h2", "contacts", "Switchboard")],
    });
  }
  return null;
}

describe("the view model", () => {
  it("builds a row with the service named only when there are two, and a moved row's old time (review focus 4)", () => {
    expect(sessionRow(session({ hasJoinLink: true }), context)).toMatchObject({
      href: `/teaching/session/${OCC}`,
      timeTop: "12:30",
      timeBottom: "13:30",
      meta: "Seminar room 1 · also online · Hospital A psychiatry",
    });
    const moved = session({
      status: "moved",
      startsAt: "2026-10-01T05:30:00.000Z",
      endsAt: "2026-10-01T06:30:00.000Z",
      previousStartsAt: "2026-10-01T04:30:00.000Z",
    });
    expect(sessionRow(moved, { ...context, showTeam: false })).toMatchObject({
      timeTop: "13:30",
      was: "12:30",
      meta: "Moved from 12:30 · Seminar room 1",
    });
    expect(sessionRow(session({ status: "cancelled" }), context)).toMatchObject({
      cancelled: true,
      meta: "Cancelled · Hospital A psychiatry",
    });
  });

  it("decides the hero's actions by phase, date first on a quiet day", () => {
    expect(heroModel(session({ hasJoinLink: true }), heroInput)).toMatchObject({
      eyebrowRight: `Starts in 40${NB}min`,
      figure: "12:30",
      figureEnd: "–13:30",
      meta: "Seminar room 1 · check-in opens 12:15",
    });
    expect(heroModel(session({ hasJoinLink: true }), heroInput).actions.map((a) => a.label)).toEqual([
      "Join on Teams",
      "Details",
    ]);
    const open = heroModel(session(), { ...heroInput, now: DURING });
    expect(open).toMatchObject({ eyebrowRight: "On now", live: true });
    expect(open.actions.map((a) => [a.label, a.emphasis])).toEqual([
      ["Check in with code", "primary"],
      ["Check in without code", "text"],
    ]);
    const tuesday = session({ startsAt: "2026-10-06T00:00:00.000Z", endsAt: "2026-10-06T00:45:00.000Z" });
    expect(heroModel(tuesday, { ...heroInput, hadToday: false })).toMatchObject({
      eyebrowRight: "No teaching today",
      figureDate: "Tue 6 Oct",
      figure: "08:00",
    });
    expect(heroModel(tuesday, { ...heroInput, hadToday: false }).actions.map((a) => a.label)).toEqual([
      "Details",
      "Add to calendar",
    ]);
  });

  it("offers one action, See it in Week, for a relocated On Call session", () => {
    const relocated = session({
      occurrenceId: `${ENTRY}@2026-09-30`,
      serviceId: "on-call",
      source: "on_call_relocated",
    });
    const hero = heroModel(relocated, heroInput);
    expect(hero.actions.map((a) => [a.label, a.href])).toEqual([["See it in Week", "/teaching/week"]]);
    expect(hero.meta).toBe("Seminar room 1 · From On Call");
  });

  it("sums up the rest of the week in one line", () => {
    const cancelled = session({
      occurrenceId: "c",
      status: "cancelled",
      startsAt: "2026-09-30T08:00:00.000Z",
      endsAt: "2026-09-30T08:45:00.000Z",
    });
    expect(restOfWeek([session(), journal, cancelled], OCC, NOW, TODAY)).toBe(
      `1${NB}more session · today's 16:00 is cancelled`,
    );
  });
});

describe("Today", () => {
  it("merges both services into one hero that names its service, with Join from the session read (review focus 4)", async () => {
    const fetchMock = serveFetch((url) =>
      url.startsWith("/api/teaching?view=week")
        ? json(200, week({ teams: [teamA, teamB], sessions: [session({ hasJoinLink: true }), journal] }))
        : url.startsWith("/api/teaching?view=session")
          ? json(200, {
              ...session({ hasJoinLink: true }),
              joinUrl: JOIN,
              presenterName: null,
              materials: [],
              changeReason: null,
              canShowCode: false,
              counts: null,
            })
          : null,
    );
    render(<TeachingToday demoMode={false} />);
    const hero = await screen.findByTestId("teaching-hero");
    expect(hero).toHaveTextContent("Seminar room 1 · Hospital A psychiatry · check-in opens 12:15");
    expect(await within(hero).findByRole("link", { name: /^Join on Teams/ })).toHaveAttribute("href", JOIN);
    expect(rawText(screen.getByRole("link", { name: /Rest of this week/ }))).toContain(`1${NB}more session`);
    expect(screen.queryByTestId(/^teaching-row-/)).toBeNull();
    expect(fetchCalls(fetchMock, "/api/teaching?view=week&from=2026-09-28&to=2026-10-06")).toBe(1);

    fireEvent.change(screen.getByRole("combobox", { name: "Service" }), { target: { value: TEAM_B } });
    expect(screen.getByTestId("teaching-hero")).toHaveTextContent("Journal club");
    expect(screen.getByTestId("teaching-hero")).not.toHaveTextContent("Hospital B psychiatry");
  });

  it("checks in without code while check-in is open, then says Self-reported", async () => {
    vi.setSystemTime(DURING);
    let attended = false;
    serveFetch((url, body) => {
      if (url === `/api/teaching/services/${TEAM_A}`) {
        expect(body).toEqual({ action: "attendance.self", occurrenceId: OCC });
        attended = true;
        return json(200, { occurrenceId: OCC, method: "self", recordedAt: DURING.toISOString(), serviceId: TEAM_A });
      }
      if (url.startsWith("/api/teaching?view=week")) {
        return json(
          200,
          week(
            attended ? { attendance: [{ occurrenceId: OCC, method: "self", recordedAt: DURING.toISOString() }] } : {},
          ),
        );
      }
      return null;
    });
    render(<TeachingToday demoMode={false} />);
    const hero = await screen.findByTestId("teaching-hero");
    expect(within(hero).getByRole("link", { name: "Check in with code" })).toHaveAttribute(
      "href",
      `/teaching/session/${OCC}?check-in=scan`,
    );
    fireEvent.click(within(hero).getByRole("button", { name: "Check in without code" }));
    await waitFor(() => expect(screen.getByTestId("teaching-hero")).toHaveTextContent("Self-reported"));
    expect(screen.getByTestId("teaching-today-checked-in")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("teaching-today-checked-in")).toHaveTextContent("Checked in.");
  });

  it("puts a check-in save error in an alert", async () => {
    vi.setSystemTime(DURING);
    serveFetch((url) =>
      url === `/api/teaching/services/${TEAM_A}`
        ? apiError(503, "teaching_unavailable")
        : url.startsWith("/api/teaching?view=week")
          ? json(200, week())
          : null,
    );
    render(<TeachingToday demoMode={false} />);
    const hero = await screen.findByTestId("teaching-hero");
    fireEvent.click(within(hero).getByRole("button", { name: "Check in without code" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-today-checked-in")).toBeNull();
  });

  it("counts catch-up from the whole calendar week, so a Wednesday still sees Monday's unmarked session", async () => {
    // The week read answers only for the dates it is asked about, like the server.
    const monday = session({
      occurrenceId: PAST,
      title: "Monday journal club",
      startsAt: "2026-09-28T04:30:00.000Z",
      endsAt: "2026-09-28T05:30:00.000Z",
    });
    serveFetch((url) => {
      if (!url.startsWith("/api/teaching?view=week")) return null;
      const params = new URL(url, "http://localhost").searchParams;
      const from = params.get("from") ?? "";
      const to = params.get("to") ?? "";
      const inRange = [monday, session()].filter((s) => {
        const key = s.startsAt.slice(0, 10);
        return key >= from && key <= to;
      });
      return json(200, week({ sessions: inRange }));
    });
    render(<TeachingToday demoMode={false} />);
    expect(await screen.findByTestId("teaching-hero")).toHaveTextContent("Registrar teaching");
    const needsYou = await screen.findByTestId("teaching-needs-you");
    expect(rawText(within(needsYou).getByRole("link", { name: /^Catch up on/ }))).toContain(
      `Catch up on 1${NB}session`,
    );
  });

  it("keeps Needs you on screen when there is no session ahead", async () => {
    const monday = session({
      occurrenceId: PAST,
      startsAt: "2026-09-28T04:30:00.000Z",
      endsAt: "2026-09-28T05:30:00.000Z",
    });
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week")
        ? json(200, week({ sessions: [monday] }))
        : url === "/api/teaching?view=next-session"
          ? json(200, { session: null })
          : url === "/api/teaching?view=unlogged-count"
            ? json(200, { count: 2 })
            : null,
    );
    render(<TeachingToday demoMode={false} />);
    expect(await screen.findByTestId("teaching-state-empty")).toBeInTheDocument();
    const needsYou = await screen.findByTestId("teaching-needs-you");
    expect(within(needsYou).getByRole("link", { name: /^Catch up on/ })).toHaveAttribute(
      "href",
      "/teaching/resources#catch-up",
    );
    expect(await within(needsYou).findByRole("link", { name: /^Review & log/ })).toHaveAttribute(
      "href",
      "/teaching/review",
    );
  });

  it("says the next-session read failed rather than claiming there are no sessions", async () => {
    let calls = 0;
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week")
        ? json(200, week({ sessions: [] }))
        : url === "/api/teaching?view=next-session"
          ? calls++ === 0
            ? apiError(500, "teaching_unavailable")
            : json(200, { session: null })
          : null,
    );
    render(<TeachingToday demoMode={false} />);
    expect(await screen.findByTestId("today-state-failed")).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-state-empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("teaching-state-empty")).toBeInTheDocument();
  });

  it("asks for the next session when nothing falls in the next seven days, and opens the calendar sheet", async () => {
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week")
        ? json(200, week({ sessions: [] }))
        : url === "/api/teaching?view=next-session"
          ? json(200, {
              session: session({ startsAt: "2026-10-13T00:00:00.000Z", endsAt: "2026-10-13T00:45:00.000Z" }),
            })
          : null,
    );
    render(<TeachingToday demoMode={false} />);
    const hero = await screen.findByTestId("teaching-hero");
    expect(hero).toHaveTextContent("Tue 13 Oct");
    fireEvent.click(within(hero).getByRole("button", { name: "Add to calendar" }));
    expect(await screen.findByRole("dialog", { name: "Add to my calendar" })).toContainElement(
      screen.getByTestId("calendar-link"),
    );
  });

  it("publishes the reader's roles for the pages sheet, and clears them when signed out", async () => {
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week") ? json(200, week({ teams: [{ ...teamA, role: "organiser" }] })) : null,
    );
    function Roles() {
      return <span data-testid="roles">{useTeachingRoles().join()}</span>;
    }
    const view = render(
      <>
        <Roles />
        <TeachingToday demoMode={false} />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("organiser"));
    view.unmount();

    // The API refusing a read the browser thought was signed in (the reader's status is signed out is the sample, below).
    authState.status = "authenticated";
    serveFetch((url) => (url.startsWith("/api/teaching?view=week") ? apiError(401, "teaching_signed_out") : null));
    render(
      <>
        <Roles />
        <TeachingToday demoMode={false} />
      </>,
    );
    await screen.findByTestId("teaching-state-signed-out");
    await waitFor(() => expect(screen.getByTestId("roles")).toBeEmptyDOMElement());
  });

  it("a refused read: the sign-in module, and Open the demo enters the whole-mode Teaching sample", async () => {
    authState.status = "authenticated";
    serveFetch((url) => (url.startsWith("/api/teaching?view=week") ? apiError(401, "teaching_signed_out") : null));
    render(<TeachingToday demoMode={false} />);
    const moduleEl = await screen.findByTestId("teaching-state-signed-out");
    expect(screen.queryByText("Demo · made-up people")).toBeNull();
    fireEvent.click(within(moduleEl).getByRole("button", { name: "Sign in" }));
    expect(screen.getByTestId("sign-in-dialog")).toBeInTheDocument();
    // A real link, not an in-page toggle: the sample is a cookie set by a route, so it survives moving between pages.
    expect(within(moduleEl).getByRole("link", { name: "Open the demo" })).toHaveAttribute(
      "href",
      "/teaching/sample?next=%2Fteaching",
    );
  });

  it("the sample is the same switch as demo mode: made-up people, no API call", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<TeachingToday demoMode />);
    expect(await screen.findByText("Demo · made-up people")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("demo mode never calls the API, and a loading page shows a static skeleton", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<TeachingToday demoMode />);
    expect(await screen.findByTestId("teaching-hero")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says Try again after an error, and loads on retry", async () => {
    let calls = 0;
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week")
        ? calls++ === 0
          ? apiError(500, "teaching_unavailable")
          : json(200, week())
        : null,
    );
    render(<TeachingToday demoMode={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("teaching-hero")).toHaveTextContent("Registrar teaching");
  });
});

describe("Week", () => {
  const monday = session({
    occurrenceId: PAST,
    title: "Case conference",
    startsAt: "2026-09-28T04:30:00.000Z",
    endsAt: "2026-09-28T05:30:00.000Z",
  });
  const mine = session({
    occurrenceId: "mine",
    title: "My case presentation",
    isPresenter: true,
    startsAt: "2026-09-30T06:00:00.000Z",
    endsAt: "2026-09-30T07:00:00.000Z",
  });
  const relocated = session({
    occurrenceId: `${ENTRY}@2026-10-01`,
    serviceId: "on-call",
    source: "on_call_relocated",
    title: "Registrar tutorial",
    startsAt: "2026-10-01T06:00:00.000Z",
    endsAt: "2026-10-01T07:00:00.000Z",
  });

  function serveWeek(overrides = {}) {
    return serveFetch((url, body) => {
      if (url.startsWith("/api/teaching?view=week"))
        return json(
          200,
          week({
            sessions: [monday, session(), mine, journal],
            teams: [teamA, teamB],
            relocated: [relocated],
            ...overrides,
          }),
        );
      if (url === `/api/teaching/services/${TEAM_A}`) return json(200, body ?? {});
      return onCallRoutes(url);
    });
  }

  it("groups every remaining day, labels services, and brings a past day back from the rail (review focus 4)", async () => {
    const fetchMock = serveWeek();
    render(<TeachingWeekScreen demoMode={false} />);
    const todayGroup = await screen.findByRole("region", { name: "Today · Wednesday 30 September" });
    expect(rawText(todayGroup)).toContain(`2${NB}sessions`);
    expect(screen.getByTestId(`teaching-row-${JOURNAL}`)).toHaveTextContent("Hospital B psychiatry");
    expect(screen.queryByTestId(`teaching-row-${PAST}`)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mon 28, 1 session" }));
    expect(screen.getByTestId(`teaching-row-${PAST}`)).toBeInTheDocument();
    expect(fetchCalls(fetchMock, "/api/teaching?view=week&from=2026-09-28&to=2026-10-04")).toBe(1);
  });

  it("switches to Presenting, and moves a week", async () => {
    const fetchMock = serveWeek();
    render(<TeachingWeekScreen demoMode={false} />);
    await screen.findByTestId(`teaching-row-${OCC}`);
    fireEvent.click(screen.getByRole("radio", { name: "Presenting" }));
    expect(screen.queryByTestId(`teaching-row-${OCC}`)).toBeNull();
    expect(screen.getByTestId("teaching-row-mine")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "This week" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(fetchCalls(fetchMock, "/api/teaching?view=week&from=2026-10-05&to=2026-10-11")).toBe(1));
  });

  it("moves by week with icon arrows, offers This week only away from it, and words an empty week by when it is", async () => {
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week") ? json(200, week({ sessions: [] })) : onCallRoutes(url),
    );
    render(<TeachingWeekScreen demoMode={false} />);
    expect(await screen.findByText("No more sessions this week.")).toBeInTheDocument();
    const nav = byId("teaching-week-nav");
    expect(within(nav).getByRole("button", { name: "Previous week" })).toHaveTextContent("");
    expect(within(nav).queryByRole("button", { name: "This week" })).toBeNull();
    fireEvent.click(within(nav).getByRole("button", { name: "Previous week" }));
    expect(await screen.findByText("No sessions this week.")).toBeInTheDocument();
    expect(byId("teaching-week-nav")).toHaveTextContent("Mon 21 Sep – Sun 27 Sep");
    fireEvent.click(within(byId("teaching-week-nav")).getByRole("button", { name: "This week" }));
    expect(await screen.findByText("No more sessions this week.")).toBeInTheDocument();
    expect(byId("teaching-week-nav")).toHaveTextContent("Mon 28 Sep – Sun 4 Oct");
  });

  it("keeps a visitor's added sessions instead of the no-service state", async () => {
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week")
        ? json(200, week({ teams: [], relocated: [], sessions: [session()] }))
        : onCallRoutes(url),
    );
    render(<TeachingWeekScreen demoMode={false} />);
    expect(
      await within(await waitFor(() => byId("teaching-week-list"))).findByText("Registrar teaching"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-state-no-team")).toBeNull();
  });

  it("says when the reader is not in a teaching service yet", async () => {
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week") ? json(200, week({ teams: [], sessions: [] })) : onCallRoutes(url),
    );
    render(<TeachingWeekScreen demoMode={false} />);
    expect(await screen.findByTestId("teaching-state-no-team")).toBeInTheDocument();
  });

  it("adds a service to the calendar, and says In sync once part 2 reports it", async () => {
    serveWeek({ teams: [teamA, { ...teamB, inCalendar: true }] });
    render(<TeachingWeekScreen demoMode={false} />);
    const row = await screen.findByRole("button", { name: /Add to my calendar/ });
    expect(row).toHaveTextContent("In sync");
    fireEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "Add to my calendar" });
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Hospital A psychiatry" }));
    await waitFor(() => expect(within(sheet).getByRole("checkbox", { name: "Hospital A psychiatry" })).toBeChecked());
  });

  it("opens the reader's own On Call entry in On Call's editor, and lists handbook teaching only", async () => {
    serveWeek();
    render(<TeachingWeekScreen demoMode={false} />);
    const list = await waitFor(() => byId("teaching-relocated"));
    fireEvent.click(await within(list).findByRole("button", { name: /Registrar tutorial/ }));
    expect(screen.getByTestId("on-call-editor")).toHaveTextContent(ENTRY);
    const handbook = await waitFor(() => byId("teaching-handbook"));
    expect(within(handbook).getByRole("link", { name: /Friday registrar teaching/ })).toHaveAttribute(
      "href",
      "https://example.org/t",
    );
    expect(within(handbook).queryByText("Switchboard")).toBeNull();
  });

  it("says so when the handbook read fails, but not when the reader has no On Call access", async () => {
    serveFetch((url) => {
      if (url.startsWith("/api/teaching?view=week"))
        return json(200, week({ sessions: [monday, session(), mine, journal], teams: [teamA, teamB] }));
      if (url === "/api/on-call/services") return json(500, {});
      return onCallRoutes(url);
    });
    const { unmount } = render(<TeachingWeekScreen demoMode={false} />);
    expect(await screen.findByText("Your service handbook's teaching entries couldn't load.")).toBeInTheDocument();
    unmount();
    serveFetch((url) => {
      if (url.startsWith("/api/teaching?view=week"))
        return json(200, week({ sessions: [monday, session(), mine, journal], teams: [teamA, teamB] }));
      if (url === "/api/on-call/services") return json(403, {});
      return onCallRoutes(url);
    });
    render(<TeachingWeekScreen demoMode={false} />);
    await screen.findByTestId(`teaching-row-${JOURNAL}`);
    expect(screen.queryByText("Your service handbook's teaching entries couldn't load.")).toBeNull();
  });

  it("says so when the On Call list could not load", async () => {
    serveWeek({ relocated: [], relocatedUnavailable: true });
    render(<TeachingWeekScreen demoMode={false} />);
    expect(await screen.findByText("On Call teaching list couldn't load.")).toBeInTheDocument();
  });
});
