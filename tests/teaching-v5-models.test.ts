import { describe, expect, it } from "vitest";

import {
  cpdButtonLabel,
  cpdWeek,
  recordChart,
  supervisorSummary,
  termRow,
} from "@/components/teaching/my-record-model";
import {
  feedbackSummary,
  readinessAction,
  readinessCount,
  supervisionSummary,
  talkKicker,
  upcomingTalkMeta,
} from "@/components/teaching/presenting-model";
import { examPrepRow } from "@/components/teaching/resources-model";
import { milestoneRows, overdueNote, termPanel } from "@/components/teaching/term-model";
import {
  dayHeading,
  nextForYou,
  nowPanel,
  openFromOtherServices,
  weekCountLabel,
  weekDayKeys,
  weekRow,
  weekTitle,
} from "@/components/teaching/this-week-model";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import type { SupervisionEntry, SupervisionPairingView, TeachSession } from "@/lib/teaching/depth-model";
import type { LogbookRow } from "@/lib/teaching/model";
import { sampleExamPrep, sampleTermTracker, type TermRecord } from "@/lib/teaching/term-tracker";

/* Teaching v5 (5 Oct mock-up): every count and phrase the five tabs print. Perth is UTC+8 all year. */

const NB = " ";
const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// Tuesday 6 October 2026, 12:35 in Perth.
const NOW = new Date("2026-10-06T04:35:00Z");
const TODAY = "2026-10-06";

const session = (overrides: Partial<SessionSummaryRead> = {}): SessionSummaryRead => ({
  occurrenceId: "11111111-1111-4111-8111-111111111111",
  serviceId: TEAM,
  title: "Case presentation",
  startsAt: "2026-10-06T04:30:00.000Z",
  endsAt: "2026-10-06T05:30:00.000Z",
  venue: "Seminar Room 2",
  hasJoinLink: false,
  status: "scheduled",
  isPresenter: false,
  source: "teaching",
  ...overrides,
});
const context = { teams: [], attendance: [], showTeam: false, now: NOW };

