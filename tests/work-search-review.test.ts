import { describe, expect, it } from "vitest";

import { onCallEntrySchema } from "@/lib/on-call/entry-model";
import { answerWorkQuestion, parseDateRange, type WorkAnswerInput } from "@/lib/work-search/answers";
import {
  cmeActivityWorkItems,
  entryWorkItem,
  leaveWorkItems,
  sessionWorkItems,
  shiftWorkItems,
} from "@/lib/work-search/items";
import { workSearchAreas, type WorkAreaRead } from "@/lib/work-search/model";
import { collapseSeries, searchWork, workComingUp, workSearchCorrection } from "@/lib/work-search/search";
import { looksLikePatientDetails } from "@/lib/work-search/signals";
import { singularOf, workSearchTerms } from "@/lib/work-search/terms";

// Monday 5 October 2026, Perth (UTC+8).
const today = "2026-10-05";
const at = (perthWall: string) => Date.parse(`${perthWall}+08:00`);
const ready: WorkAreaRead[] = workSearchAreas.map((area) => ({ area, status: "ready", sample: false }));

const shift = (
  id: string,
  start: string,
  end: string,
  kind: "day" | "night" | "on_call" | "leave",
  title = "Ward 4",
) => ({
  id,
  startsAt: new Date(at(start)).toISOString(),
  endsAt: new Date(at(end)).toISOString(),
  title,
  location: null,
  kind,
});

const renewal = (id: string, title: string, expiresOn: string, notForThisJob = false) =>
  entryWorkItem(
    onCallEntrySchema.parse({
      id,
      section: "logistics",
      slug: title.toLowerCase().replace(/\W+/g, "-"),
      title,
      details: {
        category: "Life support",
        kind: "compliance",
        expiresOn,
        ...(notForThisJob ? { notForThisJob: true } : {}),
      },
      isPersonal: true,
      isOwn: true,
    }),
    `/admin/renewals#${id}`,
  );

const shifts = shiftWorkItems([
  shift("d0", "2026-10-05T08:00", "2026-10-05T16:00", "day"),
  shift("n1", "2026-10-05T21:00", "2026-10-06T07:30", "night"),
  shift("n2", "2026-10-06T21:00", "2026-10-07T07:30", "night"),
  shift("c1", "2026-10-08T21:00", "2026-10-09T08:00", "on_call", "Registrar on call"),
  shift("l1", "2026-10-12T08:00", "2026-10-12T17:00", "leave", "Annual leave"),
  shift("d1", "2026-10-13T08:00", "2026-10-13T17:00", "day"),
]);

const items = [
  ...shifts,
  ...leaveWorkItems([
    { id: "lv", kind: "pd_leave", startsOn: "2026-11-09", endsOn: "2026-11-13", status: "planned", serviceId: null },
  ]),
  ...sessionWorkItems([
    {
      occurrenceId: "o1",
      serviceId: "t",
      title: "Journal club",
      startsAt: "2026-10-07T04:30:00.000Z",
      endsAt: "2026-10-07T05:30:00.000Z",
      venue: "Room 2",
      hasJoinLink: false,
      status: "scheduled",
      isPresenter: false,
      source: "teaching",
    },
  ]),
  ...cmeActivityWorkItems([
    {
      id: "cpd1",
      date: "2026-09-10",
      title: "Informed consent workshop",
      allocations: [{ category: "educational", hours: 2 }],
      reflection: "",
      costCents: null,
      transcribed: false,
      routineId: null,
      documentId: null,
      buckets: [],
    },
  ]),
  renewal("11111111-1111-4111-8111-111111111111", "Basic life support", "2026-09-30"),
  renewal("22222222-2222-4222-8222-222222222222", "Manual handling", "2026-09-01", true),
  renewal("33333333-3333-4333-8333-333333333333", "Fire safety", "2026-10-26"),
];

const input = (now: string, extra: Partial<WorkAnswerInput> = {}): WorkAnswerInput => ({
  items,
  areas: ready,
  today: now.slice(0, 10),
  now: at(now),
  cpd: null,
  ...extra,
});

const search = (query: string) => searchWork({ items, entries: [] }, query, { currentArea: null, today });

