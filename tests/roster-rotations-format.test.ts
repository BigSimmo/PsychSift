import { describe, expect, it } from "vitest";

import {
  byYearNewest,
  currentTermId,
  formatClosing,
  formatClosingDay,
  formatDayWithYear,
  formatShortDate,
  formatTermDates,
  insertAt,
  knownRanking,
  moveById,
  moveItem,
  movedAnnouncement,
  myRoundProgress,
  placesWords,
  rankTag,
  rankedNeeded,
  rotationRoundHref,
  sameOrder,
  sendBlockedReason,
  topChoiceCount,
  yearSummary,
} from "@/components/roster/rotations/rotation-format";
import type { MyRound } from "@/lib/roster/rotations/model";

/* The doctor's rotation screens: dates, rank words and the list moves behind the ranking. Invented data only. */

const PERTH = "Australia/Perth";
const SYDNEY = "Australia/Sydney";

const rotations = [
  { id: "cl", name: "Consultation liaison", site: "Example Hospital", places: 2 },
  { id: "ed", name: "Emergency psychiatry", site: "Example Hospital", places: 1 },
  { id: "older", name: "Older adult", site: "Riverside Clinic", places: 2 },
];

describe("dates", () => {
  it("writes a term as day and short month, start to end", () => {
    expect(formatShortDate("2027-02-01")).toBe("1 Feb");
    expect(formatTermDates("2027-02-01", "2027-05-02")).toBe("1 Feb to 2 May");
    expect(formatTermDates("2027-11-01", "2028-01-31")).toBe("1 Nov to 31 Jan");
    expect(formatTermDates("2027-03-03", "2027-03-03")).toBe("3 Mar");
  });

  it("leaves a malformed date as it was rather than inventing one", () => {
    expect(formatShortDate("soon")).toBe("soon");
  });

  it("names the closing time on the work zone's wall clock", () => {
    // 09:00 UTC is 17:00 in Perth and 20:00 in Sydney (daylight time in late October).
    expect(formatClosing("2026-10-30T09:00:00.000Z", PERTH)).toBe("Fri 30 Oct at 17:00");
    expect(formatClosing("2026-10-30T09:00:00.000Z", SYDNEY)).toBe("Fri 30 Oct at 20:00");
    expect(formatClosingDay("2026-10-30T09:00:00.000Z", PERTH)).toBe("Fri 30 Oct");
  });

  it("dates a publish on the zone's calendar, with the year", () => {
    // 20:00 UTC on 5 Nov is already 6 Nov in Perth.
    expect(formatDayWithYear("2025-11-05T20:00:00.000Z", PERTH)).toBe("6 Nov 2025");
  });

  it("finds the term holding today, inclusive at both ends", () => {
    const terms = [
      { id: "t1", label: "Term 1", start: "2026-02-01", end: "2026-05-02" },
      { id: "t2", label: "Term 2", start: "2026-05-03", end: "2026-08-01" },
    ];
    expect(currentTermId(terms, "2026-05-02")).toBe("t1");
    expect(currentTermId(terms, "2026-05-03")).toBe("t2");
    expect(currentTermId(terms, "2026-09-01")).toBeNull();
  });
});