describe("This week", () => {
  it("titles the week and its days in words", () => {
    expect(weekTitle("2026-10-05", "2026-10-09")).toBe("5 to 9 October");
    expect(weekTitle("2026-09-28", "2026-10-02")).toBe("28 September to 2 October");
    expect(dayHeading(TODAY, TODAY)).toBe("Tuesday 6 · today");
    expect(dayHeading("2026-10-07", TODAY)).toBe("Wednesday 7");
  });

  it("shows the weekend only when something runs on it", () => {
    expect(weekDayKeys("2026-10-05", [session()])).toHaveLength(5);
    expect(weekDayKeys("2026-10-05", [session({ startsAt: "2026-10-10T02:00:00.000Z" })])).toHaveLength(7);
    // A cancelled Saturday session still opens the weekend, so the cancellation is seen.
    expect(
      weekDayKeys("2026-10-05", [session({ startsAt: "2026-10-10T02:00:00.000Z", status: "cancelled" })]),
    ).toHaveLength(7);
  });

  it("counts only sessions that run, and says 'at least' when a source failed", () => {
    const list = [session(), session({ occurrenceId: "b", status: "cancelled" })];
    expect(weekCountLabel(list, false)).toBe(`This week · 1${NB}session`);
    expect(weekCountLabel(list, true)).toBe(`This week · at least 1${NB}session`);
    expect(weekCountLabel([], false)).toBe("This week · nothing booked yet");
    expect(weekCountLabel([], true)).toBe("This week · none loaded");
  });

  it("builds a row's state and meta from the live session, with a missed one pointing to catch-up", () => {
    expect(weekRow(session(), context)).toMatchObject({ state: "now", time: "12:30", meta: "On now · Seminar Room 2" });
    const past = weekRow(
      session({ startsAt: "2026-10-05T04:30:00.000Z", endsAt: "2026-10-05T05:30:00.000Z" }),
      context,
    );
    // The mock-up's words: a past session with no check-in reads "missed", with Watch beside it.
    expect(past).toMatchObject({
      state: "past",
      meta: "Seminar Room 2 · missed",
      watch: "/teaching/resources#catch-up",
    });
    const moved = weekRow(
      session({
        startsAt: "2026-10-07T06:00:00.000Z",
        endsAt: "2026-10-07T07:00:00.000Z",
        status: "moved",
        previousStartsAt: "2026-10-07T04:30:00.000Z",
        venue: null,
        isPresenter: true,
      } as Partial<SessionSummaryRead>),
      context,
    );
    expect(moved).toMatchObject({ state: "moved", meta: "Moved from 12:30 · Room to confirm · you present" });
    expect(weekRow(session({ status: "cancelled" }), context).meta).toBe("Cancelled");
  });

  it("puts the running session in the panel with minutes left, else the next one with its wait", () => {
    const on = nowPanel([session()], { ...context, today: TODAY });
    expect(on).toMatchObject({ kicker: "On now · 12:30 to 13:30", live: true, elapsed: 8 });
    expect(on?.meta).toBe(`Seminar Room 2 · 55${NB}min left`);
    const later = nowPanel([session({ startsAt: "2026-10-06T06:00:00.000Z", endsAt: "2026-10-06T07:00:00.000Z" })], {
      ...context,
      today: TODAY,
    });
    expect(later?.kicker).toBe(`Next · today 14:00 · in 1${NB}h 25${NB}min`);
    expect(later?.elapsed).toBeNull();
    expect(nowPanel([session({ status: "cancelled" })], { ...context, today: TODAY })).toBeNull();
  });

  it("offers one-tap check-in only from the start, the code in the 15 minutes before, and keeps it past midnight", () => {
    const member = {
      id: TEAM,
      name: "Hospital A",
      role: "doctor" as const,
      acceptsRealData: true,
      isDemo: false,
    };
    const at = (iso: string) => ({ ...context, teams: [member], now: new Date(iso), today: TODAY });
    // 12:20 Perth: inside the check-in window, before the start. The server refuses one-tap until 12:30.
    expect(nowPanel([session()], at("2026-10-06T04:20:00Z"))).toMatchObject({ live: false, checkIn: "code" });
    // 12:00 Perth: the window has not opened.
    expect(nowPanel([session()], at("2026-10-06T04:00:00Z"))).toMatchObject({ checkIn: "not-yet", opensAt: "12:15" });
    // A session from 23:30 to 00:30 is still open for one-tap check-in at 00:10 the next day.
    const late = session({ startsAt: "2026-10-05T15:30:00.000Z", endsAt: "2026-10-05T16:30:00.000Z" });
    expect(nowPanel([late], { ...at("2026-10-05T16:10:00Z"), today: TODAY })).toMatchObject({
      live: true,
      checkIn: "open",
    });
    // A midnight session viewed at 23:50 the evening before: the code window is open, though the date differs.
    const midnight = session({ startsAt: "2026-10-06T16:00:00.000Z", endsAt: "2026-10-06T17:00:00.000Z" });
    expect(nowPanel([midnight], at("2026-10-06T15:50:00Z"))).toMatchObject({ live: false, checkIn: "code" });
    // A visitor session from another service (What's on) is never checked in from here: it opens its page.
    expect(
      nowPanel([session({ serviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })], at("2026-10-06T04:40:00Z")),
    ).toMatchObject({
      live: true,
      checkIn: "none",
    });
    // Already checked in reads as done whatever the time.
    expect(
      nowPanel([session()], {
        ...at("2026-10-06T04:40:00Z"),
        attendance: [{ occurrenceId: session().occurrenceId, method: "self", recordedAt: "2026-10-06T04:35:00Z" }],
      }),
    ).toMatchObject({ checkIn: "done", doneLabel: "You checked in" });
  });

  it("prefers your own talk for 'next for you', and counts other services' open sessions", () => {
    const yours = session({ occurrenceId: "y", startsAt: "2026-10-08T04:30:00.000Z", isPresenter: true });
    const sooner = session({ occurrenceId: "s", startsAt: "2026-10-07T04:30:00.000Z" });
    expect(nextForYou([sooner, yours], null, NOW)?.occurrenceId).toBe("y");
    expect(nextForYou([sooner], null, NOW)?.occurrenceId).toBe("s");
    expect(
      openFromOtherServices([
        { own: false, inMyWeek: false, status: "scheduled" },
        { own: false, inMyWeek: true, status: "scheduled" },
        { own: true, inMyWeek: false, status: "scheduled" },
        { own: false, inMyWeek: false, status: "cancelled" },
      ]),
    ).toBe(1);
  });
});

