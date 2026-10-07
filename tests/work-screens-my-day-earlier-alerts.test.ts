import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALERT_CODES,
  EMPTY_SNAPSHOT,
  addArrival,
  alertRowSub,
  alertRowTitle,
  areaChips,
  clearAlerts,
  filterAlerts,
  groupAlertsByDay,
  markAlertOpened,
  mergeTray,
  parseEarlierAlerts,
  removeAlert,
  sampleEarlierAlerts,
  serializeEarlierAlerts,
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
