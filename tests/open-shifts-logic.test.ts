import { describe, expect, it } from "vitest";

import { ruleContentSha256, UNSIGNED, type RuleSignOff } from "@/lib/admin/rule-sign-off";
import { boardStatus, boardWeek, weekStart } from "@/lib/open-shifts/board";
import { DEFAULT_FILTERS, dayRows, nextMatchingDate, summariseBrowse } from "@/lib/open-shifts/browse";
import { groupMine, hoursMeter } from "@/lib/open-shifts/mine";
import { gapTimes, isBrowsable, isBelowMyLevel, timeOfDay, type OpenShiftListing } from "@/lib/open-shifts/model";
import { parseOffer } from "@/lib/open-shifts/parse-offer";
import { groupPosted } from "@/lib/open-shifts/posted";
import { isClash, rosterCheck, rosterCheckFor, rosterCoveredUntil } from "@/lib/open-shifts/roster-check";
import { sampleListings, sampleRoster } from "@/lib/open-shifts/sample";
import type { FatigueShift } from "@/lib/roster/fatigue-rules";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { addDaysToDate, perthWallToIso } from "@/lib/roster/shifts/perth-time";

const NOW = new Date("2026-10-05T02:00:00.000Z"); // Mon 5 Oct, 10:00 Perth
const TODAY = "2026-10-05";

const signers = [{ userId: "11111111-1111-4111-8111-111111111111", name: "Dr Jane Example" }];
const signed: RuleSignOff = {
  enabled: true,
  signedBy: "Dr Jane Example",
  signedByUserId: "11111111-1111-4111-8111-111111111111",
  signedAt: "2026-10-02T01:30:00.000Z",
  signedContentSha256: ruleContentSha256(FATIGUE_RULE_SET),
};

function at(date: string, time: string): string {
  return perthWallToIso(date, time)!;
}

function span(date: string, from: string, to: string) {
  return { startsAt: at(date, from), endsAt: at(to <= from ? addDaysToDate(date, 1) : date, to) };
}

let counter = 0;
function rostered(date: string, from: string, to: string, kind: FatigueShift["kind"] = "day"): FatigueShift {
  counter += 1;
  return { id: `r${counter}`, ...span(date, from, to), kind };
}

function listing(overrides: Partial<OpenShiftListing> & { date: string; from: string; to: string }): OpenShiftListing {
  const { date, from, to, ...rest } = overrides;
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    status: "open",
    urgent: false,
    ...span(date, from, to),
    shiftCode: "D",
    kind: "day",
    minGrade: "registrar",
    siteId: "00000000-0000-4000-8000-00000000b001",
    siteName: "Northgate",
    serviceId: "00000000-0000-4000-8000-00000000a001",
    teamName: "Northgate Psychiatry",
    mine: false,
    claimedByMe: false,
    myGrade: "registrar",
    ...rest,
  };
}

describe("open shifts model", () => {
  it("bands start times by Perth clock", () => {
    expect(timeOfDay(at(TODAY, "07:00"))).toBe("day");
    expect(timeOfDay(at(TODAY, "13:59"))).toBe("day");
    expect(timeOfDay(at(TODAY, "14:00"))).toBe("evening");
    expect(timeOfDay(at(TODAY, "20:00"))).toBe("night");
    expect(timeOfDay(at(TODAY, "06:59"))).toBe("night");
  });

  it("only offers open shifts that aren't the reader's own and haven't started", () => {
    expect(isBrowsable(listing({ date: "2026-10-06", from: "08:00", to: "16:30" }), NOW)).toBe(true);
    expect(isBrowsable(listing({ date: "2026-10-06", from: "08:00", to: "16:30", mine: true }), NOW)).toBe(false);
    expect(isBrowsable(listing({ date: "2026-10-06", from: "08:00", to: "16:30", claimedByMe: true }), NOW)).toBe(
      false,
    );
    expect(isBrowsable(listing({ date: "2026-10-06", from: "08:00", to: "16:30", status: "claimed" }), NOW)).toBe(
      false,
    );
    expect(isBrowsable(listing({ date: TODAY, from: "08:00", to: "16:30" }), NOW)).toBe(false);
  });

  it("knows a lower-level shift only when both levels are known", () => {
    expect(isBelowMyLevel(listing({ date: TODAY, from: "08:00", to: "16:30", minGrade: "resident" }))).toBe(true);
    expect(isBelowMyLevel(listing({ date: TODAY, from: "08:00", to: "16:30", minGrade: null }))).toBe(false);
    expect(
      isBelowMyLevel(listing({ date: TODAY, from: "08:00", to: "16:30", myGrade: null, minGrade: "intern" })),
    ).toBe(false);
  });

  it("runs an end at or before the start into the next day", () => {
    expect(gapTimes("2026-10-06", "21:30", "08:00")).toEqual(span("2026-10-06", "21:30", "08:00"));
    expect(gapTimes("2026-10-06", "08:00", "16:30")?.endsAt).toBe(at("2026-10-06", "16:30"));
    expect(gapTimes("not a date", "08:00", "16:30")).toBeNull();
  });
});

