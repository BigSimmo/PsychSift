import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALERT_CODES,
  ALERT_MATCH_MS,
  EMPTY_SNAPSHOT,
  addArrival,
  alertRowLabel,
  alertRowSub,
  alertRowTitle,
  areaChips,
  baselineTray,
  clearAlerts,
  filterAlerts,
  groupAlertsByDay,
  isSameAlertTime,
  markAlertOpened,
  mergeTray,
  parseEarlierAlerts,
  removeAlert,
  restoreAlerts,
  sampleEarlierAlerts,
  serializeEarlierAlerts,
  storedEarlierAlertsOwner,
  visibleAlerts,
  type AlertCode,
  type EarlierAlert,
} from "@/lib/work-screens/my-day/earlier-alerts";

/** 2026-10-07 09:30 Perth (a Wednesday). */
const NOW = Date.parse("2026-10-07T09:30:00+08:00");
const HOUR = 60 * 60 * 1000;

function alert(code: AlertCode, at: number, extra: Partial<EarlierAlert> = {}): EarlierAlert {
  return { id: `${code}:${at}`, code, at, approx: false, openedAt: null, ...extra };
}

function serviceWorkerCopy(): Record<string, { title?: string; body: string; path: string }> {
  const source = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
  const start = source.indexOf("const ROSTER_PUSH = ");
  expect(start).toBeGreaterThan(-1);
  const literalStart = source.indexOf("{", start);
  const literalEnd = source.indexOf("\n};", literalStart);
  // A plain object literal of strings in a file this repo owns.
  return new Function(`return ${source.slice(literalStart, literalEnd + 2)}`)() as Record<
    string,
    { title?: string; body: string; path: string }
  >;
}

describe("Earlier alerts copy", () => {
  it("says exactly what the service worker puts on the lock screen, and opens where a lock-screen tap goes", () => {
    const worker = serviceWorkerCopy();
    expect(Object.keys(ALERT_CODES).sort()).toEqual(Object.keys(worker).sort());
    for (const [code, info] of Object.entries(ALERT_CODES)) {
      const shown = worker[code]!;
      expect(info.lockBody).toBe(shown.body);
      expect(info.lockTitle).toBe(shown.title ?? "Roster");
      expect(info.path).toBe(shown.path);
    }
  });

  it("titles a row with the lock screen's first sentence only", () => {
    expect(alertRowTitle("changed")).toBe("Your roster changed");
    expect(alertRowTitle("request")).toBe("Something in Roster is waiting for you");
    expect(alertRowTitle("brief")).toBe("Your morning brief is ready");
    for (const code of Object.keys(ALERT_CODES) as AlertCode[]) {
      expect(ALERT_CODES[code].lockBody.startsWith(alertRowTitle(code))).toBe(true);
      expect(alertRowTitle(code)).not.toMatch(/[;]/);
    }
  });

  it("marks a time-less alert as seen by the time it was read", () => {
    expect(alertRowSub(alert("brief", Date.parse("2026-10-07T07:00:00+08:00")))).toBe("Morning brief · 07:00");
    expect(alertRowSub(alert("reminder", NOW, { approx: true }))).toBe("Reminder · seen by 09:30");
  });
});

describe("Earlier alerts storage", () => {
  it("reads back only this account's list, and nothing unreadable", () => {
    const snapshot = { ...EMPTY_SNAPSHOT, alerts: [alert("brief", NOW - HOUR)] };
    const raw = serializeEarlierAlerts(snapshot, "owner-a");
    expect(parseEarlierAlerts(raw, "owner-a", NOW).alerts).toHaveLength(1);
    expect(parseEarlierAlerts(raw, "owner-b", NOW).alerts).toEqual([]);
    expect(parseEarlierAlerts(raw, "", NOW).alerts).toEqual([]);
    expect(parseEarlierAlerts("{not json", "owner-a", NOW)).toEqual(EMPTY_SNAPSHOT);
    expect(parseEarlierAlerts(JSON.stringify({ v: 2, owner: "owner-a", alerts: [] }), "owner-a", NOW)).toEqual(
      EMPTY_SNAPSHOT,
    );
  });

  it("keeps 7 days, newest first, and drops malformed rows", () => {
    const raw = JSON.stringify({
      v: 1,
      owner: "a",
      alerts: [
        alert("brief", NOW - 8 * 24 * HOUR),
        alert("changed", NOW - 2 * HOUR),
        alert("request", NOW - HOUR),
        { id: "x", code: "nope", at: NOW, approx: false, openedAt: null },
        { id: "y", code: "test", at: "today", approx: false, openedAt: null },
      ],
      trayApprox: {},
      hidden: [],
    });
    expect(parseEarlierAlerts(raw, "a", NOW).alerts.map((row) => row.code)).toEqual(["request", "changed"]);
  });
});