describe("next shift is never one already over, and one under way says so", () => {
  it("skips a day shift that ended earlier today", () => {
    const answer = answerWorkQuestion("when is my next shift", input("2026-10-05T18:00"));
    expect(answer?.headline).toBe("Monday 5 October");
    expect(answer?.items[0]?.id).toBe("roster:shift:n1");
  });

  it("shows a night in progress as on now, with what comes after", () => {
    const answer = answerWorkQuestion("when am I next on nights?", input("2026-10-06T02:00"));
    expect(answer).toMatchObject({ label: "On now", headline: "Until 07:30", sub: "Ward 4 · then Tue 6 Oct, 21:00" });
  });

  it("never counts a leave row in the roster as the next shift", () => {
    const answer = answerWorkQuestion("when is my next shift", input("2026-10-09T09:00"));
    expect(answer?.items.map((item) => item.id)).not.toContain("roster:shift:l1");
    expect(answer?.headline).toBe("Tuesday 13 October");
  });

  it("counts an overnight on-call shift when asked about nights", () => {
    const answer = answerWorkQuestion("next night", input("2026-10-07T09:00"));
    expect(answer?.headline).toBe("Thursday 8 October");
    expect(answer?.meta).toContain("On call overnight");
  });

  it("says how far the roster goes when there is none", () => {
    const answer = answerWorkQuestion("when am I next on evenings", input("2026-10-05T09:00"));
    expect(answer?.headline).toBe("No evenings rostered");
    expect(answer?.sub).toContain("Tue 13 Oct");
  });
});

describe("date phrases", () => {
  it("reads tomorrow, weekdays, next week and written dates", () => {
    expect(parseDateRange("tomorrow", today)).toMatchObject({ from: "2026-10-06", to: "2026-10-06" });
    expect(parseDateRange("on friday", today)).toMatchObject({ from: "2026-10-09", to: "2026-10-09" });
    expect(parseDateRange("next week", today)).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
    expect(parseDateRange("this weekend", today)).toMatchObject({ from: "2026-10-10", to: "2026-10-11" });
    expect(parseDateRange("12 oct", today)).toMatchObject({ from: "2026-10-12" });
    expect(parseDateRange("jan 4", today)).toMatchObject({ from: "2027-01-04" });
    expect(parseDateRange("journal club", today)).toBeNull();
  });

  it("answers am I working on a day, including when on leave", () => {
    expect(answerWorkQuestion("am I working tomorrow?", input("2026-10-05T09:00"))).toMatchObject({
      label: "Tuesday 6 October",
      headline: "21:00 to 07:30 Wed",
    });
    expect(answerWorkQuestion("am I working on 12 oct", input("2026-10-05T09:00"))?.headline).toBe("Not rostered");
  });

  it("counts nights and free days in a range", () => {
    expect(answerWorkQuestion("how many nights this week", input("2026-10-05T09:00"))?.headline).toBe("3 nights");
    const free = answerWorkQuestion("free days this week", input("2026-10-05T09:00"));
    expect(free?.headline).toBe("4 days with no rostered shift");
  });

  it("uses next week's window for what's due next week", () => {
    expect(answerWorkQuestion("what's due next week", input("2026-10-05T09:00"))?.understood).toContain("next 14 days");
  });

  it("does not treat a teaching question as a shift question", () => {
    expect(answerWorkQuestion("what day is my next teaching session", input("2026-10-05T09:00"))).toBeNull();
  });
});

describe("renewals", () => {
  it("never shows a renewal marked not for this job as overdue", () => {
    const answer = answerWorkQuestion("what's overdue", input("2026-10-05T09:00"));
    expect(answer?.items.map((item) => item.title)).toEqual(["Basic life support", "Fire safety"]);
  });

  it("puts overdue renewals first in Coming up", () => {
    const next = workComingUp(items, today, at("2026-10-05T18:00"), 4);
    expect(next[0]?.title).toBe("Basic life support");
    expect(next.map((item) => item.id)).not.toContain("roster:shift:d0");
  });
});

describe("sample records are never presented as yours", () => {
  it("labels the source when an area returned sample data", () => {
    const areas = ready.map((read) => (read.area === "roster" ? { ...read, sample: true } : read));
    expect(answerWorkQuestion("when is my next shift", input("2026-10-05T09:00", { areas }))?.source).toContain(
      "sample data",
    );
  });
});

describe("word forms", () => {
  it("finds plurals, shorthand, months and small typos", () => {
    expect(search("sessions").map((hit) => hit.item.title)).toContain("Journal club");
    expect(search("bls").map((hit) => hit.item.title)).toContain("Basic life support");
    expect(search("october").length).toBeGreaterThan(0);
    expect(search("jornal").map((hit) => hit.item.title)).toContain("Journal club");
    expect(search("cme").map((hit) => hit.item.title)).toContain("Informed consent workshop");
  });

  it("matches the start of words only", () => {
    expect(search("form").map((hit) => hit.item.title)).not.toContain("Informed consent workshop");
  });

  it("drops one- and two-letter words when longer ones are typed", () => {
    expect(workSearchTerms("on a night")).toHaveLength(1);
    expect(singularOf("activities")).toBe("activity");
    expect(singularOf("class")).toBeNull();
  });
});