describe("roster check", () => {
  const candidate = { id: "c1", ...span("2026-10-07", "08:00", "16:30"), kind: "day" as const };

  it("says it can't check without a roster", () => {
    expect(rosterCheck(candidate, null, NOW, signed, signers).state).toBe("none");
    expect(rosterCheck(candidate, [], NOW, signed, signers).state).toBe("none");
  });

  it("blocks an overlap even while the fatigue rules are switched off", () => {
    const roster = [rostered("2026-10-07", "12:00", "20:00")];
    const check = rosterCheck(candidate, roster, NOW, UNSIGNED);
    expect(check.state).toBe("overlap");
    expect(check.state === "overlap" && check.overlapMinutes).toBe(270);
    expect(isClash(check)).toBe(true);
  });

  it("counts leave as a clash", () => {
    expect(rosterCheck(candidate, [rostered("2026-10-07", "00:00", "23:59", "leave")], NOW, UNSIGNED).state).toBe(
      "overlap",
    );
  });

  it("checks only clashes while the rules are unsigned", () => {
    const roster = [rostered("2026-10-06", "08:00", "16:30"), rostered("2026-10-09", "08:00", "16:30")];
    expect(rosterCheck(candidate, roster, NOW, UNSIGNED)).toEqual({ state: "clash-only", coveredUntil: "2026-10-09" });
  });

  it("gives breaks and the busiest 14 days when the signed rules find nothing", () => {
    const roster = [rostered("2026-10-06", "08:00", "16:30"), rostered("2026-10-08", "08:00", "16:30")];
    const check = rosterCheck(candidate, roster, NOW, signed, signers);
    expect(check.state).toBe("ok");
    if (check.state !== "ok") return;
    expect(check.breakBefore).toBe(15.5);
    expect(check.breakAfter).toBe(15.5);
    expect(check.busiest14d).toBe(25.5);
    expect(check.limit14d).toBe(140);
  });

  it("flags a short break under the signed rules without blocking", () => {
    const roster = [rostered("2026-10-06", "21:00", "02:00", "evening")];
    const check = rosterCheck(candidate, roster, NOW, signed, signers);
    expect(check.state).toBe("flag");
    expect(isClash(check)).toBe(false);
  });

  it("never reads a roster that is loading, failed or ends earlier as a clean check", () => {
    const roster = [rostered("2026-10-06", "08:00", "16:30")];
    expect(rosterCheckFor(candidate, null, "loading", NOW).state).toBe("loading");
    expect(rosterCheckFor(candidate, null, "error", NOW).state).toBe("unread");
    expect(rosterCheck(candidate, roster, NOW, signed, signers)).toEqual({
      state: "beyond",
      coveredUntil: "2026-10-06",
    });
  });

  it("reports how far the saved roster reaches", () => {
    expect(rosterCoveredUntil([rostered("2026-10-06", "21:30", "08:00", "night")])).toBe("2026-10-07");
  });
});

describe("browse", () => {
  const roster = [rostered("2026-10-07", "08:00", "16:30")];
  const rows = [
    listing({ date: "2026-10-07", from: "09:00", to: "17:00" }), // clashes
    listing({ date: "2026-10-07", from: "18:00", to: "23:00", kind: "evening" }),
    listing({ date: "2026-10-08", from: "08:00", to: "16:30", minGrade: "resident" }), // lower level
    listing({ date: "2026-10-09", from: "08:00", to: "16:30", urgent: true }),
    listing({ date: "2026-10-30", from: "08:00", to: "16:30" }), // outside 14 days
  ];

  it("hides clashes and lower levels by default, each counted once", () => {
    const summary = summariseBrowse(rows, roster, DEFAULT_FILTERS, NOW);
    expect(summary.total).toBe(4);
    expect(summary.matching).toHaveLength(2);
    expect(summary.hidden).toEqual({ clash: 1, level: 1, site: 0, time: 0 });
    expect(summary.lowerLevelCount).toBe(1);
    expect([...summary.urgentDays]).toEqual(["2026-10-09"]);
    expect(summary.perDay.get("2026-10-07")).toBe(1);
  });

  it("shows everything with the filters relaxed, and the calendar counts follow the list", () => {
    const summary = summariseBrowse(
      rows,
      roster,
      { ...DEFAULT_FILTERS, hideClashes: false, includeLowerLevels: true },
      NOW,
    );
    expect(summary.matching).toHaveLength(4);
    expect(summary.perDay.get("2026-10-07")).toBe(2);
    const day = dayRows(summary, "2026-10-07");
    expect(day.shown).toHaveLength(2);
    expect(day.hidden).toHaveLength(0);
  });

  it("explains what a day hides and finds the next day with a match", () => {
    const summary = summariseBrowse(rows, roster, DEFAULT_FILTERS, NOW);
    expect(dayRows(summary, "2026-10-07")).toMatchObject({ hiddenClash: 1, hiddenLevel: 0 });
    expect(nextMatchingDate(summary, "2026-10-07")).toBe("2026-10-09");
  });

  it("filters by start time and counts each band", () => {
    const summary = summariseBrowse(rows, roster, { ...DEFAULT_FILTERS, starts: ["evening"] }, NOW);
    expect(summary.matching.map((row) => row.listing.kind)).toEqual(["evening"]);
    expect(summary.startCounts).toEqual({ day: 1, evening: 1, night: 0 });
  });

  it("never treats the made-up sample as anything but open shifts in the window", () => {
    const summary = summariseBrowse(sampleListings(NOW), sampleRoster(NOW), DEFAULT_FILTERS, NOW);
    expect(summary.total).toBeGreaterThan(5);
    expect(summary.matching.every((row) => row.check.state !== "overlap")).toBe(true);
  });
});

