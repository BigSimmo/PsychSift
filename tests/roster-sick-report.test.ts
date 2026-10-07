import { describe, expect, it } from "vitest";

import {
  ROSTER_FEATURE_SEARCH_RECORDS,
  isShortNotice,
  managerWord,
  myReports,
  personalOnlyShifts,
  reportFor,
  sickButtonLabel,
  sickCandidates,
  sickDayWord,
  sickDefaultPick,
  sickErrorWords,
  sickMessage,
  sickNeedsYouItems,
  sickPageTitle,
  sickPhase,
  sickShiftTitle,
  sickTimeline,
  sickTimes,
  sickWindow,
  startsInWords,
} from "@/lib/roster/sick/sick-report";
import type { RosterAssignment, RosterOpenShift } from "@/lib/roster/team/model";

// Tue 6 Oct 2026, 19:30 in Perth (UTC+8).
const NOW = new Date("2026-10-06T11:30:00Z");
// Wed 7 Oct 2026, 00:30 in Perth.
const AFTER_MIDNIGHT = new Date("2026-10-06T16:30:00Z");
const ME = "5e000000-0000-4000-8000-000000000001";
const OTHER = "5e000000-0000-4000-8000-000000000002";
const TEAM = { serviceId: "5e000000-0000-4000-8000-000000000003", name: "Ward 4" };

