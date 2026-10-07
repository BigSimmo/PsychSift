import { describe, expect, it } from "vitest";

import {
  buildFirstWeekSections,
  EMPTY_FIRST_WEEK_READ,
  firstWeekAskForPackText,
  firstWeekCalendarIcs,
  firstWeekChangeSummary,
  firstWeekDateTile,
  firstWeekEyebrow,
  firstWeekItemChanged,
  firstWeekItems,
  firstWeekLandAlertOn,
  firstWeekPhase,
  firstWeekProgress,
  firstWeekProgressLabel,
  firstWeekSearchRecords,
  firstWeekSectionHref,
  firstWeekSectionStatus,
  formatFirstWeekDate,
  isFirstWeekHighlighted,
  isFirstWeekSectionId,
  isValidFirstWeekRead,
  nextFirstWeekSection,
  parseFirstWeekRead,
  restoreFirstWeekMarks,
  selectFirstWeekNeedsYou,
  setFirstWeekLandAlert,
  setFirstWeekSectionRead,
  FIRST_WEEK_MAX_HOSPITALS,
  FIRST_WEEK_SECTION_IDS,
  type FirstWeekLogin,
  type FirstWeekSection,
} from "@/lib/on-call/first-week-pack";
import { handbookItems, SITE } from "./helpers/on-call-handbook-fixtures";

// 09:00 Perth on Mon 26 Oct 2026.
const NOW = new Date("2026-10-26T01:00:00Z");

describe("firstWeekPhase", () => {
  it("reads no date, an unreal date and a malformed date as no date", () => {
    expect(firstWeekPhase(null, NOW)).toEqual({ kind: "no-date" });
    expect(firstWeekPhase("2026-02-30", NOW)).toEqual({ kind: "no-date" });
    expect(firstWeekPhase("2 Nov", NOW)).toEqual({ kind: "no-date" });
  });

  it("is ahead more than a week out, and names the day the highlight starts", () => {
    const phase = firstWeekPhase("2026-11-30", NOW);
    expect(phase).toMatchObject({ kind: "ahead", daysAway: 35, highlightFrom: "2026-11-23" });
    expect(isFirstWeekHighlighted(phase)).toBe(false);
  });

  it("is highlighted from exactly seven days before until day seven of the job", () => {
    expect(firstWeekPhase("2026-11-03", NOW).kind).toBe("ahead");
    expect(firstWeekPhase("2026-11-02", NOW)).toEqual({ kind: "soon", startsOn: "2026-11-02", daysAway: 7 });
    expect(firstWeekPhase("2026-10-27", NOW)).toMatchObject({ kind: "soon", daysAway: 1 });
    expect(firstWeekPhase("2026-10-26", NOW)).toEqual({ kind: "today", startsOn: "2026-10-26" });
    expect(firstWeekPhase("2026-10-24", NOW)).toEqual({ kind: "first-week", startsOn: "2026-10-24", day: 3 });
    expect(firstWeekPhase("2026-10-20", NOW)).toMatchObject({ kind: "first-week", day: 7 });
    expect(firstWeekPhase("2026-10-19", NOW)).toMatchObject({ kind: "past", daysSince: 7 });
    for (const date of ["2026-11-02", "2026-10-26", "2026-10-20"]) {
      expect(isFirstWeekHighlighted(firstWeekPhase(date, NOW))).toBe(true);
    }
    expect(isFirstWeekHighlighted(firstWeekPhase("2026-10-19", NOW))).toBe(false);
  });

  it("uses the Perth date, not the UTC date, near midnight", () => {
    // 23:30 UTC on 25 Oct is 07:30 on 26 Oct in Perth.
    expect(firstWeekPhase("2026-10-26", new Date("2026-10-25T23:30:00Z")).kind).toBe("today");
  });
});

