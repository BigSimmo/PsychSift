import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { CPD_APPLICATIONS_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import {
  addReferee,
  agreedCount,
  applicationsNeedsYouItems,
  applicationsSearchRecords,
  applicationTextProblem,
  EMPTY_APPLICATIONS,
  isValidApplications,
  nextSeasonDate,
  nudgeMessage,
  outOfOrderStages,
  parseApplications,
  quietReferees,
  recordNudge,
  refereeLine,
  refereeNameProblem,
  removeReferee,
  removeSeasonDate,
  restoreReferee,
  sampleApplications,
  seasonRail,
  seasonYear,
  setRefereeStatus,
  shortDate,
  undoRefereeEdit,
  undoSeasonDate,
  updateRefereeDetails,
  upsertSeasonDate,
  type ApplicationsState,
  type SeasonDate,
} from "@/lib/cme/applications";
import { buildCv, cvPlainText, toggleHiddenLine } from "@/lib/cme/applications-cv";
import type { CmeEntry } from "@/lib/cme/types";

const today = "2026-10-06";

function date(stage: SeasonDate["stage"], on: string, remind = true): SeasonDate {
  return { stage, on, time: "", source: "", remind, addedOn: "2026-10-01" };
}

describe("patient-detail checks", () => {
  it("lets ordinary words through and catches record numbers, dates of birth, beds and titles with names", () => {
    expect(applicationTextProblem("Hospital advert")).toBeNull();
    expect(applicationTextProblem("Consultant, Ward 4 and Clinic B")).toBeNull();
    expect(applicationTextProblem("")).toBeNull();
    for (const bad of ["URN 1234567", "DOB 01/02/1980", "bed 12", "Mrs Smith", "45yo F"])
      expect(applicationTextProblem(bad), bad).not.toBeNull();
  });

  it("allows a colleague's title and name but no digits or extra details", () => {
    expect(refereeNameProblem("Dr Grant")).toBeNull();
    expect(refereeNameProblem("Mr O'Brien")).toBeNull();
    expect(refereeNameProblem("A/Prof Jane Lowe")).toBeNull();
    expect(refereeNameProblem("")).toMatchObject({ title: "Add a name" });
    expect(refereeNameProblem("Dr Grant 0412 345 678")).toMatchObject({ title: "A name has no numbers" });
    expect(refereeNameProblem("grant@example.org")).not.toBeNull();
    expect(refereeNameProblem("Dr Grant DOB")).not.toBeNull();
  });

  it("reads the part after the title with both patient-detail checks, allowing a title and surname", () => {
    // "Mr Smith" stays allowed: surgeons are Mr or Ms, and a colleague's title and surname is the field.
    for (const name of ["Dr Smith", "Mr Smith", "Ms Patel", "Dr J Smith", "Prof Jane Lowe"])
      expect(refereeNameProblem(name), name).toBeNull();
    for (const name of ["JS", "Dr J.S.", "J.S."])
      expect(refereeNameProblem(name), name).toMatchObject({ title: "This looks like a patient detail" });
  });

  it("reads a role or source with both checks, letting hospital capitals through", () => {
    expect(applicationTextProblem("Consultant, RPH")).toBeNull();
    for (const bad of ["Consultant, call 0412 345 678", "Saw J.S. on the ward", "34 y.o. male"])
      expect(applicationTextProblem(bad), bad).not.toBeNull();
  });
});

describe("season dates", () => {
  it("adds one date per stage, in stage order, and removes it", () => {
    let state = upsertSeasonDate(EMPTY_APPLICATIONS, date("interviews", "2026-11-20"));
    state = upsertSeasonDate(state, date("close", "2026-10-30"));
    state = upsertSeasonDate(state, date("close", "2026-10-31"));
    expect(state.dates.map((item) => [item.stage, item.on])).toEqual([
      ["close", "2026-10-31"],
      ["interviews", "2026-11-20"],
    ]);
    expect(removeSeasonDate(state, "close").dates).toHaveLength(1);
  });

  it("places Today before the next dated stage with a countdown, and not at all with no dates", () => {
    expect(seasonRail(EMPTY_APPLICATIONS, today).some((item) => item.kind === "today")).toBe(false);
    const state = upsertSeasonDate(
      upsertSeasonDate(EMPTY_APPLICATIONS, date("adverts", "2026-09-01")),
      date("close", "2026-10-30"),
    );
    const rail = seasonRail(state, today);
    expect(rail.map((item) => (item.kind === "today" ? "today" : item.stage))).toEqual([
      "adverts",
      "today",
      "close",
      "interviews",
      "offers",
      "start",
    ]);
    expect(rail[1]).toEqual({ kind: "today", countdown: "24 days to applications close" });
    expect(rail[0]).toMatchObject({ past: true });
  });

  it("puts Today at the end once every date has passed, and says today on the day", () => {
    const past = upsertSeasonDate(EMPTY_APPLICATIONS, date("close", "2026-09-01"));
    expect(seasonRail(past, today).at(-1)).toEqual({ kind: "today", countdown: null });
    const onTheDay = upsertSeasonDate(EMPTY_APPLICATIONS, date("close", today));
    expect(seasonRail(onTheDay, today)[1]).toEqual({ kind: "today", countdown: "Applications close today" });
  });

  it("names dates typed out of order rather than reordering them", () => {
    const state = upsertSeasonDate(
      upsertSeasonDate(EMPTY_APPLICATIONS, date("close", "2026-11-30")),
      date("interviews", "2026-11-01"),
    );
    expect(outOfOrderStages(state)).toEqual(["interviews"]);
  });

  it("reads the season year from the start date only, never guessing one", () => {
    expect(seasonYear(EMPTY_APPLICATIONS)).toBeNull();
    expect(seasonYear(upsertSeasonDate(EMPTY_APPLICATIONS, date("close", "2026-10-30")))).toBeNull();
    expect(seasonYear(upsertSeasonDate(EMPTY_APPLICATIONS, date("start", "2028-02-01")))).toBe(2028);
  });

  it("undoes one date change only", () => {
    const before = upsertSeasonDate(EMPTY_APPLICATIONS, date("close", "2026-10-30"));
    const changed = upsertSeasonDate(before, date("close", "2026-11-02"));
    const later = upsertSeasonDate(changed, date("interviews", "2026-11-20"));
    const undone = undoSeasonDate(later, "close", before.dates[0]!);
    expect(undone.dates.map((item) => [item.stage, item.on])).toEqual([
      ["close", "2026-10-30"],
      ["interviews", "2026-11-20"],
    ]);
    expect(undoSeasonDate(later, "interviews", null).dates.map((item) => item.stage)).toEqual(["close"]);
  });

  it("finds the next date for a Today card", () => {
    const state = upsertSeasonDate(EMPTY_APPLICATIONS, date("close", "2026-10-09"));
    expect(nextSeasonDate(state, today)).toMatchObject({ days: 3, date: { stage: "close" } });
    expect(nextSeasonDate(EMPTY_APPLICATIONS, today)).toBeNull();
  });
});

describe("referees", () => {
  function withGrant(): ApplicationsState {
    return addReferee(
      EMPTY_APPLICATIONS,
      { name: " Dr Grant ", role: "Consultant", status: "asked" },
      "2026-10-01",
      "r1",
    );
  }

  it("adds with a dated history, changes status once, and removes", () => {
    let state = withGrant();
    expect(state.referees[0]).toMatchObject({ name: "Dr Grant", history: [{ status: "asked", on: "2026-10-01" }] });
    state = setRefereeStatus(state, "r1", "agreed", today);
    state = setRefereeStatus(state, "r1", "agreed", today);
    expect(state.referees[0]!.history).toHaveLength(2);
    expect(agreedCount(state)).toBe(1);
    expect(refereeLine(state.referees[0]!, today)).toBe("Agreed today");
    expect(removeReferee(state, "r1").referees).toEqual([]);
  });

  it("raises a referee asked five days ago with no reply, and a nudge resets the clock", () => {
    const state = withGrant();
    expect(quietReferees(state, "2026-10-05")).toEqual([]);
    expect(quietReferees(state, today)).toMatchObject([{ days: 5 }]);
    expect(refereeLine(state.referees[0]!, today)).toBe("Asked Thu 1 Oct · no reply in 5 days");
    expect(quietReferees(recordNudge(state, "r1", today), today)).toEqual([]);
  });

  it("writes a polite nudge with no patient detail, with time words that fit", () => {
    const grant = withGrant().referees[0]!;
    // Asked 5 days ago: no time words.
    expect(nudgeMessage(grant, today)).toBe(
      "Hi Dr Grant, just checking you got my referee request. Happy to send anything that helps. Thanks.",
    );
    expect(nudgeMessage(grant, "2026-10-01")).toContain("got my referee request.");
    expect(nudgeMessage(grant, "2026-10-09")).toContain("got my referee request from last week.");
    // Two weeks on: the date it was sent.
    expect(nudgeMessage(grant, "2026-10-20")).toContain("got the referee request I sent on Thu 1 Oct.");
    expect(
      nudgeMessage({ ...grant, history: [{ kind: "status", status: "asked", on: "2026-09-20" }] }, "2026-10-07"),
    ).toBe(
      "Hi Dr Grant, just checking you got the referee request I sent on Sun 20 Sep. Happy to send anything that helps. Thanks.",
    );
  });

  it("dates a nudge from the first request, not the last nudge", () => {
    const nudged = recordNudge(withGrant(), "r1", "2026-10-25").referees[0]!;
    expect(nudgeMessage(nudged, "2026-10-26")).toContain("I sent on Thu 1 Oct");
  });

  it("undoes a referee edit without losing a nudge recorded since, and puts a removed referee back", () => {
    let state = addReferee(withGrant(), { name: "Dr Moss", role: "", status: "asked" }, "2026-10-01", "r2");
    const before = state.referees[0]!;
    state = setRefereeStatus(
      updateRefereeDetails(state, "r1", { name: "Dr Grant", role: "Head" }),
      "r1",
      "agreed",
      today,
    );
    // A nudge for another referee, and one for this one, copied before Undo.
    state = recordNudge(recordNudge(state, "r2", today), "r1", today);
    const undone = undoRefereeEdit(state, before, { kind: "status", status: "agreed", on: today });
    expect(undone.referees[0]).toMatchObject({ status: "asked", role: "Consultant" });
    expect(undone.referees[0]!.history).toEqual([
      { kind: "status", status: "asked", on: "2026-10-01" },
      { kind: "nudge", on: today },
    ]);
    expect(undone.referees[1]!.history.at(-1)).toEqual({ kind: "nudge", on: today });
    const removed = removeReferee(undone, "r1");
    expect(restoreReferee(removed, undone.referees[0]!, 0).referees.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(restoreReferee(undone, undone.referees[0]!, 0).referees).toHaveLength(2);
  });
});

describe("device record", () => {
  it("reads back empty from nothing, junk, a wrong version or duplicate stages", () => {
    expect(parseApplications(null)).toEqual(EMPTY_APPLICATIONS);
    expect(parseApplications("nope")).toEqual(EMPTY_APPLICATIONS);
    expect(parseApplications(JSON.stringify({ ...EMPTY_APPLICATIONS, version: 9 }))).toEqual(EMPTY_APPLICATIONS);
    const dup = { ...EMPTY_APPLICATIONS, dates: [date("close", "2026-10-30"), date("close", "2026-10-31")] };
    expect(isValidApplications(dup)).toBe(false);
    expect(parseApplications(JSON.stringify(dup))).toEqual(EMPTY_APPLICATIONS);
  });

  it("drops a stored field that fails today's patient-detail checks", () => {
    const stored = {
      ...EMPTY_APPLICATIONS,
      referees: [{ id: "x", name: "Mrs Smith URN 1234567", role: "", status: "asked", history: [] }],
      statement: "Looked after bed 12",
    };
    const read = parseApplications(JSON.stringify(stored));
    expect(read.referees).toEqual([]);
    expect(read.statement).toBe("");
  });

  it("round-trips the sample", () => {
    const sample = sampleApplications(today);
    expect(isValidApplications(sample)).toBe(true);
    expect(parseApplications(JSON.stringify(sample))).toEqual(sample);
  });

  it("is cleared with the other account-scoped keys", () => {
    const source = fs.readFileSync("src/lib/account-scoped-browser-state.ts", "utf8");
    const clear = source.slice(source.indexOf("export function clearAccountScopedBrowserStorage"));
    expect(clear).toContain("CPD_APPLICATIONS_STORAGE_KEY");
    expect(CPD_APPLICATIONS_STORAGE_KEY).toBe("psychsift:cpd:applications-v1");
  });
});

describe("hooks for other areas", () => {
  it("raises a reminded date from a week before, and a quiet referee", () => {
    let state = upsertSeasonDate(EMPTY_APPLICATIONS, date("close", "2026-10-07"));
    state = upsertSeasonDate(state, date("interviews", "2026-11-20"));
    state = upsertSeasonDate(state, date("offers", "2026-10-08", false));
    state = addReferee(state, { name: "Dr Grant", role: "", status: "asked" }, "2026-09-20", "r1");
    expect(applicationsNeedsYouItems(state, today)).toEqual([
      {
        id: "cpd:applications:date:close",
        title: "Applications close tomorrow",
        dueOn: "2026-10-07",
        area: "cpd",
        href: "/cme/applications",
        kind: "action",
      },
      {
        id: "cpd:applications:referee:r1",
        title: "Dr Grant has not replied in 16 days",
        dueOn: today,
        area: "cpd",
        href: "/cme/applications",
        kind: "action",
      },
    ]);
  });

  it("offers the pages, dates and referees to work search", () => {
    const state = addReferee(
      upsertSeasonDate(EMPTY_APPLICATIONS, date("close", "2026-10-30")),
      { name: "Dr Grant", role: "", status: "agreed" },
      today,
      "r1",
    );
    const titles = applicationsSearchRecords(state).map((record) => record.title);
    expect(titles).toEqual([
      "Job applications",
      "CV from your records",
      "Applications close, Fri 30 Oct",
      "Dr Grant, referee",
    ]);
  });

  it("writes short dates with the year only when it differs", () => {
    expect(shortDate("2026-10-01", today)).toBe("Thu 1 Oct");
    expect(shortDate("2027-02-01", today)).toBe("Mon 1 Feb 2027");
  });
});

function entry(id: string, entryDate: string, overrides: Partial<CmeEntry> = {}): CmeEntry {
  return {
    id,
    date: entryDate,
    title: `Activity ${id}`,
    allocations: [{ category: "educational", hours: 1 }],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
    ...overrides,
  };
}

describe("CV", () => {
  const entries = [
    entry("e1", "2026-03-01"),
    entry("e2", "2026-04-01", { title: "Clozapine audit", allocations: [{ category: "measuring", hours: 4 }] }),
    entry("e3", "2025-05-01"),
    entry("e4", "2023-05-01"),
    entry("future", "2026-12-01"),
    entry("gone", "2026-02-01", { archivedAt: "2026-02-02T00:00:00Z" }),
  ];
  const terms = [
    {
      id: "t1",
      number: 2,
      unit: "Adult inpatient",
      site: "Example Hospital",
      startsOn: "2026-08-03",
      endsOn: "2027-01-29",
    },
    { id: "t2", number: 3, unit: "Not yet", site: "", startsOn: "2027-02-01", endsOn: "2027-05-01" },
  ];
  const talks = [
    { occurrenceId: "o1", title: "Catatonia", startsAt: "2026-09-30T02:00:00.000Z" },
    { occurrenceId: "o2", title: "Booked later", startsAt: "2026-11-30T02:00:00.000Z" },
  ];

  it("builds terms, teaching given, CPD by year and outcome work, never future or archived records", () => {
    const sections = buildCv({ entries, terms, talks, statement: "", range: "two", today });
    expect(sections.map((section) => section.id)).toEqual(["terms", "teaching", "cpd"]);
    expect(sections[0]!.lines.map((line) => line.title)).toEqual(["Adult inpatient, Example Hospital"]);
    expect(sections[1]!.lines.map((line) => line.title)).toEqual(["Catatonia"]);
    expect(sections[2]!.lines.map((line) => line.title)).toEqual([
      "2026: 5 h logged, 2 activities",
      "Clozapine audit",
      "2025: 1 h logged, 1 activity",
    ]);
    expect(sections[2]!.lines[0]!.sub).toBe("Educational 1 h · Outcomes 4 h");
  });

  it("narrows to this year or widens to every year", () => {
    const year = buildCv({ entries, terms: [], talks: [], statement: "", range: "year", today });
    expect(year[0]!.lines.some((line) => line.title.startsWith("2025"))).toBe(false);
    const all = buildCv({ entries, terms: [], talks: [], statement: "", range: "all", today });
    expect(all[0]!.lines.some((line) => line.title.startsWith("2023"))).toBe(true);
  });

  it("adds the statement only in the doctor's own words, and is empty with no records", () => {
    expect(buildCv({ entries: [], terms: [], talks: [], statement: "  ", range: "all", today })).toEqual([]);
    const sections = buildCv({ entries: [], terms: [], talks: [], statement: "I like teaching.", range: "all", today });
    expect(sections).toEqual([
      {
        id: "statement",
        title: "In your own words",
        lines: [{ id: "statement", title: "I like teaching.", sub: null, source: "you" }],
      },
    ]);
  });

  it("copies plain text without hidden lines, and drops a section left empty", () => {
    const sections = buildCv({ entries, terms, talks, statement: "", range: "two", today });
    const hidden = new Set(toggleHiddenLine([], "talk:o1"));
    const { text, hiddenCount, shownCount } = cvPlainText(sections, hidden);
    expect(hiddenCount).toBe(1);
    expect(shownCount).toBe(4);
    expect(text).not.toContain("Catatonia");
    // The Teaching section had one line, so hiding it drops the heading too.
    expect(text).not.toContain("Teaching");
    expect(text).toContain("- Clozapine audit (Measuring outcomes · 2026)");
    expect(toggleHiddenLine(["talk:o1"], "talk:o1")).toEqual([]);
  });

  it("adds the registration date recorded in Admin, only while it is still to come", () => {
    const withDate = buildCv({
      entries: [],
      terms: [],
      talks: [],
      registration: { expiresOn: "2027-09-30" },
      statement: "",
      range: "two",
      today,
    });
    expect(withDate[0]).toEqual({
      id: "registration",
      title: "Registration",
      lines: [
        {
          id: "admin:registration",
          title: "Medical registration",
          sub: "Renewal date you recorded: 30 Sep 2027",
          source: "admin",
        },
      ],
    });
    // Never "current" or "valid": it is the doctor's own recorded date, not a check with the Board.
    expect(JSON.stringify(withDate)).not.toMatch(/current|valid|verified/i);
    for (const expiresOn of ["2026-01-01", "not a date"])
      expect(
        buildCv({ entries: [], terms: [], talks: [], registration: { expiresOn }, statement: "", range: "two", today }),
      ).toEqual([]);
  });

  it("counts teaching attended per year, once per session, and registrars supervised without names", () => {
    const attended = [
      { occurrenceId: "a1", startsAt: "2026-03-04T01:00:00.000Z" },
      { occurrenceId: "a1", startsAt: "2026-03-04T01:00:00.000Z" },
      { occurrenceId: "a2", startsAt: "2026-05-04T01:00:00.000Z" },
      { occurrenceId: "a3", startsAt: "2025-05-04T01:00:00.000Z" },
      { occurrenceId: "a4", startsAt: "2026-12-04T01:00:00.000Z" },
      { occurrenceId: "a5", startsAt: "2022-05-04T01:00:00.000Z" },
    ];
    const supervising = [
      { pairingId: "p1", startsOn: "2026-02-02", endsOn: "2026-08-01" },
      { pairingId: "p2", startsOn: "2025-08-04", endsOn: "2026-02-01" },
      { pairingId: "p3", startsOn: "2027-02-01", endsOn: "2027-08-01" },
    ];
    const sections = buildCv({
      entries: [],
      terms: [],
      talks,
      attended,
      supervising,
      statement: "",
      range: "two",
      today,
    });
    const teaching = sections.find((section) => section.id === "teaching")!;
    expect(teaching.lines.map((line) => [line.title, line.sub, line.source])).toEqual([
      ["Catatonia", "30 Sep 2026", "teaching"],
      ["Teaching sessions attended", "2 sessions recorded in 2026", "teaching"],
      ["Teaching sessions attended", "1 session recorded in 2025", "teaching"],
      ["Supervisor to 2 registrars", "2025 to 2026", "assessments"],
    ]);
    const thisYear = buildCv({
      entries: [],
      terms: [],
      talks: [],
      attended,
      supervising,
      statement: "",
      range: "year",
      today,
    });
    expect(thisYear[0]!.lines.map((line) => line.sub)).toEqual(["2 sessions recorded in 2026", "2026"]);
  });

  it("keeps a supervision and a term that span the whole of This year", () => {
    const sections = buildCv({
      entries: [],
      terms: [{ id: "t1", number: 3, unit: "Ward 4", site: "", startsOn: "2025-12-01", endsOn: "2027-01-31" }],
      talks: [],
      supervising: [{ pairingId: "p1", startsOn: "2025-08-01", endsOn: "2027-02-01" }],
      statement: "",
      range: "year",
      today: "2026-10-07",
    });
    expect(sections.find((section) => section.id === "terms")?.lines).toHaveLength(1);
    expect(sections.find((section) => section.id === "teaching")?.lines.map((line) => [line.title, line.sub])).toEqual([
      ["Supervisor to 1 registrar", "2026"],
    ]);
  });
});
