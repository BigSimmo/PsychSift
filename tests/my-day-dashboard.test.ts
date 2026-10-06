import { describe, expect, it } from "vitest";

import { adminNextRenewal } from "@/components/my-day/sources/entries";
import {
  daysUntil,
  dueCountsByDate,
  formatCountdown,
  formatRingFigure,
  parseHiddenCards,
  parseSnoozes,
  selectNeedsYou,
  selectUpNext,
  serialiseHiddenCards,
  snoozeUntil,
  weekOf,
  type MyDayTimedEvent,
} from "@/lib/my-day/dashboard";
import type { MyDayItem } from "@/lib/my-day/model";
import { complianceFixture } from "./helpers/on-call-entry-fixture";

// 12:40 on Sat 3 Oct 2026 in Perth.
const NOW = new Date("2026-10-03T04:40:00Z");
const TODAY = "2026-10-03";

function item(id: string, severity: MyDayItem["severity"] = "info"): MyDayItem {
  return { id, mode: "my-work", title: id, due: null, severity, href: `/x/${id}` };
}

function event(id: string, startsAt: string, endsAt: string, source: MyDayTimedEvent["source"] = "teaching") {
  return { id, source, startsAt, endsAt, title: id, where: "", href: `/${id}`, actionLabel: "Open" };
}

describe("hidden cards", () => {
  it("round-trips known card ids in card order and ignores anything else", () => {
    // v13 replaced the single "renewal" figure with the "renewals" runway, so a
    // stored "renewal" is now an unknown id and is dropped like any other.
    const hidden = parseHiddenCards(JSON.stringify(["renewals", "renewal", "nonsense", "up-next", 3]));
    expect([...hidden].sort()).toEqual(["renewals", "up-next"]);
    expect(serialiseHiddenCards(hidden)).toBe(JSON.stringify(["up-next", "renewals"]));
    // Cards on the Work and Me pages round-trip too.
    expect(serialiseHiddenCards(parseHiddenCards(JSON.stringify(["quick-note", "calls"])))).toBe(
      JSON.stringify(["calls", "quick-note"]),
    );
    expect(parseHiddenCards("not json").size).toBe(0);
    expect(parseHiddenCards(null).size).toBe(0);
  });
});

describe("snoozes", () => {
  it("keeps only well-formed dates still ahead of today", () => {
    expect(
      parseSnoozes(JSON.stringify({ a: "2026-10-04", b: TODAY, c: "2026-10-02", d: "soon", e: 4 }), TODAY),
    ).toEqual({ a: "2026-10-04" });
    expect(parseSnoozes("[]", TODAY)).toEqual({});
    expect(parseSnoozes("{", TODAY)).toEqual({});
  });

  it("moves to tomorrow in Perth, even late in the UTC day", () => {
    expect(snoozeUntil(NOW)).toBe("2026-10-04");
    // 23:30 Perth on 3 Oct is 15:30 UTC the same day.
    expect(snoozeUntil(new Date("2026-10-03T15:30:00Z"))).toBe("2026-10-04");
  });
});

describe("selectNeedsYou", () => {
  it("caps at three in the given order and leaves moved rows out", () => {
    const items = [item("a", "overdue"), item("b", "overdue"), item("c", "soon"), item("d"), item("e")];
    expect(selectNeedsYou(items, {}, TODAY)).toMatchObject({ waiting: 5, total: 5 });
    expect(selectNeedsYou(items, {}, TODAY).shown.map((row) => row.id)).toEqual(["a", "b", "c"]);
    const moved = selectNeedsYou(items, { a: "2026-10-04" }, TODAY);
    expect(moved.shown.map((row) => row.id)).toEqual(["b", "c", "d"]);
    expect(moved).toMatchObject({ waiting: 4, total: 5 });
    expect(selectNeedsYou(items, { a: "2026-10-04" }, "2026-10-04").shown[0]?.id).toBe("a");
  });
});