describe("firstWeekEyebrow", () => {
  it("says each phase in plain words", () => {
    expect(firstWeekEyebrow({ kind: "no-date" })).toBe("No start date yet");
    expect(firstWeekEyebrow(firstWeekPhase("2026-11-30", NOW))).toBe("Starts in 5 weeks");
    expect(firstWeekEyebrow(firstWeekPhase("2026-11-09", NOW))).toBe("Starts in 14 days");
    expect(firstWeekEyebrow(firstWeekPhase("2026-11-02", NOW))).toBe("Starts in 7 days");
    expect(firstWeekEyebrow(firstWeekPhase("2026-10-27", NOW))).toBe("Starts tomorrow");
    expect(firstWeekEyebrow(firstWeekPhase("2026-10-26", NOW))).toBe("Starts today");
    expect(firstWeekEyebrow(firstWeekPhase("2026-10-24", NOW))).toBe("Day 3 of your first week");
    expect(firstWeekEyebrow(firstWeekPhase("2026-09-01", NOW))).toBe("Your first week has passed");
  });

  it("draws the date tile and the long date", () => {
    expect(firstWeekDateTile("2026-11-02")).toEqual({ month: "NOV", day: "2", weekday: "MON" });
    expect(firstWeekDateTile("2026-13-01")).toBeNull();
    expect(formatFirstWeekDate("2026-11-02")).toBe("Mon 2 Nov 2026");
    expect(formatFirstWeekDate("nonsense")).toBe("nonsense");
  });
});

describe("sections", () => {
  const items = handbookItems([
    { id: "b1", title: "Collect your badge", section: "orientation", phase: "before_start" },
    { id: "f1", title: "Find the handover room", section: "orientation", phase: "first_shift" },
    { id: "f2", title: "Meet the ward clerk", section: "orientation", phase: "first_week" },
    { id: "o1", title: "Hand back keys", section: "orientation", phase: "leaving" },
    { id: "c1", title: "Psychiatry: Nurse in charge", phase: "first_shift", phone: "4000" },
    { id: "e1", title: "Emergency: Code blue", kind: "clinical", phone: "55" },
    { id: "r1", title: "Referral route", section: "referrals" },
  ]);
  const logins: FirstWeekLogin[] = [
    { id: "l1", title: "Hospital email", ready: true, source: "you" },
    { id: "l2", title: "Pathology", ready: false, source: "you" },
    { id: "l3", title: "Shared guide", ready: null, source: "shared" },
  ];

  it("draws only the phases and sections each part holds, never leaving items or referrals", () => {
    expect(
      firstWeekItems(items, "first-day", SITE)
        .map((item) => item.id)
        .sort(),
    ).toEqual(["b1", "f1"]);
    expect(firstWeekItems(items, "expect", SITE).map((item) => item.id)).toEqual(["f2"]);
    expect(firstWeekItems(items, "who", SITE).map((item) => item.id)).toEqual(["c1"]);
    expect(firstWeekItems(items, "escalate", SITE).map((item) => item.id)).toEqual(["e1"]);
    // Emergency rows are pinned only for the chosen site.
    expect(firstWeekItems(items, "escalate", null)).toEqual([]);
  });

  it("counts each section and summarises it, saying not written when empty", () => {
    const sections = buildFirstWeekSections({ items, siteId: SITE, logins, loginsState: "ready" });
    expect(sections.map((section) => section.id)).toEqual([...FIRST_WEEK_SECTION_IDS]);
    expect(sections.map((section) => section.title)).toEqual([
      "Who is who",
      "What we expect",
      "How to escalate",
      "Logins",
      "Your first day",
    ]);
    const byId = Object.fromEntries(sections.map((section) => [section.id, section]));
    expect(byId.expect.summary).toBe("1 item");
    expect(byId["first-day"].summary).toBe("2 items");
    const dated = buildFirstWeekSections({ items, siteId: SITE, logins, loginsState: "ready", startsOn: "2026-11-02" });
    expect(dated.find((section) => section.id === "first-day")?.summary).toBe("Mon 2 Nov · 2 items");
    expect(byId.who.summary).toBe("1 role");
    expect(byId.escalate.summary).toBe("1 emergency line");
    expect(byId.logins.summary).toBe("1 of 2 ready");
    expect(byId["first-day"].updatedAt).toBe("2026-09-20T04:00:00.000Z");
    const empty = buildFirstWeekSections({ items: [], siteId: SITE, logins: [], loginsState: "ready" });
    expect(empty.find((section) => section.id === "who")?.summary).toBe("Not written by your hospital yet");
    expect(empty.find((section) => section.id === "logins")?.summary).toBe("None listed in New job yet");
  });

  it("never claims logins it could not read", () => {
    for (const [state, text] of [
      ["loading", "Loading your New job list"],
      ["failed", "Could not load your New job list"],
      ["signed-out", "Sign in to see your New job list"],
    ] as const) {
      const section = buildFirstWeekSections({ items, siteId: SITE, logins, loginsState: state }).find(
        (item) => item.id === "logins",
      );
      expect(section).toMatchObject({ summary: text, count: 0 });
    }
    const shared = buildFirstWeekSections({
      items,
      siteId: SITE,
      logins: [logins[2]],
      loginsState: "ready",
    }).find((item) => item.id === "logins");
    expect(shared?.summary).toBe("1 item from your service");
  });

  it("links and orders the sections", () => {
    expect(firstWeekSectionHref("who")).toBe("/on-call/first-week?section=who");
    expect(nextFirstWeekSection("who")).toBe("expect");
    expect(nextFirstWeekSection("logins")).toBe("first-day");
    expect(nextFirstWeekSection("first-day")).toBeNull();
    expect(isFirstWeekSectionId("who")).toBe(true);
    expect(isFirstWeekSectionId("passwords")).toBe(false);
    expect(isFirstWeekSectionId(undefined)).toBe(false);
  });
});