function row(id: number, startsAt: string, endsAt: string, extra: Partial<RosterAssignment> = {}): RosterAssignment {
  return {
    id: `5e000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    userId: ME,
    name: "Me",
    grade: "registrar",
    siteId: null,
    siteName: "Example Hospital",
    startsAt,
    endsAt,
    shiftCode: "D",
    kind: "day",
    ...extra,
  };
}

const tomorrowDay = row(10, "2026-10-07T00:00:00Z", "2026-10-07T08:30:00Z"); // Wed 08:00 to 16:30
const tonightCall = row(11, "2026-10-06T13:00:00Z", "2026-10-07T00:00:00Z", { kind: "on_call", shiftCode: "OC" }); // 21:00
const startedAlready = row(12, "2026-10-06T10:00:00Z", "2026-10-06T14:00:00Z");
const dayAfter = row(13, "2026-10-08T00:00:00Z", "2026-10-08T08:30:00Z");
const leave = row(14, "2026-10-07T00:00:00Z", "2026-10-07T08:00:00Z", { kind: "leave", shiftCode: "AL" });
const colleague = row(15, "2026-10-07T00:00:00Z", "2026-10-07T08:30:00Z", { userId: OTHER });

function open(extra: Partial<RosterOpenShift>): RosterOpenShift {
  return {
    id: "5e000000-0000-4000-8000-0000000000f1",
    status: "reported",
    urgent: true,
    startsAt: tomorrowDay.startsAt,
    endsAt: tomorrowDay.endsAt,
    shiftCode: "D",
    kind: "day",
    minGrade: null,
    siteId: null,
    mine: true,
    claimedByMe: false,
    ...extra,
  };
}

describe("sick window and candidates", () => {
  it("covers today and tomorrow in Perth", () => {
    expect(sickWindow(NOW)).toEqual({ from: "2026-10-06", to: "2026-10-07" });
    // 23:30 Perth is still the 6th; the window does not slip a day at UTC midnight.
    expect(sickWindow(new Date("2026-10-06T15:30:00Z"))).toEqual({ from: "2026-10-06", to: "2026-10-07" });
  });

  it("keeps my working shifts that have not started, today and tomorrow only, in start order", () => {
    const picked = sickCandidates(
      [{ team: TEAM, assignments: [tomorrowDay, tonightCall, startedAlready, dayAfter, leave, colleague] }],
      ME,
      NOW,
    );
    expect(picked.map((shift) => shift.assignmentId)).toEqual([tonightCall.id, tomorrowDay.id]);
    expect(picked[0]).toMatchObject({ serviceId: TEAM.serviceId, teamName: "Ward 4", kind: "on_call" });
  });

  it("lists own-roster shifts not on a team roster, never twice", () => {
    const own = [
      { id: "a", startsAt: tomorrowDay.startsAt, endsAt: tomorrowDay.endsAt, title: "Day", workplace: null },
      {
        id: "b",
        startsAt: "2026-10-07T10:00:00Z",
        endsAt: "2026-10-07T14:00:00Z",
        title: "Clinic",
        workplace: "Rooms",
      },
      { id: "c", startsAt: "2026-10-09T00:00:00Z", endsAt: "2026-10-09T08:00:00Z", title: "Later", workplace: null },
    ];
    expect(personalOnlyShifts(own, [tomorrowDay], NOW).map((shift) => shift.id)).toEqual(["b"]);
  });
});

describe("words", () => {
  it("names the day: Today, Tonight from 17:00, else weekday and date", () => {
    expect(sickDayWord("2026-10-06T12:00:00Z", NOW)).toBe("Tonight");
    expect(sickDayWord("2026-10-06T08:00:00Z", NOW)).toBe("Today");
    expect(sickDayWord(tomorrowDay.startsAt, NOW)).toBe("Wed 7");
    expect(sickShiftTitle(tonightCall, NOW)).toBe("Tonight · On call");
  });

  it("writes times in plain words, with the next day named", () => {
    expect(sickTimes(tomorrowDay)).toBe("08:00 to 16:30");
    expect(sickTimes(tonightCall)).toBe("21:00 to Wed 08:00");
  });

  it("counts down without going negative", () => {
    expect(startsInWords("2026-10-06T13:10:00Z", NOW)).toBe("1 h 40");
    expect(startsInWords("2026-10-06T12:15:00Z", NOW)).toBe("45 min");
    expect(startsInWords("2026-10-06T14:30:00Z", NOW)).toBe("3 h");
    expect(startsInWords("2026-10-06T10:00:00Z", NOW)).toBe("0 min");
  });

  it("flags short notice under four hours", () => {
    expect(isShortNotice(tonightCall.startsAt, NOW)).toBe(true);
    expect(isShortNotice(tomorrowDay.startsAt, NOW)).toBe(false);
  });

  it("flags a same-day shift as short notice too, such as 08:00 seen at 00:30", () => {
    expect(isShortNotice(tomorrowDay.startsAt, AFTER_MIDNIGHT)).toBe(true);
    expect(isShortNotice(dayAfter.startsAt, AFTER_MIDNIGHT)).toBe(false);
  });

  it("labels the button for what is picked", () => {
    expect(sickButtonLabel([], NOW)).toBe("Pick a shift first");
    expect(sickButtonLabel([tomorrowDay], NOW)).toBe("I'm sick for tomorrow");
    expect(sickButtonLabel([tonightCall], NOW)).toBe("I'm sick for tonight's shift");
    expect(sickButtonLabel([{ startsAt: "2026-10-06T08:00:00Z" }], NOW)).toBe("I'm sick for today's shift");
    expect(sickButtonLabel([tonightCall, tomorrowDay], NOW)).toBe("I'm sick for both");
    expect(sickButtonLabel([tonightCall, tomorrowDay, dayAfter], NOW)).toBe("I'm sick for all 3");
  });

  it("names a single manager only when the team has exactly one named manager", () => {
    expect(managerWord(undefined)).toBe("your roster managers");
    expect(managerWord([{ name: "Dr Grant" }])).toBe("Dr Grant");
    expect(managerWord([{ name: "Dr Grant" }, { name: "Dr Hall" }])).toBe("your roster managers");
    expect(managerWord([{ name: null }])).toBe("your roster managers");
    expect(managerWord([{ name: "   " }])).toBe("your roster managers");
  });

  it("before anything is sent, the message asks for cover and never claims a report", () => {
    const text = sickMessage(
      [
        { ...tonightCall, reported: false },
        { ...tomorrowDay, reported: false },
      ],
      NOW,
    );
    expect(text).toBe(
      "Hi, I'm unwell and can't work my on call shift tonight (21:00 to Wed 08:00) and day shift on Wed 7 (08:00 to 16:30). They aren't reported in PsychSift Roster yet. Could you arrange cover?",
    );
    expect(text).not.toMatch(/I've reported/);
    expect(sickMessage([{ ...tomorrowDay, reported: false }], NOW)).toBe(
      "Hi, I'm unwell and can't work my day shift on Wed 7 (08:00 to 16:30). It isn't reported in PsychSift Roster yet. Could you arrange cover?",
    );
    expect(sickMessage([], NOW)).toBe("");
  });

  it("says reported only for a shift whose report went through", () => {
    expect(sickMessage([{ ...tomorrowDay, reported: true }], NOW)).toBe(
      "Hi, I'm unwell and can't work my day shift on Wed 7 (08:00 to 16:30). I've reported it in PsychSift Roster so it can go on Open shifts.",
    );
    expect(
      sickMessage(
        [
          { ...tomorrowDay, reported: true },
          { ...tonightCall, reported: false },
        ],
        NOW,
      ),
    ).toBe(
      "Hi, I'm unwell and can't work my on call shift tonight (21:00 to Wed 08:00) and day shift on Wed 7 (08:00 to 16:30). I've reported the day shift on Wed 7 (08:00 to 16:30) in PsychSift Roster so it can go on Open shifts. The on call shift tonight (21:00 to Wed 08:00) isn't reported there. Could you arrange cover for it?",
    );
  });

  it("turns refusal codes into plain words and never shows a raw code", () => {
    expect(sickErrorWords("roster_request_exists", "x")).toMatch(/swap or offer waiting/);
    expect(sickErrorWords("sample_read_only", "x")).toMatch(/example team/);
    expect(sickErrorWords("demo_mode_unavailable", "x")).toMatch(/example team/);
    expect(sickErrorWords("roster_unavailable", "x")).toMatch(/Nothing was sent/);
    expect(sickErrorWords("something_new", "")).toMatch(/Phone your roster manager/);
    expect(sickErrorWords("something_new", "Server words")).toBe("Server words");
  });
});

describe("after sending", () => {
  it("finds my report for a shift, preferring a live one", () => {
    const cancelled = open({ id: "5e000000-0000-4000-8000-0000000000f0", status: "cancelled" });
    const live = open({ status: "open" });
    expect(reportFor([cancelled, live], tomorrowDay)?.id).toBe(live.id);
    expect(reportFor([cancelled], tomorrowDay)).toBeNull();
    expect(reportFor([open({ mine: false })], tomorrowDay)).toBeNull();
    expect(reportFor([open({ shiftCode: "L" })], tomorrowDay)).toBeNull();
  });

  it("keeps only my urgent live or covered reports", () => {
    const giveAway = open({ id: "5e000000-0000-4000-8000-0000000000f2", urgent: false, status: "open" });
    const covered = open({ id: "5e000000-0000-4000-8000-0000000000f3", status: "approved" });
    const gone = open({ id: "5e000000-0000-4000-8000-0000000000f4", status: "cancelled" });
    const theirs = open({ id: "5e000000-0000-4000-8000-0000000000f5", mine: false });
    expect(myReports([giveAway, covered, gone, theirs, open({})]).map((item) => item.id)).toEqual([
      covered.id,
      "5e000000-0000-4000-8000-0000000000f1",
    ]);
  });

  it("maps every status to a phase", () => {
    expect(sickPhase({ status: "reported" })).toBe("reported");
    expect(sickPhase({ status: "open" })).toBe("open");
    expect(sickPhase({ status: "claimed" })).toBe("claimed");
    expect(sickPhase({ status: "approved" })).toBe("covered");
    expect(sickPhase({ status: "cancelled" })).toBe("taken-back");
    expect(sickPhase({ status: "expired" })).toBe("expired");
  });

  it("builds a three-step timeline that only claims what the app does", () => {
    const plan = sickTimeline("plan", "Dr Grant");
    expect(plan.map((step) => step.title)).toEqual([
      "Dr Grant is told",
      "Posted on Open shifts",
      "A locum only if nobody takes it",
    ]);
    expect(plan.every((step) => step.state === "todo")).toBe(true);
    expect(sickTimeline("plan", "your roster managers")[0]!.title).toBe("Your roster managers are told");
    expect(sickTimeline("holding", "Dr Grant").map((step) => step.state)).toEqual(["current", "todo", "todo"]);
    expect(sickTimeline("reported", "Dr Grant").map((step) => step.state)).toEqual(["done", "current", "todo"]);
    expect(sickTimeline("covered", "Dr Grant").map((step) => step.state)).toEqual(["done", "done", "skipped"]);
    expect(sickTimeline("taken-back", "Dr Grant")[0]!.title).toBe("Report taken back");
    expect(sickTimeline("expired", "Dr Grant")[1]!.state).toBe("warning");
    for (const phase of [
      "plan",
      "holding",
      "reported",
      "open",
      "claimed",
      "covered",
      "taken-back",
      "expired",
    ] as const) {
      const words = JSON.stringify(sickTimeline(phase, "Dr Grant"));
      expect(words).not.toMatch(/agency|guarantee|reason|diagnos/i);
    }
  });
});

describe("hand-offs", () => {
  it("lists reports still waiting for cover as Needs you updates", () => {
    const items = sickNeedsYouItems(
      [open({}), open({ id: "5e000000-0000-4000-8000-0000000000f3", status: "approved" })],
      NOW,
    );
    expect(items).toEqual([
      {
        title: "Wed 7 · Day not covered yet",
        dueOn: "2026-10-07",
        area: "roster",
        href: "/roster/sick",
        kind: "update",
      },
    ]);
  });

  it("offers static search records for both pages", () => {
    expect(ROSTER_FEATURE_SEARCH_RECORDS.map((record) => record.href)).toEqual(["/roster/sick", "/roster/staffing"]);
    expect(ROSTER_FEATURE_SEARCH_RECORDS[0]!.keywords).toContain("unwell");
  });
});

describe("which shift is ticked first", () => {
  it("after midnight, today's 08:00 shift comes before tomorrow's", () => {
    const thursday = dayAfter; // Thu 08:00
    expect(sickDefaultPick([thursday, tomorrowDay], AFTER_MIDNIGHT)).toBe(tomorrowDay);
    expect(sickButtonLabel([tomorrowDay], AFTER_MIDNIGHT)).toBe("I'm sick for today's shift");
    expect(sickPageTitle([tomorrowDay], AFTER_MIDNIGHT)).toBe("Sick today");
    expect(isShortNotice(tomorrowDay.startsAt, AFTER_MIDNIGHT)).toBe(true);
    // Picking Thursday instead is worded for tomorrow.
    expect(sickButtonLabel([thursday], AFTER_MIDNIGHT)).toBe("I'm sick for tomorrow");
    expect(sickPageTitle([thursday], AFTER_MIDNIGHT)).toBe("Sick for tomorrow");
  });

  it("in the evening, tomorrow's shift is ticked and tonight's is left as an option", () => {
    expect(sickDefaultPick([tonightCall, tomorrowDay], NOW)).toBe(tomorrowDay);
    expect(sickDefaultPick([tonightCall], NOW)).toBe(tonightCall);
  });

  it("before the evening, the next shift that has not started is ticked", () => {
    const morning = new Date("2026-10-06T02:00:00Z"); // Tue 10:00
    expect(sickDefaultPick([tomorrowDay, tonightCall], morning)).toBe(tonightCall);
    expect(sickDefaultPick([startedAlready, tomorrowDay], new Date("2026-10-06T11:00:00Z"))).toBe(tomorrowDay);
    expect(sickDefaultPick([], NOW)).toBeUndefined();
  });
});
