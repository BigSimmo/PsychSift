import { describe, expect, it } from "vitest";

import type { OnCallShiftImportSummary } from "@/lib/roster/shifts/model";
import { formatPerthDay } from "@/lib/roster/shifts/perth-time";
import {
  formatSnapshotTimes,
  importChangeNotices,
  teamChangeNotices,
  type TeamDayChange,
} from "@/lib/roster/what-changed";

const TODAY = "2026-10-05";
const day = (date: string) => formatPerthDay(date);

function snap(start: string, end: string, title = "On call", location: string | null = null) {
  return { startsAt: start, endsAt: end, title, location };
}

const summary = (changes: OnCallShiftImportSummary["changes"]) => ({
  changes,
  seenAt: null as string | null,
});

describe("formatSnapshotTimes", () => {
  it("shows Perth wall-clock times", () => {
    expect(formatSnapshotTimes(snap("2026-10-06T08:00:00+08:00", "2026-10-06T17:00:00+08:00"))).toBe("08:00–17:00");
  });

  it("converts UTC instants to Perth time", () => {
    expect(formatSnapshotTimes(snap("2026-10-06T00:00:00Z", "2026-10-06T09:00:00Z"))).toBe("08:00–17:00");
  });

  it("adds +1 for an overnight shift", () => {
    expect(formatSnapshotTimes(snap("2026-10-06T17:00:00+08:00", "2026-10-07T08:00:00+08:00"))).toBe("17:00–08:00 +1");
  });
});

describe("importChangeNotices", () => {
  it("returns nothing for a missing summary", () => {
    expect(importChangeNotices(null, TODAY)).toEqual([]);
    expect(importChangeNotices(undefined, TODAY)).toEqual([]);
  });

  it("returns nothing once the summary has been seen", () => {
    const after = snap("2026-10-06T08:00:00+08:00", "2026-10-06T17:00:00+08:00");
    expect(importChangeNotices({ changes: [{ kind: "added", after }], seenAt: "2026-10-04T00:00:00Z" }, TODAY)).toEqual(
      [],
    );
  });

  it("describes an added shift with title, times and location", () => {
    const after = snap("2026-10-06T08:00:00+08:00", "2026-10-06T17:00:00+08:00", " Ward cover ", " Ward 3 ");
    const [notice] = importChangeNotices(summary([{ kind: "added", after }]), TODAY);
    expect(notice.title).toBe(`${day("2026-10-06")}: added`);
    expect(notice.detail).toBe("Ward cover · 08:00–17:00 · Ward 3");
    expect(notice.source).toBe("import");
    expect(notice.date).toBe("2026-10-06");
    expect(notice.href).toBe("/roster/shifts");
  });

  it("omits the location when there is none", () => {
    const after = snap("2026-10-06T08:00:00+08:00", "2026-10-06T17:00:00+08:00", "On call", "  ");
    const [notice] = importChangeNotices(summary([{ kind: "added", after }]), TODAY);
    expect(notice.detail).toBe("On call · 08:00–17:00");
  });

  it("describes a removed shift using its old day", () => {
    const before = snap("2026-10-07T08:00:00+08:00", "2026-10-07T17:00:00+08:00", "Clinic", "Room 2");
    const [notice] = importChangeNotices(summary([{ kind: "removed", before }]), TODAY);
    expect(notice.title).toBe(`${day("2026-10-07")}: removed`);
    expect(notice.detail).toBe("Clinic · 08:00–17:00 · Room 2");
  });

  it("describes a move within the same day without naming a previous day", () => {
    const before = snap("2026-10-06T08:00:00+08:00", "2026-10-06T17:00:00+08:00");
    const after = snap("2026-10-06T09:00:00+08:00", "2026-10-06T18:00:00+08:00");
    const [notice] = importChangeNotices(summary([{ kind: "moved", before, after }]), TODAY);
    expect(notice.title).toBe(`${day("2026-10-06")}: moved`);
    expect(notice.detail).toBe("Was On call · 08:00–17:00. Now On call · 09:00–18:00");
  });

  it("names the previous day when a shift moves to a different day", () => {
    const before = snap("2026-10-06T08:00:00+08:00", "2026-10-06T17:00:00+08:00");
    const after = snap("2026-10-08T08:00:00+08:00", "2026-10-08T17:00:00+08:00");
    const [notice] = importChangeNotices(summary([{ kind: "moved", before, after }]), TODAY);
    expect(notice.title).toBe(`${day("2026-10-08")}: moved`);
    expect(notice.detail).toBe(`Was ${day("2026-10-06")} On call · 08:00–17:00. Now On call · 08:00–17:00`);
  });

  it("keeps a move from a coming day back into the past, because the coming day is now free", () => {
    const before = snap("2026-10-07T08:00:00+08:00", "2026-10-07T17:00:00+08:00");
    const after = snap("2026-10-03T08:00:00+08:00", "2026-10-03T17:00:00+08:00");
    const notices = importChangeNotices(summary([{ kind: "moved", before, after }]), TODAY);
    expect(notices).toHaveLength(1);
    expect(notices[0].detail).toContain(`Was ${day("2026-10-07")}`);
  });

  it("drops a move that stays entirely in the past", () => {
    const before = snap("2026-10-02T08:00:00+08:00", "2026-10-02T17:00:00+08:00");
    const after = snap("2026-10-03T08:00:00+08:00", "2026-10-03T17:00:00+08:00");
    expect(importChangeNotices(summary([{ kind: "moved", before, after }]), TODAY)).toEqual([]);
  });

  it("marks overnight shifts with +1 in the detail", () => {
    const after = snap("2026-10-06T17:00:00+08:00", "2026-10-07T08:00:00+08:00");
    const [notice] = importChangeNotices(summary([{ kind: "added", after }]), TODAY);
    expect(notice.detail).toContain("17:00–08:00 +1");
  });

  it("drops changes before today and keeps today", () => {
    const early = snap("2026-10-04T08:00:00+08:00", "2026-10-04T17:00:00+08:00");
    const todayShift = snap("2026-10-05T08:00:00+08:00", "2026-10-05T17:00:00+08:00");
    const notices = importChangeNotices(
      summary([
        { kind: "added", after: early },
        { kind: "added", after: todayShift },
      ]),
      TODAY,
    );
    expect(notices.map((n) => n.date)).toEqual(["2026-10-05"]);
  });

  it("sorts by date and gives unique ids", () => {
    const a = snap("2026-10-09T08:00:00+08:00", "2026-10-09T17:00:00+08:00");
    const b = snap("2026-10-06T08:00:00+08:00", "2026-10-06T17:00:00+08:00");
    const c = snap("2026-10-07T08:00:00+08:00", "2026-10-07T17:00:00+08:00");
    const notices = importChangeNotices(
      summary([
        { kind: "added", after: a },
        { kind: "added", after: b },
        { kind: "removed", before: c },
      ]),
      TODAY,
    );
    expect(notices.map((n) => n.date)).toEqual(["2026-10-06", "2026-10-07", "2026-10-09"]);
    expect(new Set(notices.map((n) => n.id)).size).toBe(3);
  });
});