describe("patient details", () => {
  it("flags hospital numbers, dates of birth and names, but not phone numbers or roster dates", () => {
    for (const text of ["UR 1234567", "urn12345", "bed 12", "12/03/1980", "1980-03-12", "12 March 1980", "Mr Smith"]) {
      expect(looksLikePatientDetails(text, 2026), text).toBe(true);
    }
    for (const text of ["0892241000", "9224 1000", "12/10/2026", "13 11 14", "leave form", "2026-10-12"]) {
      expect(looksLikePatientDetails(text, 2026), text).toBe(false);
    }
  });
});

describe("v12 build: honest partial answers, week strip, calendar, series and typos", () => {
  it("answers what's due from Admin when Teaching failed, and says at least", () => {
    const areas = ready.map((read) => (read.area === "teaching" ? { ...read, status: "failed" as const } : read));
    const answer = answerWorkQuestion("what's due this month?", input("2026-10-05T09:00", { areas }));
    expect(answer?.unavailable).toBeUndefined();
    expect(answer?.headline).toBe("1 overdue, at least 1 coming up");
    expect(answer?.missing).toBe("Your talks");
    expect(answer?.source).toBe("From your Admin records. Teaching couldn't be checked.");
  });

  it("still refuses to answer what's due while Admin is unread", () => {
    const areas = ready.map((read) => (read.area === "my-work" ? { ...read, status: "failed" as const } : read));
    expect(
      answerWorkQuestion("what's due this month?", input("2026-10-05T09:00", { areas }))?.unavailable,
    ).toBeTruthy();
  });

  it("names the undated renewals in the footnote, never as nothing due", () => {
    const answer = answerWorkQuestion("what's due this month?", input("2026-10-05T09:00"));
    expect(answer?.footnote).toBe("Dates are shown as you recorded them.");
    expect(answer?.headline).toBe("1 overdue, 1 coming up");
  });

  it("draws a Monday-to-Sunday strip for free days this week", () => {
    const answer = answerWorkQuestion("free days this week", input("2026-10-05T09:00"));
    expect(answer?.label).toBe("Days off this week");
    expect(answer?.week?.map((day) => day.date)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(answer?.week?.filter((day) => day.free).map((day) => day.date)).toEqual([
      "2026-10-07",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(answer?.sub).toBe("Wed 7, Fri 9, Sat 10, Sun 11");
  });

  it("offers Add to calendar for an upcoming shift, never for one under way", () => {
    expect(answerWorkQuestion("when am I next on nights?", input("2026-10-05T09:00"))?.calendar?.id).toBe(
      "roster:shift:n1",
    );
    expect(answerWorkQuestion("when am I next on nights?", input("2026-10-05T23:00"))?.calendar).toBeUndefined();
  });

  it("names the day an overnight shift ends on", () => {
    expect(shifts.find((item) => item.id === "roster:shift:n1")?.detail).toBe("Mon 5 Oct · 21:00 to 07:30 Tue");
  });

  it("shows a weekly session once with how many more there are", () => {
    const weekly = sessionWorkItems(
      ["o1", "o2", "o3"].map((id, index) => ({
        occurrenceId: id,
        serviceId: "t",
        title: "Journal club",
        startsAt: `2026-10-${String(7 + index * 7).padStart(2, "0")}T04:30:00.000Z`,
        endsAt: `2026-10-${String(7 + index * 7).padStart(2, "0")}T05:30:00.000Z`,
        venue: "Room 2",
        hasJoinLink: false,
        status: "scheduled" as const,
        isPresenter: false,
        source: "teaching" as const,
      })),
    );
    const hits = collapseSeries(searchWork({ items: weekly, entries: [] }, "journal", { currentArea: null, today }));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.item.detail).toMatch(/· \+2 more$/);
  });

  it("says which word a typo was read as, and can search exactly", () => {
    expect(workSearchCorrection(items, "jornal")).toEqual({ typed: "jornal", read: "journal" });
    expect(workSearchCorrection(items, "journal")).toBeNull();
    expect(searchWork({ items, entries: [] }, "jornal", { currentArea: null, today, exact: true })).toHaveLength(0);
  });
});