describe("my shifts", () => {
  const requested = listing({ date: "2026-10-10", from: "08:00", to: "18:00", status: "claimed", claimedByMe: true });
  const booked = listing({ date: "2026-10-07", from: "08:00", to: "16:30", status: "approved", claimedByMe: true });
  const others = listing({ date: "2026-10-08", from: "08:00", to: "16:30", status: "claimed" });

  it("groups only the reader's own requests", () => {
    const groups = groupMine([requested, booked, others], NOW);
    expect(groups.requested.map((row) => row.id)).toEqual([requested.id]);
    expect(groups.booked.map((row) => row.id)).toEqual([booked.id]);
    expect(groups.cancelled).toEqual([]);
  });

  it("counts at least the roster plus asked-for shifts, and an approved shift on the roster only once", () => {
    const roster = [rostered("2026-10-06", "08:00", "16:30"), rostered("2026-10-07", "08:00", "16:30")];
    const meter = hoursMeter(roster, [requested, booked], NOW, true);
    expect(meter).toMatchObject({ rostered: 17, approved: 0, requested: 10, total: 27, limit: 140 });
  });

  it("drops the limit while the fatigue rules are off", () => {
    expect(hoursMeter([], [requested], NOW, false).limit).toBeNull();
  });
});

describe("pasted offers", () => {
  it("reads a date and a time range", () => {
    expect(parseOffer("need a reg for Ward 4B Sat 17 Oct 0800–1630, Northgate", TODAY)).toEqual({
      date: "2026-10-17",
      start: "08:00",
      end: "16:30",
    });
    expect(parseOffer("Fri 9/10 17:00 - 23:00", TODAY)).toEqual({ date: "2026-10-09", start: "17:00", end: "23:00" });
  });

  it("rolls a date already passed into next year, and leaves blanks rather than guessing", () => {
    expect(parseOffer("3 Jan 0800-1600", TODAY).date).toBe("2027-01-03");
    expect(parseOffer("can anyone help tomorrow?", TODAY)).toEqual({ date: null, start: null, end: null });
    expect(parseOffer("31 Feb 2500-2600", TODAY)).toEqual({ date: null, start: null, end: null });
  });
});

describe("poster views", () => {
  const base = { serviceId: "s1", teamName: "Northgate", siteName: "Ward 4B" };
  const row = (id: string, status: OpenShiftListing["status"], date: string, from = "08:00") => ({
    ...base,
    id,
    status,
    ...span(date, from, "16:30"),
  });

  it("puts requests and reports first, then open, then filled this week", () => {
    const groups = groupPosted(
      [
        row("a", "claimed", "2026-10-07"),
        row("b", "open", "2026-10-08"),
        row("c", "approved", "2026-10-09"),
        row("d", "approved", "2026-10-20"),
        row("e", "reported", "2026-10-06"),
        row("f", "cancelled", "2026-10-06"),
      ],
      NOW,
    );
    expect(groups.hasRequest.map((item) => item.id)).toEqual(["e", "a"]);
    expect(groups.open.map((item) => item.id)).toEqual(["b"]);
    expect(groups.filledThisWeek.map((item) => item.id)).toEqual(["c"]);
  });

  it("lays the week out Monday to Sunday and marks open shifts inside 48 hours unfilled", () => {
    expect(weekStart("2026-10-08")).toBe("2026-10-05");
    expect(boardStatus(row("x", "open", "2026-10-06"), NOW)).toBe("unfilled");
    expect(boardStatus(row("y", "open", "2026-10-09"), NOW)).toBe("open");
    expect(boardStatus(row("z", "cancelled", "2026-10-09"), NOW)).toBeNull();
    const week = boardWeek(
      [row("a", "claimed", "2026-10-07"), row("b", "open", "2026-10-06"), row("c", "approved", "2026-10-13")],
      "2026-10-07",
      NOW,
    );
    expect(week.days[0]).toBe("2026-10-05");
    expect(week.counts).toEqual({ all: 2, open: 0, requested: 1, unfilled: 1, filled: 0 });
    expect(week.rows).toHaveLength(1);
    expect(week.rows[0]!.cells[2]!.map((cell) => cell.status)).toEqual(["requested"]);
  });
});