describe("rank words", () => {
  it("tags 1st and 2nd green, later ranks in the area colour, and an unranked place amber", () => {
    expect(rankTag({ rank: 1, locked: false })).toEqual({ label: "1st", tone: "green" });
    expect(rankTag({ rank: 2, locked: false })).toEqual({ label: "2nd", tone: "green" });
    expect(rankTag({ rank: 3, locked: false })).toEqual({ label: "3rd", tone: "mode" });
    expect(rankTag({ rank: null, locked: false })).toEqual({ label: "Free place", tone: "amber" });
  });

  it("calls a place the administrator fixed by hand Set, not a free place", () => {
    expect(rankTag({ rank: null, locked: true })).toEqual({ label: "Set", tone: "neutral" });
    expect(rankTag({ rank: 2, locked: true })).toEqual({ label: "2nd", tone: "green" });
  });

  it("announces a move by its new place", () => {
    expect(movedAnnouncement("Consultation liaison", 1)).toBe("Consultation liaison moved to 2nd");
  });

  it("counts places a term in words", () => {
    expect(placesWords(1)).toBe("1 place a term");
    expect(placesWords(3)).toBe("3 places a term");
  });

  it("sums up a year by top-three choices", () => {
    const year = [{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: null }];
    expect(topChoiceCount(year)).toBe(3);
    expect(topChoiceCount(year, 2)).toBe(2);
    expect(yearSummary(year, 4)).toBe("3 of 4 were in your top three");
    expect(yearSummary([{ rank: 1 }, { rank: 1 }], 2)).toBe("Every term is a 1st choice");
    expect(yearSummary([{ rank: 5 }], 1)).toBe("0 of 1 were in your top three");
    expect(yearSummary([{ rank: 2 }], 2)).toBe("1 of 2 was in your top three");
  });
});

describe("list moves", () => {
  it("moves an item and clamps at either end", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 7, 0)).toEqual(["a", "b", "c"]);
  });

  it("never changes the list it was given", () => {
    const list = ["a", "b"];
    moveItem(list, 0, 1);
    expect(list).toEqual(["a", "b"]);
  });

  it("moves by id one place up or down, and leaves unknown ids and end moves alone", () => {
    expect(moveById(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveById(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveById(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveById(["a", "b", "c"], "z", 1)).toEqual(["a", "b", "c"]);
  });

  it("puts a removed item back where it was for Undo, once only", () => {
    expect(insertAt(["a", "c"], "b", 1)).toEqual(["a", "b", "c"]);
    expect(insertAt(["a"], "b", 9)).toEqual(["a", "b"]);
    expect(insertAt(["a", "b"], "b", 0)).toEqual(["a", "b"]);
  });

  it("compares order, not just membership", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameOrder(["a"], ["a", "b"])).toBe(false);
  });

  it("drops rotations the round no longer offers, and repeats", () => {
    expect(knownRanking(["ed", "gone", "cl", "ed"], { rotations })).toEqual(["ed", "cl"]);
  });
});

describe("sending", () => {
  it("needs the round's minimum, at least one, never more than are on offer", () => {
    expect(rankedNeeded({ minRanked: 2, rotations })).toBe(2);
    expect(rankedNeeded({ minRanked: 0, rotations })).toBe(1);
    expect(rankedNeeded({ minRanked: 9, rotations })).toBe(3);
  });

  it("says why Send is waiting, and nothing once enough are ranked", () => {
    expect(sendBlockedReason(0, { minRanked: 2, rotations })).toBe("Rank at least 2 to send");
    expect(sendBlockedReason(1, { minRanked: 2, rotations })).toBe("Rank 1 more to send. You need at least 2");
    expect(sendBlockedReason(2, { minRanked: 2, rotations })).toBeNull();
  });

  it("reads a doctor's progress as sent, draft or not started", () => {
    expect(myRoundProgress({ submittedAt: "2026-10-01T00:00:00.000Z", ranking: ["cl"] })).toBe("sent");
    expect(myRoundProgress({ submittedAt: null, ranking: ["cl"] })).toBe("draft");
    expect(myRoundProgress({ submittedAt: null, ranking: [] })).toBe("not-started");
  });
});

describe("links and order", () => {
  it("escapes a round id in its link", () => {
    expect(rotationRoundHref("example:round:2027")).toBe("/roster/rotations/example%3Around%3A2027");
  });

  it("puts the round planning the latest year first", () => {
    const round = (start: string) => ({ round: { terms: [{ start }] } }) as unknown as MyRound;
    const sorted = [round("2026-02-01"), round("2027-02-01")].sort(byYearNewest);
    expect(sorted.map((entry) => entry.round.terms[0]?.start)).toEqual(["2027-02-01", "2026-02-01"]);
  });
});