describe("read marks", () => {
  const section: FirstWeekSection = {
    id: "who",
    title: "Who is who",
    summary: "3 roles",
    count: 3,
    updatedAt: "2026-10-20T00:00:00.000Z",
  };

  it("reads unread, read, and changed since it was read", () => {
    expect(firstWeekSectionStatus(section, undefined)).toBe("unread");
    expect(firstWeekSectionStatus(section, "nonsense")).toBe("unread");
    expect(firstWeekSectionStatus(section, "2026-10-21T00:00:00.000Z")).toBe("read");
    expect(firstWeekSectionStatus(section, "2026-10-19T00:00:00.000Z")).toBe("changed");
    expect(firstWeekSectionStatus({ ...section, updatedAt: null }, "2026-10-19T00:00:00.000Z")).toBe("read");
  });

  it("parses only the expected shape, and anything else as nothing read", () => {
    expect(parseFirstWeekRead(null)).toEqual(EMPTY_FIRST_WEEK_READ);
    expect(parseFirstWeekRead("{")).toEqual(EMPTY_FIRST_WEEK_READ);
    expect(parseFirstWeekRead(JSON.stringify({ version: 2, hospitals: {} }))).toEqual(EMPTY_FIRST_WEEK_READ);
    // A section the pack no longer has is dropped, and the rest kept.
    expect(
      parseFirstWeekRead(JSON.stringify({ version: 1, hospitals: { "a:b": { passwords: "2026-10-01T00:00:00Z" } } })),
    ).toEqual(EMPTY_FIRST_WEEK_READ);
    expect(
      parseFirstWeekRead(
        JSON.stringify({
          version: 1,
          hospitals: { "a:b": { before: "2026-10-01T00:00:00Z", who: "2026-10-02T00:00:00Z" } },
        }),
      ),
    ).toEqual({ version: 1, hospitals: { "a:b": { who: "2026-10-02T00:00:00Z" } } });
    expect(parseFirstWeekRead(JSON.stringify({ version: 1, hospitals: {}, name: "Dr Smith" }))).toEqual(
      EMPTY_FIRST_WEEK_READ,
    );
    expect(parseFirstWeekRead(JSON.stringify({ version: 1, hospitals: {}, landAlertOff: "yes" }))).toEqual(
      EMPTY_FIRST_WEEK_READ,
    );
    expect(parseFirstWeekRead(JSON.stringify({ version: 1, hospitals: { "a:b": { who: "Dr Smith" } } }))).toEqual(
      EMPTY_FIRST_WEEK_READ,
    );
    const good = { version: 1, hospitals: { "svc:site": { who: "2026-10-01T00:00:00.000Z" } } };
    expect(parseFirstWeekRead(JSON.stringify(good))).toEqual(good);
    expect(isValidFirstWeekRead(good)).toBe(true);
  });

  it("sets and clears one mark, and drops a hospital with none left", () => {
    let state = setFirstWeekSectionRead(EMPTY_FIRST_WEEK_READ, "svc:site", "who", "2026-10-01T00:00:00.000Z");
    expect(state.hospitals["svc:site"]).toEqual({ who: "2026-10-01T00:00:00.000Z" });
    state = setFirstWeekSectionRead(state, "svc:site", "who", null);
    expect(state.hospitals).toEqual({});
    // A key that is not an id pair is refused, never stored.
    expect(setFirstWeekSectionRead(EMPTY_FIRST_WEEK_READ, "Dr Smith's ward", "who", "2026-10-01T00:00:00.000Z")).toBe(
      EMPTY_FIRST_WEEK_READ,
    );
  });

  it("keeps at most eight hospitals, dropping the oldest marks", () => {
    let state = EMPTY_FIRST_WEEK_READ;
    for (let index = 0; index < FIRST_WEEK_MAX_HOSPITALS + 2; index += 1) {
      state = setFirstWeekSectionRead(
        state,
        `svc:${index}`,
        "who",
        new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      );
    }
    expect(Object.keys(state.hospitals)).toHaveLength(FIRST_WEEK_MAX_HOSPITALS);
    expect(state.hospitals["svc:0"]).toBeUndefined();
    expect(state.hospitals["svc:9"]).toBeDefined();
    expect(isValidFirstWeekRead(state)).toBe(true);
  });

  it("turns the landing alert off and on, keeping every mark through later changes", () => {
    let state = setFirstWeekSectionRead(EMPTY_FIRST_WEEK_READ, "svc:site", "who", "2026-10-01T00:00:00.000Z");
    expect(firstWeekLandAlertOn(state)).toBe(true);
    state = setFirstWeekLandAlert(state, false);
    expect(firstWeekLandAlertOn(state)).toBe(false);
    state = setFirstWeekSectionRead(state, "svc:site", "logins", "2026-10-02T00:00:00.000Z");
    expect(firstWeekLandAlertOn(state)).toBe(false);
    expect(isValidFirstWeekRead(state)).toBe(true);
    expect(parseFirstWeekRead(JSON.stringify(state))).toEqual(state);
    state = setFirstWeekLandAlert(state, true);
    expect(state).toEqual({
      version: 1,
      hospitals: { "svc:site": { who: "2026-10-01T00:00:00.000Z", logins: "2026-10-02T00:00:00.000Z" } },
    });
  });

  it("restores a hospital's marks exactly, for Undo", () => {
    const before = { who: "2026-10-01T00:00:00.000Z" } as const;
    let state = setFirstWeekSectionRead(EMPTY_FIRST_WEEK_READ, "svc:site", "who", before.who);
    state = setFirstWeekSectionRead(state, "svc:site", "logins", "2026-10-02T00:00:00.000Z");
    state = restoreFirstWeekMarks(state, "svc:site", before);
    expect(state.hospitals["svc:site"]).toEqual(before);
  });

  it("counts progress over sections that hold something, with screen-reader text", () => {
    const sections: FirstWeekSection[] = [
      section,
      { ...section, id: "expect", updatedAt: null },
      { ...section, id: "logins", count: 0, updatedAt: null },
    ];
    const progress = firstWeekProgress(sections, {
      expect: "2026-10-01T00:00:00.000Z",
      who: "2026-10-01T00:00:00.000Z",
    });
    expect(progress).toEqual({ read: 1, total: 2, changed: 1 });
    expect(firstWeekProgressLabel(progress)).toBe("1 of 2 sections read, 1 changed since you read it");
    expect(firstWeekProgressLabel({ read: 0, total: 1, changed: 0 })).toBe("0 of 1 section read");
    expect(firstWeekProgressLabel({ read: 0, total: 0, changed: 0 })).toBe("Nothing to read yet");
  });
});