describe("selectUpNext", () => {
  const teaching = event("teach", "2026-10-03T06:00:00Z", "2026-10-03T07:00:00Z");
  const shift = event("shift", "2026-10-03T09:00:00Z", "2026-10-04T00:30:00Z", "shift");
  const tomorrow = event("tomorrow", "2026-10-04T01:00:00Z", "2026-10-04T02:00:00Z");

  it("picks the earliest thing still to start today", () => {
    expect(selectUpNext([shift, teaching, tomorrow], NOW)).toEqual({ state: "upcoming", event: teaching });
  });

  it("never reaches into tomorrow", () => {
    expect(selectUpNext([tomorrow], NOW)).toBeNull();
  });

  it("falls back to a teaching session on now, but not to a running shift", () => {
    const onNow = event("on-now", "2026-10-03T04:00:00Z", "2026-10-03T05:00:00Z");
    const runningShift = event("running", "2026-10-03T00:30:00Z", "2026-10-03T09:00:00Z", "shift");
    expect(selectUpNext([onNow, runningShift], NOW)).toEqual({ state: "on-now", event: onNow });
    expect(selectUpNext([runningShift], NOW)).toBeNull();
  });
});

describe("countdown wording", () => {
  it("rounds up to the minute and never says zero", () => {
    expect(formatCountdown(80 * 60_000)).toEqual({ short: "1 h 20 min", spoken: "1 hour 20 minutes" });
    expect(formatCountdown(60 * 60_000)).toEqual({ short: "1 h", spoken: "1 hour" });
    expect(formatCountdown(61_000)).toEqual({ short: "2 min", spoken: "2 minutes" });
    expect(formatCountdown(0)).toEqual({ short: "1 min", spoken: "1 minute" });
    expect(formatCountdown(26 * 60 * 60_000)).toEqual({ short: "1 d 2 h", spoken: "1 day 2 hours" });
  });

  it("draws the ring figure as h:mm under a day and days above", () => {
    expect(formatRingFigure(260 * 60_000)).toBe("4:20");
    expect(formatRingFigure(5 * 60_000)).toBe("0:05");
    expect(formatRingFigure(50 * 60 * 60_000)).toBe("2 d");
  });
});

describe("week and dates", () => {
  it("runs Monday to Sunday around today", () => {
    expect(weekOf(TODAY)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("counts dated items by Perth day and skips undated ones", () => {
    const counts = dueCountsByDate([
      { ...item("a"), due: "2026-10-01" },
      { ...item("b"), due: "2026-09-30T17:00:00Z" }, // 01:00 on 1 Oct in Perth
      { ...item("c"), due: null },
    ]);
    expect([...counts]).toEqual([["2026-10-01", 2]]);
    expect(daysUntil("2026-11-24", TODAY)).toBe(52);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
  });
});

describe("adminNextRenewal", () => {
  it("is the first recorded date still ahead, never a passed one", () => {
    const passed = complianceFixture("Fire training", { category: "Training", expiresOn: "2026-09-01" });
    const next = complianceFixture("Medical registration", { category: "Registration", expiresOn: "2026-11-24" });
    const later = complianceFixture("Basic life support", { category: "Training", expiresOn: "2027-03-01" });
    expect(adminNextRenewal([later, passed, next], NOW, false)).toEqual({
      entryId: next.id,
      title: "Medical registration",
      date: "2026-11-24",
      href: `/admin/renewals?item=${next.id}`,
      sample: false,
    });
    expect(adminNextRenewal([passed], NOW, false)).toBeNull();
    expect(adminNextRenewal([], NOW, false)).toBeNull();
  });

  // Codex review on #3234: the capped "Coming up" list filled with passed dates and hid a future one.
  it("still finds the future date behind six passed ones", () => {
    const passedDates = Array.from({ length: 6 }, (_, index) =>
      complianceFixture(`Passed ${index}`, { category: "Training", expiresOn: `2026-0${index + 1}-15` }),
    );
    const future = complianceFixture("Medical registration", { category: "Registration", expiresOn: "2026-11-24" });
    expect(adminNextRenewal([...passedDates, future], NOW, false)?.entryId).toBe(future.id);
  });
});