describe("Presenting", () => {
  const talk = (overrides: Partial<TeachSession> = {}): TeachSession => ({
    occurrenceId: "22222222-2222-4222-8222-222222222222",
    serviceId: TEAM,
    title: "Journal club",
    startsAt: "2026-10-06T06:00:00.000Z",
    endsAt: "2026-10-06T06:45:00.000Z",
    venue: null,
    status: "scheduled",
    items: ["reading_list"],
    deidConfirmedAt: null,
    ...overrides,
  });

  it("says when the next talk is, and how ready later ones are", () => {
    expect(talkKicker(talk(), NOW, TODAY)).toBe(`Your next talk · today 14:00 · in 85${NB}min`);
    expect(talkKicker(talk({ startsAt: "2026-10-12T00:00:00.000Z" }), NOW, TODAY)).toBe(
      "Your next talk · Mon 12 Oct 08:00",
    );
    expect(upcomingTalkMeta(talk({ startsAt: "2026-10-13T08:00:00.000Z" }))).toBe(
      `Tue 16:00 · 1${NB}of 4 ready · patient check open`,
    );
    expect(
      upcomingTalkMeta(talk({ startsAt: "2026-10-13T08:00:00.000Z", deidConfirmedAt: "2026-10-05T00:00:00Z" })),
    ).toBe(`Tue 16:00 · 1${NB}of 4 ready`);
    expect(upcomingTalkMeta(talk({ startsAt: "2026-10-13T09:00:00.000Z", items: [] }))).toBe("Tue 17:00 · not started");
  });

  it("makes the patient-details check the one filled button until it is done", () => {
    expect(readinessAction(talk())).toEqual({ kind: "deid", label: "I have checked: no patient details" });
    expect(readinessAction(talk({ deidConfirmedAt: "2026-10-05T00:00:00Z" }))).toEqual({
      kind: "item",
      item: "aims",
      label: "Mark aims written",
    });
    expect(
      readinessAction(
        talk({ deidConfirmedAt: "2026-10-05T00:00:00Z", items: ["reading_list", "aims", "slides_link", "room"] }),
      ),
    ).toBeNull();
  });

  it("never reads as fully ready while the patient-details check is open", () => {
    const all = ["reading_list", "aims", "slides_link", "room"] as TeachSession["items"];
    expect(readinessCount(talk({ items: all }))).toBe(`4${NB}of 4 · patient check open`);
    expect(readinessCount(talk({ items: all, deidConfirmedAt: "2026-10-05T00:00:00Z" }))).toBe(`4${NB}of 4`);
  });

  it("shows released feedback only, as counts with no names", () => {
    expect(feedbackSummary({ released: false })).toBeNull();
    const summary = feedbackSummary({
      released: true,
      replies: 9,
      useful: { 1: 0, 2: 0, 3: 1, 4: 3, 5: 5 },
      pace: { slow: 1, right: 7, fast: 1 },
    });
    expect(summary).toMatchObject({
      answers: "9 answers",
      paceLine: "Pace: too slow 1 · about right 7 · too fast 1",
      usefulness: "4.4",
    });
  });

  it("sums your own supervision against your own targets, and counts what waits for you to confirm", () => {
    const entry = (date: string, minutes: number, status: "pending" | "confirmed") =>
      ({ entryId: `e-${date}`, date, minutes, status, notes: [] }) as unknown as SupervisionEntry;
    const pairing = (overrides: Partial<SupervisionPairingView>): SupervisionPairingView =>
      ({
        pairingId: "p",
        access: "registrar",
        registrarName: "Me",
        supervisorName: "Dr Example",
        startsOn: "2026-08-31",
        endsOn: "2026-11-06",
        targetHours: 10,
        confirmedMinutes: 360,
        pendingMinutes: 60,
        pendingCount: 1,
        oldestPendingAt: null,
        entries: [entry("2026-09-28", 60, "confirmed"), entry("2026-10-05", 60, "pending")],
        serviceId: TEAM,
        serviceName: "Hospital A",
        readOnlyUntil: null,
        ...overrides,
      }) as SupervisionPairingView;
    const summary = supervisionSummary([
      pairing({}),
      pairing({ access: "supervisor", pendingCount: 2, entries: null }),
    ]);
    expect(summary.mine).toEqual({
      confirmed: `6${NB}h`,
      targetLine: `of your 10${NB}h target`,
      toGo: `4${NB}h to go`,
      percent: 60,
    });
    expect(summary.entries.map((e) => e.meta)).toEqual([
      `5 Oct · 60${NB}min · waiting for your supervisor to confirm`,
      `28 Sep · 60${NB}min · confirmed`,
    ]);
    expect(summary.toConfirm).toBe(2);
    // With rows loaded, a correction to an already-confirmed entry waits too (pendingCount leaves it out).
    const corrected = {
      ...entry("2026-09-21", 60, "confirmed"),
      notes: [
        { noteId: "n", reason: "minutes", correctedValue: {}, createdAt: "2026-09-22T00:00:00Z", confirmedAt: null },
      ],
    } as unknown as SupervisionEntry;
    expect(
      supervisionSummary([pairing({ access: "supervisor", pendingCount: 0, entries: [{ ...corrected }] })]).toConfirm,
    ).toBe(1);
    expect(supervisionSummary([pairing({ targetHours: null })]).mine?.targetLine).toBeNull();
    // Hours with an untargeted supervisor do not fill another supervisor's target.
    expect(
      supervisionSummary([pairing({}), pairing({ pairingId: "q", targetHours: null, confirmedMinutes: 600 })]).mine,
    ).toEqual({
      confirmed: `16${NB}h`,
      targetLine: `6${NB}h${NB}of your 10${NB}h target`,
      toGo: `4${NB}h to go`,
      percent: 60,
    });
  });
});