describe("hand-offs", () => {
  it("raises a Needs you item only while highlighted and something is left", () => {
    const progress = { read: 1, total: 4, changed: 0 };
    expect(selectFirstWeekNeedsYou({ startsOn: null, now: NOW, progress })).toEqual([]);
    expect(selectFirstWeekNeedsYou({ startsOn: "2026-12-01", now: NOW, progress })).toEqual([]);
    expect(
      selectFirstWeekNeedsYou({ startsOn: "2026-11-02", now: NOW, progress: { read: 4, total: 4, changed: 0 } }),
    ).toEqual([]);
    expect(selectFirstWeekNeedsYou({ startsOn: "2026-11-02", now: NOW, progress })).toEqual([
      {
        id: "on-call:first-week:unread",
        title: "Your first week pack: 3 left to read",
        dueOn: "2026-11-02",
        area: "call",
        href: "/on-call/first-week",
        kind: "action",
      },
    ]);
    expect(
      selectFirstWeekNeedsYou({ startsOn: "2026-11-02", now: NOW, progress: { read: 0, total: 4, changed: 0 } })[0]
        .title,
    ).toBe("Read your first week pack");
    const changed = selectFirstWeekNeedsYou({
      startsOn: "2026-10-24",
      now: NOW,
      progress: { read: 3, total: 4, changed: 1 },
    });
    expect(changed).toEqual([
      expect.objectContaining({
        kind: "update",
        title: "Your first week pack changed: 1 section",
        dueOn: "2026-10-26",
      }),
    ]);
  });

  it("raises no landing item when the doctor turned the alert off, but still says what changed", () => {
    expect(
      selectFirstWeekNeedsYou({
        startsOn: "2026-11-02",
        now: NOW,
        progress: { read: 0, total: 4, changed: 0 },
        landAlert: false,
      }),
    ).toEqual([]);
    expect(
      selectFirstWeekNeedsYou({
        startsOn: "2026-11-02",
        now: NOW,
        progress: { read: 2, total: 4, changed: 1 },
        landAlert: false,
      }).map((item) => item.kind),
    ).toEqual(["update"]);
  });

  it("counts changed items and names the newest change", () => {
    const rows = [
      { updatedAt: "2026-10-20T00:00:00.000Z" },
      { updatedAt: "2026-10-22T00:00:00.000Z" },
      { updatedAt: "2026-09-01T00:00:00.000Z" },
      { updatedAt: null },
    ];
    expect(firstWeekItemChanged(rows[0], "2026-10-10T00:00:00.000Z")).toBe(true);
    expect(firstWeekItemChanged(rows[0], undefined)).toBe(false);
    expect(firstWeekItemChanged(rows[3], "2026-10-10T00:00:00.000Z")).toBe(false);
    expect(firstWeekChangeSummary(rows, "2026-10-10T00:00:00.000Z")).toEqual({
      count: 2,
      latest: "2026-10-22T00:00:00.000Z",
    });
    expect(firstWeekChangeSummary(rows, undefined)).toEqual({ count: 0, latest: null });
  });

  it("writes a note asking for a pack with only the hospital and the start date", () => {
    expect(firstWeekAskForPackText({ hospitalName: "Synthetic Hospital", startsOn: "2026-11-02" })).toContain(
      "I am starting at Synthetic Hospital on Mon 2 Nov 2026.",
    );
    const bare = firstWeekAskForPackText({ hospitalName: "  ", startsOn: "nonsense" });
    expect(bare).toContain("I am starting. Is there a first week pack");
  });

  it("gives search records with titles and keywords only", () => {
    const records = firstWeekSearchRecords();
    expect(records[0]).toMatchObject({ title: "Your first week", area: "On Call", href: "/on-call/first-week" });
    expect(records.every((record) => record.href.startsWith("/on-call/first-week"))).toBe(true);
    expect(records.flatMap((record) => record.keywords)).toContain("orientation");
  });

  it("builds an all-day first-day event with a week-before and a day-before reminder", () => {
    const ics = firstWeekCalendarIcs({ startsOn: "2026-11-02", hospitalName: "Synthetic Hospital", now: NOW });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261102");
    expect(ics).toContain("DTEND;VALUE=DATE:20261103");
    expect(ics).toContain("SUMMARY:First day at Synthetic Hospital");
    expect(ics).toContain("TRIGGER:-P7D");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics).toContain("UID:first-day-2026-11-02@psychiatry.tools");
    expect(ics?.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(firstWeekCalendarIcs({ startsOn: "2026-11-02", hospitalName: null, now: NOW })).toContain(
      "SUMMARY:First day in your new job",
    );
    expect(firstWeekCalendarIcs({ startsOn: "not a date", hospitalName: null, now: NOW })).toBeNull();
    const dayOnly = firstWeekCalendarIcs({
      startsOn: "2026-11-02",
      hospitalName: null,
      now: NOW,
      reminders: { weekBefore: false, dayBefore: false },
    });
    expect(dayOnly).not.toContain("VALARM");
    expect(dayOnly).toContain("DTSTART;VALUE=DATE:20261102");
  });
});
