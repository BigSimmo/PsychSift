/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));

import {
  attendanceCsv,
  changeRisks,
  draftFor,
  expectedMemberCount,
  logbookFigures,
  sessionRisks,
} from "@/components/teaching/organise-model";
import { NeedsYou } from "@/components/teaching/teaching-needs-you";
import { TeachingLogbook } from "@/components/teaching/teaching-logbook";
import { TeachingOrganise } from "@/components/teaching/teaching-organise";
import type { LogbookRow, SeriesRow } from "@/lib/teaching/model";

import {
  NB,
  OCC,
  TEAM_A,
  TEAM_B,
  TODAY,
  detail,
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

const ORGANISE_URL = `/api/teaching/services/${TEAM_A}?action=organise.read`;
const SESSION_URL = `/api/teaching?view=session&occurrenceId=${OCC}`;
// Numbers and units are joined by a non-breaking space, which an accessible name keeps, so name
// matchers use `\s` (which matches it) rather than a plain space.
const POST_TO_3 = /^Post to 3\smembers$/;
const SERIES = "55555555-5555-4555-8555-555555555555";
const organiser = { ...teamA, role: "organiser" as const };
const members = ["u1", "u2", "u3"].map((userId, i) => ({
  userId,
  name: `Demo Dr ${"ABC"[i]}`,
  role: "doctor" as const,
  joinedAt: "2026-01-01T00:00:00Z",
}));
const groups = [{ groupId: "g1", name: "PGY2", userIds: ["u1"] }];
const organise = { series: [] as SeriesRow[], groups, members };
const seriesRow = (overrides: Partial<SeriesRow> = {}): SeriesRow => ({
  seriesId: SERIES,
  title: "Registrar teaching",
  kind: "lecture",
  groupIds: ["g1"],
  repeat: "weekly",
  firstDate: "2026-09-02",
  startTime: "12:30",
  minutes: 60,
  venue: "Seminar room 1",
  joinUrl: null,
  skipDates: [],
  endDate: "2026-12-16",
  presenterId: null,
  materials: [],
  lastConfirmedAt: null,
  audience: "registrars",
  ...overrides,
});
const row = (overrides: Partial<LogbookRow> = {}): LogbookRow => ({
  occurrenceId: OCC,
  method: "self",
  recordedAt: "2026-09-16T05:00:00Z",
  title: "Registrar teaching",
  startsAt: "2026-09-16T04:30:00.000Z",
  endsAt: "2026-09-16T05:30:00.000Z",
  serviceName: "Hospital A psychiatry",
  cpdEntryId: null,
  ...overrides,
});

describe("the models", () => {
  it("names one risk per rule: a room not confirmed, and a clash within one service", () => {
    const roomless = session({ occurrenceId: "a", venue: null, hasJoinLink: false });
    const clash = session({
      occurrenceId: "b",
      title: "Journal club",
      startsAt: "2026-09-30T05:00:00.000Z",
      endsAt: "2026-09-30T06:00:00.000Z",
    });
    const elsewhere = session({ occurrenceId: "c", serviceId: TEAM_B, startsAt: "2026-09-30T05:00:00.000Z" });
    expect(sessionRisks([roomless, elsewhere]).map((r) => [r.occurrenceId, r.text])).toEqual([
      ["a", "Room not confirmed"],
    ]);
    expect(changeRisks(session(), { ...draftFor(session()), startTime: "13:00" }, [clash])[0].text).toBe(
      "Clashes with Journal club at 13:00",
    );
  });

  it("counts this term, hours and sessions not in CPD, with a non-breaking space before units", () => {
    expect(logbookFigures([row(), row({ occurrenceId: "x", cpdEntryId: "e" })], TODAY)).toEqual([
      { id: "term", label: "This term", value: "2", unit: "sessions" },
      { id: "hours", label: "Hours", value: "2", unit: "h" },
      { id: "unlogged", label: "Not in CPD", value: "1" },
    ]);
    expect(attendanceCsv([row()])).toBe(
      `Date,Start,End,Session,Service,How,In CPD\r\n2026-09-16,12:30,13:30,Registrar teaching,Hospital A psychiatry,Self-reported,No`,
    );
  });

  it("counts the members a change reaches: the series' groups, or the whole service (R9)", () => {
    const read = { series: [seriesRow()], groups, members };
    expect(expectedMemberCount(read, SERIES)).toBe(1);
    expect(expectedMemberCount({ ...read, series: [seriesRow({ groupIds: [] })] }, SERIES)).toBe(3);
    expect(expectedMemberCount(read, null)).toBe(3);
    // A group id that names someone no longer active is not counted.
    expect(
      expectedMemberCount({ ...read, groups: [{ groupId: "g1", name: "PGY2", userIds: ["u1", "gone"] }] }, SERIES),
    ).toBe(1);
  });
});

describe("My record", () => {
  const recent = row({
    occurrenceId: "22222222-2222-4222-8222-222222222222",
    title: "Case discussion",
    startsAt: "2026-09-29T04:30:00.000Z",
    endsAt: "2026-09-29T06:00:00.000Z",
  });
  const recentLogged = row({
    occurrenceId: "33333333-3333-4333-8333-333333333333",
    cpdEntryId: "e",
    startsAt: "2026-09-28T04:30:00.000Z",
    endsAt: "2026-09-28T05:30:00.000Z",
  });
  const review = (r: LogbookRow, hours: number) => ({
    occurrenceId: r.occurrenceId,
    serviceName: r.serviceName,
    title: r.title,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    hours,
  });
  function serveRecord(
    options: {
      attendance?: LogbookRow[];
      feedback?: Response | null;
      reviewRows?: ReturnType<typeof review>[];
      refuse?: string;
    } = {},
  ) {
    const posts: Array<Record<string, unknown> | null> = [];
    const fetchMock = serveFetch((url, body) => {
      if (url === "/api/teaching?view=logbook")
        return json(200, { attendance: options.attendance ?? [row(), row({ occurrenceId: "x", cpdEntryId: "e" })] });
      if (url === "/api/teaching/depth?view=feedback-open")
        return options.feedback === undefined
          ? json(200, {
              sessions: [
                {
                  occurrenceId: OCC,
                  serviceId: TEAM_A,
                  title: "Case presentation",
                  startsAt: "2026-09-29T04:30:00.000Z",
                  endsAt: "2026-09-29T05:30:00.000Z",
                },
              ],
            })
          : options.feedback;
      if (url === "/api/teaching/depth?view=cpd-review") return json(200, { rows: options.reviewRows ?? [] });
      if (url === "/api/teaching/cpd/review" && body) {
        posts.push(body);
        const rows = body.rows as Array<{ occurrenceId: string }>;
        return json(200, {
          results: rows.map((r) =>
            options.refuse
              ? { occurrenceId: r.occurrenceId, entryId: null, code: "teaching_window_closed", message: options.refuse }
              : { occurrenceId: r.occurrenceId, entryId: "new", code: null, message: null },
          ),
        });
      }
      return null;
    });
    return { posts, fetchMock };
  }

  it("shows the 12 weeks in words, the ledger, and opens Log to CPD from an unlogged row", async () => {
    serveRecord();
    render(<TeachingLogbook demoMode={false} />);
    const chart = await screen.findByTestId("teaching-record-chart");
    // Work-mode redesign, owner request 6 Oct 2026: "Last 12 weeks" is now the section label (a string
    // prop), so it is built with withUnit and carries the non-breaking space too.
    expect(chart.textContent).toContain(`Last 12${NB}weeks · 2${NB}sessions`);
    expect(chart.textContent).toContain(`You checked in at teaching in 1${NB}of the last 12${NB}weeks.`);
    expect(within(chart).getByRole("img").getAttribute("aria-label")).toMatch(
      /^Sessions per week, 13 July to this week:/,
    );
    // Weeks before the first check-in (16 September) are not gaps.
    expect(chart).toHaveTextContent("None in the week of 21 September. This week so far: 0.");
    // Every check-in stays folded under the supervisor summary until asked for, as the mock-up ends there.
    expect(screen.queryByRole("region", { name: "September 2026" })).toBeNull();
    fireEvent.click(within(screen.getByTestId("teaching-record-ledger")).getByRole("button", { name: "Show" }));
    // jest-dom folds a real non-breaking space to a plain one, so read the raw text (U1 report).
    expect(screen.getByRole("region", { name: "September 2026" }).textContent).toContain(`2${NB}h`);
    fireEvent.click(screen.getAllByRole("button", { name: /Registrar teaching/ })[0]);
    expect(await screen.findByRole("dialog", { name: "Log to CPD" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download CSV" }).getAttribute("href")).toMatch(/^blob:|^data:text\/csv/);
  });

  it("lists feedback you owe with Give, keeping names out, and links Supervision under Presenting", async () => {
    serveRecord();
    render(<TeachingLogbook demoMode={false} />);
    const owed = await screen.findByTestId("teaching-record-feedback");
    expect(owed).toHaveTextContent("Feedback you owe · 1");
    expect(owed).toHaveTextContent("Name not shown");
    expect(within(owed).getByRole("link", { name: "Give feedback on Case presentation" })).toHaveAttribute(
      "href",
      "/teaching/feedback",
    );
    expect(screen.getByRole("link", { name: /^Registrar supervision/ })).toHaveAttribute(
      "href",
      "/teaching/supervision",
    );
  });

  it("says plainly when feedback owed did not load, instead of showing nothing owed", async () => {
    serveRecord({ feedback: json(500, { error: "nope" }) });
    render(<TeachingLogbook demoMode={false} />);
    expect(await screen.findByText(/Sessions waiting for your feedback did not load/)).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-record-feedback")).toBeNull();
  });

  it("ticks this week's sessions not in CPD and logs them in one go, with the week's hours", async () => {
    const { posts } = serveRecord({
      attendance: [recent, recentLogged, row()],
      reviewRows: [review(recent, 1.5), review(row(), 1)],
    });
    render(<TeachingLogbook demoMode={false} />);
    const cpd = await screen.findByTestId("teaching-record-cpd");
    expect(cpd.textContent).toContain(`1.5${NB}h · 1 already logged`);
    expect(within(cpd).getByRole("checkbox", { name: /Case discussion/ })).toBeChecked();
    expect(within(cpd).getByRole("link", { name: /^1\solder session not in CPD yet/ })).toHaveAttribute(
      "href",
      "/teaching/review",
    );
    fireEvent.click(within(cpd).getByRole("button", { name: /^Log 1\ssession to my CPD$/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ rows: [{ occurrenceId: "22222222-2222-4222-8222-222222222222", hours: 1.5 }] });
    expect(typeof (posts[0]!.rows as Array<{ requestId: string }>)[0].requestId).toBe("string");
  });

  it("says which sessions were not saved when the server refuses a row", async () => {
    serveRecord({
      attendance: [recent],
      reviewRows: [review(recent, 1.5)],
      refuse: "The CPD window for this session has closed",
    });
    render(<TeachingLogbook demoMode={false} />);
    const cpd = await screen.findByTestId("teaching-record-cpd");
    fireEvent.click(within(cpd).getByRole("button", { name: /^Log 1\ssession to my CPD$/ }));
    expect(await within(cpd).findByRole("alert")).toHaveTextContent(
      /^1\ssession was not saved: The CPD window for this session has closed\. Use Change hours for it\.$/,
    );
  });

  it("logs nothing when every session is unticked", async () => {
    serveRecord({ attendance: [recent], reviewRows: [review(recent, 1.5)] });
    render(<TeachingLogbook demoMode={false} />);
    const cpd = await screen.findByTestId("teaching-record-cpd");
    fireEvent.click(within(cpd).getByRole("checkbox", { name: /Case discussion/ }));
    expect(within(cpd).getByRole("button", { name: /^Log 0\ssessions to my CPD$/ })).toBeDisabled();
  });

  it("says so when there are no check-ins yet", async () => {
    serveRecord({ attendance: [] });
    render(<TeachingLogbook demoMode={false} />);
    expect(await screen.findByText("No check-ins yet. Sessions you check in to show here.")).toBeInTheDocument();
  });
});

describe("Organise", () => {
  function serveOrganise(
    teams = [organiser, teamB],
    options: { read?: typeof organise; seriesId?: string | null; sessions?: ReturnType<typeof session>[] } = {},
  ) {
    const posts: Array<{ body: Record<string, unknown> | null; init?: RequestInit }> = [];
    const fetchMock = serveFetch((url, body, init) => {
      if (url.startsWith("/api/teaching?view=week"))
        return json(200, week({ teams, sessions: options.sessions ?? [session({ venue: null })] }));
      if (url === SESSION_URL) return json(200, detail({ venue: null, seriesId: options.seriesId ?? null }));
      if (url === ORGANISE_URL) return json(200, options.read ?? organise);
      if (url === `/api/teaching/services/${TEAM_A}` && body) {
        posts.push({ body, init });
        if (body.action === "invitation.create")
          return json(200, { invitationId: "i", expiresAt: "2026-10-07T03:50:00Z", code: "JOIN-CODE-1" });
        if (body.action === "series.save") return json(200, { seriesId: SERIES, occurrences: 16 });
        return json(200, {});
      }
      return null;
    });
    return { posts, fetchMock };
  }

  it("offers only the services the reader organises, and says so when there are none (review focus 4)", async () => {
    serveOrganise([
      organiser,
      teamB,
      { ...teamB, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Hospital C", role: "admin" },
    ]);
    const { unmount } = render(<TeachingOrganise demoMode={false} />);
    const picker = await screen.findByRole("combobox", { name: "Service you organise" });
    expect(within(picker).queryByRole("option", { name: "Hospital B psychiatry" })).toBeNull();
    expect(within(picker).queryByRole("option", { name: "All services" })).toBeNull();
    expect(within(picker).getByRole("option", { name: "Hospital C" })).toBeInTheDocument();
    unmount();
    serveOrganise([teamA]);
    render(<TeachingOrganise demoMode={false} />);
    expect(await screen.findByText("Organise is for your service's organisers.")).toBeInTheDocument();
  });

  it("offers Import a timetable to organisers and admins, and in the preview-only demo", async () => {
    serveOrganise([teamA]);
    const first = render(<TeachingOrganise demoMode={false} />);
    expect(await screen.findByText("Organise is for your service's organisers.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Import a timetable/ })).toBeNull();
    first.unmount();
    serveOrganise([organiser]);
    const second = render(<TeachingOrganise demoMode={false} />);
    expect(await screen.findByRole("link", { name: /^Import a timetable/ })).toHaveAttribute(
      "href",
      "/teaching/import",
    );
    second.unmount();
    render(<TeachingOrganise demoMode />);
    expect(await screen.findByTestId("teaching-organise-demo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Import a timetable/ })).toHaveAttribute("href", "/teaching/import");
  });

  it("shows Download attendance as busy while the export is read", async () => {
    let finish: (response: Response) => void = () => {};
    serveFetch((url) => {
      if (url.startsWith("/api/teaching?view=week")) return json(200, week({ teams: [organiser] }));
      if (url === ORGANISE_URL) return json(200, organise);
      if (url.startsWith(`/api/teaching/services/${TEAM_A}?action=export.attendance`))
        return new Promise<Response>((resolve) => (finish = resolve));
      return null;
    });
    render(<TeachingOrganise demoMode={false} />);
    const download = await screen.findByRole("button", { name: /Download attendance/ });
    fireEvent.click(download);
    expect(download).toHaveAttribute("aria-busy", "true");
    expect(download).toBeDisabled();
    expect(download).toHaveTextContent("Preparing the spreadsheet…");
    await act(async () => finish(json(200, { rows: [] })));
    await waitFor(() => expect(download).not.toHaveAttribute("aria-busy"));
  });

  it("names the one risk in the next 48 hours with the one filled button, and shows the counts", async () => {
    serveOrganise([organiser]);
    render(<TeachingOrganise demoMode={false} />);
    const risky = await screen.findByTestId(`teaching-row-${OCC}`);
    expect(risky).toHaveTextContent("Today · no room set");
    expect(within(risky).getByRole("button", { name: "Set room" })).toBeInTheDocument();
    expect(screen.getByTestId("teaching-organise-soon")).toHaveTextContent(/Next 48 hours · 1 · 1 to check/);
    expect(screen.getByRole("button", { name: /^Members/ })).toHaveTextContent(/3\smembers/);
    expect(screen.getByText(/^Series · 0$/)).toBeInTheDocument();
  });

  it("posts a change only after 10 seconds, undoes inside them, and sends with keepalive", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-30T03:50:00Z"));
    const { posts } = serveOrganise([organiser]);
    render(<TeachingOrganise demoMode={false} />);
    await act(async () => vi.advanceTimersByTimeAsync(50));
    fireEvent.click(screen.getByTestId(`teaching-row-${OCC}`).querySelector("a,button")!);
    const sheet = screen.getByRole("dialog", { name: "Change this session" });
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(within(sheet).getByText("Room not confirmed")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Fix" }));
    expect(within(sheet).getByLabelText("Room")).toHaveFocus();
    fireEvent.change(within(sheet).getByLabelText("Room"), { target: { value: "Seminar room 2" } });
    expect(within(sheet).getByText("No clashes")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: POST_TO_3 }));
    expect(screen.getByTestId("teaching-organise-pending")).toHaveTextContent("Posting to 3 members");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => vi.advanceTimersByTimeAsync(11_000));
    expect(posts).toEqual([]);

    fireEvent.click(screen.getByTestId(`teaching-row-${OCC}`).querySelector("a,button")!);
    const again = screen.getByRole("dialog", { name: "Change this session" });
    fireEvent.click(within(again).getByRole("radio", { name: "Cancel" }));
    fireEvent.click(within(again).getByRole("button", { name: POST_TO_3 }));
    await act(async () => vi.advanceTimersByTimeAsync(9_000));
    expect(posts).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(posts.map((p) => [p.body, p.init?.keepalive])).toEqual([
      [{ action: "occurrence.change", occurrenceId: OCC, status: "cancelled", reason: "presenter_unavailable" }, true],
    ]);
  });

  it("cancels an unsent change when leaving inside the undo window", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-30T03:50:00Z"));
    const { posts } = serveOrganise([organiser]);
    const { unmount } = render(<TeachingOrganise demoMode={false} />);
    await act(async () => vi.advanceTimersByTimeAsync(50));
    fireEvent.click(screen.getByTestId(`teaching-row-${OCC}`).querySelector("a,button")!);
    const sheet = screen.getByRole("dialog", { name: "Change this session" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "Cancel" }));
    fireEvent.click(within(sheet).getByRole("button", { name: /Post to/ }));
    expect(posts).toEqual([]);
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(10001));
    expect(posts).toEqual([]);
  });

  it("counts only the series' groups on the post button when the session belongs to one (R9)", async () => {
    serveOrganise([organiser], { read: { ...organise, series: [seriesRow()] }, seriesId: SERIES });
    render(<TeachingOrganise demoMode={false} />);
    fireEvent.click((await screen.findByTestId(`teaching-row-${OCC}`)).querySelector("a,button")!);
    const sheet = screen.getByRole("dialog", { name: "Change this session" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "Cancel" }));
    expect(await within(sheet).findByRole("button", { name: /^Post to 1\smember$/ })).toBeInTheDocument();
  });

  it("does not offer to post a move that changes nothing", async () => {
    serveOrganise([organiser], { sessions: [session()] });
    render(<TeachingOrganise demoMode={false} />);
    fireEvent.click((await screen.findByTestId(`teaching-row-${OCC}`)).querySelector("a,button")!);
    const sheet = screen.getByRole("dialog", { name: "Change this session" });
    expect(within(sheet).getByText("No clashes")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /Post to/ })).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText("Room"), { target: { value: "Seminar room 2" } });
    expect(within(sheet).getByRole("button", { name: /Post to/ })).toBeEnabled();
  });

  it("saves a series with the audience chosen in its picker (R4)", async () => {
    const { posts } = serveOrganise([organiser], {
      read: { ...organise, series: [seriesRow({ title: "Demo grand round" })] },
    });
    render(<TeachingOrganise demoMode={false} />);
    fireEvent.click(await screen.findByRole("button", { name: /Demo grand round/ }));
    const sheet = await screen.findByRole("dialog", { name: "Edit series" });
    const audience = within(sheet).getByLabelText("Audience");
    expect(
      within(audience)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Interns", "Residents", "Registrars", "Consultants", "All doctors"]);
    expect(audience).toHaveValue("registrars");
    fireEvent.change(audience, { target: { value: "all_doctors" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save series" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toMatchObject({ action: "series.save", seriesId: SERIES, audience: "all_doctors" });
  });

  it("invites by email and shows the one-time code", async () => {
    serveOrganise([organiser]);
    render(<TeachingOrganise demoMode={false} />);
    fireEvent.click(await screen.findByRole("button", { name: /Invite/ }));
    const sheet = await screen.findByRole("dialog", { name: "Invite a member" });
    fireEvent.change(within(sheet).getByLabelText("Work email"), { target: { value: "new@health.wa.gov.au" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Create invitation" }));
    expect(await within(sheet).findByText("JOIN-CODE-1")).toBeInTheDocument();
  });

  it("filters members on the device, never asking the server", async () => {
    const { fetchMock } = serveOrganise([organiser]);
    render(<TeachingOrganise demoMode={false} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Members/ }));
    const sheet = await screen.findByRole("dialog", { name: "Members" });
    const before = fetchMock.mock.calls.length;
    fireEvent.change(within(sheet).getByLabelText("Filter members"), { target: { value: "dr b" } });
    expect(within(sheet).getByText("Demo Dr B")).toBeInTheDocument();
    expect(within(sheet).queryByText("Demo Dr A")).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(before);
  });
});

describe("Needs you", () => {
  it("offers to review unlogged sessions into CPD, and hides itself when nothing needs the reader", async () => {
    serveFetch((url) => (url === "/api/teaching?view=unlogged-count" ? json(200, { count: 2 }) : null));
    render(<NeedsYou live />);
    expect(await screen.findByRole("link", { name: /^Review & log 2\ssessions/ })).toHaveAttribute(
      "href",
      "/teaching/review",
    );
    // Work-mode redesign, owner request 6 Oct 2026: the Logbook tab is always one tap away, so
    // Needs you no longer repeats it as an "Open logbook" row.
    expect(screen.queryByRole("link", { name: /^Open logbook/ })).toBeNull();
  });

  it("renders nothing with nothing to log, and asks nothing in the demo", async () => {
    const fetchMock = serveFetch((url) =>
      url === "/api/teaching?view=unlogged-count" ? json(200, { count: 0 }) : null,
    );
    const { container, rerender } = render(<NeedsYou live />);
    await waitFor(() => expect(fetchCalls(fetchMock, "/api/teaching?view=unlogged-count")).toBe(1));
    expect(container).toBeEmptyDOMElement();
    rerender(<NeedsYou live={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