describe("My record", () => {
  const row = (startsAt: string, overrides: Partial<LogbookRow> = {}): LogbookRow => ({
    occurrenceId: startsAt,
    method: "self",
    recordedAt: startsAt,
    title: "Registrar teaching",
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 90 * 60_000).toISOString(),
    serviceName: "Hospital A",
    cpdEntryId: null,
    ...overrides,
  });

  it("says how many of the last 12 weeks had a check-in, names a single gap, and averages full weeks", () => {
    // One check-in every week from 20 July except the week of 7 September, plus one this week.
    const weeks = Array.from(
      { length: 12 },
      (_, i) => new Date(Date.parse("2026-07-21T04:30:00Z") + i * 7 * 86_400_000),
    );
    const rows = weeks.filter((d) => !d.toISOString().startsWith("2026-09-08")).map((d) => row(d.toISOString()));
    const chart = recordChart(rows, TODAY);
    expect(chart.total).toBe(11);
    expect(chart.headline).toBe(`You checked in at teaching in 11${NB}of the last 12${NB}weeks.`);
    expect(chart.gapLine).toBe("None in the week of 7 September. This week so far: 1.");
    expect(chart.axis).toEqual(["20 Jul", "31 Aug", "This week"]);
    expect(chart.averageLabel).toBe("average 0.9 a week");
    expect(recordChart([], TODAY)).toMatchObject({
      headline: `No teaching check-ins in the last 12${NB}weeks.`,
      average: null,
      gapLine: "This week so far: 0.",
    });
    // A new starter: weeks before the first check-in are neither gaps nor part of the average.
    const starter = recordChart([row("2026-09-22T04:30:00.000Z"), row("2026-09-23T04:30:00.000Z")], TODAY);
    expect(starter.gapLine).toBe("None in the week of 28 September. This week so far: 0.");
    expect(starter.averageLabel).toBe("average 1.0 a week");
    expect(starter.description).toMatch(/Average 1\.0 a week over 2\u00a0full weeks\.$/);
  });

  it("keeps CPD this week to the last seven days, with hours, what is already in, and older ones counted", () => {
    const recent = row("2026-10-05T04:30:00.000Z");
    const old = row("2026-09-10T04:30:00.000Z");
    const logged = row("2026-10-06T01:30:00.000Z", { cpdEntryId: "e" });
    // Last Thursday is inside the seven days, as the mock-up's Tuesday still offers last Wednesday to Friday.
    const lastWeek = row("2026-10-01T04:30:00.000Z");
    // Eight days back is not.
    const tooOld = row("2026-09-28T04:30:00.000Z");
    const review = [recent, old, lastWeek, tooOld].map((r) => ({ ...r, hours: 1.5 }));
    const week = cpdWeek(review, [recent, old, lastWeek, tooOld, logged], NOW);
    expect(week.rows.map((r) => [r.occurrenceId, r.meta])).toEqual([
      [lastWeek.occurrenceId, "Thu 1 Oct"],
      [recent.occurrenceId, "Mon 5 Oct"],
    ]);
    expect(week.right).toBe(`3${NB}h · 1 already logged`);
    expect(week.older).toBe(2);
    expect(cpdButtonLabel(3)).toBe(`Log 3${NB}sessions to my CPD`);
    expect(cpdButtonLabel(1)).toBe(`Log 1${NB}session to my CPD`);
  });

  it("summarises attendance for the supervisor within the term, counts only", () => {
    const term = sampleTermTracker(TODAY).terms[0];
    const inside = row("2026-09-16T04:30:00.000Z");
    const before = row("2026-07-01T04:30:00.000Z");
    expect(supervisorSummary([inside, before], term, TODAY)).toEqual({
      title: "Term 4 attendance summary",
      meta: `1${NB}session · 1.5${NB}h`,
      rows: [inside],
    });
    expect(supervisorSummary([], null, TODAY)).toEqual({
      title: `Attendance summary, last 12${NB}weeks`,
      meta: "No check-ins in this span yet",
      rows: [],
    });
    // A term with no number still reads as this term's summary.
    expect(supervisorSummary([inside], { ...term, number: null }, TODAY).title).toBe("This term's attendance summary");
  });

  it("names the term row from the doctor's own term, or offers to set one up", () => {
    expect(termRow(sampleTermTracker(TODAY), TODAY)).toEqual({
      title: `Term 4 · week 6${NB}of 10`,
      meta: `Mid-term due Thu 15 Oct · 7${NB}EPAs logged this year`,
    });
    expect(termRow({ ...sampleTermTracker(TODAY), currentTermId: null }, TODAY).title).toBe("Track your term");
    // A milestone past its due date says so, rather than "due" a date already gone.
    const state = sampleTermTracker(TODAY);
    const [first] = state.terms;
    const late = {
      ...state,
      terms: [{ ...first, milestones: { ...first.milestones, mid: { dueOn: "2026-10-01", doneOn: null } } }],
    };
    expect(termRow(late, TODAY).meta).toMatch(/^Mid-term overdue · was due Thu 1 Oct · /);
    const allDone = {
      ...state,
      terms: [
        {
          ...first,
          milestones: {
            start: { ...first.milestones.start, doneOn: "2026-09-01" },
            mid: { ...first.milestones.mid, doneOn: "2026-09-20" },
            end: { ...first.milestones.end, doneOn: "2026-10-02" },
          },
        },
      ],
    };
    expect(termRow(allDone, TODAY).meta).toMatch(/^All three marked done · /);
  });
});