describe("Earlier alerts from the lock screen", () => {
  it("adds a timed alert once, however often the lock screen is read", () => {
    const tray = [{ code: "request" as const, at: NOW - HOUR }];
    const once = mergeTray(EMPTY_SNAPSHOT, tray, NOW);
    const twice = mergeTray(once, tray, NOW + 1000);
    expect(twice.alerts).toHaveLength(1);
    expect(twice.alerts[0]!.id).toBe(`request:${NOW - HOUR}`);
  });

  it("counts alerts the phone gives no time for, adding only new ones", () => {
    const first = mergeTray(EMPTY_SNAPSHOT, [{ code: "brief", at: null }], NOW);
    expect(first.alerts).toHaveLength(1);
    expect(first.alerts[0]!.approx).toBe(true);
    const same = mergeTray(first, [{ code: "brief", at: null }], NOW + 60_000);
    expect(same.alerts).toHaveLength(1);
    const more = mergeTray(
      same,
      [
        { code: "brief", at: null },
        { code: "brief", at: null },
      ],
      NOW + 120_000,
    );
    expect(more.alerts).toHaveLength(2);
  });

  it("does not read back an alert the reader removed or cleared while it is still on the lock screen", () => {
    const tray = [
      { code: "request" as const, at: NOW - HOUR },
      { code: "changed" as const, at: NOW - 2 * HOUR },
    ];
    const read = mergeTray(EMPTY_SNAPSHOT, tray, NOW);
    const removed = removeAlert(read, `request:${NOW - HOUR}`);
    expect(mergeTray(removed, tray, NOW).alerts.map((row) => row.code)).toEqual(["changed"]);
    const cleared = clearAlerts(read);
    expect(mergeTray(cleared, tray, NOW).alerts).toEqual([]);
  });

  it("adds an arrival the worker reported, and marks one opened once", () => {
    const arrived = addArrival(EMPTY_SNAPSHOT, "test", NOW);
    expect(addArrival(arrived, "test", NOW).alerts).toHaveLength(1);
    const opened = markAlertOpened(arrived, `test:${NOW}`, NOW + 5000);
    expect(opened.alerts[0]!.openedAt).toBe(NOW + 5000);
    expect(markAlertOpened(opened, `test:${NOW}`, NOW + 9000).alerts[0]!.openedAt).toBe(NOW + 5000);
  });
});

describe("Earlier alerts view", () => {
  const rows = [
    alert("brief", Date.parse("2026-10-07T07:00:00+08:00")),
    alert("request", Date.parse("2026-10-06T18:12:00+08:00")),
    alert("brief", Date.parse("2026-10-06T07:00:00+08:00")),
    alert("reminder", Date.parse("2026-10-04T14:00:00+08:00")),
    // 23:30 UTC is already the next day in Perth.
    alert("changed", Date.parse("2026-10-04T23:30:00Z")),
  ];

  it("groups by Perth day, newest first", () => {
    const days = groupAlertsByDay(rows, NOW);
    expect(days.map((day) => [day.label, day.alerts.length])).toEqual([
      ["Today", 1],
      ["Yesterday", 2],
      ["Mon 5 Oct", 1],
      ["Sun 4 Oct", 1],
    ]);
  });

  it("offers one chip per area with alerts, and the counts add up to All", () => {
    const chips = areaChips(rows);
    expect(chips.map((chip) => chip.area)).toEqual(["roster", "brief", "reminder"]);
    expect(chips.reduce((sum, chip) => sum + chip.count, 0)).toBe(rows.length);
    expect(filterAlerts(rows, "roster").map((row) => row.code)).toEqual(["request", "changed"]);
    expect(filterAlerts(rows, "all")).toHaveLength(rows.length);
  });

  it("builds a sample that is never in the future", () => {
    const sample = sampleEarlierAlerts(NOW);
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.every((row) => row.at <= NOW)).toBe(true);
  });
});

describe("Earlier alerts heard by an open page and on the lock screen", () => {
  it("lists an alert once when the page heard it arrive and the lock screen shows it a few ms earlier", () => {
    const heard = addArrival(EMPTY_SNAPSHOT, "request", NOW);
    const read = mergeTray(heard, [{ code: "request", at: NOW - 4 }], NOW + 30_000);
    expect(read.alerts).toHaveLength(1);
    // And again on every later read.
    expect(mergeTray(read, [{ code: "request", at: NOW - 4 }], NOW + 90_000).alerts).toHaveLength(1);
  });

  it("still lists a second real alert of the same kind, one lock-screen copy per alert heard", () => {
    const heard = addArrival(EMPTY_SNAPSHOT, "request", NOW);
    const read = mergeTray(
      heard,
      [
        { code: "request", at: NOW - 4 },
        { code: "request", at: NOW + 20_000 },
        { code: "request", at: NOW - 3 * HOUR },
      ],
      NOW + 30_000,
    );
    expect(read.alerts).toHaveLength(3);
  });

  it("does not bring back a heard alert the reader removed when the lock screen still shows it", () => {
    const heard = addArrival(EMPTY_SNAPSHOT, "offer", NOW);
    const removed = removeAlert(heard, `offer:${NOW}`);
    expect(mergeTray(removed, [{ code: "offer", at: NOW - 7 }], NOW + 5000).alerts).toEqual([]);
  });

  it("takes one alert heard by two open tabs as one, and counts it as on a time-less lock screen", () => {
    const first = addArrival(EMPTY_SNAPSHOT, "brief", NOW);
    const second = addArrival(first, "brief", NOW + 3);
    expect(second.alerts).toHaveLength(1);
    expect(second.trayApprox.brief).toBe(1);
    // A phone that gives lock-screen alerts no time: the one now showing is the one already listed.
    expect(mergeTray(second, [{ code: "brief", at: null }], NOW + 60_000).alerts).toHaveLength(1);
    // A different kind at the same moment is a different alert.
    expect(addArrival(second, "test", NOW + 3).alerts).toHaveLength(2);
  });

  it("matches a lock-screen copy to its row by time, within the match window only", () => {
    const row = alert("changed", NOW);
    expect(isSameAlertTime(row, NOW)).toBe(true);
    expect(isSameAlertTime(row, NOW - 5)).toBe(true);
    expect(isSameAlertTime(row, NOW + ALERT_MATCH_MS + 1)).toBe(false);
    expect(isSameAlertTime(row, undefined)).toBe(false);
    expect(isSameAlertTime(alert("changed", NOW, { approx: true }), undefined)).toBe(true);
  });
});