describe("teamChangeNotices", () => {
  const duty = (start: string, end: string, shiftCode = "AM", siteName: string | null = "Site A") => ({
    startsAt: start,
    endsAt: end,
    shiftCode,
    siteName,
  });
  const am = duty("2026-10-06T08:00:00+08:00", "2026-10-06T17:00:00+08:00");

  it("reads a day that gains duties as added", () => {
    const changes: TeamDayChange[] = [{ date: "2026-10-06", before: [], after: [am] }];
    const [notice] = teamChangeNotices(changes, TODAY);
    expect(notice.title).toBe(`${day("2026-10-06")}: added`);
    expect(notice.detail).toBe("AM · 08:00–17:00 · Site A");
    expect(notice.id).toBe("team-2026-10-06");
    expect(notice.source).toBe("team");
    expect(notice.href).toBe("/roster/shifts");
  });

  it("reads a day that loses all duties as now off", () => {
    const [notice] = teamChangeNotices([{ date: "2026-10-06", before: [am], after: [] }], TODAY);
    expect(notice.title).toBe(`${day("2026-10-06")}: now off`);
    expect(notice.detail).toBe("Was AM · 08:00–17:00 · Site A. Now off");
  });

  it("reads a changed day as changed", () => {
    const pm = duty("2026-10-06T13:00:00+08:00", "2026-10-06T22:00:00+08:00", "PM", null);
    const [notice] = teamChangeNotices([{ date: "2026-10-06", before: [am], after: [pm] }], TODAY);
    expect(notice.title).toBe(`${day("2026-10-06")}: changed`);
    expect(notice.detail).toBe("Was AM · 08:00–17:00 · Site A. Now PM · 13:00–22:00");
  });

  it("joins several duties with commas", () => {
    const pm = duty("2026-10-06T18:00:00+08:00", "2026-10-07T02:00:00+08:00", "NT", "Site B");
    const [notice] = teamChangeNotices([{ date: "2026-10-06", before: [], after: [am, pm] }], TODAY);
    expect(notice.detail).toBe("AM · 08:00–17:00 · Site A, NT · 18:00–02:00 +1 · Site B");
  });

  it("drops past dates and sorts the rest", () => {
    const notices = teamChangeNotices(
      [
        { date: "2026-10-09", before: [], after: [am] },
        { date: "2026-10-04", before: [], after: [am] },
        { date: "2026-10-06", before: [am], after: [] },
      ],
      TODAY,
    );
    expect(notices.map((n) => n.date)).toEqual(["2026-10-06", "2026-10-09"]);
  });
});