describe("Term", () => {
  const term = (): TermRecord => sampleTermTracker(TODAY).terms[0];

  it("shows the week, the dates and the next assessment in days", () => {
    expect(termPanel(term(), TODAY)).toMatchObject({
      kicker: "Term 4 · Psychiatry · Example Hospital",
      heading: `Week 6${NB}of 10`,
      meta: "31 Aug to 6 Nov · mid-term due in 9 days",
      total: 10,
    });
    expect(termPanel(term(), TODAY).weeks.slice(4, 7)).toEqual(["done", "now", "later"]);
  });

  it("moves an overdue assessment to the top with one plain warning, and looks forward in the panel", () => {
    const later = "2026-10-19";
    const rows = milestoneRows(term(), later);
    expect(rows.map((r) => [r.title, r.meta, r.action])).toEqual([
      ["Mid-term", "Overdue · was due Thu 15 Oct", "mark"],
      ["Beginning of term", "Marked done Wed 2 Sep", "undo"],
      ["End of term", "Due Fri 6 Nov", null],
    ]);
    expect(overdueNote(term(), later)).toBe("Mid-term was due Thu 15 Oct and is not marked done.");
    expect(termPanel(term(), later).meta).toBe("31 Aug to 6 Nov · end of term in 18 days");
    expect(overdueNote(term(), TODAY)).toBeNull();
  });
});

describe("Resources: My exam prep row", () => {
  it("counts down to the doctor's own exam date, with the plan week and the run", () => {
    expect(examPrepRow(sampleExamPrep(TODAY), TODAY)).toEqual({
      title: "Written exam in 111 days",
      meta: `Study plan week 6${NB}of 22 · 9 days in a row`,
    });
    expect(examPrepRow(null, TODAY).title).toBe("My exam prep");
    const passed = {
      ...sampleExamPrep(TODAY),
      exam: { name: "Written exam", on: "2026-10-01", planStartsOn: "2026-05-01" },
    };
    expect(examPrepRow(passed, TODAY).meta).toBe("Written exam has passed · set your next exam");
  });
});