describe("Earlier alerts after another account used this device", () => {
  it("names whose list is kept, without reading it", () => {
    expect(storedEarlierAlertsOwner(serializeEarlierAlerts(EMPTY_SNAPSHOT, "owner-b"))).toBe("owner-b");
    expect(storedEarlierAlertsOwner(null)).toBeNull();
    expect(storedEarlierAlertsOwner("{not json")).toBeNull();
  });

  it("counts what is on the lock screen as already seen, so only later alerts are listed", () => {
    const tray = [
      { code: "manage" as const, at: NOW - HOUR },
      { code: "brief" as const, at: null },
    ];
    const base = baselineTray(EMPTY_SNAPSHOT, tray);
    expect(base.alerts).toEqual([]);
    expect(mergeTray(base, tray, NOW).alerts).toEqual([]);
    const later = mergeTray(base, [...tray, { code: "changed", at: NOW - 60 }], NOW);
    expect(later.alerts.map((row) => row.code)).toEqual(["changed"]);
  });
});

describe("Earlier alerts Clear and Undo", () => {
  const read = mergeTray(
    EMPTY_SNAPSHOT,
    [
      { code: "request", at: NOW - HOUR },
      { code: "changed", at: NOW - 2 * HOUR },
      { code: "brief", at: NOW - 3 * HOUR },
    ],
    NOW,
  );

  it("clears only the rows asked for", () => {
    const cleared = clearAlerts(read, [`request:${NOW - HOUR}`, `changed:${NOW - 2 * HOUR}`]);
    expect(cleared.alerts.map((row) => row.code)).toEqual(["brief"]);
    expect(cleared.hidden).toEqual([`request:${NOW - HOUR}`, `changed:${NOW - 2 * HOUR}`]);
  });

  it("puts removed rows back into the list as it is now, keeping newer alerts and other removals", () => {
    const request = read.alerts.find((row) => row.code === "request")!;
    const changed = read.alerts.find((row) => row.code === "changed")!;
    const afterFirst = removeAlert(read, request.id);
    const afterSecond = addArrival(removeAlert(afterFirst, changed.id), "test", NOW + 1000);
    // Undo of the first removal only.
    const undone = restoreAlerts(afterSecond, [request], NOW + 2000);
    expect(undone.alerts.map((row) => row.code)).toEqual(["test", "request", "brief"]);
    expect(undone.hidden).toEqual([changed.id]);
    // Pressing it twice changes nothing more.
    expect(restoreAlerts(undone, [request], NOW + 3000).alerts).toHaveLength(3);
  });
});

describe("Earlier alerts at the edges of the day and the week", () => {
  it("drops from view what passed 7 days while the page was open", () => {
    const rows = [alert("brief", NOW - 7 * 24 * HOUR - 1), alert("changed", NOW - 6 * 24 * HOUR)];
    expect(visibleAlerts(rows, NOW).map((row) => row.code)).toEqual(["changed"]);
  });

  it("never heads an alert that arrived just after Perth midnight above Today", () => {
    const beforeMidnight = Date.parse("2026-10-07T23:59:30+08:00");
    const justAfter = Date.parse("2026-10-08T00:00:10+08:00");
    const days = groupAlertsByDay(
      [alert("brief", justAfter), alert("changed", Date.parse("2026-10-07T18:00:00+08:00"))],
      beforeMidnight,
    );
    expect(days.map((day) => day.label)).toEqual(["Today", "Yesterday"]);
  });

  it("says the day and the state in the row's spoken label", () => {
    const row = alert("request", Date.parse("2026-10-06T18:12:00+08:00"));
    expect(alertRowLabel(row, "Yesterday")).toBe(
      "Something in Roster is waiting for you. Roster · 18:12, Yesterday. New. Opens Roster swaps.",
    );
    expect(alertRowLabel({ ...row, openedAt: NOW }, "Yesterday")).toContain(". Opened. ");
  });
});
